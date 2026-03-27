import type { FastifyInstance } from 'fastify';

import { logoutAppSession, refreshAppSession } from '../app-sessions.js';
import { consumeHandoffTicket, handleBungieCallback, startBungieLogin } from '../bungie.js';
import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import type { BungieStartBody, HandoffConsumeBody, RefreshTokenBody } from '../types.js';

const startBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    platform: { type: 'string' },
    appState: { type: 'string' },
    redirectMode: { type: 'string', enum: ['native', 'web'] }
  }
} as const;

const handoffBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ticket', 'loginId'],
  properties: {
    ticket: { type: 'string' },
    loginId: { type: 'string' }
  }
} as const;

const refreshBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['refreshToken'],
  properties: {
    refreshToken: { type: 'string', minLength: 1 }
  }
} as const;

export async function registerAuthRoutes(app: FastifyInstance, deps: { config: AppConfig; db: DbAdapter | null }): Promise<void> {
  app.post<{ Body: BungieStartBody }>('/auth/bungie/start', {
    schema: {
      body: startBodySchema
    }
  }, async (request, reply) => {
    const response = await startBungieLogin(deps.db, deps.config, request.body ?? {});
    return reply.code(200).send(response);
  });

  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>('/auth/bungie/callback', async (request, reply) => {
    const result = await handleBungieCallback(deps.db, deps.config, request.query);
    return reply.redirect(result.redirectUrl);
  });

  app.post<{ Body: HandoffConsumeBody }>('/auth/bungie/handoff/consume', {
    schema: {
      body: handoffBodySchema
    }
  }, async (request, reply) => {
    const result = await consumeHandoffTicket(deps.db, deps.config, request.body, {
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });

    return reply.code(200).send(result);
  });

  app.post<{ Body: RefreshTokenBody }>('/auth/refresh', {
    schema: {
      body: refreshBodySchema
    }
  }, async (request, reply) => {
    const result = await refreshAppSession(deps.db, deps.config, request.body.refreshToken, {
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });

    return reply.code(200).send(result);
  });

  app.post<{ Body: RefreshTokenBody }>('/auth/logout', {
    schema: {
      body: refreshBodySchema
    }
  }, async (request, reply) => {
    const result = await logoutAppSession(deps.db, request.body.refreshToken);
    return reply.code(200).send(result);
  });
}
