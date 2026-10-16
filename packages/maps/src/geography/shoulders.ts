import type { Elevation, MapSettings } from '../contract.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, GeographyFailure } from './budget.js';
export const SHOULDER_POLICY = 'banded-lipschitz-cut-v2' as const;
export interface ShoulderPolicy {
  axisGradeCap: number;
  guaranteedBandSteps: number;
  stageOffsetM: number;
  /** Cap slope beyond the guaranteed band, so grading fades back into natural ground. */
  steepGrade: number;
}
export interface ShoulderEvidence {
  policy: typeof SHOULDER_POLICY;
  axisGradeCap: number;
  fullGradientCap: number;
  guaranteedManhattanBandM: number;
  changedDrySamples: number;
  work: number;
}
/** Frozen v2 outer cap: 1:2 beyond the band blends cuts back into natural valley sides. */
export const SHOULDER_STEEP_GRADE = 0.5;
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
    steepGrade: SHOULDER_STEEP_GRADE,
  };
}
class KeyHeap {
  private readonly heap: Int32Array;
  size = 0;
  constructor(
    capacity: number,
    private readonly key: Float64Array,
  ) {
    this.heap = new Int32Array(capacity);
  }
  private less(a: number, b: number): boolean {
    return this.key[a]! < this.key[b]! || (this.key[a] === this.key[b] && a < b);
  }
  push(i: number): void {
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(i, this.heap[p]!)) break;
      this.heap[k] = this.heap[p]!;
      k = p;
    }
    this.heap[k] = i;
  }
  pop(): number {
    const first = this.heap[0]!,
      last = this.heap[--this.size]!;
    let k = 0;
    while (k * 2 + 1 < this.size) {
      let c = k * 2 + 1;
      if (c + 1 < this.size && this.less(this.heap[c + 1]!, this.heap[c]!)) c++;
      if (!this.less(this.heap[c]!, last)) break;
      this.heap[k] = this.heap[c]!;
      k = c;
    }
    if (this.size) this.heap[k] = last;
    return first;
  }
}
const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [-1, -1, 1],
] as const;
/**
 * Cut-only shoulders anchored at wet nodes with possibly different floor levels.
 * `anchors[i]` is a wet node's floor level, or NaN for dry ground. The cap is
 * the cheapest eight-neighbour chamfer path value
 * `level + axisCap·d·(axis + √2·diagonal) + steep·d·(axis' + √2·diagonal')`,
 * where a step is gentle only when both nodes lie within the guaranteed chamfer
 * band of some wet node. Keys are recomputed from integer step counts, never
 * accumulated. Neighbouring band nodes differ by at most axisCap·d along an
 * axis, which bounds every in-band bilinear gradient as the v1 cut did, while
 * the near-Euclidean chamfer avoids Manhattan diamond terraces. Ground is
 * never raised.
 */
export function gradeShoulders(
  samples: number[],
  anchors: Float64Array,
  elevation: Elevation,
  policy: ShoulderPolicy,
  budget: Budget,
  bandSteps: number | Int32Array = policy.guaranteedBandSteps,
): ShoulderEvidence {
  const n = samples.length,
    c = elevation.columns,
    rows = elevation.rows,
    d = elevation.spacingM,
    startWork = budget.used;
  // Two chamfer searches, each: buffers and seed scan, <=9N pushes, <=9N pops,
  // <=8N neighbour visits; plus the final scan. Heap sifts are not itemised.
  budget.take(56 * n);
  let highest = -Infinity;
  for (let i = 0; i < n; i++) highest = Math.max(highest, samples[i]!);
  // Per-anchor bands start at (widest band - own band), so a node is in band
  // exactly when some anchor lies within that anchor's own chamfer band.
  let widest = 0;
  if (typeof bandSteps === 'number') widest = bandSteps;
  else
    for (let i = 0; i < n; i++)
      if (!Number.isNaN(anchors[i]!)) widest = Math.max(widest, bandSteps[i]!);
  const distance = new Float64Array(n).fill(Infinity),
    done = new Uint8Array(n);
  let seeds = 0;
  {
    const heap = new KeyHeap(9 * n, distance);
    for (let i = 0; i < n; i++)
      if (!Number.isNaN(anchors[i]!)) {
        distance[i] = typeof bandSteps === 'number' ? 0 : widest - bandSteps[i]!;
        heap.push(i);
        seeds++;
      }
    if (!seeds) throw new Error('Shoulder grading requires channel anchors');
    while (heap.size) {
      const i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      if (distance[i]! >= widest) continue;
      const x = i % c,
        y = (i - x) / c;
      for (const [dx, dy, diagonal] of NEIGHBOURS) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= c || ny >= rows) continue;
        const j = ny * c + nx,
          value = distance[i]! + (diagonal ? Math.SQRT2 : 1);
        if (!done[j] && value < distance[j]!) {
          distance[j] = value;
          heap.push(j);
        }
      }
    }
  }
  const inBand = (i: number) => distance[i]! <= widest + 1e-9;
  const key = new Float64Array(n).fill(Infinity),
    level = new Float64Array(n),
    steps = new Int32Array(4 * n),
    heap = new KeyHeap(9 * n, key),
    gentleStep = policy.axisGradeCap * d,
    steepStep = policy.steepGrade * d;
  done.fill(0);
  for (let i = 0; i < n; i++)
    if (!Number.isNaN(anchors[i]!)) {
      key[i] = level[i] = anchors[i]!;
      heap.push(i);
    }
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    // Keys pop in increasing order; a cap at or above all ground can cut nothing more.
    if (key[i]! >= highest) break;
    done[i] = 1;
    const x = i % c,
      y = (i - x) / c;
    for (const [dx, dy, diagonal] of NEIGHBOURS) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= c || ny >= rows) continue;
      const j = ny * c + nx;
      if (done[j] || !Number.isNaN(anchors[j]!)) continue;
      const slot = (inBand(i) && inBand(j) ? 0 : 2) + diagonal,
        a = steps[4 * i]! + (slot === 0 ? 1 : 0),
        g = steps[4 * i + 1]! + (slot === 1 ? 1 : 0),
        sa = steps[4 * i + 2]! + (slot === 2 ? 1 : 0),
        sg = steps[4 * i + 3]! + (slot === 3 ? 1 : 0);
      let value = level[i]! + gentleStep * (a + Math.SQRT2 * g);
      if (sa || sg) value += steepStep * (sa + Math.SQRT2 * sg);
      if (value < key[j]!) {
        key[j] = value;
        level[j] = level[i]!;
        steps[4 * j] = a;
        steps[4 * j + 1] = g;
        steps[4 * j + 2] = sa;
        steps[4 * j + 3] = sg;
        heap.push(j);
      }
    }
  }
  let changedDrySamples = 0;
  for (let i = 0; i < n; i++)
    if (Number.isNaN(anchors[i]!) && key[i]! < Infinity) {
      const cap = decimal6(key[i]!);
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
