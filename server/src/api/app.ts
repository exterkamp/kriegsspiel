/**
 * The HTTP and WebSocket API. See docs/architecture.md (Components).
 *
 *   POST /games                    create "Hold the Bridge": body `{ "rate"?: number }`
 *   GET  /games/:id/ws?token=...   WebSocket for one side (`@kriegsspiel/protocol` messages)
 *   GET  /healthz                  liveness, `{ ok: true }`
 *   /admin/api/*                   read-only debug API, only when `admin.enabled` (see ../admin)
 *   GET  /*                        the built client, when `staticDir` is set
 *
 * Dev auth is a per-side token in the URL; real accounts arrive with Epic #5.
 */
import { randomBytes, randomUUID } from 'node:crypto';
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
import { TraceStore } from '../debug/trace.js';
import type { OrderParser } from '../orders/index.js';
import { Hub, type Socket } from './hub.js';

/** Fastest clock a client may ask for: 1 game day per wall second. */
export const MAX_RATE = 86_400;

/** Slowest clock a client may ask for: 1 game second per 100 wall seconds. */
export const MIN_RATE = 0.01;

const CreateGame = z
  .object({ rate: z.number().finite().min(MIN_RATE).max(MAX_RATE).optional() })
  .strict();

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
  onError?: (gameId: string, error: unknown) => void;
}

export interface App {
  server: FastifyInstance;
  host: GameHost;
  hub: Hub;
}

export async function buildApp(options: AppOptions): Promise<App> {
  const server = Fastify({
    logger: options.logger
      ? {
          // The side token rides in the query string; keep it out of the logs.
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
  /** gameId -> token -> side. Lives as long as the process, like the in-memory store. */
  const tokens = new Map<string, Map<string, SideId>>();

  await server.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  // Liveness for the container health check. Does not touch a game or the store.
  server.get('/healthz', async () => ({ ok: true }));

  if (trace) await adminApi(server, { host, trace, token: options.admin?.token });

  if (options.staticDir) {
    await server.register(fastifyStatic, { root: resolve(options.staticDir) });
  }

  server.post('/games', async (req, reply) => {
    const body = CreateGame.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const world = loadScenario(holdTheBridge);
    const id = randomUUID();
    await host.create(id, world, { rate: body.data.rate });
    const bySide = new Map<string, SideId>();
    const issued: Record<string, string> = {};
    for (const side of world.sides) {
      const token = randomBytes(16).toString('hex');
      bySide.set(token, side.id);
      issued[side.id] = token;
    }
    tokens.set(id, bySide);
    return reply.code(201).send({
      id,
      scenario: world.scenarioId,
      rate: body.data.rate ?? 1,
      tokens: issued,
      ws: Object.fromEntries(
        Object.entries(issued).map(([side, token]) => [side, `/games/${id}/ws?token=${token}`]),
      ),
    });
  });

  server.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/games/:id/ws',
    {
      websocket: true,
      // Runs before the upgrade, so a bad game or token is a plain HTTP error.
      preValidation: async (req, reply) => {
        const { id } = req.params;
        if (!host.get(id)) return reply.code(404).send({ error: 'no_such_game' });
        const token = req.query.token;
        if (typeof token !== 'string' || !tokens.get(id)?.has(token)) {
          return reply.code(401).send({ error: 'bad_token' });
        }
      },
    },
    (socket, req) => {
      const side = tokens.get(req.params.id)?.get(req.query.token ?? '');
      if (!side) return socket.close(1008, 'bad token');
      hub.attach(req.params.id, side, socket as unknown as Socket);
    },
  );

  server.addHook('onClose', async () => {
    hub.closeAll();
    await trace?.close();
    await host.shutdown();
  });

  return { server, host, hub };
}
