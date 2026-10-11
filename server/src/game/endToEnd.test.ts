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
import { toDispatch } from '../api/sideView.js';
import { GameHost, MemoryGameStore, replayLog, type GameStore } from './index.js';
import { createRegistry, startingState } from './registry.js';
import { FakeTime } from './testing.js';

const MIN = 60_000;
// Intents are in millimetres, like engine state.
const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const HORIZON_MS = 60 * MIN;

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

async function play(rate: number | 'fast-forward', untilMs: number | 'end'): Promise<Run> {
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
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: fast ? 1 : rate });
  if (fast) await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  const horizon = untilMs === 'end' ? Infinity : untilMs;
  let at = 0;
  for (const step of SCRIPT) {
    if (step.atMs > horizon || game.state.world.outcome) break;
    if (fast) await game.submit({ kind: 'advanceTo', gameMs: step.atMs });
    else await time.advance((step.atMs - at) / (rate as number));
    at = step.atMs;
    // The advance may have ended the game; nobody signs orders in a finished game.
    if (game.state.world.outcome) break;
    await game.submit({ kind: 'order', side: 'blue', text: step.text });
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

async function replayOf(run: Run, untilGameMs: number) {
  const header = (await run.store.logHeader('g1'))!;
  return replayLog(
    header,
    loadScenario(holdTheBridge),
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
      const blue = viewFor(run.state.world, 'blue', run.state.time).reports.map(toDispatch);
      const opening = blue.find((d) => d.text.includes('no enemy yet in sight'));
      expect(opening).toMatchObject({
        from: 'Chief of staff',
        category: 'staff',
        receivedAtGame: 0,
      });
      expect(opening!.location).toBeDefined();
      const ack = blue.find((d) => d.text.includes('received its orders'));
      expect(ack).toMatchObject({ category: 'subordinates', confidence: 'high' });
      expect(ack!.receivedAtGame).toBeLessThanOrEqual(10 * MIN);
      // Red's own opening report never reaches Blue.
      expect(blue.filter((d) => d.text.includes('no enemy yet in sight'))).toHaveLength(1);
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
