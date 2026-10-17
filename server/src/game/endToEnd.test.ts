/**
 * End-to-end headless game (docs/architecture.md, Testing strategy): a scripted Blue plays "Hold
 * the Bridge" against the scripted Red on a fake wall clock. The same inputs at rates 1, 4, 12 and
 * in fast-forward must give identical final states and event logs, and replay must match.
 */
import {
  holdTheBridge,
  loadScenario,
  viewFor,
  type EmittedEvent,
  type EngineState,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { NARRATE_WINDOW_BASE_MS as NARRATION_WINDOW_MS } from '../umpire/index.js';
import { toDispatch } from '../api/sideView.js';
import { GameHost, MemoryGameStore, replayLog, type GameStore } from './index.js';
import { createRegistry, startingState } from './registry.js';
import { FakeTime } from './testing.js';

const MIN = 60_000;
// Intents are in millimetres, like engine state.
const BRIDGE = { x: 2_050_000, y: 1_500_000 };
// Blue holds the bridge in this script; the battle is decided long before the 50-minute hold.
const HORIZON_MS = 200 * MIN;
/** The staff's slowest answer (D-staff): a first game must outlast it. */
const STAFF_ANSWER_MS = 15 * MIN;

/** Blue's script: what it signs, at which game time. Wording picks the parse result. */
const SCRIPT: { atMs: number; text: string }[] = [
  { atMs: 0, text: 'blue-1 march to the bridge' },
  { atMs: 0, text: 'blue-2 march to the bridge' },
  { atMs: 2 * MIN, text: 'blue-3 hold the bridge' },
  { atMs: 20 * MIN, text: 'blue-1 hold the bridge' },
];

/** A fixed parser: no model, the same answer every time. */
const parser: OrderParser = {
  async parse(text: string): Promise<ParseResult> {
    const unitId = text.split(' ')[0]!;
    const hold = text.includes('hold');
    return {
      kind: 'intents',
      text,
      unitId,
      intents: [hold ? { kind: 'hold', at: BRIDGE } : { kind: 'move', to: BRIDGE }],
    } as ParseResult;
  },
};

interface Run {
  state: EngineState<GameState>;
  events: EmittedEvent[];
  store: GameStore;
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function play(
  rate: number | 'fast-forward',
  untilMs: number | 'end',
  script: readonly { atMs: number; text: string }[] = SCRIPT,
  seed?: number,
  /** The engine rules to play under; absent: the current ones. */
  rules?: number,
): Promise<Run> {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const events: EmittedEvent[] = [];
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
    onEmitted: (_id, e) => events.push(...e),
  });
  const fast = rate === 'fast-forward';
  const loaded = loadScenario({
    ...holdTheBridge,
    ...(seed === undefined ? {} : { seed }),
  });
  const game = await host.create('g1', rules === undefined ? loaded : { ...loaded, rules }, {
    rate: fast ? 1 : rate,
  });
  if (fast) await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  const horizon = untilMs === 'end' ? Infinity : untilMs;
  let at = 0;
  for (const [i, step] of script.entries()) {
    if (step.atMs > horizon || game.state.world.outcome) break;
    if (fast) await game.submit({ kind: 'advanceTo', gameMs: step.atMs });
    else await time.advance((step.atMs - at) / (rate as number));
    at = step.atMs;
    // The advance may have ended the game; nobody signs orders in a finished game.
    if (game.state.world.outcome) break;
    // The desk's own id, as the hub passes it on: the unit's acknowledgement names it (#438).
    await game.submit({ kind: 'order', side: 'blue', text: step.text, orderId: `desk-${i}` });
  }
  if (fast) {
    if (untilMs === 'end') await time.advance(0);
    else await game.submit({ kind: 'advanceTo', gameMs: untilMs });
  } else {
    await time.advance((horizon - at) / (rate as number));
  }
  if (untilMs !== 'end') await game.submit({ kind: 'pause' });
  const run = { state: game.state, events, store };
  await host.shutdown();
  host = undefined;
  return run;
}

/**
 * Order ids are `<game>-o<log seq>`, and seq counts every logged command, so a fast-forward run
 * (which logs setMode and advanceTo too) numbers orders differently. Rename them by first
 * appearance so only real differences show.
 */
function canonical<T>(items: readonly T[]): unknown[] {
  const names = new Map<string, string>();
  const text = JSON.stringify(items).replace(/g1-o\d+/g, (id) => {
    if (!names.has(id)) names.set(id, `order#${names.size + 1}`);
    return names.get(id)!;
  });
  return JSON.parse(text) as unknown[];
}

