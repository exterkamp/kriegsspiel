import {
  AssetSchema,
  HARD_LIMITS,
  type Bounds,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Point,
  type Water,
} from '../contract.js';
import { fail, TopologyBudget } from '../errors.js';
import { polygonEdges, validatePolygon } from '../geometry.js';
import { preflightAsset } from '../resources.js';
import { createElevationQueries } from '../queries.js';
import { checkField } from '../terrain/input.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, bounded, GeographyFailure } from './budget.js';
import type { GeographyLimits, PhysicsEvidence } from './types.js';

export function validateWaterPhysics(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  limits: GeographyLimits = {},
): GenerationResult<PhysicsEvidence> {
  return bounded(() => {
    const s = checkField(elevation, bounds, settings);
    preflightAsset(
      { layers: { water } },
      { ...HARD_LIMITS, maxFeatures: s.limits.maxFeatures, maxVertices: s.limits.maxVertices },
    );
    const parsed = AssetSchema.shape.layers.shape.water.safeParse(water);
    if (!parsed.success) fail('$.water', parsed.error.message);
    const budget = new Budget(
      limits.maxPhysicsWork ?? Math.min(100_000_000, s.limits.maxTopologyChecks * 8),
      'whole-water physics work',
    );
    budget.take(elevation.samples.length); // Reserve the Float64 query snapshot before allocation.
    const q = createElevationQueries({ elevation, bounds });
    let maxGroundExcessM = -Infinity;
    for (const [wi, w] of water.entries()) {
      const level = w.kind === 'lake' ? w.surfaceElevationM : w.surfaceProfileM[0]!;
      if (decimal6(level) !== level)
        fail(`$.water[${wi}]`, 'Water surface must be decimal6 stable', 'UNSUPPORTED_PRECISION');
      if (
        w.kind === 'river' &&
        (w.surfacePolicy !== 'standing-water-v1' ||
          w.surfaceProfileM.length !== w.centreline.length ||
          w.surfaceProfileM.some((h) => h !== level))
      )
        throw new GeographyFailure(
          'UNSUPPORTED_WATER_SURFACE',
          'constant standing surface',
          'This stage certifies constant standing/backwater profiles only.',
        );
      for (const [pi, p] of w.polygons.entries()) {
        const vertices = [p.outer, ...p.holes].flat();
        budget.take(vertices.length * vertices.length + vertices.length);
        validatePolygon(p, `$.water[${wi}].polygons[${pi}]`, new TopologyBudget(budget.max));
        for (const v of vertices)
          if (v[0] < 0 || v[1] < 0 || v[0] > bounds.maxX || v[1] > bounds.maxY)
            fail(`$.water[${wi}].polygons[${pi}]`, 'Water outside bounds');
        const edges = polygonEdges(p),
          d = elevation.spacingM;
        const test = (h: number) => {
          maxGroundExcessM = Math.max(maxGroundExcessM, h - level);
          if (h - level > 1e-7)
            throw new GeographyFailure(
              'WATER_ABOVE_GROUND_FAILURE',
              'whole water area',
              `Ground exceeds ${w.id} standing surface by ${h - level} m.`,
            );
        };
        // Bilinear patches have no strict interior maximum. A maximum on the
        // polygon/cell intersection lies on a polygon edge or grid seam; seams
        // are linear between boundary intersections and interior grid nodes.
        for (const [a, b] of edges) {
          const dx = b[0] - a[0],
            dy = b[1] - a[1];
          const count = Math.ceil(Math.abs(dx) / d) + Math.ceil(Math.abs(dy) / d) + 4;
          budget.take(count * 8);
          const cuts = [0, 1];
          for (const [lo, hi, origin, delta] of [
            [Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[0], dx],
            [Math.min(a[1], b[1]), Math.max(a[1], b[1]), a[1], dy],
          ]) {
            if (delta === 0) continue;
            for (let k = Math.floor(lo! / d) + 1; k * d < hi!; k++) {
              const t = (k * d - origin!) / delta!;
              if (t > 0 && t < 1) cuts.push(t);
            }
          }
          const sorted = [...new Set(cuts)].sort((a, b) => a - b);
          for (let j = 1; j < sorted.length; j++) {
            const t0 = sorted[j - 1]!,
              t1 = sorted[j]!,
              u: Point = [a[0] + t0 * dx, a[1] + t0 * dy],
              v: Point = [a[0] + t1 * dx, a[1] + t1 * dy],
              mid: Point = [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
            const h0 = q.heightAt(...u),
              h1 = q.heightAt(...v),
              hm = q.heightAt(...mid);
            test(h0);
            test(h1);
            const quadratic = 2 * (h0 + h1 - 2 * hm),
              linear = h1 - h0 - quadratic;
            if (quadratic < 0) {
              const t = -linear / (2 * quadratic);
              if (t > 0 && t < 1) test(h0 + linear * t + quadratic * t * t);
            }
          }
        }
        // Even/odd scanlines include holes and avoid a per-node whole-ring scan.
        const minY = Math.min(...p.outer.map((v) => v[1])),
          maxY = Math.max(...p.outer.map((v) => v[1]));
        for (let row = Math.ceil(minY / d); row * d <= maxY; row++) {
          budget.take(edges.length * 2);
          const y = row * d,
            cuts: number[] = [];
          for (const [a, b] of edges)
            if (a[1] > y !== b[1] > y)
              cuts.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
          budget.take(cuts.length * Math.ceil(Math.log2(cuts.length + 1)));
          cuts.sort((a, b) => a - b);
          for (let j = 1; j < cuts.length; j += 2) {
            const left = Math.max(0, Math.ceil(cuts[j - 1]! / d)),
              right = Math.min(elevation.columns - 1, Math.floor(cuts[j]! / d));
            budget.take(Math.max(0, right - left + 1));
            for (let col = left; col <= right; col++)
              test(elevation.samples[row * elevation.columns + col]!);
          }
        }
      }
    }
    return {
      ok: true,
      value: {
        maxGroundExcessM: water.length ? Math.max(0, maxGroundExcessM) : 0,
        work: budget.used,
      },
      diagnostics: [],
    };
  });
}
