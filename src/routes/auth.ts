import type { FastifyInstance } from 'fastify';

import { logoutAppSession, refreshAppSession } from '../app-sessions.js';
import { consumeHandoffTicket, handleBungieCallback, startBungieLogin } from '../bungie.js';
import type { AppConfig } from '../config.js';
import {
  clearWebSessionCookies,
  getRefreshTokenFromCookies,
  hasWebSessionCookies,
  requireCsrfToken,
  setWebSessionCookies
} from '../cookies.js';
import type { DbAdapter } from '../db.js';
import { AppError } from '../errors.js';
import type { BungieStartBody, HandoffConsumeBody, RefreshTokenBody } from '../types.js';
import { findSessionCurrentUser } from '../users.js';

const startBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    platform: { type: 'string' },
    appState: { type: 'string' },
    returnTo: { type: 'string' },
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
  properties: {
    refreshToken: { type: 'string', minLength: 1 }
  }
} as const;

const optionalRefreshBodySchema = {
  anyOf: [
    refreshBodySchema,
    { type: 'null' }
  ]
} as const;

interface AuthRouteDeps {
  config: AppConfig;
  db: DbAdapter | null;
  bungieFetch?: typeof fetch;
}

function getRefreshTokenFromRequest(request: {
  body?: RefreshTokenBody | null;
  headers: Record<string, unknown>;
}): { refreshToken: string; source: 'body' | 'cookie' | 'none' } {
  const bodyToken = request.body?.refreshToken?.trim();
  if (bodyToken) {
    return {
      refreshToken: bodyToken,
      source: 'body'
    };
  }

  const cookieToken = getRefreshTokenFromCookies(request as never);
  if (cookieToken) {
    return {
      refreshToken: cookieToken,
      source: 'cookie'
    };
  }

  return {
    refreshToken: '',
    source: 'none'
  };
}

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.get('/auth/session', async (request, reply) => {
    const user = await findSessionCurrentUser(request, deps.db, deps.config);

    if (!user) {
      return reply.code(200).send({
        authenticated: false
      });
    }

    return reply.code(200).send({
      authenticated: true,
      user: {
        userId: user.userId
      }
    });
  });

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
    const result = await handleBungieCallback(
      deps.db,
      deps.config,
      request.query,
      deps.bungieFetch
        ? {
            fetchImpl: deps.bungieFetch,
            metadata: {
              ip: request.ip,
              userAgent: request.headers['user-agent']
            }
          }
        : {
            metadata: {
              ip: request.ip,
              userAgent: request.headers['user-agent']
            }
          }
    );

    if (result.session) {
      setWebSessionCookies(reply, deps.config, result.session);
    }

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

  app.post<{ Body: RefreshTokenBody | null }>('/auth/refresh', {
    schema: {
      body: optionalRefreshBodySchema
    }
  }, async (request, reply) => {
    const tokenInput = getRefreshTokenFromRequest(request);
    if (tokenInput.source === 'none') {
      throw new AppError(400, 'refresh_token_required', 'Refresh token is required');
    }

    if (tokenInput.source === 'cookie') {
      requireCsrfToken(request);
    }

    const result = await refreshAppSession(deps.db, deps.config, tokenInput.refreshToken, {
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });

    if (tokenInput.source === 'cookie') {
      setWebSessionCookies(reply, deps.config, result);

      return reply.code(200).send({
        ok: true,
        expiresIn: result.expiresIn,
        refreshExpiresIn: result.refreshExpiresIn
      });
    }

    return reply.code(200).send(result);
  });

  app.post<{ Body: RefreshTokenBody | null }>('/auth/logout', {
    schema: {
      body: optionalRefreshBodySchema
    }
  }, async (request, reply) => {
    const tokenInput = getRefreshTokenFromRequest(request);
    const cookieSessionPresent = hasWebSessionCookies(request);

    if (tokenInput.source === 'cookie' || (tokenInput.source === 'none' && cookieSessionPresent)) {
      requireCsrfToken(request);
    }

    if (tokenInput.source !== 'none') {
      await logoutAppSession(deps.db, tokenInput.refreshToken);
    }

    if (tokenInput.source === 'cookie' || cookieSessionPresent) {
      clearWebSessionCookies(reply, deps.config);
    }

    const result = { ok: true };
    return reply.code(200).send(result);
  });
}
