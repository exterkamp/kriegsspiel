import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Elevation, type GenerationResult } from '../src/contract.js';
import { accumulateFlow, deriveDrainage, streamSamples } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function fixture(columns: number, rows: number, samples: number[]) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = (columns - 1) * 25;
  settings.heightM = (rows - 1) * 25;
  return {
    elevation: { columns, rows, spacingM: 25, samples } as Elevation,
    settings,
    bounds: { minX: 0 as const, minY: 0 as const, maxX: settings.widthM, maxY: settings.heightM },
  };
}
describe('bounded priority flood and drainage', () => {
  it('fills a bowl to its actual ring spill without replacing original ground', () => {
    const a = fixture(
      5,
      5,
      [10, 10, 10, 10, 10, 10, 8, 8, 8, 10, 10, 8, 0, 8, 5, 10, 8, 8, 8, 10, 10, 10, 10, 10, 10],
    );
    const original = a.elevation.samples.slice(),
      r = value(deriveDrainage(a.elevation, a.bounds, a.settings));
    expect(r.drainage.filledSamples[12]).toBe(8);
    expect(a.elevation.samples[12]).toBe(0);
    expect(a.elevation.samples).toEqual(original);
    expect(r.evidence.enqueued).toBe(25);
    expect(r.evidence.popped).toBe(25);
    expect(r.evidence.neighbourChecks).toBe(8 * 25);
    for (let i = 0; i < 25; i++) {
      let j = i,
        steps = 0;
      while (r.drainage.downstream[j]! >= 0) {
        const next = r.drainage.downstream[j]!;
        expect(r.ranks[next]).toBeLessThan(r.ranks[j]!);
        j = next;
        if (++steps > 24) throw Error('cycle');
      }
    }
  });
  it('resolves flat ground/equal spillways by stable ranks without adding epsilon', () => {
    const a = fixture(9, 7, Array(63).fill(100)),
      r = value(deriveDrainage(a.elevation, a.bounds, a.settings));
    expect(new Set(r.drainage.filledSamples)).toEqual(new Set([100]));
    expect(value(deriveDrainage(a.elevation, a.bounds, a.settings))).toEqual(r);
    for (let i = 0; i < 63; i++)
      if (r.drainage.downstream[i]! >= 0)
        expect(r.ranks[r.drainage.downstream[i]!]).toBeLessThan(r.ranks[i]!);
  });
  it('chooses metric D8 steepest descent: S rather than the lower SE neighbour', () => {
    const a = fixture(3, 3, [20, 20, 20, 20, 10, 20, 20, 8, 7.5]),
      r = value(deriveDrainage(a.elevation, a.bounds, a.settings));
    expect(r.drainage.downstream[4]).toBe(7);
  });
  it('accumulates the independent Y oracle, includes exact thresholds and rejects cycles', () => {
    const r = accumulateFlow([4, 4, 5, 4, 7, 7, 7, 8, -1]);
    expect(r).toEqual([1, 1, 1, 1, 4, 2, 1, 8, 9]);
    expect(streamSamples(r, 3)).toEqual([4, 7, 8]);
    expect(streamSamples(r, 4)).toEqual([4, 7, 8]);
    expect(streamSamples(r, 5)).toEqual([7, 8]);
    expect(() => accumulateFlow([1, 0])).toThrow(/cycle/);
    expect(() => accumulateFlow([2, -1])).toThrow(/Invalid receiver/);
  });
  it('succeeds at exact total work W and fails W−1 without a partial graph', () => {
    const a = fixture(
        5,
        5,
        Array.from({ length: 25 }, (_, i) => i % 7),
      ),
      r = value(deriveDrainage(a.elevation, a.bounds, a.settings));
    expect(
      value(deriveDrainage(a.elevation, a.bounds, a.settings, { maxFloodWork: r.evidence.work })),
    ).toEqual(r);
    expect(
      deriveDrainage(a.elevation, a.bounds, a.settings, { maxFloodWork: r.evidence.work - 1 }),
    ).toMatchObject({
      ok: false,
      kind: 'infeasible',
      diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }],
    });
    expect(deriveDrainage(a.elevation, a.bounds, a.settings, { maxFloodWork: 1 })).toMatchObject({
      ok: false,
    });
  });
  it('rejects nonfinite/unnormalized ground, malformed options and receivers as input errors', () => {
    const a = fixture(3, 3, Array(9).fill(0));
    a.elevation.samples[4] = NaN;
    expect(() => deriveDrainage(a.elevation, a.bounds, a.settings)).toThrow(/finite/);
    a.elevation.samples[4] = 0.00000049;
    expect(() => deriveDrainage(a.elevation, a.bounds, a.settings)).toThrow(/decimal-6/);
    a.elevation.samples[4] = 0;
    expect(() => deriveDrainage(a.elevation, a.bounds, a.settings, { maxFloodWork: NaN })).toThrow(
      RangeError,
    );
    expect(() => streamSamples([NaN], 1)).toThrow(/finite/);
  });
});
