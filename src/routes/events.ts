import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config.js';
import type { DbAdapter } from '../db.js';
import type { PartyEventBus, PartyRealtimeEvent } from '../party-events.js';
import { requireCurrentUser } from '../users.js';

const KEEPALIVE_INTERVAL_MS = 25_000;

function writeEventChunk(reply: { raw: NodeJS.WritableStream }, event: PartyRealtimeEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function registerEventRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    db: DbAdapter | null;
    partyEvents: PartyEventBus;
  }
): Promise<void> {
  app.get('/events/stream', async (request, reply) => {
    const user = await requireCurrentUser(request, deps.db, deps.config);

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();
    reply.raw.write(': connected\n\n');

    const unsubscribe = deps.partyEvents.subscribe(user.userId, (event) => {
      writeEventChunk(reply, event);
    });

    const keepalive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, KEEPALIVE_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(keepalive);
      unsubscribe();
      reply.raw.off('close', cleanup);
      reply.raw.off('error', cleanup);
    };

    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
  });
}
