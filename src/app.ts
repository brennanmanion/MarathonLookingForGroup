import Fastify from 'fastify';

import type { AppConfig } from './config.js';
import type { DbAdapter } from './db.js';
import { registerDocs } from './docs.js';
import { isAppError } from './errors.js';
import { InMemoryPartyEventBus, type PartyEventBus } from './party-events.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDocsRoutes } from './routes/docs.js';
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';
import { registerPartyRoutes } from './routes/parties.js';
import { registerWebRoutes } from './routes/web.js';

export interface AppServices {
  bungieFetch?: typeof fetch;
  partyEvents?: PartyEventBus;
}

export async function createApp(config: AppConfig, db: DbAdapter | null, services: AppServices = {}) {
  const app = Fastify({
    logger: config.nodeEnv !== 'test'
  });
  const partyEvents = services.partyEvents ?? new InMemoryPartyEventBus();

  if (db) {
    app.addHook('onClose', async () => {
      await db.close();
    });
  }

  app.addHook('onClose', async () => {
    partyEvents.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message
      });
    }

    request.log?.error?.(error);
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Unexpected server error'
    });
  });

  await registerDocs(app);
  await registerHealthRoutes(app);
  await registerDocsRoutes(app);
  await registerEventRoutes(app, { config, db, partyEvents });
  await registerAuthRoutes(app, services.bungieFetch ? { config, db, bungieFetch: services.bungieFetch } : { config, db });
  await registerMeRoutes(app, services.bungieFetch ? { config, db, bungieFetch: services.bungieFetch } : { config, db });
  await registerPartyRoutes(app, { config, db, partyEvents });
  await registerWebRoutes(app);

  return app;
}