/** Describe the first place two sequences differ, or null when they are identical. */
function firstDivergence(
  what: string,
  a: readonly unknown[],
  b: readonly unknown[],
): string | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return `${what}: first divergence at index ${i} (of ${a.length} vs ${b.length})\n  a: ${JSON.stringify(a[i])}\n  b: ${JSON.stringify(b[i])}`;
    }
  }
  return null;
}

/** The final world, key by key, so a failure names the first differing field. */
function worldDivergence(a: GameState, b: GameState): string | null {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) {
      return `final world: first divergence in "${k}"\n  a: ${JSON.stringify(ra[k])}\n  b: ${JSON.stringify(rb[k])}`;
    }
  }
  return null;
}

/** What the log says happened, without wall-time bookkeeping that legitimately differs by rate. */
async function logOf(store: GameStore) {
  return (await store.inputLog('g1'))
    .filter((e) => e.command.kind === 'order')
    .map((e) => ({
      gameMs: e.gameMs,
      agent: e.agent ?? false,
      command: e.command,
      parse: e.parse,
    }));
}

async function replayOf(run: Run, untilGameMs: number, seed?: number) {
  const header = (await run.store.logHeader('g1'))!;
  return replayLog(
    header,
    loadScenario(seed === undefined ? holdTheBridge : { ...holdTheBridge, seed }),
    await run.store.inputLog('g1'),
    createRegistry(),
    untilGameMs,
    startingState,
  );
}

describe('the in-tray of a live game', () => {
  it.each([1, 4, 12] as const)(
    'holds an opening report and an order-delivered note after 10 game minutes at rate %i',
    async (rate) => {
      const run = await play(rate, 10 * MIN);
      const reports = viewFor(run.state.world, 'blue', run.state.time).reports;
      const blue = reports.map(toDispatch);
      const opening = blue.find((_, i) => reports[i]!.kind === 'situation');
      expect(opening).toMatchObject({
        from: 'Chief of staff',
        category: 'staff',
        receivedAtGame: 0,
      });
      expect(opening!.location).toBeDefined();
      const ack = blue.find((_, i) => reports[i]!.kind === 'orderDelivered');
      expect(ack).toMatchObject({ category: 'subordinates', confidence: 'high' });
      expect(ack!.orderId).toMatch(/^desk-\d+$/);
      expect(ack!.receivedAtGame).toBeLessThanOrEqual(10 * MIN);
      // Red's own opening report never reaches Blue.
      expect(reports.filter((r) => r.kind === 'situation')).toHaveLength(1);
    },
    60_000,
  );
});

describe('pacing of a first game (#178)', () => {
  it.each([1, 4, 12] as const)(
    'a game with no player orders ends in a Red win, but not before game minute 25 (rate %i)',
    async (rate) => {
      const run = await play(rate, HORIZON_MS, [], 7);
      expect(run.state.world.outcome).toMatchObject({ winner: 'red', reason: 'objective-taken' });
      expect(run.state.time).toBeGreaterThanOrEqual(25 * MIN);
      // Staff answers and a narration window fit before it ends.
      expect(run.state.time).toBeGreaterThan(STAFF_ANSWER_MS + NARRATION_WINDOW_MS);
    },
    60_000,
  );

  // Red takes the bridge in 34 of seeds 1 to 40 under rules 1 and under rules 2 (#432), and in 29
  // under rules 3 (#528), where Blue's idle battalions firing from the south bank contest the hold:
  // these are the first 12 it takes under rules 3 (seeds 8 and 11 are Blue wins, and seed 12, a Red
  // win under rules 2, is now Blue's: Red's attack is broken under Blue's fire).
  it.each([1, 2, 3, 4, 5, 6, 7, 9, 10, 13, 14, 15])(
    'with no player orders Red takes the bridge in most seeds (seed %i)',
    async (seed) => {
      const run = await play('fast-forward', HORIZON_MS, [], seed);
      expect(run.state.world.outcome).toMatchObject({ winner: 'red', reason: 'objective-taken' });
    },
    60_000,
  );

  it('Blue sending 1st and 2nd Battalion to the bridge at once is not lost: there is a fight', async () => {
    const run = await play(12, HORIZON_MS);
    expect(run.events.some((e) => e.type === 'combat.fire')).toBe(true);
    expect(run.state.world.outcome?.winner).not.toBe('red');
    // Nothing moves once the game is over.
    const end = run.state.world.outcome!.time;
    expect(run.events.filter((e) => e.type === 'game.end')).toHaveLength(1);
    expect(run.state.time).toBe(end);
    expect(run.state.world.units.every((u) => u.intent.kind === 'idle')).toBe(true);
  }, 60_000);
});

