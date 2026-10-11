/**
 * The HTTP and WebSocket API. See docs/architecture.md (Components).
 *
 *   /auth/*                        magic-link login, sessions, account deletion (see ../auth/routes)
 *   GET  /scenarios                the scenarios a game can be made from
 *   POST /games                    signed in: make a game, body `{ scenario?, rate?, side?, sessionType?, pause?, lobby? }`;
 *                                  the creator takes `side` (default: the first human side). It starts at once unless
 *                                  `lobby` is true: then it waits in the lobby for `start`
 *   GET  /games                    signed in: the games you made or hold a seat in
 *   GET  /games/:id                signed in: the game's settings, status, which sides are taken and ready, and which are yours
 *   POST /games/:id/join           signed in: take a free side, body `{ "side": string }` (the invite link is `/?game=<id>`)
 *   POST /games/:id/ready          signed in, seated: body `{ "ready": boolean }`
 *   POST /games/:id/start          the creator: start a lobby game once every side is taken and every player is ready
 *   GET  /games/:id/window         seated, game over: the umpire's window timeline (403 `game_not_over` before the end)
 *   GET  /games/:id/window/at?at=  seated, game over: true positions, beliefs, dice and rulings at a game time
 *   GET  /games/:id/ws             WebSocket for the side the signed-in user holds (`@kriegsspiel/protocol` messages);
 *                                  in hot-seat, `?side=` picks which of the creator's sides
 *   GET  /healthz                  liveness, `{ ok: true }`
 *   /admin/api/*                   read-only debug API, only when `admin.enabled` (see ../admin)
 *   GET  /*                        the built client, when `staticDir` is set
 *
 * A seat (one user on one side of one game) is the only way into a game; the session cookie is checked
 * before the WebSocket upgrade.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { holdTheBridge, loadScenario, type SideId } from '@kriegsspiel/engine';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WallClock } from '../clock.js';
import {
  GameHost,
  MemoryGameStore,
  createRegistry,
  loadScenarioById,
  scenarioList,
  startingState,
  type GameStore,
  type Timers,
} from '../game/index.js';
import { adminApi } from '../admin/adminApi.js';
import { loadReplayInput } from '../admin/replayView.js';
import { LogMailer, type Mailer } from '../auth/mailer.js';
import { authRoutes, type Auth } from '../auth/routes.js';
import { MemoryAuthStore, type AuthStore } from '../auth/store.js';
import { TraceStore } from '../debug/trace.js';
import {
  MemoryLobbyStore,
  SESSION_TYPES,
  type LobbyGame,
  type LobbyStore,
  type SessionType,
} from '../lobby/store.js';
import type { PauseConfig } from '../pause.js';
import type { OrderParser } from '../orders/index.js';
import { Hub, type Socket } from './hub.js';
import { windowAt, windowTimeline } from './umpireWindow.js';

/** Fastest clock a client may ask for: 1 game day per wall second. */
export const MAX_RATE = 86_400;

/** Slowest clock a client may ask for: 1 game second per 100 wall seconds. */
export const MIN_RATE = 0.01;

const SideName = z.enum(['blue', 'red']);

const PauseSettings = z
  .object({
    rule: z.enum(['unanimous', 'majority']),
    voteTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
    maxPauseMs: z
      .number()
      .int()
      .min(1000)
      .max(7 * 86_400_000)
      .optional(),
  })
  .strict();

const CreateGame = z
  .object({
    scenario: z.string().optional(),
    rate: z.number().finite().min(MIN_RATE).max(MAX_RATE).optional(),
    side: SideName.optional(),
    sessionType: z.enum(SESSION_TYPES as [SessionType, ...SessionType[]]).optional(),
    pause: PauseSettings.optional(),
    lobby: z.boolean().optional(),
  })
  .strict();

const JoinGame = z.object({ side: SideName }).strict();

const Ready = z.object({ ready: z.boolean() }).strict();

const WindowQuery = z.object({ at: z.coerce.number().finite().min(0), side: SideName.optional() });

const WsQuery = z.object({ side: SideName.optional() });

/** Largest message a client may send. Orders are a few lines of prose. */
const MAX_PAYLOAD_BYTES = 16 * 1024;

