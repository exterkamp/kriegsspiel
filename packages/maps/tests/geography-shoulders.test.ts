import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Elevation,
  type GenerationResult,
  type Point,
} from '../src/contract.js';
import { createElevationQueries } from '../src/queries.js';
import { generateElevation } from '../src/terrain/index.js';
import {
  generateGeography,
  geographyPreset,
  validateWaterPhysics,
} from '../src/geography/index.js';
import { gradeShoulders, shoulderPolicy } from '../src/geography/shoulders.js';
import { Budget, bounded } from '../src/geography/budget.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
/** Independent complete-interior derivative oracle: split seams, fit each quadratic. */
function maxGrade(
  q: ReturnType<typeof createElevationQueries>,
  a: Point,
  b: Point,
  spacing: number,
): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy),
    cuts = [0, 1];
  for (const [origin, delta] of [
    [a[0], dx],
    [a[1], dy],
  ])
    if (delta)
      for (
        let k = Math.floor(Math.min(origin!, origin! + delta!) / spacing) + 1;
        k * spacing < Math.max(origin!, origin! + delta!);
        k++
      ) {
        const t = (k * spacing - origin!) / delta!;
        if (t > 0 && t < 1) cuts.push(t);
      }
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  let grade = 0;
  for (let j = 1; j < sorted.length; j++) {
    const lo = sorted[j - 1]!,
      hi = sorted[j]!,
      h = (t: number) => q.heightAt(a[0] + dx * t, a[1] + dy * t),
      h0 = h(lo),
      h1 = h(hi),
      hm = h((lo + hi) / 2),
      A = 2 * (h0 + h1 - 2 * hm),
      B = h1 - h0 - A,
      L = length * (hi - lo);
    grade = Math.max(grade, Math.abs(B) / L, Math.abs(2 * A + B) / L);
  }
  return grade;
}
describe('versioned bounded bank and shoulder cuts', () => {
  it('gives the exact Manhattan cap and bounds the full bilinear gradient on graded dry cells', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.widthM = s.heightM = 200;
    const policy = shoulderPolicy(s),
      e: Elevation = { columns: 9, rows: 9, spacingM: 25, samples: Array(81).fill(100) },
      wet = new Uint8Array(81);
    wet[40] = 1;
    const samples = e.samples.slice();
    samples[40] = 0;
    const evidence = gradeShoulders(samples, wet, e, 0, policy, new Budget(1000, 'test'));
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++)
        expect(samples[y * 9 + x]).toBe(
          Number((policy.axisGradeCap * 25 * (Math.abs(x - 4) + Math.abs(y - 4))).toFixed(6)),
        );
    const q = createElevationQueries({
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
      elevation: { ...e, samples },
    });
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        for (const [u, v] of [
          [0, 0],
          [0.999999, 0.999999],
          [0, 0.999999],
          [0.999999, 0],
        ])
          expect(q.slopeAt((x + u!) * 25, (y + v!) * 25)).toBeLessThanOrEqual(
            s.roads.maxGrade / 2 + 1e-7,
          );
    expect(evidence.work).toBe(9 * 81);
    expect(samples.every((h, i) => h <= e.samples[i]!)).toBe(true);
  });
  it('reserves exact W before buffers, succeeds W and rejects W−1 without a partial cut', () => {
    const s = structuredClone(DEFAULT_SETTINGS),
      e: Elevation = { columns: 3, rows: 3, spacingM: 25, samples: Array(9).fill(100) },
      wet = new Uint8Array(9);
    wet[4] = 1;
    const run = (work: number) =>
      bounded(() => ({
        ok: true,
        value: gradeShoulders(
          e.samples.slice(),
          wet,
          e,
          0,
          shoulderPolicy(s),
          new Budget(work, 'shoulders'),
        ),
        diagnostics: [],
      }));
    expect(run(81)).toMatchObject({ ok: true });
    expect(run(80)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }],
    });
    expect(e.samples).toEqual(Array(9).fill(100));
  });
  it('returns explicit precision infeasibility when the requested grade cannot survive decimal6', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.roads.maxGrade = 1e-10;
    expect(bounded(() => ({ ok: true, value: shoulderPolicy(s), diagnostics: [] }))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SHOULDER_PRECISION' }],
    });
  });
  it('certifies both complete outward25m connectors for every river97 candidate without relaxing maxGrade', () => {
    const s = geographyPreset('river-valley'),
      bounds = { minX: 0 as const, minY: 0 as const, maxX: 5000, maxY: 5000 },
      source = value(generateElevation(s, 97)),
      r = value(generateGeography(source, bounds, s, 97)),
      q = createElevationQueries({ elevation: r.elevation, bounds });
    expect(r.evidence.shoulder).toMatchObject({
      policy: 'manhattan-lipschitz-cut-v1',
      fullGradientCap: 0.05,
      guaranteedManhattanBandM: 100,
    });
    expect(r.crossingCandidates).toHaveLength(123);
    for (const c of r.crossingCandidates) {
      const [a, b] = c.endpoints,
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        ux = (b[0] - a[0]) / length,
        uy = (b[1] - a[1]) / length,
        before: Point = [a[0] - 25 * ux, a[1] - 25 * uy],
        after: Point = [b[0] + 25 * ux, b[1] + 25 * uy];
      expect(maxGrade(q, a, before, 25)).toBeLessThanOrEqual(s.roads.maxGrade);
      expect(maxGrade(q, b, after, 25)).toBeLessThanOrEqual(s.roads.maxGrade);
    }
    // A conservative bbox covers each whole reserved connector capsule. Check
    // all four derivative corners of every covered bilinear cell independently.
    for (const c of r.crossingCandidates) {
      const [a, b] = c.endpoints,
        L = Math.hypot(b[0] - a[0], b[1] - a[1]),
        ux = (b[0] - a[0]) / L,
        uy = (b[1] - a[1]) / L;
      for (const [start, end] of [
        [a, [a[0] - 25 * ux, a[1] - 25 * uy]],
        [b, [b[0] + 25 * ux, b[1] + 25 * uy]],
      ] as [Point, Point][]) {
        const radius = c.widthM / 2,
          left = Math.max(0, Math.floor((Math.min(start[0], end[0]) - radius) / 25)),
          right = Math.min(199, Math.floor((Math.max(start[0], end[0]) + radius) / 25)),
          top = Math.max(0, Math.floor((Math.min(start[1], end[1]) - radius) / 25)),
          bottom = Math.min(199, Math.floor((Math.max(start[1], end[1]) + radius) / 25));
        for (let y = top; y <= bottom; y++)
          for (let x = left; x <= right; x++) {
            const i = y * 201 + x,
              h = r.elevation.samples,
              A = h[i]!,
              B = h[i + 1]!,
              C = h[i + 201]!,
              D = h[i + 202]!;
            for (const [dx, dy] of [
              [B - A, C - A],
              [B - A, D - B],
              [D - C, C - A],
              [D - C, D - B],
            ])
              expect(Math.hypot(dx!, dy!) / 25).toBeLessThanOrEqual(s.roads.maxGrade);
          }
      }
    }
    expect(value(validateWaterPhysics(r.elevation, bounds, r.water, s)).maxGroundExcessM).toBe(0);
    expect(r.sourceElevation).toEqual(source);
    expect(r.elevation.samples.every((h, i) => h <= source.samples[i]!)).toBe(true);
  }, 20000);
});
