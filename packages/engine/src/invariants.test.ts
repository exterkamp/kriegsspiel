import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PACES, deserialize, serialize, type Formation, type Pace } from './index.js';
import corpus from './invariants.corpus.json' with { type: 'json' };
import {
  HOUR,
  SCENARIOS,
  applyCmds,
  runChecked,
  runThrough,
  startState,
  type Cmd,
  type Metres,
  type ScenarioName,
} from './invariants.testkit.js';

/*
 * Property and invariant suite for the engine (docs/architecture.md, Testing strategy).
 * Counterexamples go in invariants.corpus.json as command lists and replay below.
 */

const NAMES = Object.keys(SCENARIOS) as ScenarioName[];
const scenarioArb = fc.constantFrom(...NAMES);

const sideOf = (name: ScenarioName, id: string) =>
  SCENARIOS[name].units.find((u) => u.id === id)!.side as 'blue' | 'red';

/** Random orders against a scenario, over `hours` of game time, including ones the engine must refuse. */
function cmdsArb(name: ScenarioName, hours: number, max = 24): fc.Arbitrary<Cmd[]> {
  const { width, height } = SCENARIOS[name].map;
  const ids = SCENARIOS[name].units.map((u) => u.id);
  const unit = fc.oneof(
    { weight: 12, arbitrary: fc.constantFrom(...ids) },
    { weight: 1, arbitrary: fc.constant('no-such-unit') },
  );
  // Mostly on the map, sometimes just outside it.
  const to: fc.Arbitrary<Metres> = fc.tuple(
    fc.integer({ min: -50, max: width + 50 }),
    fc.integer({ min: -50, max: height + 50 }),
  );
  const at = fc.integer({ min: 0, max: hours * HOUR });
  const cmd: fc.Arbitrary<Cmd> = fc.oneof(
    fc.record({
      kind: fc.constant('move' as const),
      at,
      unit,
      to,
      pace: fc.option(fc.constantFrom<Pace>(...PACES), { nil: undefined }),
    }),
    fc.record({ kind: fc.constant('halt' as const), at, unit }),
    fc.record({
      kind: fc.constant('formation' as const),
      at,
      unit,
      formation: fc.constantFrom<Formation>('line', 'column', 'square'),
    }),
    fc.record({
      kind: fc.constant('attack' as const),
      at,
      unit,
      target: fc.oneof(fc.constantFrom(...ids), fc.constant('ghost')),
    }),
    fc
      .record({
        kind: fc.constant('order' as const),
        at,
        unit: fc.constantFrom(...ids),
        intent: fc.constantFrom<'move' | 'hold' | 'withdraw'>('move', 'hold', 'withdraw'),
        to,
        courier: fc.option(fc.constantFrom<'fast' | 'safe'>('fast', 'safe'), { nil: undefined }),
        wrongSide: fc.boolean(),
      })
      .map(({ wrongSide, ...c }): Cmd => {
        const side = sideOf(name, c.unit);
        return { ...c, side: wrongSide ? (side === 'blue' ? 'red' : 'blue') : side };
      }),
  );
  return fc.array(cmd, { maxLength: max });
}

/** Strictly increasing stop times that end at `end`. */
const stopsArb = (end: number) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: end - 1 }), { maxLength: 12 })
    .map((xs) => [...xs.sort((a, b) => a - b), end]);

const scenarioRun = scenarioArb.chain((name) =>
  fc.record({ name: fc.constant(name), cmds: cmdsArb(name, 3), stops: stopsArb(3 * HOUR) }),
);

describe('engine properties', () => {
  it('advancing in chunks gives the same state and events as advancing once', () => {
    fc.assert(
      fc.property(scenarioRun, ({ name, cmds, stops }) => {
        const start = applyCmds(startState(name), cmds);
        const once = runThrough(start, [stops.at(-1)!]);
        const chunked = runThrough(start, stops);
        expect(serialize(chunked.state)).toBe(serialize(once.state));
        expect(chunked.emitted).toEqual(once.emitted);
      }),
      { numRuns: 100 },
    );
  });

  it('a state saved and restored at a random point carries on identically', () => {
    fc.assert(
      fc.property(
        scenarioRun,
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ name, cmds, stops }, frac) => {
          const end = stops.at(-1)!;
          const mid = Math.floor(end * frac);
          const start = applyCmds(startState(name), cmds);
          const straight = runThrough(start, [end]);
          const first = runThrough(start, [mid]);
          const text = serialize(first.state);
          expect(serialize(deserialize(text))).toBe(text);
          const resumed = runThrough(deserialize(text), [end]);
          expect(serialize(resumed.state)).toBe(serialize(straight.state));
          expect([...first.emitted, ...resumed.emitted]).toEqual(straight.emitted);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps every rule at every stop: no teleporting, no strength created, values in range', () => {
    fc.assert(
      fc.property(scenarioRun, ({ name, cmds, stops }) => {
        const fine = stops.flatMap((t, i) => {
          const from = i === 0 ? 0 : stops[i - 1]!;
          return [from + Math.floor((t - from) / 2), t];
        });
        const unique = [...new Set(fine)].filter((t) => t > 0);
        const r = runChecked(applyCmds(startState(name), cmds), unique);
        expect(r.found).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('the same inputs always give the same game', () => {
    fc.assert(
      fc.property(scenarioRun, ({ name, cmds, stops }) => {
        const end = stops.at(-1)!;
        const a = runThrough(applyCmds(startState(name), cmds), [end]);
        const b = runThrough(applyCmds(startState(name), cmds), [end]);
        expect(serialize(a.state)).toBe(serialize(b.state));
      }),
      { numRuns: 40 },
    );
  });
});

describe('order fuzz runner', () => {
  const HOURS = 6;
  it(`survives random orders over ${HOURS} game-hours on each scenario`, () => {
    for (const name of NAMES) {
      fc.assert(
        fc.property(cmdsArb(name, HOURS, 40), (cmds) => {
          const stops = Array.from({ length: HOURS * 4 }, (_, i) => ((i + 1) * HOUR) / 4);
          const r = runChecked(applyCmds(startState(name), cmds), stops);
          expect(r.found).toEqual([]);
        }),
        { numRuns: 40 },
      );
    }
  });
});

describe('saved counterexamples', () => {
  const entries = corpus.entries as Array<{
    name: string;
    scenario: ScenarioName;
    hours: number;
    stops?: number[];
    cmds: Cmd[];
    note: string;
  }>;
  it.each(entries)('$name', ({ scenario, hours, cmds, stops: saved }) => {
    const stops = saved ?? Array.from({ length: hours * 4 }, (_, i) => ((i + 1) * HOUR) / 4);
    const start = applyCmds(startState(scenario), cmds);
    expect(runChecked(start, stops).found).toEqual([]);
    expect(serialize(runThrough(start, stops).state)).toBe(
      serialize(runThrough(start, [stops.at(-1)!]).state),
    );
  });
});
