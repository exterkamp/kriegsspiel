/**
 * Rigid turns against real time (#430, D39 "The three adjudicators"): a `rigid` turn is real-time
 * play stepped in fixed slices, so the same orders and seed give the same game at its turn ends.
 * Blue sends both battalions to the bridge at the start (1st Battalion "Hold the bridge", 2nd
 * "March to the bridge"), the scripted Red plays itself, and the two modes are compared.
 */
import {
  MS_PER_MINUTE,
  advanceTo,
  courierPass,
  createState,
  engineTurnStart,
  holdTheBridge,
  issueOrder,
  loadScenario,
  positionAt,
  type GameState,
} from '@kriegsspiel/engine';
import type { TurnOrder, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { engineOrdersOf, rulesParseTurnOrder, type EngineTurnOutput } from './engineTurn.js';
import { GameHost, MemoryGameStore, createRegistry, replayLog, startingState } from './index.js';
import { FakeTime } from './testing.js';

const MIN = MS_PER_MINUTE;
const ORDERS: TurnOrder[] = [
  { orderId: 'b1', to: 'blue-1', text: 'Hold the bridge' },
  { orderId: 'b2', to: 'blue-2', text: 'March to the bridge' },
];
/**
 * How far apart the two modes may end: turn mode counts the objective's hold and a battle's close
 * from the game minute they start in (#429), real time from the instant, so a game decided by one
 * of them can end up to a minute earlier in turns.
 */
const MINUTE_RULE_MS = MIN;

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

interface Snap {
  t: number;
  units: { id: string; x: number; y: number; strength: number; status: string }[];
}

/** Where each unit stands (metres, part-way along a march), its men and status. */
function snap(world: GameState, t: number): Snap {
  return {
    t,
    units: world.units.map((u) => {
      const p = positionAt(world.map, u, t);
      return {
        id: u.id,
        x: Math.round(p.x / 1000),
        y: Math.round(p.y / 1000),
        strength: Math.round(u.strength),
        status: u.status,
      };
    }),
  };
}

/** A rigid turn game to its end: Blue sends `ORDERS` in turn 1 and nothing after. */
async function playTurns(seed: number, turnMinutes: number) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser: {
      parse: async () => {
        throw new Error('a rigid turn-mode game calls no model');
      },
    },
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
  });
  const settings: UmpireSettings = { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes };
  const scenario = { ...loadScenario(holdTheBridge), seed };
  const game = await host.create('turns', scenario, { settings });
  const ends: Snap[] = [];
  for (let turn = 1; turn < 100 && !game.state.world.outcome; turn++) {
    for (const order of turn === 1 ? ORDERS : []) {
      const res = await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order });
      expect(res).toMatchObject({ ok: true });
    }
    await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
    await time.flush();
    ends.push(snap(game.state.world, game.state.time));
  }
  const log = await store.inputLog('turns');
  const replayed = replayLog(
    (await store.logHeader('turns'))!,
    scenario,
    log,
    createRegistry(),
    undefined,
    startingState,
  );
  const world = game.state.world;
  await host.shutdown();
  host = undefined;
  return { ends, log, world, replayed: replayed.state.world };
}

