import { WorkBudget } from './budgets.js';

/**
 * Frozen `structured-relief-eroded-v2` landform processes. Every routine is a
 * deterministic function of its typed-array input: integer tie-breaking, a
 * fixed visiting order and only IEEE-exact arithmetic plus `Math.sqrt`.
 */
export const EROSION = Object.freeze({
  /** Implicit stream-power passes (Braun & Willett 2013 with m=0.5, n=1). */
  iterations: 10,
  /** Dimensionless erodibility: F = coefficient·sqrt(upstream cells)/step length in cells. */
  coefficient: 0.3,
  /** Explicit four-neighbour hillslope diffusion passes and rate (stable below 0.25). */
  diffusionPasses: 1,
  diffusionRate: 0.18,
  /** Diffusion between stream-power passes. */
  interleavedDiffusion: 2,
  /** Rise per flood step that fills closed depressions as gently sloping (0.2%) floors. */
  drainageEpsilonM: 0.05,
});

const D8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** Binary min-heap on (key, index); ties resolve by smaller row-major index. */
class IndexHeap {
  private readonly heap: Int32Array;
  size = 0;
  constructor(
    capacity: number,
    private readonly key: Float64Array,
  ) {
    this.heap = new Int32Array(capacity);
  }
  private less(a: number, b: number): boolean {
    const ka = this.key[a]!,
      kb = this.key[b]!;
    return ka < kb || (ka === kb && a < b);
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

export interface FloodRouting {
  /** Row-major indices in pop order: every receiver precedes its donors. */
  order: Int32Array;
  /** Steepest filled-surface D8 receiver, or the flood parent across flats; -1 at outlets. */
  receiver: Int32Array;
  /** Receiver step length in cells (1 or sqrt 2). */
  length: Float64Array;
  filled: Float64Array;
}

/** Priority flood from every boundary sample, with an optional strict rise. */
export function floodRoute(
  h: Float64Array,
  columns: number,
  rows: number,
  epsilon: number,
): FloodRouting {
  const n = h.length,
    filled = new Float64Array(h),
    seen = new Uint8Array(n),
    parent = new Int32Array(n).fill(-1),
    order = new Int32Array(n),
    receiver = new Int32Array(n).fill(-1),
    length = new Float64Array(n),
    heap = new IndexHeap(n, filled);
  for (let i = 0; i < n; i++) {
    const x = i % columns,
      y = (i - x) / columns;
    if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) {
      seen[i] = 1;
      heap.push(i);
    }
  }
  let popped = 0;
  while (heap.size) {
    const i = heap.pop();
    order[popped++] = i;
    const x = i % columns,
      y = (i - x) / columns;
    for (const [dx, dy] of D8) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const j = ny * columns + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      parent[j] = i;
      const floor = filled[i]! + epsilon;
      if (filled[j]! < floor) filled[j] = floor;
      heap.push(j);
    }
  }
  for (let i = 0; i < n; i++) {
    const x = i % columns,
      y = (i - x) / columns;
    if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) continue;
    let best = -1,
      slope = 0,
      step = 1;
    for (const [dx, dy] of D8) {
      const j = (y + dy) * columns + x + dx,
        drop = filled[i]! - filled[j]!;
      if (drop <= 0) continue;
      const diagonal = dx !== 0 && dy !== 0,
        // Compare drop/length without square roots: drop^2/len^2.
        g = diagonal ? (drop * drop) / 2 : drop * drop;
      if (g > slope || (g === slope && j < best)) {
        slope = g;
        best = j;
        step = diagonal ? Math.SQRT2 : 1;
      }
    }
    if (best < 0) {
      best = parent[i]!;
      const px = best % columns;
      step = px !== x && (best - px) / columns !== y ? Math.SQRT2 : 1;
    }
    receiver[i] = best;
    length[i] = step;
  }
  return { order, receiver, length, filled };
}

