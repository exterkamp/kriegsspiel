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
 *   POST /games/:id/join           signed in: take a free side, body `{ "side": string }` (the invite link is `/?game=<id>`);
 *                                  with a `role` (chiefOfStaff, intelligence, quartermaster, or subordinate with `units`) join
 *                                  the table of a side that already has its commander, in the lobby or (D6e) after the start
 *   POST /games/:id/leave-role     signed in: give up the role you joined; after the start the next holder is briefed from its journal
 *   POST /games/:id/leave          signed in: give up your seat (or role) in a game still in the lobby; the creator cannot
 *   POST /games/:id/kick           the creator: remove another player from a lobby game, body `{ side, role?, unit? }`
 *                                  (no `role`: the side's seat holder; a subordinate is named by one of their `unit`s)
 *   POST /games/:id/ready          signed in, seated or holding a role: body `{ "ready": boolean }`
 *   POST /games/:id/start          the creator: start a lobby game once every side is taken and every player is ready
 *   GET  /games/:id/window         seated, game over: the umpire's window timeline (403 `game_not_over` before the end)
 *   GET  /games/:id/window/dissents seated, game over: dissents on signed orders, for the critique (D6e)
 *   GET  /games/:id/window/at?at=  seated, game over: true positions, beliefs, dice and rulings at a game time
 *   GET  /games/:id/critique       seated, game over: the umpire's critique, each point citing logged events (403 `game_not_over` before the end)
 *   GET  /games/:id/ws             WebSocket for the side the signed-in user holds (`@kriegsspiel/protocol` messages);
 *                                  in hot-seat, `?side=` picks which of the creator's sides
 *   /notifications/*               signed in: notification preferences and web push subscriptions (see ../notify)
 *   GET  /healthz                  liveness, `{ ok: true }`
 *   /admin/api/*                   read-only debug API, only when `admin.enabled` (see ../admin)
 *   GET  /*                        the built client, when `staticDir` is set
 *
 * A seat (one user on one side of one game) is the only way into a game; the session cookie is checked
 * before the WebSocket upgrade.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { holdTheBridge, loadScenario, type Seat, type SideId } from '@kriegsspiel/engine';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { spaFallback } from './spaFallback.js';
import {
  DEFAULT_UMPIRE_DIAL,
  DEFAULT_UMPIRE_PERSONA,
  DIALS,
  PERSONAS,
} from '@kriegsspiel/protocol';
import { z } from 'zod';
import type { WallClock } from '../clock.js';
import {
  GameHost,
  type GameHostOptions,
  MemoryGameStore,
  createRegistry,
  loadScenarioById,
  scenarioList,
  startingState,
  type GameStore,
  type Timers,
} from '../game/index.js';
import { adminApi } from '../admin/adminApi.js';
import { loadReplayInput, replayTimeline } from '../admin/replayView.js';
import { LogMailer, type Mailer } from '../auth/mailer.js';
import { originAllowed } from '../auth/origin.js';
import { authRoutes, type Auth } from '../auth/routes.js';
import { MemoryAuthStore, type AuthStore } from '../auth/store.js';
import { NOOP_TRACE, TraceStore, traceRequest } from '../debug/trace.js';
import {
  MemoryLobbyStore,
  SESSION_TYPES,
  type Forward,
  type LobbyGame,
  type LobbyStore,
  type PastHolder,
  type RoleSeat,
  type SessionType,
} from '../lobby/store.js';
import type { PauseConfig } from '../pause.js';
import {
  Notifier,
  MemoryNotifyStore,
  notifyRoutes,
  type NotifyStore,
  type PushSender,
} from '../notify/index.js';
import { Hub, type Socket } from './hub.js';
import { CritiqueService } from './critiqueService.js';
import { windowAt, windowTimeline } from './umpireWindow.js';
import { dissentNotes } from '../critique.js';
import { seatKey } from './sideView.js';

/** Fastest clock a client may ask for: 1 game day per wall second. */
export const MAX_RATE = 86_400;

/** Slowest clock a client may ask for: 1 game second per 100 wall seconds. */
export const MIN_RATE = 0.01;

const SideName = z.enum(['blue', 'red']);

const PauseSettings = z
  .object({
    rule: z.enum(['unanimous', 'majority']),
    voteTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
    // Emergency hold (D5): how long it stops the clock, and how many a player and the game may call.
    holdMs: z.number().int().min(1000).max(3_600_000).optional(),
    holdsPerPlayer: z.number().int().min(0).max(20).optional(),
    holdsPerGame: z.number().int().min(0).max(100).optional(),
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
    /** The rigid-to-free dial and the umpire's persona (3.11); both optional, defaulting to standard and dry. */
    dial: z.enum(DIALS).optional(),
    persona: z.enum(PERSONAS).optional(),
    hierarchy: z.enum(['shared', 'chain']).optional(),
    lobby: z.boolean().optional(),
  })
  .strict();

const JoinGame = z
  .object({
    side: SideName,
    role: z.enum(['chiefOfStaff', 'intelligence', 'quartermaster', 'subordinate']).optional(),
    units: z.array(z.string().min(1).max(64)).min(1).max(64).optional(),
  })
  .strict();

const Ready = z.object({ ready: z.boolean() }).strict();

const WindowQuery = z.object({ at: z.coerce.number().finite().min(0), side: SideName.optional() });

const WsQuery = z.object({ side: SideName.optional() });

/** Largest message a client may send. Orders are a few lines of prose. */
const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Byte size of a JSON-ish payload for a trace entry; undefined when it cannot be measured. */
function byteSizeOf(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'object') {
    // A Fastify reply is not a payload; its size is captured through `send` instead.
    if ('raw' in value && typeof (value as { send?: unknown }).send === 'function') {
      return undefined;
    }
    try {
      return Buffer.byteLength(JSON.stringify(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface AppOptions {
  /** One parser for every game, or one per game. See `GameHostOptions.parser`. */
  parser: GameHostOptions['parser'];
  store?: GameStore;
  /** A game ended or was closed: drop per-game resources such as its umpire client. May be called more than once. */
  onGameDone?: (gameId: string) => void;
  /** Lobby records. Defaults to memory; `main.ts` supplies the SQLite store. */
  lobby?: LobbyStore;
  wallNow?: WallClock;
  timers?: Timers;
  /** Log lines from Fastify; off by default so tests stay quiet. */
  logger?: boolean;
  /** Play sides the scenario marks `scripted` with the built-in opponent. Off unless set; `main.ts` sets it from the environment. */
  scriptedOpponents?: boolean;
  /** Replaces the built-in opponent's agents for a game, for example with LLM commanders. See `GameHostOptions.aiAgents`. */
  aiAgents?: GameHostOptions['aiAgents'];
  /** True when the umpire is the test provider (canned responses): `GET /scenarios` says so and the client shows a badge. */
  testUmpire?: boolean;
  /** Narrates each side's dispatches per window. See `GameHostOptions.narrator`. */
  narrator?: GameHostOptions['narrator'];
  /** The umpire that writes the post-game critique, per game. Unset: the critique is the log's own wording. */
  critic?: GameHostOptions['narrator'];
  /** Directory of the built client to serve at `/`. Unset: API only (dev uses the Vite server). */
  staticDir?: string;
  /**
   * Serve `index.html` for the Angular client's routes (`/admin`, `/map-authoring`, `/map-benchmark`
   * and below) and redirect the old `*.html` pages. Needs `staticDir`; off by default, which is what
   * the Svelte client expects (it has real `admin/index.html` and `*.html` files).
   */
  spaFallback?: boolean;
  /**
   * Debug/admin view (Epic #119). Off unless `enabled`: then no `/admin` route exists and the
   * trace is a no-op. When on, requests must be loopback or carry `token`.
   */
  admin?: { enabled: boolean; token?: string; open?: boolean; trace?: TraceStore };
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
    /** Guest play (D17c): `POST /auth/guest` starts a session with no email. Default off. */
    guestPlay?: boolean;
    devTools?: boolean;
    /** Unused guests, and their games, are removed after this long (default 7 days). */
    guestIdleMs?: number;
    /** Guests created per client address per hour (default 10). */
    guestPerIp?: number;
    /** Extra origins allowed to open a game WebSocket, besides the public origin and the request's own host; `*` allows any (`ALLOWED_ORIGINS`). */
    allowedOrigins?: string[];
  };
  /**
   * Trust `X-Forwarded-For` for `req.ip`, which keys the login rate limits. On behind a reverse proxy,
   * so each player has their own bucket; off when the port is reachable directly, where the header can be forged.
   */
  trustProxy?: boolean;
  /** Notifications (epic #5): preferences and push subscriptions (default in memory), and the web push sender (unset: no web push). */
  notify?: { store?: NotifyStore; push?: PushSender; emailEveryMs?: number };
  onError?: (gameId: string, error: unknown) => void;
  /** Bounds on memory held by games (#161). Each field falls back to its `DEFAULT_GAME_LIMITS` value. */
  limits?: Partial<GameLimits>;
}

export interface GameLimits {
  /** Unfinished games (in the lobby, or open in memory) one account may have made at once. */
  perUser: number;
  /** The same cap for a guest. */
  perGuest: number;
  /** A game nobody has connected to for this long (wall ms) is closed in memory; its data stays in the store. */
  idleMs: number;
  /** How often the server looks for finished and idle games to close. 0 turns the sweep off. */
  sweepEveryMs: number;
  /**
   * A finished game nobody is connected to is closed once it has been quiet this long (wall ms), so
   * a viewer whose socket is between the upgrade check and `hub.attach` never meets a closed game.
   */
  finishedGraceMs: number;
}

export const DEFAULT_GAME_LIMITS: GameLimits = {
  perUser: 20,
  perGuest: 3,
  idleMs: 24 * 3_600_000,
  sweepEveryMs: 60_000,
  finishedGraceMs: 30_000,
};

export interface App {
  server: FastifyInstance;
  host: GameHost;
  hub: Hub;
  notifier: Notifier;
  notifyStore: NotifyStore;
  auth: Auth;
  authStore: AuthStore;
  lobby: LobbyStore;
  /** Close finished games nobody watches and games idle past `limits.idleMs`; returns the ids closed. Runs on a timer too. */
  sweepGames(): Promise<string[]>;
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
  /**
   * Run one game-scoped HTTP handler inside `traceRequest` (#198), so the admin Requests panel
   * has a row for it and the commands, events and LLM calls it causes share its correlation id.
   * Only routes that belong to a game are wrapped: trace entries are stored per game, and a
   * synthetic bucket for /healthz, /auth or /scenarios would surface as a phantom game in the
   * admin game picker. Callers wrap only the part of a handler that runs once the caller is
   * signed in and the game is known to exist: a rejected request (401, 400, 404) leaves no
   * trace row, so a failed create cannot mint a phantom game id for the picker and an
   * unauthenticated caller cannot grow the store by inventing ids. The response size is what
   * the handler passes to `reply.send`, or the JSON size of a returned value.
   */
  const tracedHttp = async <T>(
    gameId: string,
    req: FastifyRequest,
    reply: FastifyReply | undefined,
    fn: () => Promise<T>,
  ): Promise<T> => {
    if (!trace) return fn();
    let sentBytes: number | undefined;
    if (reply) {
      const raw = reply as FastifyReply & { send: (payload?: unknown) => FastifyReply };
      const send = raw.send.bind(reply);
      raw.send = (payload?: unknown) => {
        sentBytes = byteSizeOf(payload) ?? sentBytes;
        return send(payload);
      };
    }
    const contentLength = Number(req.headers['content-length']);
    return traceRequest(
      trace,
      gameId,
      {
        transport: 'http',
        method: req.method,
        // The query can carry secrets (the magic-link token); the panel needs the route only.
        path: req.url.split('?')[0] ?? req.url,
        ...(Number.isFinite(contentLength) ? { bytes: contentLength } : {}),
      },
      fn,
      // Every wrapped handler either sends through `reply.send` or returns a measurable
      // value, so the fallback is unreachable in practice.
      { responseBytes: (result) => sentBytes ?? byteSizeOf(result) ?? 0 },
    );
  };
  const onError = (gameId: string, e: unknown) => {
    server.log.error({ err: e, gameId }, 'game error');
    options.onError?.(gameId, e);
  };
  // The hub and host refer to each other: the host notifies the hub, the hub looks games up.
  const store = options.store ?? new MemoryGameStore();
  const hub: Hub = new Hub(
    (id) => host.get(id),
    onError,
    store,
    (id, userId) => {
      const rec = lobby.get(id);
      return (
        authStore.seatOf(id, userId) ??
        (rec?.roles?.find((r) => r.userId === userId)?.side as SideId | undefined)
      );
    },
    {
      hierarchy: (id) => lobby.get(id)?.hierarchy ?? 'shared',
      subordinateUnits: (id, side) =>
        (lobby.get(id)?.roles ?? [])
          .filter((r) => r.side === side && r.role === 'subordinate')
          .flatMap((r) => r.units ?? []),
      list: (id) => lobby.get(id)?.forwards ?? [],
      add: (id, f: Forward) => {
        const rec = lobby.get(id);
        if (rec) lobby.put({ ...rec, forwards: [...(rec.forwards ?? []), f] });
      },
    },
    trace ?? NOOP_TRACE,
    (id, userId) => lobby.get(id)?.roles?.find((r) => r.userId === userId)?.succeeds,
  );
  const lobby = options.lobby ?? new MemoryLobbyStore();
  const limits: GameLimits = { ...DEFAULT_GAME_LIMITS, ...options.limits };
  /** Wall time each open game was last started, reopened or connected to; the sweep reads it for idleness. */
  const lastActive = new Map<string, number>();
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
  /** The players who vote on pauses and ratio changes: every seat and role holder. */
  const votersOf = (rec: LobbyGame): string[] =>
    rec.sessionType === 'hot_seat'
      ? [rec.creator]
      : [
          ...authStore.seatsOf(rec.id).map((s) => s.userId),
          ...(rec.roles ?? []).map((r) => r.userId),
        ];
  /** A role changed hands in a running game: its voters follow (D6e). */
  const syncVoters = (rec: LobbyGame): void => host.get(rec.id)?.setVoters(votersOf(rec));
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
      return { voters: votersOf(rec), ...rec.pause };
    },
    // Only a co-op game has the built-in opponent; the other shapes leave every side to people.
    scriptedOpponents: (id) =>
      options.scriptedOpponents === true && recordOf(id)?.sessionType === 'co_op_vs_ai',
    aiAgents: options.aiAgents,
    narrator: options.narrator,
    deputyAway: (id, side, seat) => hub.isAway(id, side as SideId, seat),
    trace,
    onUpdate: (id) => {
      hub.notify(id);
      notifier.observe(id);
      if (host.get(id)?.state.world.outcome) options.onGameDone?.(id);
    },
    onClose: (id) => {
      lastActive.delete(id);
      notifier.forget(id);
      options.onGameDone?.(id);
    },
    onError,
  });
  const notifyStore = options.notify?.store ?? new MemoryNotifyStore();
  const mailer = options.auth?.mailer ?? new LogMailer((line) => server.log.info(line));
  const publicUrl = options.auth?.publicUrl ?? 'http://localhost:3000';
  const wallNow = options.wallNow ?? Date.now;
  const notifier = new Notifier({
    auth: authStore,
    store: notifyStore,
    mailer,
    push: options.notify?.push,
    publicUrl,
    lookup: (id) => host.get(id),
    sendToUser: (id, userId, message, side) => hub.sendToUser(id, userId, message, side),
    wallNow,
    emailEveryMs: options.notify?.emailEveryMs,
    onError,
  });

  await server.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  // Liveness for the container health check. Does not touch a game or the store.
  server.get('/healthz', async () => ({ ok: true }));

  if (trace)
    await adminApi(server, {
      host,
      trace,
      store,
      token: options.admin?.token,
      open: options.admin?.open === true,
    });

  if (options.staticDir) {
    await server.register(fastifyStatic, { root: resolve(options.staticDir), redirect: true });
    if (options.spaFallback) spaFallback(server);
  }

  const auth = await authRoutes(server, {
    store: authStore,
    mailer,
    publicUrl,
    wallNow: options.wallNow,
    loginPerEmail: options.auth?.loginPerEmail,
    loginPerIp: options.auth?.loginPerIp,
    guestPlay: options.auth?.guestPlay,
    devTools: options.auth?.devTools,
    guestIdleMs: options.auth?.guestIdleMs,
    guestPerIp: options.auth?.guestPerIp,
    onAccountDeleted: (userId) => {
      notifyStore.deleteUser(userId);
      lobby.forgetUser(userId);
      hub.disconnectUser(userId, 'account deleted');
    },
    onLogout: (userId) => hub.disconnectUser(userId),
    onGuestAdopted: (guestId, userId) => {
      lobby.reassignUser(guestId, userId);
      notifyStore.deleteUser(guestId);
      hub.disconnectUser(guestId, 'signed in');
    },
  });

  notifyRoutes(server, { auth, store: notifyStore, push: options.notify?.push });

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
    return authStore.seatOf(rec.id, userId) ?? (roleOf(rec, userId)?.side as SideId | undefined);
  };

  /** The role seat a user joined with, if any (the side's commander has the side seat instead). */
  const roleOf = (rec: LobbyGame, userId: string): RoleSeat | undefined =>
    rec.roles?.find((r) => r.userId === userId);

  /**
   * The seat a connection plays under. A side with nobody in a role plays shared HQ and has none;
   * once a side has role holders, its commander is the seat holder, and each of them has a seat.
   */
  const seatFor = (rec: LobbyGame, userId: string): Seat | undefined => {
    const held = roleOf(rec, userId);
    if (held) return { role: held.role, ...(held.units ? { units: held.units } : {}) };
    const side = authStore.seatOf(rec.id, userId);
    if (side && rec.roles?.some((r) => r.side === side)) return { role: 'commander' };
    return undefined;
  };

  // Command authority follows the lobby record, so a role that changed hands is not signed for by its old holder (#77).
  hub.setSeatResolver((gameId, userId) => {
    const rec = lobby.get(gameId);
    return rec ? seatFor(rec, userId) : undefined;
  });

  /** A started game is reopened (paused) if the server restarted since it was last used. */
  const running = async (rec: LobbyGame): Promise<boolean> => {
    if (rec.status !== 'started') return false;
    if (host.get(rec.id)) {
      lastActive.set(rec.id, wallNow());
      return true;
    }
    try {
      await host.open(rec.id);
      lastActive.set(rec.id, wallNow());
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
    ...(rec.umpire ? { umpire: rec.umpire } : {}),
    side: sideFor(rec, userId) ?? null,
    creator: rec.creator === userId,
    createdAtMs: rec.createdAtMs,
  });

  server.get('/scenarios', async () => ({
    scenarios: scenarioList(),
    // Who plays a side nobody sits at: absent when this server has no computer opponent.
    ...(options.scriptedOpponents === true
      ? { opponent: options.aiAgents ? 'ai_commander' : 'scripted' }
      : {}),
    // Present when the umpire answers with canned responses, so the game can say so.
    ...(options.testUmpire ? { umpire: 'test' } : {}),
    // Whether the admin view is mounted, and whether it is open to anyone, so the menu can link to it.
    ...(trace ? { admin: options.admin?.open === true ? 'open' : 'token' } : {}),
  }));

  server.post('/games', async (req, reply) => {
    // Sign-in and every 400 are settled before any tracing: a failed create must not leave
    // a trace row under the would-be id, or the admin picker fills with phantom games.
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
    const cap = user.guest ? limits.perGuest : limits.perUser;
    const unfinished = lobby
      .byCreator(user.id)
      .filter(
        (r) =>
          r.status === 'lobby' ||
          (r.status === 'started' && host.get(r.id) && !host.get(r.id)?.state.world.outcome),
      );
    if (unfinished.length >= cap) {
      return reply.code(429).send({
        error: 'too_many_games',
        message: `you already have ${unfinished.length} unfinished games; finish or leave one first`,
      });
    }
    const createdId = randomUUID();
    const rec: LobbyGame = {
      id: createdId,
      scenario,
      rate: body.data.rate ?? 1,
      sessionType,
      ...(body.data.pause ? { pause: body.data.pause } : {}),
      umpire: {
        dial: body.data.dial ?? DEFAULT_UMPIRE_DIAL,
        persona: body.data.persona ?? DEFAULT_UMPIRE_PERSONA,
      },
      ...(body.data.hierarchy ? { hierarchy: body.data.hierarchy } : {}),
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
    // The request is accepted from here, so the creation itself is traced under the new id.
    return tracedHttp(createdId, req, reply, async () => {
      if (sessionType !== 'hot_seat' && !authStore.claimSeat(rec.id, side, user.id)) {
        return reply.code(500).send({ error: 'seat_failed' });
      }
      lobby.put(rec);
      const result = {
        id: rec.id,
        scenario,
        rate: rec.rate,
        sessionType,
        umpire: rec.umpire,
        side: sessionType === 'hot_seat' ? playable[0]! : side,
        ws: `/games/${rec.id}/ws`,
      };
      if (body.data.lobby) return reply.code(201).send({ ...result, status: 'lobby' });
      const startError = await startGame(rec);
      if (startError) return reply.code(500).send({ error: startError });
      return reply.code(201).send({ ...result, status: 'started' });
    });
  });

  /** Ids of games whose `/start` is in flight, so a second request gets 409 rather than a failed create. */
  const starting = new Set<string>();

  /** Create the game's actor and mark the record started. Returns an error code on failure. */
  const startGame = async (rec: LobbyGame): Promise<string | undefined> => {
    try {
      await host.create(rec.id, loadScenarioById(rec.scenario), {
        rate: rec.rate,
        settings: rec.umpire,
      });
    } catch (e) {
      server.log.error({ err: e, gameId: rec.id }, 'could not start game');
      return 'start_failed';
    }
    lastActive.set(rec.id, wallNow());
    // Re-read: a /ready that landed during the await must not be overwritten.
    lobby.put({ ...(lobby.get(rec.id) ?? rec), status: 'started' });
    return undefined;
  };

  /** Where a started game stands: over or not, its game time and when it was last played (wall time). */
  const progressOf = async (
    rec: LobbyGame,
  ): Promise<{
    finished: boolean;
    gameTimeMs: number;
    lastPlayedMs: number;
    /** Set once the game is over: the winning side, or null when both were put out together. */
    winner?: string | null;
  }> => {
    const none = { finished: false, gameTimeMs: 0, lastPlayedMs: rec.createdAtMs };
    if (rec.status !== 'started') return none;
    // The standing is kept with the game record as it is played (#262), so this reads, never replays.
    let sum = await store.loadSummary(rec.id).catch(() => undefined);
    if (!sum) return none;
    if (!sum.known) {
      // A game stored before the standing was kept: replay it once and keep the result.
      try {
        const input = await loadReplayInput(store, rec.id);
        if (input) {
          const tl = replayTimeline(input);
          await store.backfillSummary(rec.id, {
            lastPlayedMs: input.entries.reduce((m, e) => Math.max(m, e.wallMs), 0) || undefined,
            ...(tl.outcome ? { outcome: { winner: tl.outcome.winner } } : {}),
          });
          sum = await store.loadSummary(rec.id);
          if (sum && sum.gameMs < tl.endMs) sum = { ...sum, gameMs: tl.endMs };
        }
      } catch {
        return none;
      }
      if (!sum) return none;
    }
    const lastPlayedMs = Math.max(sum.lastPlayedMs ?? 0, rec.createdAtMs);
    const live = host.get(rec.id)?.state;
    if (live) {
      const outcome = live.world.outcome;
      return {
        finished: Boolean(outcome),
        ...(outcome ? { winner: outcome.winner } : {}),
        gameTimeMs: live.time,
        lastPlayedMs,
      };
    }
    return {
      finished: sum.finished,
      ...(sum.finished ? { winner: sum.winner ?? null } : {}),
      gameTimeMs: sum.gameMs,
      lastPlayedMs,
    };
  };

  server.get('/games', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const mine = new Set(authStore.gamesOf(user.id));
    const recs = [
      ...[...mine].map(recordOf).filter((r): r is LobbyGame => r !== undefined),
      ...lobby.byCreator(user.id).filter((r) => !mine.has(r.id)),
      ...lobby.byRoleHolder(user.id).filter((r) => !mine.has(r.id) && r.creator !== user.id),
    ];
    recs.sort((a, b) => b.createdAtMs - a.createdAtMs);
    const games = await Promise.all(
      recs.map(async (r) => ({ ...summary(r, user.id), ...(await progressOf(r)) })),
    );
    return { games };
  });

  /** A guest's game is theirs alone (D17c): to anyone else it does not exist, so an invite link to it fails. */
  const isPrivateTo = (rec: LobbyGame, userId: string): boolean =>
    rec.creator !== userId && authStore.getUser(rec.creator)?.guest === true;

  server.get<{ Params: { id: string } }>('/games/:id', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    const rec = recordOf(id);
    if (!rec || isPrivateTo(rec, user.id)) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(id, req, reply, async () => {
      const seats = authStore.seatsOf(id);
      const hotSeat = rec.sessionType === 'hot_seat';
      return {
        ...summary(rec, user.id),
        you: sideFor(rec, user.id) ?? null,
        removed: rec.removed?.includes(user.id) ?? false,
        ready: rec.ready.includes(user.id) || (rec.creator === user.id && !hotSeat),
        role: seatFor(rec, user.id)?.role ?? null,
        pause: rec.pause ?? null,
        sides: humanSides(rec).map((side) => {
          const seat = seats.find((s) => s.side === side);
          return {
            side,
            taken: hotSeat || seat !== undefined,
            // Who sits where is not told, only which jobs are filled and which of them is yours.
            roles: (rec.roles ?? [])
              .filter((r) => r.side === side)
              .map((r) => ({
                role: r.role,
                ...(r.units ? { units: r.units } : {}),
                you: r.userId === user.id,
              })),
            // The creator starts the game, so they count as ready.
            ready:
              hotSeat ||
              (seat !== undefined &&
                (seat.userId === rec.creator || rec.ready.includes(seat.userId))),
          };
        }),
      };
    });
  });

  /**
   * Join a side's table in a role. The side's seat holder is its commander, so it must exist first;
   * each staff role is held by one player, and a subordinate commands units no one else does.
   */
  const joinRole = (
    rec: LobbyGame,
    userId: string,
    side: SideId,
    role: RoleSeat['role'],
    units: string[] | undefined,
    reply: FastifyReply,
  ) => {
    // After the start a role may still be taken, until the game is over (D6e).
    const midGame = rec.status === 'started';
    if (starting.has(rec.id)) return reply.code(409).send({ error: 'already_started' });
    if (midGame && host.get(rec.id)?.state.world.outcome) {
      return reply.code(409).send({ error: 'game_over' });
    }
    if (!authStore.seatsOf(rec.id).some((s) => s.side === side)) {
      return reply.code(409).send({ error: 'no_commander' });
    }
    if (authStore.seatOf(rec.id, userId) || roleOf(rec, userId)) {
      return reply.code(409).send({ error: 'seat_unavailable' });
    }
    const roles = rec.roles ?? [];
    let mine: string[] | undefined;
    if (role === 'subordinate') {
      const own = new Set(
        loadScenarioById(rec.scenario)
          .units.filter((u) => u.side === side)
          .map((u) => u.id),
      );
      mine = [...new Set(units ?? [])];
      if (mine.length === 0 || mine.some((u) => !own.has(u))) {
        return reply.code(400).send({ error: 'bad_units' });
      }
      const taken = new Set(roles.filter((r) => r.side === side).flatMap((r) => r.units ?? []));
      if (mine.some((u) => taken.has(u))) return reply.code(409).send({ error: 'units_taken' });
    } else {
      if (units) return reply.code(400).send({ error: 'bad_role' });
      if (roles.some((r) => r.side === side && r.role === role)) {
        return reply.code(409).send({ error: 'role_taken' });
      }
    }
    const key = seatKey({ role, ...(mine ? { units: mine } : {}) });
    const succeeds = midGame
      ? [
          ...new Set(
            (rec.past ?? [])
              .filter((p) => p.side === side && seatKey(p) === key)
              .map((p) => p.userId),
          ),
        ]
      : undefined;
    const seat: RoleSeat = {
      userId,
      side,
      role,
      ...(mine ? { units: mine } : {}),
      ...(succeeds ? { succeeds } : {}),
    };
    const next = { ...rec, roles: [...roles, seat] };
    lobby.put(next);
    if (midGame) syncVoters(next);
    return {
      id: rec.id,
      side,
      role,
      ...(mine ? { units: mine } : {}),
      ...(midGame ? { midGame: true } : {}),
      ws: `/games/${rec.id}/ws`,
    };
  };

  server.post<{ Params: { id: string } }>('/games/:id/leave-role', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      if (starting.has(rec.id)) return reply.code(409).send({ error: 'already_started' });
      const held = roleOf(rec, user.id);
      if (!held) return reply.code(404).send({ error: 'no_role' });
      if (rec.status === 'started' && host.get(rec.id)?.state.world.outcome) {
        return reply.code(409).send({ error: 'game_over' });
      }
      // After the start the seat's journal stays: the next holder is briefed from it (D6e).
      const past: PastHolder[] =
        rec.status === 'started'
          ? [
              ...(rec.past ?? []),
              {
                userId: user.id,
                side: held.side,
                role: held.role,
                ...(held.units ? { units: held.units } : {}),
                leftAtMs: Date.now(),
              },
            ]
          : (rec.past ?? []);
      const next: LobbyGame = {
        ...rec,
        roles: (rec.roles ?? []).filter((r) => r.userId !== user.id),
        ready: rec.ready.filter((u) => u !== user.id),
        ...(past.length > 0 ? { past } : {}),
      };
      lobby.put(next);
      if (rec.status === 'started') syncVoters(next);
      return { left: true };
    });
  });

  const Kick = z.object({
    side: z.string().min(1),
    role: z.enum(['chiefOfStaff', 'intelligence', 'quartermaster', 'subordinate']).optional(),
    unit: z.string().min(1).optional(),
  });

  /** Takes `userId` out of a lobby game: their seat or role and their ready mark. */
  const vacate = (rec: LobbyGame, userId: string, removed: boolean): void => {
    authStore.releaseSeat(rec.id, userId);
    lobby.put({
      ...rec,
      roles: (rec.roles ?? []).filter((r) => r.userId !== userId),
      ready: rec.ready.filter((u) => u !== userId),
      ...(removed ? { removed: [...new Set([...(rec.removed ?? []), userId])] } : {}),
    });
  };

  server.post<{ Params: { id: string } }>('/games/:id/leave', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      if (rec.status !== 'lobby' || starting.has(rec.id))
        return reply.code(409).send({ error: 'already_started' });
      if (rec.creator === user.id) return reply.code(409).send({ error: 'creator_cannot_leave' });
      if (!authStore.seatOf(rec.id, user.id) && !roleOf(rec, user.id))
        return reply.code(404).send({ error: 'no_seat' });
      vacate(rec, user.id, false);
      return { left: true };
    });
  });

  server.post<{ Params: { id: string } }>('/games/:id/kick', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      if (rec.creator !== user.id) return reply.code(403).send({ error: 'not_creator' });
      const body = Kick.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'bad_request', message: body.error.message });
      }
      if (rec.status !== 'lobby' || starting.has(rec.id))
        return reply.code(409).send({ error: 'already_started' });
      const { side, role, unit } = body.data;
      const target = role
        ? (rec.roles ?? []).find(
            (r) =>
              r.side === side &&
              r.role === role &&
              (role !== 'subordinate' || (unit !== undefined && r.units?.includes(unit))),
          )?.userId
        : authStore.seatsOf(rec.id).find((s) => s.side === side)?.userId;
      if (!target) return reply.code(404).send({ error: 'no_such_player' });
      if (target === user.id) return reply.code(400).send({ error: 'cannot_kick_self' });
      vacate(rec, target, true);
      void notifier
        .notifyUser(
          rec.id,
          target,
          'Removed from the game',
          'The host removed you from the room before the game started.',
        )
        .catch((e) => onError(rec.id, e));
      return { removed: true };
    });
  });

  server.post<{ Params: { id: string } }>('/games/:id/join', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    const rec = recordOf(id);
    if (!rec || isPrivateTo(rec, user.id)) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(id, req, reply, async () => {
      const body = JoinGame.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'bad_request', message: body.error.message });
      }
      const { side } = body.data;
      if (rec.removed?.includes(user.id)) return reply.code(403).send({ error: 'removed' });
      if (rec.sessionType === 'hot_seat') return reply.code(400).send({ error: 'hot_seat_game' });
      if (!humanSides(rec).includes(side)) return reply.code(400).send({ error: 'bad_side' });
      if (body.data.role)
        return joinRole(rec, user.id, side, body.data.role, body.data.units, reply);
      if (body.data.units) return reply.code(400).send({ error: 'bad_role' });
      if (roleOf(rec, user.id)) return reply.code(409).send({ error: 'seat_unavailable' });
      if (!authStore.claimSeat(id, side, user.id)) {
        return reply.code(409).send({ error: 'seat_unavailable' });
      }
      return { id, side, ws: `/games/${id}/ws` };
    });
  });

  server.post<{ Params: { id: string } }>('/games/:id/ready', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      const body = Ready.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'bad_request', message: body.error.message });
      }
      if (rec.status !== 'lobby' || starting.has(rec.id))
        return reply.code(409).send({ error: 'already_started' });
      if (!authStore.seatOf(rec.id, user.id) && !roleOf(rec, user.id)) {
        return reply.code(403).send({ error: 'no_seat' });
      }
      const others = rec.ready.filter((u) => u !== user.id);
      lobby.put({ ...rec, ready: body.data.ready ? [...others, user.id] : others });
      return { ready: body.data.ready };
    });
  });

  server.post<{ Params: { id: string } }>('/games/:id/start', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const rec = recordOf(req.params.id);
    if (!rec) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      if (rec.creator !== user.id) return reply.code(403).send({ error: 'not_creator' });
      if (rec.status !== 'lobby' || starting.has(rec.id)) {
        return reply.code(409).send({ error: 'already_started' });
      }
      if (rec.sessionType !== 'hot_seat') {
        const seats = authStore.seatsOf(rec.id);
        const open = humanSides(rec).filter((side) => !seats.some((s) => s.side === side));
        if (open.length > 0) return reply.code(409).send({ error: 'sides_open', sides: open });
        const waiting = [
          ...seats,
          ...(rec.roles ?? []).map((r) => ({ side: r.side as SideId, userId: r.userId })),
        ].filter((s) => s.userId !== rec.creator && !rec.ready.includes(s.userId));
        if (waiting.length > 0) {
          return reply
            .code(409)
            .send({ error: 'not_ready', sides: [...new Set(waiting.map((s) => s.side))] });
        }
      }
      starting.add(rec.id);
      const startError = await startGame(rec).finally(() => starting.delete(rec.id));
      if (startError) return reply.code(500).send({ error: startError });
      return { id: rec.id, status: 'started', ws: `/games/${rec.id}/ws` };
    });
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
    if (!recordOf(req.params.id)) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      const w = await windowFor(req.params.id, user.id, undefined);
      if ('error' in w) return reply.code(w.status).send({ error: w.error });
      return w.timeline;
    });
  });

  const critiques = new CritiqueService({
    store,
    client: options.critic,
    wallNow,
    onNote: (gameId, note) => server.log.warn({ gameId, note }, 'critique'),
  });

  // Dissent for the critique: each signed order a teammate dissented from. Same gate as the window.
  server.get<{ Params: { id: string } }>('/games/:id/window/dissents', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    if (!recordOf(req.params.id)) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      const w = await windowFor(req.params.id, user.id, undefined);
      if ('error' in w) return reply.code(w.status).send({ error: w.error });
      return { notes: dissentNotes(w.input.entries) };
    });
  });

  server.get<{ Params: { id: string } }>('/games/:id/critique', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    if (!recordOf(req.params.id)) return reply.code(404).send({ error: 'no_such_game' });
    return tracedHttp(req.params.id, req, reply, async () => {
      const w = await windowFor(req.params.id, user.id, undefined);
      if ('error' in w) return reply.code(w.status).send({ error: w.error });
      return critiques.get(req.params.id, w.input, w.timeline.endMs);
    });
  });

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/games/:id/window/at',
    async (req, reply) => {
      const user = auth.userOf(req);
      if (!user) return reply.code(401).send({ error: 'not_signed_in' });
      if (!recordOf(req.params.id)) return reply.code(404).send({ error: 'no_such_game' });
      return tracedHttp(req.params.id, req, reply, async () => {
        const q = WindowQuery.safeParse(req.query);
        if (!q.success)
          return reply.code(400).send({ error: 'bad_request', message: q.error.message });
        const w = await windowFor(req.params.id, user.id, q.data.side);
        if ('error' in w) return reply.code(w.status).send({ error: w.error });
        return windowAt(w.input, q.data.at);
      });
    },
  );

  server.get<{ Params: { id: string } }>(
    '/games/:id/ws',
    {
      websocket: true,
      // Runs before the upgrade, so a bad session or seat is a plain HTTP error.
      preValidation: async (req, reply) => {
        const { id } = req.params;
        if (
          !originAllowed(
            req.headers.origin,
            req.headers.host,
            publicUrl,
            options.auth?.allowedOrigins,
          )
        ) {
          return reply.code(403).send({ error: 'bad_origin' });
        }
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
      void tracedHttp(req.params.id, req, undefined, async () => {
        hub.attach(
          req.params.id,
          side,
          socket as unknown as Socket,
          user.id,
          seatFor(rec, user.id),
        );
      });
    },
  );

  const sweepGames = async (): Promise<string[]> => {
    const now = wallNow();
    const closed: string[] = [];
    for (const id of host.ids()) {
      if (hub.count(id) > 0) {
        lastActive.set(id, now);
        continue;
      }
      if (!lastActive.has(id)) lastActive.set(id, now);
      const quietMs = now - lastActive.get(id)!;
      const over = Boolean(host.get(id)?.state.world.outcome) && quietMs >= limits.finishedGraceMs;
      const idle = quietMs >= limits.idleMs;
      if (!over && !idle) continue;
      try {
        await host.close(id);
        closed.push(id);
      } catch (e) {
        onError(id, e);
      }
    }
    return closed;
  };
  const sweeper =
    limits.sweepEveryMs > 0 ? setInterval(() => void sweepGames(), limits.sweepEveryMs) : undefined;
  sweeper?.unref();

  server.addHook('onClose', async () => {
    if (sweeper) clearInterval(sweeper);
    await hub.flushSeen();
    hub.closeAll();
    await trace?.close();
    await host.shutdown();
    await notifier.flush();
    if (!options.auth?.store) authStore.close();
    if (!options.lobby) lobby.close();
    if (!options.notify?.store) notifyStore.close();
  });

  return { server, host, hub, notifier, notifyStore, auth, authStore, lobby, sweepGames };
}