describe('a battle is decided (#315)', () => {
  // A seed whose battle is ruled and then closed after its pursuit. Under rules 1 the scenario's
  // own seed (1815) did; under rules 2 (#432) its battle closes at the ruling, Red having nobody
  // left, so seed 6 stands in. Played under rules 4: under rules 5 (#446) this script is not
  // decided inside the hold limit (the battalions halt at the contact line and the fight runs
  // long, Red breaking Blue only after it), and the ruling machinery followed here is
  // rules-independent; current-rules games are covered by the pacing tests above and turnParity.
  const BATTLE_SEED = 6;
  it.each([1, 4, 12] as const)(
    'with both battalions at the bridge the game ends with a declared result at rate %i',
    async (rate) => {
      const run = await play(rate, HORIZON_MS, SCRIPT, BATTLE_SEED, 4);
      const w = run.state.world;
      const end = w.outcome!;
      expect(end).toMatchObject({ winner: 'blue', reason: 'attack-broken' });
      expect(end.time).toBeGreaterThanOrEqual(30 * MIN);
      expect(end.time).toBeLessThanOrEqual(70 * MIN);
      // A unit is destroyed, and both the event and the dispatches say so.
      expect(run.events.filter((e) => e.type === 'unit.destroyed').length).toBeGreaterThan(0);
      // The umpire's ruling is on record, was announced, and reaches both sides in the same words.
      const rulings = w.rulings.filter((r) => 'kind' in r && r.kind === 'battle');
      expect(rulings).toHaveLength(1);
      expect(run.events.filter((e) => e.type === 'umpire.ruling')).toHaveLength(1);
      const narrative = (rulings[0] as { narrative: string }).narrative;
      for (const side of ['blue', 'red'] as const) {
        const texts = viewFor(w, side, run.state.time).reports.map((r) => r.text);
        expect(texts, side).toContain(narrative);
        // Nothing a side could not know: no men counts or morale figures in the umpire's words.
        expect(narrative).not.toMatch(/\d/);
      }
      const blueReports = viewFor(w, 'blue', run.state.time).reports;
      expect(blueReports.some((r) => r.kind === 'destroyed')).toBe(true);
      const redLost = viewFor(w, 'red', run.state.time).reports.filter(
        (r) => r.kind === 'unitLost',
      );
      expect(redLost.length).toBeGreaterThan(0);
      // #320: Blue was told it was engaged before the ruling, and of a unit breaking or lost.
      const ruling = rulings[0] as { time: number; narrative: string };
      const blue = viewFor(w, 'blue', run.state.time).reports;
      const engaged = blue.filter((r) => r.kind === 'engaged');
      expect(engaged.length).toBeGreaterThan(0);
      expect(Math.min(...engaged.map((r) => r.observedAt))).toBeLessThan(ruling.time);
      expect(blue.some((r) => ['heavyLosses', 'broke', 'unitLost'].includes(r.kind))).toBe(true);
      // #323: every Blue unit still alive under half its starting strength said so, exactly once, at every rate.
      const heavy = blue.filter((r) => r.kind === 'heavyLosses');
      for (const u of w.units.filter((x) => x.side === 'blue' && x.strength > 0)) {
        const said = heavy.filter((r) => r.from === u.name).length;
        const wasHeavy = u.strength < 0.5 * (w.startStrength?.[u.id] ?? u.strength);
        expect(said, u.name).toBe(wasHeavy ? 1 : said);
        expect(said, u.name).toBeLessThanOrEqual(1);
      }
      // The ruling paper carries the ruling text and is not the umpire's "reports its situation".
      const paper = blue.find((r) => r.kind === 'battle')!;
      expect(paper.text).toBe(ruling.narrative);
      expect(paper.text).toMatch(/has been broken/);
      // No report names the other side's units.
      for (const r of blue.filter((x) => x.kind !== 'contact' && x.kind !== 'destroyed')) {
        expect(r.text, r.kind).not.toMatch(/red-/i);
      }
    },
    60_000,
  );
});