/** The same orders signed at minute 0 of a real-time game, read by the same rules; snapshots at `times`. */
async function playRealTime(seed: number, times: number[]) {
  const time = new FakeTime();
  const world0 = loadScenario(holdTheBridge);
  const read = new Map(
    ORDERS.map((o) => [o.to, rulesParseTurnOrder(world0, { ...o, side: 'blue' })]),
  );
  const parser: OrderParser = {
    async parse(text): Promise<ParseResult> {
      const to = text.split(' ')[0]!;
      // The rules read these two as a plain hold and march, which the parse result can carry.
      const intents = read.get(to)!.intents as Extract<ParseResult, { kind: 'intents' }>['intents'];
      return { kind: 'intents', text, unitId: to, intents };
    },
  };
  host = new GameHost({
    store: new MemoryGameStore(),
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
  });
  const game = await host.create('rt', { ...loadScenario(holdTheBridge), seed }, { rate: 1 });
  await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  for (const o of ORDERS) {
    const res = await game.submit({ kind: 'order', side: 'blue', text: `${o.to} ${o.text}` });
    expect(res).toMatchObject({ ok: true });
  }
  const snaps: Snap[] = [];
  for (const t of times) {
    await game.submit({ kind: 'advanceTo', gameMs: t });
    snaps.push(snap(game.state.world, Math.min(t, game.state.time)));
  }
  await game.submit({ kind: 'advanceTo', gameMs: 200 * MIN });
  const world = game.state.world;
  await host.shutdown();
  host = undefined;
  return { snaps, world };
}

/** D39's 30 parity games: seeds 1 to 8, 42 and 1815, in turns of 10, 20 and 30 minutes. */
const CASES = [1, 2, 3, 4, 5, 6, 7, 8, 42, 1815].flatMap((seed) =>
  [10, 20, 30].map((turnMinutes) => ({ seed, turnMinutes })),
);

describe('rigid turns against real time (#430)', () => {
  it.each(CASES)(
    'gives the same field at every turn end and the same outcome (seed $seed, $turnMinutes-minute turns)',
    async ({ seed, turnMinutes }) => {
      const turns = await playTurns(seed, turnMinutes);
      const real = await playRealTime(
        seed,
        turns.ends.map((e) => e.t),
      );
      // The field is the same to the metre and the man at every turn end, the fights included: the
      // couriers roll on dice of their own (#432), so the pass draws the world's dice as real time does.
      expect(turns.ends.length).toBeGreaterThan(0);
      expect(turns.ends).toEqual(real.snaps);
      // The same result, at the same time up to the minute rule.
      const [t, r] = [turns.world.outcome, real.world.outcome];
      expect(t?.winner).toBeDefined();
      expect({ winner: t?.winner, reason: t?.reason }).toEqual({
        winner: r?.winner,
        reason: r?.reason,
      });
      expect(r!.time - t!.time).toBeGreaterThanOrEqual(0);
      expect(r!.time - t!.time).toBeLessThan(MINUTE_RULE_MS);
      // The scripted side thought inside the turns, and replay repeats the game with no agent.
      const opens = new Set(
        turns.log.filter((e) => e.command.kind === 'openTurn').map((e) => e.gameMs),
      );
      expect(turns.log.some((e) => e.agent && !opens.has(e.gameMs))).toBe(true);
      expect(JSON.stringify(turns.replayed)).toBe(JSON.stringify(turns.world));
    },
    60_000,
  );

  it('moves Red in the first turn, as real time does, so the bridge is fought for', async () => {
    const turns = await playTurns(1815, 30);
    const real = await playRealTime(1815, [turns.ends[0]!.t]);
    const red = (s: Snap) => s.units.filter((u) => u.id.startsWith('red'));
    // Under the once-a-turn rule Red was still forming up when the turn opened and sat it out.
    expect(red(turns.ends[0]!)).not.toEqual(red(snap(loadScenario(holdTheBridge), 0)));
    expect(turns.ends[0]).toEqual(real.snaps[0]);
  });
});

