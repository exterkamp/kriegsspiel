import { holdTheBridge, loadScenario, type EngineState, type GameState } from '@kriegsspiel/engine';
import type { TurnOrder, TurnProposal, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { windowTurns, withTurns, windowTimeline } from '../api/umpireWindow.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from '../game/index.js';
import { FakeTime } from '../game/testing.js';
import { UmpireTurnResolver } from '../game/umpireTurn.js';
import type { OrderParser } from '../orders/index.js';
import { ScriptedModel } from '../umpire/leakKit.testkit.js';
import { testReply } from '../umpire/providers/test.js';
import { UmpireError } from '../umpire/umpireClient.js';
import { loadReplayInput, replayAt, replayTimeline } from './replayView.js';
import { adminTurns, replayTurns } from './turnView.js';

const MINUTE = 60_000;
const CANARY = 'CANARY-JOURNAL-7731';

const parser: OrderParser = {
  parse: async () => {
    throw new Error('turn mode parses no order with a model');
  },
};

const PLAN: Record<string, Record<number, TurnOrder[]>> = {
  blue: {
    1: [
      { orderId: 'b1', to: 'blue-1', text: '1st Battalion, march to the bridge and hold it' },
      { orderId: 'b2', to: 'blue-2', text: 'Hold the southern wood', courier: 'safe' },
    ],
  },
  red: {
    1: [
      { orderId: 'r1', to: 'red-1', text: 'Vanguard Battalion, advance to the bridge' },
      { orderId: 'r2', to: 'red-3', text: 'Hussars, push to the bridge', courier: 'fast' },
    ],
    2: [{ orderId: 'r3', to: 'red-2', text: 'Line Battalion, march to the bridge' }],
  },
};

const charge = { id: 'r1', why: 'Does the Red hussars’ charge go home?', chance: 0.4 };

/**
 * An umpire with a story per turn: turn 1 marches Blue's hussars off the map (clamped after the
 * resend), turn 2 asks for a roll and refuses one, turn 3 fails (the tables decide), and later
 * turns are the canned proposal. Every summary and precedent carries a canary.
 */
function storyUmpire(): ScriptedModel {
  return new ScriptedModel({
    adjudicate: (req) => {
      const base = testReply(
        req.schema as Record<string, unknown>,
        req.input as never,
      ) as TurnProposal;
      const p: TurnProposal = {
        ...base,
        summary: `Turn ${base.turn} as the umpire saw it. ${CANARY}.`,
        precedents: [`Precedent of turn ${base.turn}: ${CANARY}.`],
      };
      const shown = req.input as { rolls?: unknown[] };
      if (p.turn === 1) {
        return {
          ...p,
          units: p.units.map((u) =>
            u.unitId === 'blue-3'
              ? { ...u, x: u.x + 9_000, y: u.y - 8_000, departure: 'galloped' }
              : u,
          ),
        };
      }
      if (p.turn === 2) {
        if (shown.rolls) {
          return {
            ...p,
            units: p.units.map((u) => (u.unitId === 'red-3' ? { ...u, rollIds: ['r1'] } : u)),
          };
        }
        return { ...p, rolls: [charge, { id: 'r9', why: 'Sure thing?', chance: 0.99 }] };
      }
      if (p.turn === 3) throw new UmpireError('the model is down', 'transport', 1);
      return p;
    },
  });
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

/** A standard-dial, 10-minute-turn Hold the Bridge game played to its end under `storyUmpire`. */
async function playGame() {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const registry = createRegistry();
  const client = storyUmpire();
  host = new GameHost({
    store,
    parser,
    registry,
    wallNow: time.now,
    timers: time,
    init: startingState,
    turnResolver: (_id, settings) =>
      new UmpireTurnResolver({ registry, client, dial: settings.dial as 'standard' }),
  });
  const settings: UmpireSettings = {
    dial: 'standard',
    persona: 'dry',
    mode: 'turns',
    turnMinutes: 10,
  };
  const game = await host.create(
    'g1',
    { ...loadScenario(holdTheBridge), seed: 1815 },
    { settings },
  );
  /** The live world when each turn opened (its start) and once it was resolved (its end). */
  const atStart = new Map<number, EngineState<GameState>>();
  const atEnd = new Map<number, EngineState<GameState>>();
  for (let guard = 0; guard < 20 && !game.state.world.outcome; guard++) {
    const turn = game.turnStateFor('blue')!.turn;
    atStart.set(turn, structuredClone(game.state));
    for (const side of ['blue', 'red']) {
      for (const order of PLAN[side]![turn] ?? []) {
        await game.submit({ kind: 'turnOrder', side, turn: 0, order });
      }
      await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
    }
    await time.flush();
    atEnd.set(turn, structuredClone(game.state));
  }
  expect(game.state.world.outcome).toBeTruthy();
  const input = (await loadReplayInput(store, 'g1'))!;
  return { game, input, atStart, atEnd, client };
}

describe('turns in the admin replay (D39, 11.11)', () => {
  it('marks each turn, and replays at a turn boundary and inside a turn as the live game stood', async () => {
    const { input, atStart, atEnd } = await playGame();
    const turns = input.entries.filter((e) => e.command.kind === 'resolveTurn');
    expect(turns.length).toBeGreaterThanOrEqual(4);

    const tl = replayTimeline(input);
    const turnMarks = tl.marks.filter((m) => m.kind === 'turn');
    for (const e of turns) {
      const t = e.turn!;
      expect(turnMarks).toContainEqual({
        ms: t.startMs,
        kind: 'turn',
        label: `turn ${t.n} begins`,
      });
      expect(
        turnMarks.some((m) => m.ms === e.endGameMs && m.label.startsWith(`turn ${t.n} decided by`)),
      ).toBe(true);
    }
    expect(turnMarks.find((m) => m.label.startsWith('turn 1 decided'))!.label).toBe(
      'turn 1 decided by the umpire',
    );
    expect(turnMarks.find((m) => m.label.startsWith('turn 3 decided'))!.label).toBe(
      'turn 3 decided by the tables (the umpire fell back)',
    );
    // The umpire's calls are marks the LLM jump can reach.
    expect(
      tl.marks.some((m) => m.kind === 'llm' && m.label.startsWith('turn 2: adjudicate (3 calls)')),
    ).toBe(true);

    for (const e of turns) {
      const t = e.turn!;
      // At the turn's end: the world as the live game stood once the turn was resolved.
      const end = replayAt(input, e.endGameMs!);
      expect(end.gameMs).toBe(e.endGameMs);
      expect(JSON.stringify(end.engine.world)).toBe(JSON.stringify(atEnd.get(t.n)!.world));
      // Inside a turn the umpire decided: still the turn's start until `umpire.turn` at its end.
      if (t.adjudicator === 'umpire') {
        const mid = replayAt(input, t.startMs + 5 * MINUTE);
        expect(mid.engine.world.units).toEqual(atStart.get(t.n)!.world.units);
        expect(mid.engine.world.journal).toEqual(atStart.get(t.n)!.world.journal);
        expect(mid.events.some((ev) => ev.type === 'umpire.turn' && ev.time > t.startMs)).toBe(
          false,
        );
      }
    }
    // The per-turn replay ends each turn exactly where a full replay to that time does.
    for (const r of replayTurns(input)) {
      expect(JSON.stringify(r.after)).toBe(JSON.stringify(replayAt(input, r.after.time).engine));
    }
  });
});

describe('the admin Turn panel (D39, 11.11)', () => {
  it('shows each turn’s orders, projection, calls, proposal, rolls, clamps, fallback and journal', async () => {
    const { input, client } = await playGame();
    const panel = adminTurns(input);
    expect(panel.mode).toBe('turns');
    expect(panel.open).toBeUndefined();
    const [t1, t2, t3, t4] = panel.turns;

    // Held orders as sent, the rules' reading, couriers and the projection the umpire was shown.
    expect(t1!.orders.map((o) => `${o.side}:${o.orderId}`)).toEqual([
      'blue:b1',
      'blue:b2',
      'red:r1',
      'red:r2',
    ]);
    expect(t1!.read!.map((o) => o.engineId)).toEqual(['blue-b1', 'blue-b2', 'red-r1', 'red-r2']);
    expect(t1!.couriers!.length).toBeGreaterThan(0);
    expect(t1!.projection!.turn).toBe(1);

    // The adjudicate input and output: both calls of turn 1 (the reply and the resend).
    expect(t1!.calls.map((c) => c.stage)).toEqual(['adjudicate', 'adjudicate']);
    expect(t1!.calls[0]!.input).toEqual(client.requests[0]!.input);
    expect(JSON.parse(t1!.calls[1]!.rawOutput).turn).toBe(1);
    expect(t1!.proposal!.summary).toContain(CANARY);
    expect(t1!.resent!.some((p) => p.includes('blue-3'))).toBe(true);

    // Every clamp with its reason, and how many units were clamped.
    expect(t1!.rulings.length).toBeGreaterThan(0);
    const clamp = t1!.rulings.find((r) => r.unitId === 'blue-3' && r.field === 'position')!;
    expect(clamp.reason).toMatch(/off the map/);
    expect(t1!.clampedUnits).toBeGreaterThanOrEqual(1);

    // Rolls made, and the one refused.
    expect(t2!.rolls).toEqual([expect.objectContaining({ id: 'r1', chance: 0.4 })]);
    expect(t2!.refusedRolls!.join(' ')).toMatch(/r9/);
    // Asked, answered with the roll, and the one resend for the refused request.
    expect(t2!.calls).toHaveLength(3);

    // The fallback: the tables decided, and why.
    expect(t3!.adjudicator).toBe('engine');
    expect(t3!.fallback!.error).toMatch(/^umpire fell back to the engine: /);
    expect(t3!.proposal).toBeUndefined();
    expect(t3!.rulings).toEqual([]);
    expect(t4!.adjudicator).toBe('umpire');

    // The journal after each turn: a fallback turn adds no note.
    expect(t1!.journal!.notes.map((n) => n.turn)).toEqual([1]);
    expect(t2!.journal!.notes.map((n) => n.turn)).toEqual([1, 2]);
    expect(t3!.journal!.notes.map((n) => n.turn)).toEqual([1, 2]);
    expect(t4!.journal!.notes.map((n) => n.turn)).toEqual([1, 2, 4]);
    expect(t1!.journal!.precedents[0]!.ruling).toContain(CANARY);
  });

  it('lists the open turn’s held orders while the game is played', async () => {
    const time = new FakeTime();
    const store = new MemoryGameStore();
    host = new GameHost({
      store,
      parser,
      registry: createRegistry(),
      wallNow: time.now,
      timers: time,
      init: startingState,
    });
    const settings: UmpireSettings = { dial: 'rigid', persona: 'dry', mode: 'turns' };
    const game = await host.create('g2', loadScenario(holdTheBridge), { settings });
    await game.submit({ kind: 'turnOrder', side: 'blue', turn: 0, order: PLAN.blue![1]![0]! });
    await game.submit({ kind: 'sendTurn', side: 'red', turn: 0, orders: [] });
    const panel = adminTurns((await loadReplayInput(store, 'g2'))!);
    expect(panel.turns).toEqual([]);
    expect(panel.open).toMatchObject({
      n: 1,
      sent: ['red'],
      held: { blue: [{ orderId: 'b1', to: 'blue-1' }], red: [] },
    });
  });
});

describe("turns in the post-game umpire's window (D39, 11.11)", () => {
  it('lists each turn’s outcome and the umpire’s log once the game is over', async () => {
    const { input } = await playGame();
    const tl = withTurns(input, windowTimeline(input)!);
    expect(tl.turns).toEqual(windowTurns(input));
    const [t1, t2, t3] = tl.turns!;
    expect(t1).toMatchObject({
      n: 1,
      startMs: 0,
      endMs: 10 * MINUTE,
      adjudicator: 'umpire',
      fellBack: false,
    });
    expect(t1!.summary).toContain(CANARY);
    expect(t1!.corrections).toBeGreaterThan(0);
    expect(Object.keys(t1!.losses).sort()).toEqual(['blue', 'red']);
    expect(t2!.rolls).toEqual([{ why: charge.why, chance: 0.4, success: expect.any(Boolean) }]);
    expect(t3).toMatchObject({ adjudicator: 'engine', fellBack: true, corrections: 0, rolls: [] });
    expect(t3!.summary).toBeUndefined();
    expect(t2!.journal!.notes.map((n) => n.turn)).toEqual([1, 2]);
    // A turn that cost men names the units, with their status before and after.
    const hurt = tl.turns!.flatMap((t) => t.units);
    for (const u of hurt) expect(u.lost > 0 || u.from !== u.to).toBe(true);
  });
});