describe('end-to-end headless game', () => {
  it('plays Hold the Bridge to the end in fast-forward, and replay matches', async () => {
    const run = await play('fast-forward', 4 * 60 * MIN);
    const end = run.events.find((e) => e.type === 'game.end');
    expect(end).toBeDefined();
    expect(run.state.world.outcome).not.toBeNull();

    const replayed = await replayOf(run, run.state.time);
    expect(worldDivergence(replayed.state.world, run.state.world)).toBeNull();
    expect(firstDivergence('events', replayed.emitted, run.events)).toBeNull();
  }, 60_000);

  it('gives identical final states and event logs at rates 1, 4, 12 and fast-forward', async () => {
    const base = await play(1, HORIZON_MS);
    // The scenario is decided before the horizon, and a finished game does not run on: the clock
    // stops at the outcome, so every rate ends at the outcome's game time.
    const outcome = base.state.world.outcome;
    expect(outcome).toBeTruthy();
    expect(base.state.time).toBe(outcome!.time);
    expect(base.state.time).toBeLessThan(HORIZON_MS);
    expect(base.events.length).toBeGreaterThan(0);
    const baseLog = await logOf(base.store);
    expect(baseLog.some((e) => e.agent)).toBe(true);
    expect(baseLog.some((e) => !e.agent)).toBe(true);

    for (const rate of [4, 12, 'fast-forward'] as const) {
      const run = await play(rate, HORIZON_MS);
      const label = `rate ${rate} vs rate 1`;
      expect(run.state.time, label).toBe(base.state.time);
      expect(
        worldDivergence(
          canonical([run.state.world])[0] as GameState,
          canonical([base.state.world])[0] as GameState,
        ),
        label,
      ).toBeNull();
      expect(
        firstDivergence('events', canonical(run.events), canonical(base.events)),
        label,
      ).toBeNull();
      expect(
        firstDivergence('order log', canonical(await logOf(run.store)), canonical(baseLog)),
        label,
      ).toBeNull();
    }
  }, 120_000);

  it('replays each run from its log to the same state and events', async () => {
    for (const rate of [1, 4, 12, 'fast-forward'] as const) {
      const run = await play(rate, HORIZON_MS);
      const replayed = await replayOf(run, HORIZON_MS);
      const label = `replay of rate ${rate}`;
      expect(worldDivergence(replayed.state.world, run.state.world), label).toBeNull();
      expect(firstDivergence('events', replayed.emitted, run.events), label).toBeNull();
    }
  }, 120_000);
});

describe('a decided battle against the time limit (#417)', () => {
  /** Both battalions told to hold the bridge, as in the QA playthrough. */
  const HOLD_BOTH = [
    { atMs: 0, text: 'blue-1 hold the bridge' },
    { atMs: 0, text: 'blue-2 hold the bridge' },
  ];
  const RATES = [1, 4, 12, 'fast-forward'] as const;
  // Both games are played under rules 4: under rules 5 (#446) no hold-the-bridge defence is
  // ruled broken inside the 50-minute limit (the fight at the contact line runs long), so there
  // is no pre-limit ruling for the limit to stand on. What #417 proves, that a ruling stands at
  // the limit, is rules-independent.

  it('a defence ruled broken after minute 30 wins for Red at the time limit, not objective-held, at every rate and in replay', async () => {
    // Seed 128: Blue's defence is ruled broken at about game minute 35, so the pursuit would
    // close after the 50-minute limit. Before #417 the limit gave Blue "objective-held". (Seed 117
    // showed it under rules 1; courier dice on their own stream, #432, changed the fight.)
    const runs = [];
    for (const rate of RATES) {
      const run = await play(rate, HORIZON_MS, HOLD_BOTH, 128, 4);
      const { battle, outcome } = run.state.world;
      expect(battle, `rate ${rate}`).toMatchObject({ winner: 'red', reason: 'defence-broken' });
      expect(battle!.declaredAt).toBeGreaterThan(30 * MIN);
      expect(outcome, `rate ${rate}`).toEqual({
        winner: 'red',
        reason: 'defence-broken',
        time: holdTheBridge.victory.holdMinutes * MIN,
      });
      const replayed = await replayOf(run, HORIZON_MS, 128);
      expect(worldDivergence(replayed.state.world, run.state.world), `replay ${rate}`).toBeNull();
      runs.push(run);
    }
    for (const run of runs.slice(1)) {
      expect(
        worldDivergence(
          canonical([run.state.world])[0] as GameState,
          canonical([runs[0]!.state.world])[0] as GameState,
        ),
      ).toBeNull();
    }
  }, 240_000);

  it('a ruling stands when the winning side then leaves the field', async () => {
    // Seed 27: Red's attack is ruled broken, then Blue's last unit breaks in the pursuit. Before
    // #417 that gave Red the game with "attack-broken".
    for (const rate of RATES) {
      const run = await play(rate, HORIZON_MS, HOLD_BOTH, 27, 4);
      expect(run.state.world.battle, `rate ${rate}`).toMatchObject({
        winner: 'blue',
        reason: 'attack-broken',
      });
      expect(run.state.world.outcome, `rate ${rate}`).toMatchObject({
        winner: 'blue',
        reason: 'attack-broken',
      });
    }
  }, 240_000);
});
