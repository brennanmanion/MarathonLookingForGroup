import { access, readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import type { FastifyInstance, FastifyReply } from 'fastify';

const LEGACY_WEB_ROOT = new URL('../../apps/web/', import.meta.url);
const DIST_WEB_ROOT = new URL('../../apps/web/dist/', import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function contentTypeFor(relativePath: string): string {
  return CONTENT_TYPES[extname(relativePath)] ?? 'application/octet-stream';
}

async function fileExists(url: URL): Promise<boolean> {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function loadWebFile(root: URL, relativePath: string): Promise<Buffer> {
  return readFile(new URL(relativePath, root));
}

async function sendWebFile(
  reply: FastifyReply,
  root: URL,
  relativePath: string,
  cacheControl?: string
): Promise<unknown> {
  const file = await loadWebFile(root, relativePath);
  reply.header(
    'Cache-Control',
    cacheControl ?? (relativePath.endsWith('.html') ? 'no-store' : 'public, max-age=300')
  );
  return reply.type(contentTypeFor(relativePath)).send(file);
}

export async function registerWebRoutes(app: FastifyInstance): Promise<void> {
  const hasBuiltApp = await fileExists(new URL('index.html', DIST_WEB_ROOT));
  const shellRoot = hasBuiltApp ? DIST_WEB_ROOT : LEGACY_WEB_ROOT;
  const shellIndexPath = hasBuiltApp ? 'index.html' : 'legacy.html';
  const staticRoot = hasBuiltApp ? DIST_WEB_ROOT : LEGACY_WEB_ROOT;

  const shellPaths = [
    '/app',
    '/app/',
    '/app/login',
    '/app/parties',
    '/app/parties/new',
    '/app/me',
    '/app/auth/callback/success',
    '/app/auth/callback/error'
  ];

  for (const routePath of shellPaths) {
    app.get(routePath, async (_request, reply) =>
      sendWebFile(reply, shellRoot, shellIndexPath)
    );
  }

  app.get('/app/parties/:partyId', async (_request, reply) =>
    sendWebFile(reply, shellRoot, shellIndexPath)
  );

  app.get('/app/assets/*', async (request, reply) => {
    const relativeAssetPath = (request.params as { '*': string })['*'];
    return sendWebFile(reply, staticRoot, `assets/${relativeAssetPath}`, 'public, max-age=300');
  });

  app.get('/app/manifest.webmanifest', async (_request, reply) =>
    sendWebFile(reply, staticRoot, 'manifest.webmanifest', 'public, max-age=300')
  );

  app.get('/app/icon.svg', async (_request, reply) =>
    sendWebFile(reply, staticRoot, 'icon.svg', 'public, max-age=300')
  );
}
