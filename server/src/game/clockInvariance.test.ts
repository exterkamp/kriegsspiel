/**
 * Clock invariance (docs/architecture.md, Testing strategy): the rate and pausing never change
 * outcomes. Blue signs the same orders at the same game times while a seeded schedule pauses,
 * resumes and changes the rate at random wall times; the final state, events and order log must
 * match an uninterrupted run. Seeds and hand-written schedules in the checked-in corpus are
 * replayed every run.
 */
import {
  holdTheBridge,
  loadScenario,
  type EmittedEvent,
  type EngineState,
  type GameState,
} from '@kriegsspiel/engine';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser, ParseResult } from '../orders/index.js';
import { GameHost, MemoryGameStore, replayLog, type GameStore } from './index.js';
import { createRegistry, startingState } from './registry.js';
import { FakeTime } from './testing.js';
import type { GameActor } from './actor.js';

const MIN = 60_000;
const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const HORIZON_MS = 200 * MIN;
const RATES = [1, 4, 12, 1000];

const SCRIPT: { atMs: number; text: string }[] = [
  { atMs: 0, text: 'blue-1 march to the bridge' },
  { atMs: 0, text: 'blue-2 march to the bridge' },
  { atMs: 2 * MIN, text: 'blue-3 hold the bridge' },
  { atMs: 5 * MIN, text: 'blue-1 hold the bridge' },
];

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

/**
 * A hand-written perturbation: cycle through these segments while waiting for each order. Each
 * schedule needs at least one rate step, or `reach` never advances game time.
 */
type Step = { rate: number; wallMs: number } | { pause: number };
interface Corpus {
  seeds: number[];
  schedules: { name: string; steps: Step[] }[];
}
const corpus = JSON.parse(
  readFileSync(new URL('./clockInvariance.corpus.json', import.meta.url), 'utf8'),
) as Corpus;

/** Small seeded PRNG (mulberry32), so a failing seed reproduces exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Yields the next perturbation: a rate-change-and-run segment or a pause of some wall time. */
type Next = () => Step;

function randomSteps(seed: number): Next {
  const rnd = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  return () =>
    rnd() < 0.3
      ? { pause: int(1, 20_000) }
      : { rate: RATES[int(0, RATES.length - 1)]!, wallMs: int(1, 40_000) };
}

function cycle(steps: Step[]): Next {
  let i = 0;
  return () => steps[i++ % steps.length]!;
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

interface Run {
  state: EngineState<GameState>;
  events: EmittedEvent[];
  store: GameStore;
}

async function start(rate: number) {
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
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate });
  return { time, store, events, game };
}

async function finish(game: GameActor, events: EmittedEvent[], store: GameStore): Promise<Run> {
  const run = { state: game.state, events, store };
  await host!.shutdown();
  host = undefined;
  return run;
}

/** Plain run at one fixed rate, or in fast-forward, with no interruptions. */
async function playSteady(rate: number | 'fast-forward'): Promise<Run> {
  const fast = rate === 'fast-forward';
  const { time, store, events, game } = await start(fast ? 1 : rate);
  if (fast) await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  let at = 0;
  for (const step of SCRIPT) {
    if (game.state.world.outcome) break;
    if (fast) await game.submit({ kind: 'advanceTo', gameMs: step.atMs });
    else await time.advance((step.atMs - at) / (rate as number));
    at = step.atMs;
    if (game.state.world.outcome) break;
    await game.submit({ kind: 'order', side: 'blue', text: step.text });
  }
  if (fast) await game.submit({ kind: 'advanceTo', gameMs: HORIZON_MS });
  else await time.advance((HORIZON_MS - at) / (rate as number));
  return finish(game, events, store);
}

/**
 * Same orders at the same game times, but the wall time between them is spent under `next`'s
 * pauses and rate changes. Wall chunks are whole ms and rates whole numbers, so game time lands
 * exactly on each order's time. Some orders are signed while paused.
 */
async function playPerturbed(next: Next, signPaused: () => boolean): Promise<Run> {
  const { time, store, events, game } = await start(1);
  let gameMs = 0;
  const reach = async (target: number) => {
    while (gameMs < target && !game.state.world.outcome) {
      const step = next();
      if ('pause' in step) {
        await game.submit({ kind: 'pause' });
        await time.advance(step.pause);
        await game.submit({ kind: 'resume' });
        continue;
      }
      const w = Math.min(step.wallMs, Math.floor((target - gameMs) / step.rate));
      // Too close to the target for this rate: finish at rate 1.
      const rate = w > 0 ? step.rate : 1;
      const wall = w > 0 ? w : target - gameMs;
      await game.submit({ kind: 'setRate', rate });
      await time.advance(wall);
      gameMs += wall * rate;
    }
  };
  for (const step of SCRIPT) {
    await reach(step.atMs);
    if (game.state.world.outcome) break;
    const paused = signPaused();
    if (paused) await game.submit({ kind: 'pause' });
    if (paused) await time.advance(1_234);
    await game.submit({ kind: 'order', side: 'blue', text: step.text });
    if (paused) await game.submit({ kind: 'resume' });
  }
  await reach(HORIZON_MS);
  return finish(game, events, store);
}

