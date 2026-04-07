import type { FastifyInstance } from 'fastify';

import { resyncBungieAccount } from '../bungie.js';
import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import type { CurrentUser } from '../users.js';
import { requireCurrentUser } from '../users.js';

function formatPrimaryDisplayName(user: CurrentUser): string {
  if (user.bungieGlobalDisplayName) {
    if (
      user.bungieGlobalDisplayNameCode !== null &&
      !user.bungieGlobalDisplayName.includes('#')
    ) {
      return `${user.bungieGlobalDisplayName}#${String(user.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }

    return user.bungieGlobalDisplayName;
  }

  if (user.bungieDisplayName) {
    return user.bungieDisplayName;
  }

  return `Guardian ${user.userId.slice(0, 8)}`;
}

function serializeMe(user: CurrentUser) {
  return {
    userId: user.userId,
    profile: {
      primaryDisplayName: formatPrimaryDisplayName(user),
      bungieDisplayName: user.bungieDisplayName,
      bungieGlobalDisplayName: user.bungieGlobalDisplayName,
      bungieGlobalDisplayNameCode: user.bungieGlobalDisplayNameCode
    },
    bungie: {
      membershipId: user.bungieMembershipId,
      displayName: user.bungieDisplayName,
      globalDisplayName: user.bungieGlobalDisplayName,
      globalDisplayNameCode: user.bungieGlobalDisplayNameCode,
      verified: user.bungieVerified
    },
    marathon: {
      membershipId: user.marathonMembershipId,
      verified: user.marathonVerified
    },
    capabilities: {
      canCreateParty: user.marathonVerified,
      canUsePwaPartyWrites: user.marathonVerified,
      canUsePwaBungieResync: Boolean(user.bungieMembershipId)
    },
    pwa: {
      appBasePath: '/app',
      loginPath: '/app/login',
      callbackSuccessPath: '/app/auth/callback/success',
      callbackErrorPath: '/app/auth/callback/error',
      sessionPath: '/auth/session',
      mePath: '/me',
      resyncPath: '/me/bungie/resync',
      partiesPath: '/parties',
      cookieAuth: true,
      csrfRequired: true
    },
    lastMembershipSyncAt: user.lastMembershipSyncAt
  };
}

export async function registerMeRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    db: DbAdapter | null;
    bungieFetch?: typeof fetch;
  }
): Promise<void> {
  app.get('/me', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    return reply.code(200).send(serializeMe(user));
  });

  app.post('/me/bungie/resync', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config, {
      allowCookieMutation: true
    });
    const refreshed = await resyncBungieAccount(deps.db, deps.config, user, deps.bungieFetch);
    return reply.code(200).send(serializeMe(refreshed));
  });
}
