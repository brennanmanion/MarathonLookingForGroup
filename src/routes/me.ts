import type { FastifyInstance } from 'fastify';

import { resyncBungieAccount } from '../bungie.js';
import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import type { CurrentUser } from '../users.js';
import { requireCurrentUser } from '../users.js';

function serializeMe(user: CurrentUser) {
  return {
    userId: user.userId,
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
    lastMembershipSyncAt: user.lastMembershipSyncAt
  };
}

export async function registerMeRoutes(app: FastifyInstance, deps: { config: AppConfig; db: DbAdapter | null }): Promise<void> {
  app.get('/me', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    return reply.code(200).send(serializeMe(user));
  });

  app.post('/me/bungie/resync', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    const refreshed = await resyncBungieAccount(deps.db, deps.config, user);
    return reply.code(200).send(serializeMe(refreshed));
  });
}
