/**
 * The HTTP and WebSocket API. See docs/architecture.md (Components).
 *
 *   POST /games                    create "Hold the Bridge": body `{ "rate"?: number }`
 *   GET  /games/:id/ws?token=...   WebSocket for one side (`@kriegsspiel/protocol` messages)
 *
 * Dev auth is a per-side token in the URL; real accounts arrive with Epic #5.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  startGame,
  startVisibility,
  type GameState,
  type SideId,
} from '@kriegsspiel/engine';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WallClock } from '../clock.js';
import { GameHost, MemoryGameStore, type GameStore, type Timers } from '../game/index.js';
import type { OrderParser } from '../orders/index.js';
import { Hub, type Socket } from './hub.js';

/** Fastest clock a client may ask for: 1 game day per wall second. */
export const MAX_RATE = 86_400;

const CreateGame = z
  .object({ rate: z.number().finite().positive().max(MAX_RATE).optional() })
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
  onError?: (gameId: string, error: unknown) => void;
}

function registry(): EventRegistry<GameState> {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
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
  const onError = (gameId: string, e: unknown) => {
    server.log.error({ err: e, gameId }, 'game error');
    options.onError?.(gameId, e);
  };
  // The hub and host refer to each other: the host notifies the hub, the hub looks games up.
  const hub: Hub = new Hub((id) => host.get(id), onError);
  const host: GameHost = new GameHost({
    store: options.store ?? new MemoryGameStore(),
    parser: options.parser,
    registry: registry(),
    wallNow: options.wallNow ?? Date.now,
    timers: options.timers,
    init: (state) => startGame(startVisibility(state)),
    onUpdate: (id) => hub.notify(id),
    onError,
  });
  /** gameId -> token -> side. Lives as long as the process, like the in-memory store. */
  const tokens = new Map<string, Map<string, SideId>>();

  await server.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

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
    await host.shutdown();
  });

  return { server, host, hub };
}