/** Order ids embed the log seq, which extra clock commands shift; rename by first appearance. */
function canonical<T>(items: readonly T[]): unknown[] {
  const names = new Map<string, string>();
  const text = JSON.stringify(items).replace(/g1-o\d+/g, (id) => {
    if (!names.has(id)) names.set(id, `order#${names.size + 1}`);
    return names.get(id)!;
  });
  return JSON.parse(text) as unknown[];
}

async function orderLog(store: GameStore) {
  return (await store.inputLog('g1'))
    .filter((e) => e.command.kind === 'order')
    .map((e) => ({
      gameMs: e.gameMs,
      agent: e.agent ?? false,
      command: e.command,
      parse: e.parse,
    }));
}

async function expectSame(label: string, run: Run, base: Run) {
  expect(run.state.time, label).toBe(base.state.time);
  expect(canonical([run.state.world]), label).toEqual(canonical([base.state.world]));
  expect(canonical(run.events), label).toEqual(canonical(base.events));
  expect(canonical(await orderLog(run.store)), label).toEqual(
    canonical(await orderLog(base.store)),
  );
}

describe('clock invariance', () => {
  it('rates 1, 4, 12, 1000 and fast-forward all end the same', async () => {
    const base = await playSteady(1);
    expect(base.state.world.outcome).toBeTruthy();
    expect(base.events.length).toBeGreaterThan(0);
    for (const rate of [4, 12, 1000, 'fast-forward'] as const) {
      await expectSame(`rate ${rate} vs 1`, await playSteady(rate), base);
    }
  }, 120_000);

  it('random pauses, resumes and rate changes match an uninterrupted run (corpus seeds)', async () => {
    const base = await playSteady(1);
    for (const seed of corpus.seeds) {
      const rnd = prng(seed ^ 0x9e3779b9);
      const run = await playPerturbed(randomSteps(seed), () => rnd() < 0.4);
      await expectSame(`seed ${seed}`, run, base);
    }
  }, 300_000);

  it('hand-written corpus schedules match an uninterrupted run', async () => {
    const base = await playSteady(1);
    for (const schedule of corpus.schedules) {
      await expectSame(schedule.name, await playPerturbed(cycle(schedule.steps), () => true), base);
    }
  }, 120_000);

  it('a perturbed run replays from its log to the same state', async () => {
    const run = await playPerturbed(randomSteps(2024), () => true);
    const header = (await run.store.logHeader('g1'))!;
    const replayed = await replayLog(
      header,
      loadScenario(holdTheBridge),
      await run.store.inputLog('g1'),
      createRegistry(),
      run.state.time,
      startingState,
    );
    expect(replayed.state.world).toEqual(run.state.world);
    expect(replayed.emitted).toEqual(run.events);
  }, 60_000);
});

/**
 * Drive the same script to game over in one clock configuration, leaving the game open so the
 * caller can read its clock. In manual and fast-forward modes the orders are signed by
 * `advanceTo`, exactly as in `playSteady`'s fast-forward path.
 */
async function playToOutcome(rate: number, mode?: 'manual' | 'fast-forward') {
  const { time, game } = await start(rate);
  if (mode) await game.submit({ kind: 'setMode', mode });
  let at = 0;
  for (const step of SCRIPT) {
    if (game.state.world.outcome) break;
    if (mode) await game.submit({ kind: 'advanceTo', gameMs: step.atMs });
    else await time.advance((step.atMs - at) / rate);
    at = step.atMs;
    if (game.state.world.outcome) break;
    await game.submit({ kind: 'order', side: 'blue', text: step.text });
  }
  if (mode) await game.submit({ kind: 'advanceTo', gameMs: HORIZON_MS });
  else await time.advance((HORIZON_MS - at) / rate);
  return game;
}

describe('the stopped clock at game over', () => {
  // The actor freezes the clock at the outcome's own time (actor.ts passes outcome.time to
  // clock.stop). Reverting that call to a bare stop() must fail here: in manual and fast-forward
  // modes advanceTo has already moved the clock past the outcome time when the end is noticed,
  // so the stopped reading would sit at the advance target instead.
  it('reads exactly the outcome time at rates 1, 4 and 12, and in manual and fast-forward modes', async () => {
    const configs: { label: string; run: () => ReturnType<typeof playToOutcome> }[] = [
      { label: 'rate 1', run: () => playToOutcome(1) },
      { label: 'rate 4', run: () => playToOutcome(4) },
      { label: 'rate 12', run: () => playToOutcome(12) },
      { label: 'manual', run: () => playToOutcome(1, 'manual') },
      { label: 'fast-forward', run: () => playToOutcome(1, 'fast-forward') },
    ];
    for (const { label, run } of configs) {
      const game = await run();
      const outcome = game.state.world.outcome;
      expect(outcome, label).toBeTruthy();
      expect(game.gameClock.status, label).toBe('stopped');
      expect(game.gameClock.now(), label).toBe(outcome!.time);
      await host!.shutdown();
      host = undefined;
    }
  }, 120_000);
});
