/**
 * Each game its own dice (#534): every game of a scenario was made with the scenario's seed, so two
 * games of Hold the Bridge rolled the same courier luck for the same orders. A new game now draws
 * its seed when it is made (or takes the one its request names), keeps it in the input-log header,
 * and replays from the header as before.
 */
import { createHash } from 'node:crypto';
import { holdTheBridge, loadScenario, type GameState } from '@kriegsspiel/engine';
import type { TurnOrder } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryGameStore,
  createRegistry,
  loadScenarioById,
  replayLog,
  startingState,
} from '../game/index.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { buildApp, type App } from './app.js';

const mailbox: Array<{ to: string; link: string }> = [];
const mailer = {
  async sendLoginLink(to: string, link: string) {
    mailbox.push({ to, link });
  },
};

let app: App | undefined;
let store: MemoryGameStore;

afterEach(async () => {
  await app?.server.close();
  app = undefined;
  mailbox.length = 0;
});

async function start(newSeed?: () => number): Promise<{ base: string; cookie: string }> {
  store = new MemoryGameStore();
  app = await buildApp({
    parser: new StubOrderParser(),
    store,
    auth: { mailer },
    ...(newSeed ? { newSeed } : {}),
  });
  const base = await app.server.listen({ port: 0, host: '127.0.0.1' });
  await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lead@example.test' }),
  });
  const link = new URL(mailbox.at(-1)!.link);
  const res = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
  return { base, cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

const post = (cookie: string, body: unknown = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});

async function newGame(base: string, cookie: string, body: Record<string, unknown> = {}) {
  const res = await fetch(
    `${base}/games`,
    post(cookie, { sessionType: 'hot_seat', mode: 'turns', ...body }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as Record<string, unknown> & { id: string };
  // The seed is master state: it is never sent to a player.
  expect(created).not.toHaveProperty('seed');
  return created.id;
}

const seedOf = async (id: string) => (await store.logHeader(id))!.seed;

/** Every order of the scenario's opening, sent by each side for turn 1. */
const ORDERS: Record<'blue' | 'red', TurnOrder[]> = {
  blue: [
    { orderId: 'b1', to: 'blue-1', text: 'Hold the bridge' },
    { orderId: 'b2', to: 'blue-2', text: 'March to the bridge' },
    { orderId: 'b3', to: 'blue-3', text: 'Scout the northern wood' },
  ],
  red: [
    { orderId: 'r1', to: 'red-1', text: 'Advance to the bridge' },
    { orderId: 'r2', to: 'red-2', text: 'Advance to the bridge' },
    { orderId: 'r3', to: 'red-3', text: 'Ride to the river and look for a ford' },
  ],
};

/** Play turn 1 with `ORDERS` and say how each courier fared: when it arrived, or that it was lost. */
async function courierLuck(id: string): Promise<string[]> {
  const game = app!.host.get(id)!;
  for (const side of ['blue', 'red'] as const) {
    for (const order of ORDERS[side]) {
      expect(await game.submit({ kind: 'turnOrder', side, turn: 0, order })).toMatchObject({
        ok: true,
      });
    }
    await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
  }
  // The turn is resolved when the next opens, or when it decided the game.
  const resolved = () => game.state.world.outcome || (game.turnStateFor('blue')?.turn ?? 0) >= 2;
  for (let i = 0; i < 300 && !resolved(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(resolved()).toBeTruthy();
  // What became of each order: its acknowledgement and the minute it came, or its loss.
  const { world } = game.state;
  return Object.values(world.intel)
    .flatMap((intel) => intel.reports)
    .filter((r) => r.kind === 'orderDelivered' || r.kind === 'courierLost')
    .map((r) => `${r.kind} ${r.orderRef ?? r.from} at ${Math.round(r.observedAt / 1000)} s`)
    .sort();
}

const worldHash = (w: GameState) => createHash('sha256').update(JSON.stringify(w)).digest('hex');

describe('each game its own seed (#534)', () => {
  it('gives two games of the same scenario, made one after the other, different seeds', async () => {
    const { base, cookie } = await start();
    const a = await newGame(base, cookie);
    const b = await newGame(base, cookie);
    const [sa, sb] = [await seedOf(a), await seedOf(b)];
    expect(sa).not.toBe(sb);
    for (const s of [sa, sb]) {
      expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    }
    // The world carries the game's seed (the field notes' wording, the officers' names), not the
    // scenario's.
    expect(app!.host.get(a)!.state.world.seed).toBe(sa);
    expect(app!.host.get(b)!.state.world.seed).toBe(sb);
  });

  it('rolls other courier luck for the same orders, and replays each game from its header', async () => {
    // Two seeds whose first turn differs: under seed 4 Blue's courier to the 1st Battalion is lost.
    // (Most pairs differ only later: the first turn's rides are short and rarely go wrong.)
    const seeds = [4, 5];
    const { base, cookie } = await start(() => seeds.shift()!);
    const a = await newGame(base, cookie);
    const b = await newGame(base, cookie);
    expect([await seedOf(a), await seedOf(b)]).toEqual([4, 5]);
    const [luckA, luckB] = [await courierLuck(a), await courierLuck(b)];
    expect(luckA).toContain('courierLost b1 at 1008 s');
    expect(luckB).toContain('orderDelivered b1 at 108 s');
    expect(luckA).not.toEqual(luckB);
    // Replay takes the seed from the header: the same world, with no model.
    for (const id of [a, b]) {
      const header = (await store.logHeader(id))!;
      const replayed = replayLog(
        header,
        loadScenarioById(header.scenarioId),
        await store.inputLog(id),
        createRegistry(),
        undefined,
        startingState,
      ).state;
      const live = app!.host.get(id)!.state;
      expect(replayed.rng).toBe(live.rng);
      expect(worldHash(replayed.world)).toBe(worldHash(live.world));
    }
  });

  it('plays the dice a request names, the same each time', async () => {
    const { base, cookie } = await start(() => {
      throw new Error('no seed is drawn when the request names one');
    });
    const scenarioSeed = loadScenario(holdTheBridge).seed;
    const a = await newGame(base, cookie, { seed: scenarioSeed });
    const b = await newGame(base, cookie, { seed: scenarioSeed });
    expect([await seedOf(a), await seedOf(b)]).toEqual([scenarioSeed, scenarioSeed]);
    expect(await courierLuck(a)).toEqual(await courierLuck(b));
    for (const seed of [-1, 2 ** 32, 1.5]) {
      const res = await fetch(`${base}/games`, post(cookie, { sessionType: 'hot_seat', seed }));
      expect(res.status).toBe(400);
    }
  });

  it('draws the seed when a lobby game is made, and starts it with that seed', async () => {
    const seeds = [123_456];
    const { base, cookie } = await start(() => seeds.shift()!);
    const id = await newGame(base, cookie, { lobby: true });
    expect(app!.lobby.get(id)?.seed).toBe(123_456);
    expect(await store.logHeader(id)).toBeUndefined();
    expect((await fetch(`${base}/games/${id}/start`, post(cookie))).status).toBe(200);
    expect(await seedOf(id)).toBe(123_456);
  });
});
