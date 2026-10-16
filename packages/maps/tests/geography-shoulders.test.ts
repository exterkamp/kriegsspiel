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
import { ABUTMENT_CLEARANCE_M } from '../src/geography/crossings.js';
import { certifyRoadSegment } from '../src/planning/index.js';
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
  it('gives the exact chamfer cap and bounds the full bilinear gradient on graded dry cells', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.widthM = s.heightM = 200;
    const policy = shoulderPolicy(s),
      e: Elevation = { columns: 9, rows: 9, spacingM: 25, samples: Array(81).fill(100) },
      anchors = new Float64Array(81).fill(NaN);
    anchors[40] = 0;
    const samples = e.samples.slice();
    samples[40] = 0;
    // An unbounded band keeps every step gentle: axis steps cost cap·d, diagonals √2·cap·d.
    const evidence = gradeShoulders(samples, anchors, e, policy, new Budget(10_000, 'test'), 99);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        const dx = Math.abs(x - 4),
          dy = Math.abs(y - 4),
          diagonal = Math.min(dx, dy),
          axis = dx + dy - 2 * diagonal;
        expect(samples[y * 9 + x]).toBe(
          x === 4 && y === 4
            ? 0
            : Number((0 + policy.axisGradeCap * 25 * (axis + Math.SQRT2 * diagonal)).toFixed(6)),
        );
      }
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
    expect(evidence.work).toBe(56 * 81);
    expect(samples.every((h, i) => h <= e.samples[i]!)).toBe(true);
  });
  it('stops gentle grading at the band and fades to the steep outer cap', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    const policy = shoulderPolicy(s),
      e: Elevation = { columns: 13, rows: 1, spacingM: 25, samples: Array(13).fill(100) },
      anchors = new Float64Array(13).fill(NaN);
    anchors[0] = 0;
    const samples = e.samples.slice();
    samples[0] = 0;
    gradeShoulders(samples, anchors, e, policy, new Budget(10_000, 'test'), 2);
    const gentle = policy.axisGradeCap * 25,
      steep = policy.steepGrade * 25;
    expect(samples.slice(1, 3)).toEqual([1, 2].map((k) => Number((gentle * k).toFixed(6))));
    // Beyond two band steps the cap rises at the steep grade until it clears the ground.
    expect(samples[3]).toBe(Number((gentle * 2 + steep).toFixed(6)));
    expect(samples.slice(10)).toEqual([100, 100, 100]);
  });
  it('reserves exact W before buffers, succeeds W and rejects W−1 without a partial cut', () => {
    const s = structuredClone(DEFAULT_SETTINGS),
      e: Elevation = { columns: 3, rows: 3, spacingM: 25, samples: Array(9).fill(100) },
      anchors = new Float64Array(9).fill(NaN);
    anchors[4] = 0;
    const run = (work: number) =>
      bounded(() => ({
        ok: true,
        value: gradeShoulders(
          e.samples.slice(),
          anchors,
          e,
          shoulderPolicy(s),
          new Budget(work, 'shoulders'),
        ),
        diagnostics: [],
      }));
    expect(run(56 * 9)).toMatchObject({ ok: true });
    expect(run(56 * 9 - 1)).toMatchObject({
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
  it('places every river97 abutment above the water with road-grade approaches that planning certifies', () => {
    const s = geographyPreset('river-valley'),
      bounds = { minX: 0 as const, minY: 0 as const, maxX: 5000, maxY: 5000 },
      source = value(generateElevation(s, 97)),
      r = value(generateGeography(source, bounds, s, 97)),
      q = createElevationQueries({ elevation: r.elevation, bounds });
    expect(r.evidence.shoulder).toMatchObject({
      policy: 'banded-lipschitz-cut-v2',
      fullGradientCap: 0.05,
      guaranteedManhattanBandM: 100,
    });
    expect(r.crossingCandidates.length).toBeGreaterThan(0);
    let certified = 0;
    for (const c of r.crossingCandidates) {
      const [a, b] = c.endpoints,
        w = r.water.find((x) => x.id === c.waterId)!,
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        ux = (b[0] - a[0]) / length,
        uy = (b[1] - a[1]) / length,
        before: Point = [a[0] - 25 * ux, a[1] - 25 * uy],
        after: Point = [b[0] + 25 * ux, b[1] + 25 * uy];
      if (w.kind !== 'river') throw Error('crossing over non-river');
      // Abutments stand clear of the surface, so a linear deck clears the water.
      for (const p of [a, b])
        expect(q.heightAt(...p)).toBeGreaterThan(w.surfaceProfileM[0]! + ABUTMENT_CLEARANCE_M);
      // Centreline approaches are searched below the road grade, never relaxed.
      expect(maxGrade(q, a, before, 25)).toBeLessThanOrEqual(s.roads.maxGrade);
      expect(maxGrade(q, b, after, 25)).toBeLessThanOrEqual(s.roads.maxGrade);
      // The complete reserved approach corridors are still certified by planning.
      const input = { settings: s, seed: 97, bounds, elevation: r.elevation, water: r.water },
        near = certifyRoadSegment(input, before, a, c.widthM),
        far = certifyRoadSegment(input, b, after, c.widthM);
      if (near.ok && far.ok && near.value.traversable && far.value.traversable) certified++;
    }
    expect(certified / r.crossingCandidates.length).toBeGreaterThan(0.5);
    expect(value(validateWaterPhysics(r.elevation, bounds, r.water, s)).maxGroundExcessM).toBe(0);
    expect(r.sourceElevation).toEqual(source);
    expect(r.elevation.samples.every((h, i) => h <= source.samples[i]!)).toBe(true);
  }, 20000);
});
