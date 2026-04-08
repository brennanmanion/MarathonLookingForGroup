import type { FastifyInstance } from 'fastify';

import {
  acceptPartyMember,
  cancelParty,
  createParty,
  declinePartyMember,
  getParty,
  joinParty,
  kickPartyMember,
  leaveParty,
  listParties
} from '../parties.js';
import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import { AppError } from '../errors.js';
import type { PartyEventBus, PartyRealtimeEventType } from '../party-events.js';
import type { CreatePartyBody, UpdatePartyBody } from '../types.js';
import { findOptionalCurrentUser, requireCurrentUser } from '../users.js';

async function notImplemented(): Promise<never> {
  throw new AppError(501, 'not_implemented', 'Party endpoints have not been implemented yet');
}

async function partyEditDeferred(): Promise<never> {
  throw new AppError(
    501,
    'party_edit_deferred',
    'Party editing is deferred for the current MVP. Planned host-only edits include title, max size, schedule, requirements, description, and tags.'
  );
}

const createPartyBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'activityKey', 'maxSize'],
  properties: {
    title: { type: 'string', minLength: 1 },
    activityKey: { type: 'string', minLength: 1 },
    playlistKey: { type: 'string' },
    platformKey: { type: 'string' },
    regionKey: { type: 'string' },
    languageKey: { type: 'string' },
    voiceRequired: { type: 'boolean' },
    ranked: { type: 'boolean' },
    scheduledFor: { type: 'string' },
    maxSize: { type: 'integer', minimum: 1 },
    approvalMode: { type: 'string' },
    visibility: { type: 'string' },
    requiresMarathonVerified: { type: 'boolean' },
    requirementText: { type: 'string' },
    description: { type: 'string' },
    externalJoinUrl: { type: 'string' },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tagKey'],
        properties: {
          tagKey: { type: 'string', minLength: 1 },
          tagValue: { type: 'string' }
        }
      }
    }
  }
} as const;

const joinPartyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    noteToHost: { type: 'string' }
  }
} as const;

const nullableStringSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'null' }
  ]
} as const;

const nullableBooleanSchema = {
  anyOf: [
    { type: 'boolean' },
    { type: 'null' }
  ]
} as const;

const updatePartyBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1 },
    playlistKey: nullableStringSchema,
    platformKey: { type: 'string', minLength: 1 },
    regionKey: nullableStringSchema,
    languageKey: nullableStringSchema,
    voiceRequired: { type: 'boolean' },
    ranked: nullableBooleanSchema,
    scheduledFor: nullableStringSchema,
    maxSize: { type: 'integer', minimum: 1 },
    approvalMode: { type: 'string', minLength: 1 },
    visibility: { type: 'string', minLength: 1 },
    requiresMarathonVerified: { type: 'boolean' },
    requirementText: nullableStringSchema,
    description: nullableStringSchema,
    externalJoinUrl: nullableStringSchema,
    tags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tagKey'],
        properties: {
          tagKey: { type: 'string', minLength: 1 },
          tagValue: nullableStringSchema
        }
      }
    }
  }
} as const;

const memberActionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['partyId', 'memberId'],
  properties: {
    partyId: { type: 'string', minLength: 1 },
    memberId: { type: 'string', minLength: 1 }
  }
} as const;

const partyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['partyId'],
  properties: {
    partyId: { type: 'string', minLength: 1 }
  }
} as const;

function requirePartyDb(db: DbAdapter | null): DbAdapter {
  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  return db;
}

async function loadPartyHostUserId(db: DbAdapter | null, partyId: string): Promise<string> {
  const database = requirePartyDb(db);
  const result = await database.query<{ host_user_id: string }>(
    `
      select host_user_id::text
      from parties
      where id = $1
      limit 1
    `,
    [partyId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'party_not_found', 'Party not found');
  }

  return row.host_user_id;
}

async function loadPartyMemberUserId(db: DbAdapter | null, partyId: string, memberId: string): Promise<string> {
  const database = requirePartyDb(db);
  const result = await database.query<{ user_id: string }>(
    `
      select user_id::text
      from party_members
      where party_id = $1
        and id = $2
      limit 1
    `,
    [partyId, memberId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'party_member_not_found', 'Party membership was not found');
  }

  return row.user_id;
}

