import {
  AssetSchema,
  HARD_LIMITS,
  type Bounds,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Water,
} from '../contract.js';
import { fail, TopologyBudget } from '../errors.js';
import {
  pointSegmentDistance,
  polygonEdges,
  polygonLocation,
  validatePolygon,
} from '../geometry.js';
import { createElevationQueries } from '../queries.js';
import { preflightAsset } from '../resources.js';
import { checkField } from '../terrain/input.js';
import { Budget, bounded } from './budget.js';
import type { GeographyLimits } from './types.js';
export interface GeographyQueries {
  heightAt(x: number, y: number): number;
  gradientAt(x: number, y: number): { dx: number; dy: number };
  slopeAt(x: number, y: number): number;
  waterAt(x: number, y: number): GenerationResult<string[]>;
  /** Closed disk dry and within bounds; zero radius is a point, never a footprint certificate. */
  isDry(x: number, y: number, radiusM?: number): GenerationResult<boolean>;
}
class Meter extends TopologyBudget {
  constructor(private readonly budget: Budget) {
    super(Number.MAX_SAFE_INTEGER);
  }
  override consume(_path: string, count = 1) {
    this.budget.take(count);
  }
}
export function createGeographyQueries(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  limits: GeographyLimits = {},
): GenerationResult<GeographyQueries> {
  return bounded(() => {
    const s = checkField(elevation, bounds, settings);
    preflightAsset(
      { layers: { water } },
      { ...HARD_LIMITS, maxFeatures: s.limits.maxFeatures, maxVertices: s.limits.maxVertices },
    );
    const max = limits.maxPhysicsWork ?? Math.min(100_000_000, s.limits.maxTopologyChecks * 8),
      work = new Budget(max, 'geography query work');
    work.take(elevation.samples.length);
    for (const w of water)
      for (const p of w.polygons)
        work.take(p.outer.length + p.holes.reduce((n, r) => n + r.length, 0));
    const parsed = AssetSchema.shape.layers.shape.water.safeParse(water);
    if (!parsed.success) fail('$.water', parsed.error.message);
    const snapshot = parsed.data,
      topology = new Meter(work);
    for (const w of snapshot)
      for (const p of w.polygons) {
        validatePolygon(p, '$.water', topology);
        for (const ring of [p.outer, ...p.holes])
          for (const v of ring)
            if (v[0] < 0 || v[1] < 0 || v[0] > bounds.maxX || v[1] > bounds.maxY)
              fail('$.water', 'Water exceeds bounds');
      }
    const maxX = bounds.maxX,
      maxY = bounds.maxY;
    const q = createElevationQueries({ elevation, bounds });
    const point = (x: number, y: number) => {
      q.heightAt(x, y);
      return [x, y] as [number, number];
    };
    return {
      ok: true,
      value: {
        heightAt: q.heightAt,
        gradientAt: q.gradientAt,
        slopeAt: q.slopeAt,
        waterAt: (x, y) =>
          bounded(() => {
            const p = point(x, y),
              budget = new Budget(max, 'water lookup work'),
              meter = new Meter(budget),
              ids: string[] = [];
            for (const w of snapshot)
              if (w.polygons.some((poly) => polygonLocation(p, poly, meter) !== 'outside'))
                ids.push(w.id);
            budget.take(ids.length * Math.ceil(Math.log2(ids.length + 1)));
            ids.sort();
            return { ok: true, value: ids, diagnostics: [] };
          }),
        isDry: (x, y, radiusM = 0) =>
          bounded(() => {
            const p = point(x, y);
            if (!Number.isFinite(radiusM) || radiusM < 0)
              throw new RangeError('Dry radius must be finite and nonnegative');
            if (x - radiusM < 0 || y - radiusM < 0 || x + radiusM > maxX || y + radiusM > maxY)
              return { ok: true, value: false, diagnostics: [] };
            const budget = new Budget(max, 'dry disk lookup work'),
              meter = new Meter(budget);
            for (const w of snapshot)
              for (const poly of w.polygons) {
                if (polygonLocation(p, poly, meter) !== 'outside')
                  return { ok: true, value: false, diagnostics: [] };
                for (const [a, b] of polygonEdges(poly)) {
                  budget.take();
                  if (pointSegmentDistance(p, a, b) <= radiusM + 1e-9)
                    return { ok: true, value: false, diagnostics: [] };
                }
              }
            return { ok: true, value: true, diagnostics: [] };
          }),
      },
      diagnostics: [],
    };
  });
}