/** Explicit four-neighbour hillslope diffusion with reflecting edges. */
function diffuse(h: Float64Array, columns: number, rows: number, budget: WorkBudget): void {
  budget.take(h.length * 5);
  const next = new Float64Array(h.length);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x,
        w = x > 0 ? h[i - 1]! : h[i]!,
        e = x < columns - 1 ? h[i + 1]! : h[i]!,
        north = y > 0 ? h[i - columns]! : h[i]!,
        south = y < rows - 1 ? h[i + columns]! : h[i]!;
      next[i] = h[i]! + EROSION.diffusionRate * (w + e + north + south - 4 * h[i]!);
    }
  h.set(next);
}

/**
 * Upstream area with multiple-flow-direction partitioning (Quinn-style, weights
 * proportional to drop per unit length) on the filled surface. Spreading area
 * over every lower neighbour avoids the parallel grid-aligned gullies a single
 * D8 receiver carves on planar slopes. Reverse pop order visits every higher
 * node before any lower one because popped keys never decrease.
 */
function multipleFlowArea(
  route: FloodRouting,
  columns: number,
  rows: number,
  area: Float64Array,
): void {
  const f = route.filled,
    weights = new Float64Array(8);
  area.fill(1);
  for (let k = route.order.length - 1; k >= 0; k--) {
    const i = route.order[k]!,
      x = i % columns,
      y = (i - x) / columns;
    if (route.receiver[i]! < 0) continue;
    let sum = 0;
    for (let m = 0; m < 8; m++) {
      const [dx, dy] = D8[m]!,
        nx = x + dx,
        ny = y + dy;
      weights[m] = 0;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const drop = f[i]! - f[ny * columns + nx]!;
      if (drop > 0) {
        weights[m] = dx && dy ? drop * Math.SQRT1_2 : drop;
        sum += weights[m]!;
      }
    }
    if (!sum) {
      const r = route.receiver[i]!;
      area[r] = area[r]! + area[i]!;
      continue;
    }
    for (let m = 0; m < 8; m++)
      if (weights[m]) {
        const j = (y + D8[m]![1]) * columns + x + D8[m]![0];
        area[j] = area[j]! + (area[i]! * weights[m]!) / sum;
      }
  }
}

/**
 * Carve drainage-consistent valleys into a noise field, soften hillslopes, then
 * remove every closed depression with a strict minimum rise so all flow drains to
 * the boundary. Mutates and returns `h`.
 */
export function erodeRelief(
  h: Float64Array,
  columns: number,
  rows: number,
  budget: WorkBudget,
): Float64Array {
  const n = h.length;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, h[i]!);
    hi = Math.max(hi, h[i]!);
  }
  const area = new Float64Array(n);
  for (let pass = 0; pass < EROSION.iterations; pass++) {
    budget.take(n * 12);
    const route = floodRoute(h, columns, rows, 0);
    multipleFlowArea(route, columns, rows, area);
    // Receivers precede donors in pop order, so each update uses the new receiver height.
    for (let k = 0; k < n; k++) {
      const i = route.order[k]!,
        r = route.receiver[i]!;
      if (r < 0 || h[i]! <= h[r]!) continue;
      const f = (EROSION.coefficient * Math.sqrt(area[i]!)) / route.length[i]!;
      h[i] = (h[i]! + f * h[r]!) / (1 + f);
    }
    for (let d = 0; d < EROSION.interleavedDiffusion; d++) diffuse(h, columns, rows, budget);
  }
  for (let pass = 0; pass < EROSION.diffusionPasses; pass++) diffuse(h, columns, rows, budget);
  // Restore the configured relief range so `reliefM` keeps its meaning.
  let lo2 = Infinity,
    hi2 = -Infinity;
  for (let i = 0; i < n; i++) {
    lo2 = Math.min(lo2, h[i]!);
    hi2 = Math.max(hi2, h[i]!);
  }
  budget.take(n * 12);
  if (hi2 > lo2) for (let i = 0; i < n; i++) h[i] = lo + ((h[i]! - lo2) * (hi - lo)) / (hi2 - lo2);
  const drained = floodRoute(h, columns, rows, EROSION.drainageEpsilonM);
  h.set(drained.filled);
  return h;
}
