/**
 * Read-only admin API for the debug view (Epic #119, story 8.2). See docs/architecture.md (Admin API).
 *
 *   GET /admin/api/games                       open games with clock and trace counts
 *   GET /admin/api/games/:id/state             master state snapshot (unfiltered; never sent to clients)
 *   GET /admin/api/games/:id/entries           trace entries: ?kind= &correlationId= &after= &limit=
 *   GET /admin/api/games/:id/stream            server-sent events of new entries; ?after= replays first
 *
 * Gating: `buildApp` registers this plugin only when the admin view is enabled, so otherwise every
 * `/admin` path is an ordinary 404. When enabled, a request must come from a loopback address or
 * carry the admin token (`Authorization: Bearer` or `?token=`). Only GET routes exist, and they
 * share no code with the game clients' views (`api/sideView.ts`, `api/hub.ts`).
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GameHost } from '../game/index.js';
import type { TraceEntry, TraceStore } from '../debug/trace.js';

export const ADMIN_PREFIX = '/admin/api';
export const DEFAULT_ENTRY_LIMIT = 200;
export const MAX_ENTRY_LIMIT = 1000;
const HEARTBEAT_MS = 15_000;

export interface AdminOptions {
  host: GameHost;
  trace: TraceStore;
  /** Lets non-loopback callers in when they present it. Unset: loopback only. */
  token?: string;
}

/** Settings read from the environment: `ADMIN_ENABLED` turns the view on, `ADMIN_TOKEN` is the optional remote token. */
export function adminFromEnv(env: Record<string, string | undefined>): {
  enabled: boolean;
  token?: string;
} {
  const flag = env.ADMIN_ENABLED?.trim().toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on';
  return { enabled, token: env.ADMIN_TOKEN?.trim() || undefined };
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(a) === 4) return a.startsWith('127.');
  return a === '::1';
}

function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function givenToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const q = (req.query as { token?: unknown }).token;
  return typeof q === 'string' ? q : undefined;
}

const KINDS = ['request', 'command', 'engine', 'clock', 'error', 'llm'] as const;
const EntryQuery = z.object({
  kind: z.enum(KINDS).optional(),
  correlationId: z.string().min(1).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ENTRY_LIMIT).optional(),
  token: z.string().optional(),
});

export async function adminApi(server: FastifyInstance, options: AdminOptions): Promise<void> {
  const { host, trace } = options;
  const streams = new Set<() => void>();

  server.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(ADMIN_PREFIX)) return;
    // A proxy on the same host connects over loopback, but always forwards the caller's address in a header.
    const proxied =
      req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined;
    if (!proxied && isLoopback(req.socket.remoteAddress)) return;
    if (tokenMatches(givenToken(req), options.token)) return;
    return reply.code(401).send({ error: 'admin_unauthorized' });
  });

  // preClose runs before the server waits for open connections, which a live stream would hold forever.
  server.addHook('preClose', async () => {
    for (const end of [...streams]) end();
  });

  server.get(`${ADMIN_PREFIX}/games`, async () => ({
    games: [...new Set([...trace.gameIds(), ...host.ids()])].map((id) => {
      const actor = host.get(id);
      return {
        id,
        open: actor !== undefined,
        gameMs: actor?.state.time,
        clock: actor?.gameClock.snapshot(),
        staffAtWork: actor?.staffAtWork,
        entries: trace.entries(id).length,
      };
    }),
  }));

  server.get<{ Params: { id: string } }>(`${ADMIN_PREFIX}/games/:id/state`, async (req, reply) => {
    const actor = host.get(req.params.id);
    if (!actor) return reply.code(404).send({ error: 'no_such_game' });
    return {
      id: actor.id,
      clock: actor.gameClock.snapshot(),
      clockHistory: actor.gameClock.history(),
      staffAtWork: actor.staffAtWork,
      engine: actor.state,
    };
  });

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    `${ADMIN_PREFIX}/games/:id/entries`,
    async (req, reply) => {
      const q = EntryQuery.safeParse(req.query);
      if (!q.success)
        return reply.code(400).send({ error: 'bad_request', message: q.error.message });
      const { id } = req.params;
      if (!host.get(id) && trace.entries(id).length === 0) {
        return reply.code(404).send({ error: 'no_such_game' });
      }
      const limit = q.data.limit ?? DEFAULT_ENTRY_LIMIT;
      const entries = trace.page(id, {
        kind: q.data.kind,
        correlationId: q.data.correlationId,
        afterSeq: q.data.after,
        limit,
      });
      // `next` is the cursor for the following page; absent when this page was the last.
      return {
        entries,
        next: entries.length === limit ? entries[entries.length - 1]!.seq : undefined,
      };
    },
  );

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    `${ADMIN_PREFIX}/games/:id/stream`,
    async (req, reply) => {
      const q = EntryQuery.safeParse(req.query);
      if (!q.success)
        return reply.code(400).send({ error: 'bad_request', message: q.error.message });
      const { id } = req.params;
      if (!host.get(id) && trace.entries(id).length === 0) {
        return reply.code(404).send({ error: 'no_such_game' });
      }
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      let lastSeq = q.data.after ?? 0;
      const send = (e: TraceEntry) => {
        if (e.gameId !== id || e.seq <= lastSeq) return;
        if (q.data.kind && e.kind !== q.data.kind) return;
        if (q.data.correlationId && e.correlationId !== q.data.correlationId) return;
        lastSeq = e.seq;
        res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      // Subscribe before replaying the backlog so nothing recorded in between is missed;
      // `lastSeq` drops duplicates.
      const unsubscribe = trace.subscribe(send);
      for (const e of trace.page(id, { afterSeq: lastSeq })) send(e);
      res.write(': open\n\n');
      const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      heartbeat.unref();
      const end = () => {
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(end);
        if (!res.writableEnded) res.end();
      };
      streams.add(end);
      req.raw.on('close', end);
    },
  );
}
