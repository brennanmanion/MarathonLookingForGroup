import type { FastifyInstance } from 'fastify';

import { acceptPartyMember, createParty, declinePartyMember, joinParty, kickPartyMember } from '../parties.js';
import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import { AppError } from '../errors.js';
import type { CreatePartyBody } from '../types.js';
import { requireCurrentUser } from '../users.js';

async function notImplemented(): Promise<never> {
  throw new AppError(501, 'not_implemented', 'Party endpoints have not been implemented yet');
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

const memberActionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['partyId', 'memberId'],
  properties: {
    partyId: { type: 'string', minLength: 1 },
    memberId: { type: 'string', minLength: 1 }
  }
} as const;

export async function registerPartyRoutes(app: FastifyInstance, deps: { config: AppConfig; db: DbAdapter | null }): Promise<void> {
  app.post<{ Body: CreatePartyBody }>('/parties', {
    schema: {
      body: createPartyBodySchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const result = await createParty(deps.db, user, request.body);
    return reply.code(201).send(result);
  });

  app.get('/parties', notImplemented);
  app.get('/parties/:partyId', notImplemented);
  app.patch('/parties/:partyId', notImplemented);
  app.post<{ Params: { partyId: string }; Body: { noteToHost?: string } }>('/parties/:partyId/join', {
    schema: {
      body: joinPartyBodySchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const result = await joinParty(deps.db, user, request.params.partyId, request.body?.noteToHost);
    return reply.code(200).send(result);
  });

  app.post('/parties/:partyId/leave', notImplemented);
  app.post('/parties/:partyId/cancel', notImplemented);
  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/accept', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const result = await acceptPartyMember(deps.db, user, request.params.partyId, request.params.memberId);
    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/decline', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const result = await declinePartyMember(deps.db, user, request.params.partyId, request.params.memberId);
    return reply.code(200).send(result);
  });

  app.post<{ Params: { partyId: string; memberId: string } }>('/parties/:partyId/members/:memberId/kick', {
    schema: {
      params: memberActionParamsSchema
    }
  }, async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const result = await kickPartyMember(deps.db, user, request.params.partyId, request.params.memberId);
    return reply.code(200).send(result);
  });
}
