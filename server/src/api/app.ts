/**
 * The HTTP and WebSocket API. See docs/architecture.md (Components).
 *
 *   /auth/*                        magic-link login, sessions, account deletion (see ../auth/routes)
 *   POST /games                    signed in: create "Hold the Bridge", body `{ "rate"?: number, "side"?: string }`; the creator takes `side` (default: the first human side)
 *   GET  /games/:id                signed in: which sides are taken and which one is yours
 *   POST /games/:id/join           signed in: take a free side, body `{ "side": string }`
 *   GET  /games/:id/ws             WebSocket for the side the signed-in user holds (`@kriegsspiel/protocol` messages)
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
  startingState,
  type GameStore,
  type Timers,
} from '../game/index.js';
import { adminApi } from '../admin/adminApi.js';
import { LogMailer, type Mailer } from '../auth/mailer.js';
import { authRoutes, type Auth } from '../auth/routes.js';
import { MemoryAuthStore, type AuthStore } from '../auth/store.js';
import { TraceStore } from '../debug/trace.js';
import type { OrderParser } from '../orders/index.js';
import { Hub, type Socket } from './hub.js';

/** Fastest clock a client may ask for: 1 game day per wall second. */
export const MAX_RATE = 86_400;

/** Slowest clock a client may ask for: 1 game second per 100 wall seconds. */
export const MIN_RATE = 0.01;

const SideName = z.enum(['blue', 'red']);

const CreateGame = z
  .object({
    rate: z.number().finite().min(MIN_RATE).max(MAX_RATE).optional(),
    side: SideName.optional(),
  })
  .strict();

const JoinGame = z.object({ side: SideName }).strict();

/** Largest message a client may send. Orders are a few lines of prose. */
const MAX_PAYLOAD_BYTES = 16 * 1024;

export interface AppOptions {
  parser: OrderParser;
  store?: GameStore;
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
  const host: GameHost = new GameHost({
    store,
    parser: options.parser,
    registry: createRegistry(),
    wallNow: options.wallNow ?? Date.now,
    timers: options.timers,
    init: startingState,
    scriptedOpponents: options.scriptedOpponents,
    trace,
    onUpdate: (id) => hub.notify(id),
    onError,
  });
  const authStore = options.auth?.store ?? new MemoryAuthStore();

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
    onAccountDeleted: (userId) => hub.disconnectUser(userId, 'account deleted'),
    onLogout: (userId) => hub.disconnectUser(userId),
  });

  /** A side a player may take: scenario sides run by the built-in opponent are not open. */
  const openSides = (gameId: string): SideId[] =>
    (host.get(gameId)?.state.world.sides ?? [])
      .filter((s) => !(options.scriptedOpponents && s.controller === 'scripted'))
      .map((s) => s.id);

  server.post('/games', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const body = CreateGame.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const world = loadScenario(holdTheBridge);
    const playable = world.sides
      .filter((s) => !(options.scriptedOpponents && s.controller === 'scripted'))
      .map((s) => s.id);
    const side = body.data.side ?? playable[0];
    if (!side || !playable.includes(side)) {
      return reply.code(400).send({ error: 'bad_side', message: `no playable side "${side}"` });
    }
    const id = randomUUID();
    await host.create(id, world, { rate: body.data.rate });
    // The game is already created and the host cannot delete it; log a lost seat so it is not silent.
    if (!authStore.claimSeat(id, side, user.id)) {
      server.log.error({ gameId: id, userId: user.id }, 'new game left without a seat');
      return reply.code(500).send({ error: 'seat_failed' });
    }
    return reply.code(201).send({
      id,
      scenario: world.scenarioId,
      rate: body.data.rate ?? 1,
      side,
      ws: `/games/${id}/ws`,
    });
  });

  server.get<{ Params: { id: string } }>('/games/:id', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    if (!host.get(id)) return reply.code(404).send({ error: 'no_such_game' });
    const seats = authStore.seatsOf(id);
    return {
      id,
      you: authStore.seatOf(id, user.id) ?? null,
      sides: openSides(id).map((side) => ({ side, taken: seats.some((s) => s.side === side) })),
    };
  });

  server.post<{ Params: { id: string } }>('/games/:id/join', async (req, reply) => {
    const user = auth.userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const { id } = req.params;
    if (!host.get(id)) return reply.code(404).send({ error: 'no_such_game' });
    const body = JoinGame.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const { side } = body.data;
    if (!openSides(id).includes(side)) return reply.code(400).send({ error: 'bad_side' });
    if (!authStore.claimSeat(id, side, user.id)) {
      return reply.code(409).send({ error: 'seat_unavailable' });
    }
    return { id, side, ws: `/games/${id}/ws` };
  });

  server.get<{ Params: { id: string } }>(
    '/games/:id/ws',
    {
      websocket: true,
      // Runs before the upgrade, so a bad session or seat is a plain HTTP error.
      preValidation: async (req, reply) => {
        const { id } = req.params;
        const user = auth.userOf(req);
        if (!user) return reply.code(401).send({ error: 'not_signed_in' });
        if (!host.get(id)) return reply.code(404).send({ error: 'no_such_game' });
        if (!authStore.seatOf(id, user.id)) return reply.code(403).send({ error: 'no_seat' });
      },
    },
    (socket, req) => {
      const user = auth.userOf(req);
      const side = user && authStore.seatOf(req.params.id, user.id);
      if (!user || !side) return socket.close(1008, 'no seat');
      hub.attach(req.params.id, side, socket as unknown as Socket, user.id);
    },
  );

  server.addHook('onClose', async () => {
    hub.closeAll();
    await trace?.close();
    await host.shutdown();
    if (!options.auth?.store) authStore.close();
  });

  return { server, host, hub, auth, authStore };
}
