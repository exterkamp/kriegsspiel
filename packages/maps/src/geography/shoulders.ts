import type { Elevation, MapSettings } from '../contract.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, GeographyFailure } from './budget.js';
export const SHOULDER_POLICY = 'manhattan-lipschitz-cut-v1' as const;
export interface ShoulderPolicy {
  axisGradeCap: number;
  guaranteedBandSteps: number;
  stageOffsetM: number;
}
export interface ShoulderEvidence {
  policy: typeof SHOULDER_POLICY;
  axisGradeCap: number;
  fullGradientCap: number;
  guaranteedManhattanBandM: number;
  changedDrySamples: number;
  work: number;
}
export function shoulderPolicy(s: MapSettings): ShoulderPolicy {
  const d = s.sampleSpacingM;
  // Half the requested norm bound leaves margin for independent interpolation
  // and decimal-six node rounding. Node differences change by at most 1um.
  const axisGradeCap = s.roads.maxGrade / (2 * Math.SQRT2) - 2e-6 / d;
  if (axisGradeCap <= 0)
    throw new GeographyFailure(
      'SHOULDER_PRECISION',
      'bank grading',
      'Road grade is too small for decimal6 grading at the requested spacing.',
    );
  const guaranteedBandSteps = Math.ceil(
    (3 * d + s.roads.maxReservedWidthM + s.roads.minimumAbutmentM) / d,
  );
  return {
    axisGradeCap,
    guaranteedBandSteps,
    stageOffsetM: 1 + guaranteedBandSteps * d * axisGradeCap,
  };
}
/** Exact cardinal graph distance; cap-only cutting, never raising ground. */
export function gradeShoulders(
  samples: number[],
  wetNodes: Uint8Array,
  elevation: Elevation,
  level: number,
  policy: ShoulderPolicy,
  budget: Budget,
): ShoulderEvidence {
  const n = samples.length,
    c = elevation.columns,
    rows = elevation.rows,
    d = elevation.spacingM,
    startWork = budget.used;
  budget.take(9 * n); // 2 buffers, seed/height scans, N queue pops, <=4N neighbour visits.
  const distances = new Int32Array(n).fill(-1),
    queue = new Int32Array(n);
  let head = 0,
    tail = 0;
  for (let i = 0; i < n; i++)
    if (wetNodes[i]) {
      distances[i] = 0;
      queue[tail++] = i;
    }
  if (!tail) throw new Error('Shoulder grading requires channel anchors');
  while (head < tail) {
    const i = queue[head++]!,
      x = i % c,
      y = Math.floor(i / c);
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < c - 1 ? i + 1 : -1,
      y > 0 ? i - c : -1,
      y < rows - 1 ? i + c : -1,
    ])
      if (j >= 0 && distances[j] === -1) {
        distances[j] = distances[i]! + 1;
        queue[tail++] = j;
      }
  }
  let changedDrySamples = 0;
  for (let i = 0; i < n; i++)
    if (!wetNodes[i]) {
      const cap = decimal6(level + policy.axisGradeCap * d * distances[i]!);
      if (cap < samples[i]!) {
        samples[i] = cap;
        changedDrySamples++;
      }
    }
  return {
    policy: SHOULDER_POLICY,
    axisGradeCap: decimal6(policy.axisGradeCap),
    fullGradientCap: decimal6(Math.SQRT2 * (policy.axisGradeCap + 1e-6 / d)),
    guaranteedManhattanBandM: policy.guaranteedBandSteps * d,
    changedDrySamples,
    work: budget.used - startWork,
  };
}