async function loadActivePartyMemberUserIds(db: DbAdapter | null, partyId: string): Promise<string[]> {
  const database = requirePartyDb(db);
  const result = await database.query<{ user_id: string }>(
    `
      select distinct user_id::text
      from party_members
      where party_id = $1
        and status in ('pending', 'accepted')
    `,
    [partyId]
  );

  return result.rows.map((row) => row.user_id);
}

function publishPartyEvent(
  deps: { partyEvents: PartyEventBus },
  input: {
    recipients: string[];
    type: PartyRealtimeEventType;
    partyId: string;
    actorUserId: string;
  }
): void {
  deps.partyEvents.publishToUsers(input.recipients, {
    type: input.type,
    partyId: input.partyId,
    actorUserId: input.actorUserId
  });
}

export async function registerPartyRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; db: DbAdapter | null; partyEvents: PartyEventBus }
): Promise<void> {
  app.post<{ Body: CreatePartyBody }>('/parties', {
    schema: {
      body: createPartyBodySchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const result = await createParty(deps.db, user, request.body);
    return reply.code(201).send(result);
  });

  app.get('/parties', async (request, reply) => {
    const user = await findOptionalCurrentUser(request, deps.db, deps.config);
    const result = await listParties(deps.db, user);
    return reply.code(200).send(result);
  });

  app.get<{ Params: { partyId: string } }>('/parties/:partyId', {
    schema: {
      params: partyParamsSchema
    }
  }, async (request, reply) => {
    const user = await findOptionalCurrentUser(request, deps.db, deps.config);
    const result = await getParty(deps.db, user, request.params.partyId);
    return reply.code(200).send(result);
  });

  app.patch<{ Params: { partyId: string }; Body: UpdatePartyBody }>('/parties/:partyId', {
    schema: {
      params: partyParamsSchema,
      body: updatePartyBodySchema
    }
  }, async (request) => {
    await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    return partyEditDeferred();
  });
  app.post<{ Params: { partyId: string }; Body: { noteToHost?: string } }>('/parties/:partyId/join', {
    schema: {
      params: partyParamsSchema,
      body: joinPartyBodySchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const hostUserId = await loadPartyHostUserId(deps.db, request.params.partyId);
    const result = await joinParty(deps.db, user, request.params.partyId, request.body?.noteToHost);

    publishPartyEvent(deps, {
      recipients: hostUserId === user.userId ? [] : [hostUserId],
      type: result.myStatus === 'accepted' ? 'party.join_accepted' : 'party.join_requested',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string } }>('/parties/:partyId/leave', {
    schema: {
      params: partyParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const hostUserId = await loadPartyHostUserId(deps.db, request.params.partyId);
    const result = await leaveParty(deps.db, user, request.params.partyId);

    publishPartyEvent(deps, {
      recipients: hostUserId === user.userId ? [] : [hostUserId],
      type: 'party.left',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string } }>('/parties/:partyId/cancel', {
    schema: {
      params: partyParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const activeMemberUserIds = await loadActivePartyMemberUserIds(deps.db, request.params.partyId);
    const result = await cancelParty(deps.db, user, request.params.partyId);

    publishPartyEvent(deps, {
      recipients: activeMemberUserIds.filter((memberUserId) => memberUserId !== user.userId),
      type: 'party.cancelled',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });
  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/accept', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const affectedUserId = await loadPartyMemberUserId(deps.db, request.params.partyId, request.params.memberId);
    const result = await acceptPartyMember(deps.db, user, request.params.partyId, request.params.memberId);

    publishPartyEvent(deps, {
      recipients: affectedUserId === user.userId ? [] : [affectedUserId],
      type: 'party.join_accepted',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/decline', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const affectedUserId = await loadPartyMemberUserId(deps.db, request.params.partyId, request.params.memberId);
    const result = await declinePartyMember(deps.db, user, request.params.partyId, request.params.memberId);

    publishPartyEvent(deps, {
      recipients: affectedUserId === user.userId ? [] : [affectedUserId],
      type: 'party.join_declined',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/kick', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const affectedUserId = await loadPartyMemberUserId(deps.db, request.params.partyId, request.params.memberId);
    const result = await kickPartyMember(deps.db, user, request.params.partyId, request.params.memberId);

    publishPartyEvent(deps, {
      recipients: affectedUserId === user.userId ? [] : [affectedUserId],
      type: 'party.kicked',
      partyId: result.partyId,
      actorUserId: user.userId
    });

    return reply.code(200).send(result);
  });
}
