import { holdTheBridge, loadScenario, type EngineState, type GameState } from '@kriegsspiel/engine';
import type { TurnOrder, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import {
  EngineTurnResolver,
  projectTurn,
  rulesParseTurnOrder,
  type EngineTurnOutput,
  type Projection,
} from './engineTurn.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { replayLog } from './replay.js';
import { FakeTime } from './testing.js';
import type { TurnInput, TurnResolver } from './turns.js';

const MINUTE = 60_000;

/** No model in a rigid game: any parse call is a failure. */
const parser: OrderParser = {
  parse: async () => {
    throw new Error('a rigid turn-mode game calls no model');
  },
};

/** Each side's orders by turn: the attacker goes for the bridge, the defender holds it. */
const PLAN: Record<string, Record<number, TurnOrder[]>> = {
  blue: {
    1: [
      { orderId: 'b1', to: 'blue-1', text: '1st Battalion, march to the bridge and hold it' },
      { orderId: 'b2', to: 'blue-2', text: 'Hold the southern wood', courier: 'safe' },
      {
        orderId: 'b3',
        to: 'blue-3',
        text: 'If the bridge is lost, fall back to the southern wood',
        courier: 'fast',
      },
    ],
    3: [{ orderId: 'b4', to: 'blue-2', text: 'Advance to the bridge' }],
  },
  red: {
    1: [
      { orderId: 'r1', to: 'red-1', text: 'Vanguard Battalion, advance to the bridge' },
      { orderId: 'r2', to: 'red-3', text: 'Hussars, push to the bridge', courier: 'fast' },
    ],
    2: [{ orderId: 'r3', to: 'red-2', text: 'Line Battalion, march to the bridge' }],
  },
};

/** Wraps the engine resolver: checks each projection is pure, and keeps it to compare with the turn. */
class Watching implements TurnResolver {
  readonly projections: Projection[] = [];
  private readonly inner: EngineTurnResolver;
  constructor(private readonly registry = createRegistry()) {
    this.inner = new EngineTurnResolver(this.registry);
  }
  async resolve(state: EngineState<GameState>, input: TurnInput) {
    const before = structuredClone(state);
    this.projections.push(projectTurn(state, input, this.registry));
    // The projection never touches the live world.
    expect(state).toEqual(before);
    return this.inner.resolve(state, input);
  }
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function play(opts: { seed?: number; turnMinutes?: number; scripted?: boolean } = {}) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const watching = new Watching();
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: opts.scripted ?? false,
    turnResolver: () => watching,
  });
  const settings: UmpireSettings = {
    dial: 'rigid',
    persona: 'dry',
    mode: 'turns',
    turnMinutes: opts.turnMinutes ?? 20,
  };
  const scenario = { ...loadScenario(holdTheBridge), seed: opts.seed ?? 1815 };
  const game = await host.create('g1', scenario, { settings });
  const sides = opts.scripted ? ['blue'] : ['blue', 'red'];
  // Each turn's end state, compared with its projection.
  const ends: string[] = [];
  for (let guard = 0; guard < 100 && !game.state.world.outcome; guard++) {
    const turn = game.turnStateFor('blue')!.turn;
    for (const side of sides) {
      for (const order of PLAN[side]![turn] ?? []) {
        const res = await game.submit({ kind: 'turnOrder', side, turn: 0, order });
        expect(res).toMatchObject({ ok: true });
      }
      await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
    }
    await time.flush();
    ends.push(JSON.stringify(game.state.world));
  }
  const log = await store.inputLog('g1');
  const replayed = replayLog(
    (await store.logHeader('g1'))!,
    scenario,
    log,
    createRegistry(),
    undefined,
    startingState,
  );
  return { game, log, ends, projections: watching.projections, replayed };
}