export interface AppOptions {
  parser: OrderParser;
  store?: GameStore;
  /** Lobby records. Defaults to memory; `main.ts` supplies the SQLite store. */
  lobby?: LobbyStore;
  wallNow?: WallClock;
  timers?: Timers;
  /** Log lines from Fastify; off by default so tests stay quiet. */
  logger?: boolean;
  /** Play sides the scenario marks `scripted` with the built-in opponent. Off unless set; `main.ts` sets it from the environment. */
  scriptedOpponents?: boolean;
  /** Directory of the built client to serve at `/`. Unset: API only (dev uses the Vite server). */
  staticDir?: string;
  /**
   * Debug/admin view (Epic #119). Off unless `enabled`: then no `/admin` route exists and the
   * trace is a no-op. When on, requests must be loopback or carry `token`.
   */
  admin?: { enabled: boolean; token?: string; trace?: TraceStore };
  /**
   * Accounts. Defaults to an in-memory store and a mailer that logs the login link, which suits
   * tests and local development; `main.ts` supplies the SQLite store and a real mailer.
   */
  auth?: {
    store?: AuthStore;
    mailer?: Mailer;
    /** Origin used in login links; an https origin also makes the session cookie `Secure`. */
    publicUrl?: string;
    loginPerEmail?: number;
    loginPerIp?: number;
  };
  /**
   * Trust `X-Forwarded-For` for `req.ip`, which keys the login rate limits. On behind a reverse proxy,
   * so each player has their own bucket; off when the port is reachable directly, where the header can be forged.
   */
  trustProxy?: boolean;
  onError?: (gameId: string, error: unknown) => void;
}

export interface App {
  server: FastifyInstance;
  host: GameHost;
  hub: Hub;
  auth: Auth;
  authStore: AuthStore;
  lobby: LobbyStore;
}