describe('couriers across turn boundaries (#430)', () => {
  it('acts on an order that arrives mid-turn from that minute, as in real time', () => {
    const registry = createRegistry();
    const s0 = startingState(createState(1815, loadScenario(holdTheBridge), 0));
    const turn = { n: 1, startMs: 0, endMs: 20 * MIN };
    const sent = [{ ...ORDERS[1]!, side: 'blue' }];
    const orders = engineOrdersOf(
      sent.map((o) => rulesParseTurnOrder(s0.world, o)),
      sent,
      turn.startMs,
    );
    const pass = courierPass(s0, orders, turn, registry);
    const ride = pass.couriers[0]!;
    expect(ride.outcome).toBe('delivered');
    expect(ride.atMs).toBeGreaterThan(turn.startMs);
    expect(ride.atMs).toBeLessThan(turn.endMs);

    const where = (s: typeof s0) => {
      const u = s.world.units.find((x) => x.id === 'blue-2')!;
      return positionAt(s.world.map, u, s.time);
    };
    const start = engineTurnStart(s0, orders, pass, turn);
    // Still where it stood the instant before the courier arrives.
    expect(where(advanceTo(start, ride.atMs! - 1, registry).state)).toEqual(where(s0));
    const end = advanceTo(start, turn.endMs, registry);
    expect(end.emitted.find((e) => e.type === 'order_delivered')?.time).toBe(ride.atMs);
    expect(where(end.state)).not.toEqual(where(s0));

    // Real time: signed at minute 0, it arrives at the same minute and the unit ends in the same place.
    const real = advanceTo(issueOrder(s0, orders[0]!, 0), turn.endMs, registry);
    expect(real.emitted.find((e) => e.type === 'order_delivered')?.time).toBe(ride.atMs);
    expect(where(real.state)).toEqual(where(end.state));
  });

  it('carries an order still riding at the turn end into the next turn and delivers it at its due minute', async () => {
    // Blue's HQ far in the south-east and 1st Battalion in the west: the ride outlasts a 5-minute turn.
    const scenario = loadScenario({
      ...holdTheBridge,
      sides: holdTheBridge.sides.map((s) =>
        s.id === 'blue' ? { ...s, hq: { x: 3950, y: 2950 } } : s,
      ),
      units: holdTheBridge.units.map((u) =>
        u.id === 'blue-1' ? { ...u, at: { x: 400, y: 1700 } } : u,
      ),
    });
    const time = new FakeTime();
    const store = new MemoryGameStore();
    host = new GameHost({
      store,
      parser: { parse: async () => ({ kind: 'rejection', text: '', reason: 'no model' }) },
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
      scriptedOpponents: true,
    });
    const settings: UmpireSettings = {
      dial: 'rigid',
      persona: 'dry',
      mode: 'turns',
      turnMinutes: 5,
    };
    // A seed whose courier is not lost on the long ride.
    const game = await host.create('ride', { ...scenario, seed: 1 }, { settings });
    const at = () => {
      const u = game.state.world.units.find((x) => x.id === 'blue-1')!;
      const p = positionAt(game.state.world.map, u, game.state.time);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const from = at();
    const order: TurnOrder = { orderId: 'b1', to: 'blue-1', text: 'March to the bridge' };
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order });
    const couriers: EngineTurnOutput['couriers'][] = [];
    const places: { x: number; y: number }[] = [];
    for (let turn = 1; turn <= 3 && !game.state.world.outcome; turn++) {
      await game.submit({ kind: 'sendTurn', side: 'blue', turn: 0, orders: [] });
      await time.flush();
      const log = await store.inputLog('ride');
      const resolved = log.filter((e) => e.command.kind === 'resolveTurn').at(-1)!;
      couriers.push((resolved.turn!.output as EngineTurnOutput).couriers);
      places.push(at());
    }
    const first = couriers[0]!.find((c) => c.orderId === 'blue-b1')!;
    expect(first.outcome).toBe('riding');
    expect(first.dueMs).toBeGreaterThan(5 * MIN);
    // A later turn's pass carries it on, and it arrives at the minute it was due.
    const later = couriers
      .slice(1)
      .flat()
      .find((c) => c.orderId === 'blue-b1' && c.outcome !== 'riding')!;
    expect(later).toMatchObject({ outcome: 'delivered', atMs: first.dueMs });
    // Not acted on while it was on the road; acted on once it had arrived.
    expect(places[0]).toEqual(from);
    expect(places.at(-1)).not.toEqual(from);
  });
});
