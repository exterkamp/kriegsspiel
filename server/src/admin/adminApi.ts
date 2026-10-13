/**
 * Admin API for the debug view: reads, plus the clock controls (#128) (Epic #119, story 8.2). See docs/architecture.md (Admin API).
 *
 *   GET /admin/api/games                       open games with clock and trace counts
 *   GET /admin/api/games/:id/state             master state snapshot (unfiltered; never sent to clients)
 *                                              plus each side's current `SideView`, for comparison
 *   GET /admin/api/games/:id/entries           trace entries: ?kind= &correlationId= &after= &limit=
 *   GET /admin/api/games/:id/replay            timeline of the input log: end time and marks to jump to
 *   GET /admin/api/games/:id/replay/at?at=ms   master state, both side views and events at a game time
 *   GET /admin/api/games/:id/stream            server-sent events of new entries; ?after= replays first
 *
 * Controls (#128), POST, same gating, each logged as an input marked `admin` and traced as a command:
 *   POST /admin/api/games/:id/clock            body {action: pause | resume | rate | step | stepToNext, ...}
 *
 * Gating: `buildApp` registers this plugin only when the admin view is enabled, so otherwise every
 * `/admin` path is an ordinary 404. When enabled, a request must come from a loopback address or
 * carry the admin token (`Authorization: Bearer` or `?token=`), unless open mode (`ADMIN_OPEN`, #387)
 * lets any caller in for debugging a demo stack. The only POST route is the clock control; none of them
 * feed the game clients' hub (`api/hub.ts`); `/state` only reads `api/sideView.ts` to show what a side is sent.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GameCommand, GameHost } from '../game/index.js';
import type { GameActor } from '../game/actor.js';
import { sideViewOf } from '../api/sideView.js';
import type { TraceEntry, TraceStore } from '../debug/trace.js';
import type { GameStore } from '../game/store.js';
import { loadReplayInput, replayAt, replayTimeline } from './replayView.js';

export const ADMIN_PREFIX = '/admin/api';
export const DEFAULT_ENTRY_LIMIT = 200;
export const MAX_ENTRY_LIMIT = 1000;
const HEARTBEAT_MS = 15_000;

export interface AdminOptions {
  host: GameHost;
  trace: TraceStore;
  /** Where the input log lives; replay reads it and never writes. */
  store: GameStore;
  /** Lets non-loopback callers in when they present it. Unset: loopback only. */
  token?: string;
  /** Open mode: every caller passes, with no token and no loopback check. Redaction still applies. */
  open?: boolean;
}

export const ADMIN_OPEN_WARNING =
  'admin is open: anyone who can reach this port can read all hidden game state and LLM prompts';

const isOn = (v: string | undefined): boolean => {
  const f = v?.trim().toLowerCase();
  return f === '1' || f === 'true' || f === 'on';
};

/**
 * Settings read from the environment: `ADMIN_ENABLED` turns the view on, `ADMIN_TOKEN` is the optional remote token,
 * `ADMIN_OPEN` (with `ADMIN_ENABLED`) lets anyone in. Open mode with `NODE_ENV=production` throws unless `ADMIN_OPEN_FORCE` is on.
 */
export function adminFromEnv(env: Record<string, string | undefined>): {
  enabled: boolean;
  token?: string;
  open: boolean;
} {
  const enabled = isOn(env.ADMIN_ENABLED);
  const open = enabled && isOn(env.ADMIN_OPEN);
  if (open && env.NODE_ENV === 'production' && !isOn(env.ADMIN_OPEN_FORCE)) {
    throw new Error(
      'ADMIN_OPEN is set with NODE_ENV=production: refusing to start. Unset ADMIN_OPEN, or set ADMIN_OPEN_FORCE=1 if you really mean it.',
    );
  }
  return { enabled, token: env.ADMIN_TOKEN?.trim() || undefined, open };
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

const AtQuery = z.object({
  at: z.coerce.number().finite().min(0),
  token: z.string().optional(),
});

export const MAX_ADMIN_RATE = 1000;
export const MAX_ADMIN_STEP_MS = 24 * 60 * 60 * 1000;

const ClockBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('rate'), rate: z.number().positive().max(MAX_ADMIN_RATE) }),
  z.object({ action: z.literal('step'), ms: z.number().positive().max(MAX_ADMIN_STEP_MS) }),
  z.object({ action: z.literal('stepToNext') }),
]);