export async function buildApp(options: AppOptions): Promise<App> {
  const server = Fastify({
    trustProxy: options.trustProxy ?? false,
    logger: options.logger
      ? {
          // The login token rides in the query string of /auth/verify; keep queries out of the logs.
          serializers: {
            req: (req) => ({ method: req.method, url: req.url?.split('?')[0], host: req.host }),
          },
        }
      : false,
  });
  const trace = options.admin?.enabled ? (options.admin.trace ?? new TraceStore()) : undefined;
  const onError = (gameId: string, e: unknown) => {
    server.log.error({ err: e, gameId }, 'game error');
    options.onError?.(gameId, e);
  };
  // The hub and host refer to each other: the host notifies the hub, the hub looks games up.
  const store = options.store ?? new MemoryGameStore();
  const hub: Hub = new Hub((id) => host.get(id), onError, store);
  const lobby = options.lobby ?? new MemoryLobbyStore();
  const authStore = options.auth?.store ?? new MemoryAuthStore();
  /**
   * The lobby record for a game. A game made before lobby records existed has seats and a stored
   * game but no record: it is a started team game on the one scenario of that time, and the record
   * is written back so it is only synthesised once.
   */
  const recordOf = (id: string): LobbyGame | undefined => {
    const rec = lobby.get(id);
    if (rec) return rec;
    const seats = authStore.seatsOf(id);
    if (seats.length === 0) return undefined;
    const legacy: LobbyGame = {
      id,
      scenario: loadScenario(holdTheBridge).scenarioId,
      rate: 1,
      sessionType: 'team_vs_team',
      creator: seats[0]!.userId,
      status: 'started',
      ready: [],
      createdAtMs: 0,
    };
    lobby.put(legacy);
    return legacy;
  };
  const host: GameHost = new GameHost({
    store,
    parser: options.parser,
    registry: createRegistry(),
    wallNow: options.wallNow ?? Date.now,
    timers: options.timers,
    init: startingState,
    pause: (id): PauseConfig | undefined => {
      const rec = recordOf(id);
      if (!rec?.pause) return undefined;
      const voters =
        rec.sessionType === 'hot_seat' ? [rec.creator] : authStore.seatsOf(id).map((s) => s.userId);
      return { voters, ...rec.pause };
    },
    // Only a co-op game has the built-in opponent; the other shapes leave every side to people.
    scriptedOpponents: (id) =>
      options.scriptedOpponents === true && recordOf(id)?.sessionType === 'co_op_vs_ai',
    trace,
    onUpdate: (id) => hub.notify(id),
    onError,
  });

  await server.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  // Liveness for the container health check. Does not touch a game or the store.
  server.get('/healthz', async () => ({ ok: true }));

  if (trace) await adminApi(server, { host, trace, store, token: options.admin?.token });

  if (options.staticDir) {
    await server.register(fastifyStatic, { root: resolve(options.staticDir), redirect: true });
  }

  const auth = await authRoutes(server, {
    store: authStore,
    mailer: options.auth?.mailer ?? new LogMailer((line) => server.log.info(line)),
    publicUrl: options.auth?.publicUrl ?? 'http://localhost:3000',
    wallNow: options.wallNow,
    loginPerEmail: options.auth?.loginPerEmail,
    loginPerIp: options.auth?.loginPerIp,
    onAccountDeleted: (userId) => {
      lobby.forgetUser(userId);
      hub.disconnectUser(userId, 'account deleted');
    },
    onLogout: (userId) => hub.disconnectUser(userId),
  });

  const aiPlays = options.scriptedOpponents === true;

  /** Sides people play in a game of this shape: all of them, unless the scenario hands a side to the AI. */
  const humanSides = (rec: LobbyGame): SideId[] =>
    loadScenarioById(rec.scenario)
      .sides.filter((s) => rec.sessionType !== 'co_op_vs_ai' || s.controller !== 'scripted')
      .map((s) => s.id);

  /** The side a user plays in a game; in hot-seat the creator plays any, `want` or the first. */
  const sideFor = (rec: LobbyGame, userId: string, want?: SideId): SideId | undefined => {
    if (rec.sessionType === 'hot_seat') {
      if (rec.creator !== userId) return undefined;
      const sides = humanSides(rec);
      return want ? sides.find((s) => s === want) : sides[0];
    }
    return authStore.seatOf(rec.id, userId);
  };

  /** A started game is reopened (paused) if the server restarted since it was last used. */
  const running = async (rec: LobbyGame): Promise<boolean> => {
    if (rec.status !== 'started') return false;
    if (host.get(rec.id)) return true;
    try {
      await host.open(rec.id);
      return true;
    } catch {
      return false;
    }
  };

  const summary = (rec: LobbyGame, userId: string) => ({
    id: rec.id,
    scenario: rec.scenario,
    status: rec.status,
    sessionType: rec.sessionType,
    rate: rec.rate,
    side: sideFor(rec, userId) ?? null,
    creator: rec.creator === userId,
    createdAtMs: rec.createdAtMs,
  });

  server.get('/scenarios', async () => ({ scenarios: scenarioList() }));

  server.post('/games', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const body = CreateGame.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const scenario = body.data.scenario ?? scenarioList()[0]!.id;
    if (!scenarioList().some((s) => s.id === scenario)) {
      return reply.code(400).send({ error: 'bad_scenario', message: `no scenario "${scenario}"` });
    }
    const sessionType = body.data.sessionType ?? (aiPlays ? 'co_op_vs_ai' : 'team_vs_team');
    if (sessionType === 'co_op_vs_ai' && !aiPlays) {
      return reply
        .code(400)
        .send({ error: 'no_ai_opponent', message: 'this server has no AI opponent' });
    }
    const rec: LobbyGame = {
      id: randomUUID(),
      scenario,
      rate: body.data.rate ?? 1,
      sessionType,
      ...(body.data.pause ? { pause: body.data.pause } : {}),
      creator: user.id,
      status: 'lobby',
      ready: [],
      createdAtMs: (options.wallNow ?? Date.now)(),
    };
    const playable = humanSides(rec);
    if (playable.length === 0) {
      return reply.code(400).send({ error: 'bad_session', message: 'no side for people to play' });
    }
    const side = body.data.side ?? playable[0];
    if (!side || !playable.includes(side)) {
      return reply.code(400).send({ error: 'bad_side', message: `no playable side "${side}"` });
    }
    if (sessionType !== 'hot_seat' && !authStore.claimSeat(rec.id, side, user.id)) {
      return reply.code(500).send({ error: 'seat_failed' });
    }
    lobby.put(rec);
    const result = {
      id: rec.id,
      scenario,
      rate: rec.rate,
      sessionType,
      side: sessionType === 'hot_seat' ? playable[0]! : side,
      ws: `/games/${rec.id}/ws`,
    };
    if (body.data.lobby) return reply.code(201).send({ ...result, status: 'lobby' });
    const startError = await startGame(rec);
    if (startError) return reply.code(500).send({ error: startError });
    return reply.code(201).send({ ...result, status: 'started' });
  });

  /** Ids of games whose `/start` is in flight, so a second request gets 409 rather than a failed create. */
  const starting = new Set<string>();

  /** Create the game's actor and mark the record started. Returns an error code on failure. */
  const startGame = async (rec: LobbyGame): Promise<string | undefined> => {
    try {
      await host.create(rec.id, loadScenarioById(rec.scenario), { rate: rec.rate });
    } catch (e) {
      server.log.error({ err: e, gameId: rec.id }, 'could not start game');
      return 'start_failed';
    }
    // Re-read: a /ready that landed during the await must not be overwritten.
    lobby.put({ ...(lobby.get(rec.id) ?? rec), status: 'started' });
    return undefined;
  };

  server.get('/games', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const mine = new Set(authStore.gamesOf(user.id));
    const recs = [
      ...[...mine].map(recordOf).filter((r): r is LobbyGame => r !== undefined),
      ...lobby.byCreator(user.id).filter((r) => !mine.has(r.id)),
    ];
    recs.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return { games: recs.map((r) => summary(r, user.id)) };
  });

  server.get<{ Params: { id: string } }>('/games/:id', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    const rec = recordOf(id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    const seats = authStore.seatsOf(id);
    const hotSeat = rec.sessionType === 'hot_seat';
    return {
      ...summary(rec, user.id),
      you: sideFor(rec, user.id) ?? null,
      ready: rec.ready.includes(user.id) || (rec.creator === user.id && !hotSeat),
      pause: rec.pause ?? null,
      sides: humanSides(rec).map((side) => {
        const seat = seats.find((s) => s.side === side);
        return {
          side,
          taken: hotSeat || seat !== undefined,
          // The creator starts the game, so they count as ready.
          ready:
            hotSeat ||
            (seat !== undefined &&
              (seat.userId === rec.creator || rec.ready.includes(seat.userId))),
        };
      }),
    };
  });

  server.post<{ Params: { id: string } }>('/games/:id/join', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    const rec = recordOf(id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    const body = JoinGame.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const { side } = body.data;
    if (rec.sessionType === 'hot_seat') return reply.code(400).send({ error: 'hot_seat_game' });
    if (!humanSides(rec).includes(side)) return reply.code(400).send({ error: 'bad_side' });
    if (!authStore.claimSeat(id, side, user.id)) {
      return reply.code(409).send({ error: 'seat_unavailable' });
    }
    return { id, side, ws: `/games/${id}/ws` };
  });

  server.post<{ Params: { id: string } }>('/games/:id/ready', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    const body = Ready.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    if (rec.status !== 'lobby') return reply.code(409).send({ error: 'already_started' });
    if (!authStore.seatOf(rec.id, user.id)) return reply.code(403).send({ error: 'no_seat' });
    const others = rec.ready.filter((u) => u !== user.id);
    lobby.put({ ...rec, ready: body.data.ready ? [...others, user.id] : others });
    return { ready: body.data.ready };
  });

  server.post<{ Params: { id: string } }>('/games/:id/start', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    if (rec.creator !== user.id) return reply.code(403).send({ error: 'not_creator' });
    if (rec.status !== 'lobby' || starting.has(rec.id)) {
      return reply.code(409).send({ error: 'already_started' });
    }
    if (rec.sessionType !== 'hot_seat') {
      const seats = authStore.seatsOf(rec.id);
      const open = humanSides(rec).filter((side) => !seats.some((s) => s.side === side));
      if (open.length > 0) return reply.code(409).send({ error: 'sides_open', sides: open });
      const waiting = seats.filter(
        (s) => s.userId !== rec.creator && !rec.ready.includes(s.userId),
      );
      if (waiting.length > 0) {
        return reply.code(409).send({ error: 'not_ready', sides: waiting.map((s) => s.side) });
      }
    }
    starting.add(rec.id);
    const startError = await startGame(rec).finally(() => starting.delete(rec.id));
    if (startError) return reply.code(500).send({ error: startError });
    return { id: rec.id, status: 'started', ws: `/games/${rec.id}/ws` };
  });

  /**
   * The umpire's window reveals master state, so it is the one route that checks the game is over
   * on the server: a seat alone is not enough. A game still being played, or one that cannot be
   * replayed, gets no data.
   */
  const windowFor = async (
    id: string,
    userId: string,
    want: SideId | undefined,
  ): Promise<
    | { error: string; status: number }
    | {
        input: NonNullable<Awaited<ReturnType<typeof loadReplayInput>>>;
        timeline: NonNullable<ReturnType<typeof windowTimeline>>;
      }
  > => {
    const rec = recordOf(id);
    if (!rec) return { status: 404, error: 'no_such_game' };
    if (!sideFor(rec, userId, want)) return { status: 403, error: 'no_seat' };
    if (rec.status !== 'started') return { status: 403, error: 'game_not_over' };
    const live = host.get(id);
    if (live && !live.state.world.outcome) return { status: 403, error: 'game_not_over' };
    const input = await loadReplayInput(store, id).catch(() => null);
    if (input === null) return { status: 422, error: 'cannot_replay' };
    if (!input) return { status: 404, error: 'no_such_game' };
    const timeline = windowTimeline(input, live?.state.time);
    if (!timeline) return { status: 403, error: 'game_not_over' };
    return { input, timeline };
  };

  server.get<{ Params: { id: string } }>('/games/:id/window', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const w = await windowFor(req.params.id, user.id, undefined);
    if ('error' in w) return reply.code(w.status).send({ error: w.error });
    return w.timeline;
  });

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/games/:id/window/at',
    async (req, reply) => {
      const user = auth.userOf(req);
      if (!user) return reply.code(401).send({ error: 'not_signed_in' });
      const q = WindowQuery.safeParse(req.query);
      if (!q.success)
        return reply.code(400).send({ error: 'bad_request', message: q.error.message });
      const w = await windowFor(req.params.id, user.id, q.data.side);
      if ('error' in w) return reply.code(w.status).send({ error: w.error });
      return windowAt(w.input, Math.min(q.data.at, w.timeline.endMs));
    },
  );

  server.get<{ Params: { id: string } }>(
    '/games/:id/ws',
    {
      websocket: true,
      // Runs before the upgrade, so a bad session or seat is a plain HTTP error.
      preValidation: async (req, reply) => {
        const { id } = req.params;
        const user = auth.userOf(req);
        if (!user) return reply.code(401).send({ error: 'not_signed_in' });
        const rec = recordOf(id);
        if (!rec) return reply.code(404).send({ error: 'no_such_game' });
        const query = WsQuery.safeParse(req.query);
        if (!query.success) return reply.code(400).send({ error: 'bad_side' });
        if (!sideFor(rec, user.id, query.data.side)) {
          return reply.code(403).send({ error: 'no_seat' });
        }
        if (rec.status === 'lobby') return reply.code(409).send({ error: 'not_started' });
        if (!(await running(rec))) return reply.code(404).send({ error: 'no_such_game' });
      },
    },
    (socket, req) => {
      const user = auth.userOf(req);
      const rec = recordOf(req.params.id);
      const want = WsQuery.safeParse(req.query);
      const side = user && rec && want.success && sideFor(rec, user.id, want.data.side);
      if (!user || !side) return socket.close(1008, 'no seat');
      hub.attach(req.params.id, side, socket as unknown as Socket, user.id);
    },
  );

  server.addHook('onClose', async () => {
    hub.closeAll();
    await trace?.close();
    await host.shutdown();
    if (!options.auth?.store) authStore.close();
    if (!options.lobby) lobby.close();
  });

  return { server, host, hub, auth, authStore, lobby };
}
