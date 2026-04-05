import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

const openApiPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
const openApiBaseDir = path.dirname(openApiPath);

export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    mode: 'static',
    specification: {
      path: openApiPath,
      baseDir: openApiBaseDir
    }
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    },
    staticCSP: true,
    transformStaticCSP: (header) => header
  });
}