describe('the engine adjudicator: rigid turn mode (D39, 11.4)', () => {
  it.each([
    { turnMinutes: 20, seed: 1815 },
    { turnMinutes: 20, seed: 7 },
    { turnMinutes: 5, seed: 1815 },
    { turnMinutes: 10, seed: 42 },
    { turnMinutes: 60, seed: 3 },
  ])(
    'plays Hold the Bridge to an outcome with no model call ($turnMinutes-minute turns, seed $seed)',
    async ({ turnMinutes, seed }) => {
      const run = await play({ turnMinutes, seed });
      const outcome = run.game.state.world.outcome;
      expect(outcome).toBeDefined();
      expect(outcome!.time).toBeLessThanOrEqual(50 * MINUTE);

      const turns = run.log.filter((e) => e.command.kind === 'resolveTurn');
      expect(turns.length).toBe(run.projections.length);
      expect(turns.length).toBeLessThanOrEqual(Math.ceil(50 / turnMinutes));
      for (const [i, e] of turns.entries()) {
        expect(e.error).toBeUndefined();
        expect(e.turn!.adjudicator).toBe('engine');
        expect(e.calls).toBeUndefined();
        // Each turn ends in its projection's state, and the logged summary is that projection's.
        const p = run.projections[i]!;
        expect(JSON.parse(run.ends[i]!)).toEqual(JSON.parse(JSON.stringify(p.state.world)));
        const out = e.turn!.output as EngineTurnOutput;
        expect(out.projection).toEqual(p.summary);
        expect(out.couriers).toEqual(p.couriers);
      }
      // Replay from the log needs no resolver and no model.
      expect(JSON.stringify(run.replayed.state.world)).toBe(JSON.stringify(run.game.state.world));
    },
  );

  it('is deterministic for a given seed', async () => {
    const a = await play({ seed: 99 });
    await host?.shutdown();
    host = undefined;
    const b = await play({ seed: 99 });
    expect(JSON.stringify(b.game.state.world)).toBe(JSON.stringify(a.game.state.world));
    const outputs = (log: typeof a.log) =>
      log.filter((e) => e.command.kind === 'resolveTurn').map((e) => e.turn!.output);
    expect(outputs(b.log)).toEqual(outputs(a.log));
  });

  it('folds a scripted side into the turn: it sends at the turn start and the turn still ends as projected', async () => {
    const run = await play({ scripted: true });
    expect(run.game.state.world.outcome).toBeDefined();
    const agentTimes = run.log.filter((e) => e.agent).map((e) => e.gameMs);
    expect(agentTimes.length).toBeGreaterThan(0);
    const starts = new Set(
      run.log.filter((e) => e.command.kind === 'openTurn').map((e) => e.gameMs),
    );
    for (const t of agentTimes) expect(starts.has(t)).toBe(true);
    // The next turn's scripted orders are already riding when a turn is read back, so compare units.
    for (const [i, p] of run.projections.entries()) {
      const units = JSON.parse(run.ends[i]!).units;
      expect(units).toEqual(JSON.parse(JSON.stringify(p.state.world.units)));
    }
    expect(JSON.stringify(run.replayed.state.world)).toBe(JSON.stringify(run.game.state.world));
  });

  it('keeps the projection summary of a 20-minute Hold the Bridge turn under 2,000 tokens', async () => {
    const run = await play({ turnMinutes: 20 });
    // About four characters to a token for this JSON (measured: see the PR).
    const tokens = run.projections.map((p) => Math.ceil(JSON.stringify(p.summary).length / 4));
    expect(Math.max(...tokens)).toBeLessThan(2000);
    // The turns did fight, so the budget held with contact and losses in the summary.
    const all = run.projections.flatMap((p) => p.summary.units);
    expect(all.some((u) => u.contacts?.length)).toBe(true);
  });

  it('summarises each unit: where it stood and stands, its path, losses and status', async () => {
    const run = await play({ turnMinutes: 20 });
    const first = run.projections[0]!.summary;
    expect(first).toMatchObject({ turn: 1, fromMin: 0, toMin: 20 });
    expect(first.units.map((u) => u.id)).toEqual(
      run.projections[0]!.state.world.units.map((u) => u.id),
    );
    const b1 = first.units.find((u) => u.id === 'blue-1')!;
    expect(b1.from.at).toEqual(expect.any(String));
    expect(b1.path!.length).toBeGreaterThan(1);
    expect(first.events.some((e) => e.includes('order_delivered'))).toBe(true);
  });
});

describe('the rules parse in turn mode', () => {
  const world = loadScenario(holdTheBridge);
  const sent = (to: string, text: string, side = 'blue') => ({ orderId: 'x', to, text, side });

  it('takes the addressee from the desk, never from the text', () => {
    const p = rulesParseTurnOrder(world, sent('blue-2', 'march to the bridge'));
    expect(p).toMatchObject({ to: 'blue-2', engineId: 'blue-x' });
    expect(p.intents).toEqual([{ kind: 'move', to: expect.any(Object) }]);
    // Naming another unit is not a way to redirect the order: only the addressee is offered.
    expect(
      rulesParseTurnOrder(world, sent('blue-2', 'Cavalry, march to the bridge')),
    ).toMatchObject({ to: 'blue-2', none: expect.any(String) });
  });

  it('reads a condition or a time as no new order', () => {
    for (const text of [
      'If the bridge is lost, fall back to the southern wood',
      'Hold the bridge until relieved',
      'At noon advance to the bridge',
      'march to the bridge in 10 minutes',
    ]) {
      expect(rulesParseTurnOrder(world, sent('blue-1', text)).none).toMatch(/condition or a time/);
    }
    expect(
      rulesParseTurnOrder(world, sent('blue-1', 'hold the bridge at all costs')).intents,
    ).toHaveLength(1);
  });

  it('refuses another side’s unit and what the rules cannot carry out', () => {
    expect(rulesParseTurnOrder(world, sent('red-1', 'march to the bridge')).none).toBe(
      'no such unit of this side',
    );
    expect(rulesParseTurnOrder(world, sent('blue-1', 'attack the bridge')).none).toMatch(/attack/);
    expect(rulesParseTurnOrder(world, sent('blue-1', 'sing a song')).none).toBeDefined();
  });
});