export async function adminApi(server: FastifyInstance, options: AdminOptions): Promise<void> {
  const { host, trace } = options;
  const streams = new Set<() => void>();

  server.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(ADMIN_PREFIX)) return;
    if (options.open) return;
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
        control: actor && controlOf(actor),
        staffAtWork: actor?.staffAtWork,
        entries: trace.entries(id).length,
      };
    }),
  }));

  server.get<{ Params: { id: string } }>(`${ADMIN_PREFIX}/games/:id/state`, async (req, reply) => {
    const actor = host.get(req.params.id);
    if (!actor) return reply.code(404).send({ error: 'no_such_game' });
    const clock = actor.gameClock.snapshot();
    return {
      id: actor.id,
      clock,
      control: controlOf(actor),
      clockHistory: actor.gameClock.history(),
      staffAtWork: actor.staffAtWork,
      engine: actor.state,
      // What each side's client is sent right now, so the page can show it beside `engine`.
      sideViews: Object.fromEntries(
        actor.state.world.sides.map((s) => [
          s.id,
          sideViewOf(
            actor.state,
            s.id,
            clock,
            undefined,
            [],
            actor.narrationFor(s.id),
            actor.staffHistoryFor(s.id),
            actor.overloadedFor(s.id),
          ),
        ]),
      ),
    };
  });

  server.post<{ Params: { id: string } }>(`${ADMIN_PREFIX}/games/:id/clock`, async (req, reply) => {
    const body = ClockBody.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    const actor = host.get(req.params.id);
    if (!actor) return reply.code(404).send({ error: 'no_such_game' });
    if (actor.gameClock.status === 'stopped') {
      return reply.code(409).send({ error: 'game_over', message: 'the clock is stopped' });
    }
    const b = body.data;
    let command: GameCommand;
    switch (b.action) {
      case 'pause':
        command = { kind: 'pause' };
        break;
      case 'resume':
        command = { kind: 'resume' };
        break;
      case 'rate':
        command = { kind: 'setRate', rate: b.rate };
        break;
      case 'step':
        // The actor resolves the target when the command runs, so a wait in its queue never
        // leaves the target behind the clock.
        command = { kind: 'step', ms: b.ms };
        break;
      case 'stepToNext':
        if (actor.nextEventAt === undefined) {
          return reply.code(409).send({ error: 'no_next_event', message: 'no event is queued' });
        }
        command = { kind: 'step' };
        break;
    }
    const result = await actor.submit(command, { admin: true });
    if (!result.ok)
      return reply.code(409).send({
        error: 'refused',
        message: result.kind === 'rejection' ? result.reason : result.question,
      });
    // A step the LLM barrier held short: say so, or the bar would look like it did nothing.
    const barrier = actor.gameClock.barrier;
    const stalled =
      command.kind === 'step' && barrier !== undefined && actor.gameClock.now() >= barrier;
    return {
      clock: actor.gameClock.snapshot(),
      control: controlOf(actor),
      ...(stalled ? { stalledAt: barrier } : {}),
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

  const replayInput = (id: string) => loadReplayInput(options.store, id);

  server.get<{ Params: { id: string } }>(`${ADMIN_PREFIX}/games/:id/replay`, async (req, reply) => {
    const input = await replayInput(req.params.id).catch(() => null);
    if (input === null) return reply.code(422).send({ error: 'cannot_replay' });
    if (!input) return reply.code(404).send({ error: 'no_such_game' });
    // A running game replays up to now; a finished or closed one to where its log ends.
    return replayTimeline(input, host.get(req.params.id)?.state.time);
  });

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    `${ADMIN_PREFIX}/games/:id/replay/at`,
    async (req, reply) => {
      const q = AtQuery.safeParse(req.query);
      if (!q.success)
        return reply.code(400).send({ error: 'bad_request', message: q.error.message });
      const input = await replayInput(req.params.id).catch(() => null);
      if (input === null) return reply.code(422).send({ error: 'cannot_replay' });
      if (!input) return reply.code(404).send({ error: 'no_such_game' });
      // Never past what the game knows: its live time, or else where its log ends.
      const end = host.get(req.params.id)?.state.time ?? replayTimeline(input).endMs;
      return replayAt(input, Math.min(q.data.at, end));
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

/** What the control bar needs beyond the clock anchor: the mode, the LLM barrier and the next queued event. */
function controlOf(actor: GameActor) {
  return {
    mode: actor.gameClock.mode,
    gameMs: actor.gameClock.now(),
    barrierMs: actor.gameClock.barrier,
    nextEventAt: actor.nextEventAt,
  };
}
