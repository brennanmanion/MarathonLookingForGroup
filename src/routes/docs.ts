import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

const OPENAPI_FILE = new URL('../../openapi.yaml', import.meta.url);

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Marathon LFG API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
    <style>
      body {
        margin: 0;
        background: #0f1724;
      }
      .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        persistAuthorization: true,
        tryItOutEnabled: true
      });
    </script>
  </body>
</html>
`;

export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/docs', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(SWAGGER_HTML);
  });

  app.get('/docs/', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(SWAGGER_HTML);
  });

  app.get('/openapi.yaml', async (_request, reply) => {
    const file = await readFile(OPENAPI_FILE);
    reply.header('Cache-Control', 'no-store');
    return reply.type('application/yaml; charset=utf-8').send(file);
  });
}
