import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import { AppError } from '../errors.js';
import { requireCurrentUser } from '../users.js';

export async function registerMeRoutes(app: FastifyInstance, deps: { config: AppConfig; db: DbAdapter | null }): Promise<void> {
  app.get('/me', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);
    return reply.code(200).send({
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
    });
  });

  app.post('/me/bungie/resync', async () => {
    throw new AppError(501, 'not_implemented', 'Bungie resync has not been implemented yet');
  });
}
