import {
  HARD_LIMITS,
  type Bounds,
  type Contour,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Point,
} from '../contract.js';
import { fail } from '../errors.js';
import { createElevationQueries } from '../queries.js';
import { preflightAsset } from '../resources.js';
import { bounded, TerrainLimit, WorkBudget } from './budgets.js';
import { checkField } from './input.js';

export interface ContourHeightEvidence {
  maxErrorM: number;
  segmentCount: number;
  partitionCount: number;
}
/** Independent of the extractor's cell-polynomial/refinement implementation:
 * reconstruct each chord's quadratic using existing public query evaluations.
 */
export function validateContourHeights(
  elevation: Elevation,
  bounds: Bounds,
  contours: Contour[],
  settings: MapSettings,
): GenerationResult<ContourHeightEvidence> {
  return bounded('contours', () => {
    const s = checkField(elevation, bounds, settings),
      vertexCap = Math.min(s.contours.maxVertices, s.limits.maxVertices);
    if (!Array.isArray(contours) || contours.length > s.limits.maxFeatures)
      fail('$.contours', 'Contour feature cap exceeded', 'RESOURCE_LIMIT');
    preflightAsset(contours, { ...HARD_LIMITS, maxVertices: vertexCap });
    let vertices = 0,
      segmentCount = 0;
    for (const [i, contour] of contours.entries()) {
      if (
        !Number.isFinite(contour.elevationM) ||
        !Array.isArray(contour.path) ||
        contour.path.length < 2
      )
        fail(`$.contours[${i}]`, 'Expected finite level and path with at least two points');
      vertices += contour.path.length;
      if (vertices > vertexCap) fail('$.contours', 'Contour vertex cap exceeded', 'RESOURCE_LIMIT');
      segmentCount += contour.path.length - 1;
      for (const [j, p] of contour.path.entries())
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every(Number.isFinite) ||
          p[0] < 0 ||
          p[1] < 0 ||
          p[0] > bounds.maxX ||
          p[1] > bounds.maxY
        )
          fail(`$.contours[${i}].path[${j}]`, 'Contour point must be finite and inside bounds');
    }
    const work = new WorkBudget(
      s.limits.maxTopologyChecks,
      'contours',
      'height certification work',
    );
    work.take(elevation.samples.length + vertices); // before query sample allocation
    const queries = createElevationQueries({ elevation, bounds });
    let maxErrorM = 0,
      partitionCount = 0;
    const pointAt = (a: Point, b: Point, t: number): Point => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    for (const contour of contours)
      for (let i = 1; i < contour.path.length; i++) {
        const a = contour.path[i - 1]!,
          b = contour.path[i]!;
        if (a[0] === b[0] && a[1] === b[1])
          fail(`$.contours.${contour.id}.path[${i}]`, 'Zero-length contour segment');
        const cuts = [0, 1];
        for (const axis of [0, 1] as const) {
          if (a[axis] === b[axis]) continue;
          const from = Math.floor(Math.min(a[axis], b[axis]) / elevation.spacingM) + 1,
            to = Math.ceil(Math.max(a[axis], b[axis]) / elevation.spacingM) - 1;
          work.take(Math.max(0, to - from + 1));
          for (let k = from; k <= to; k++)
            cuts.push((k * elevation.spacingM - a[axis]) / (b[axis] - a[axis]));
        }
        work.take(cuts.length * Math.ceil(Math.log2(cuts.length + 1)));
        const sorted = [...new Set(cuts)].sort((x, y) => x - y);
        for (let j = 1; j < sorted.length; j++) {
          work.take();
          partitionCount++;
          const t0 = sorted[j - 1]!,
            t1 = sorted[j]!,
            midpoint = (t0 + t1) / 2;
          const h0 = queries.heightAt(...pointAt(a, b, t0)) - contour.elevationM,
            h1 = queries.heightAt(...pointAt(a, b, t1)) - contour.elevationM,
            hm = queries.heightAt(...pointAt(a, b, midpoint)) - contour.elevationM;
          const quadratic = 2 * (h1 + h0 - 2 * hm),
            linear = h1 - h0 - quadratic;
          const stationary = quadratic ? -linear / (2 * quadratic) : -1;
          const error = Math.max(
            Math.abs(h0),
            Math.abs(h1),
            stationary > 0 && stationary < 1
              ? Math.abs(h0 + linear * stationary + quadratic * stationary * stationary)
              : 0,
          );
          maxErrorM = Math.max(maxErrorM, error);
          if (error > s.contours.verticalToleranceM)
            return {
              ok: false,
              kind: 'infeasible',
              diagnostics: [
                {
                  severity: 'error',
                  stage: 'contours',
                  code: 'CONTOUR_HEIGHT_ERROR',
                  featureId: contour.id,
                  constraint: 'bilinear vertical tolerance',
                  message: `Complete segment interior error ${error} m exceeds ${s.contours.verticalToleranceM} m.`,
                  remediation:
                    'Refine/re-extract contours against this elevation field before exporting.',
                },
              ],
            };
        }
      }
    if (!Number.isFinite(maxErrorM))
      throw new TerrainLimit(
        'contours',
        'height precision',
        'Contour error could not be certified as finite.',
      );
    return { ok: true, value: { maxErrorM, segmentCount, partitionCount }, diagnostics: [] };
  });
}
