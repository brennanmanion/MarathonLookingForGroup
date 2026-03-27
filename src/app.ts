import Fastify from 'fastify';

import type { AppConfig } from './config.js';
import type { DbAdapter } from './db.js';
import { isAppError } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';
import { registerPartyRoutes } from './routes/parties.js';

export interface AppServices {
  bungieFetch?: typeof fetch;
}

export async function createApp(config: AppConfig, db: DbAdapter | null, services: AppServices = {}) {
  const app = Fastify({
    logger: config.nodeEnv !== 'test'
  });

  if (db) {
    app.addHook('onClose', async () => {
      await db.close();
    });
  }

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

  await registerHealthRoutes(app);
  await registerAuthRoutes(app, services.bungieFetch ? { config, db, bungieFetch: services.bungieFetch } : { config, db });
  await registerMeRoutes(app, { config, db });
  await registerPartyRoutes(app, { config, db });

  return app;
}
