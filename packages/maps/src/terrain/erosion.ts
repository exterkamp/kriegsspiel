import { WorkBudget } from './budgets.js';

/**
 * Frozen `gradient-relief-eroded-v3` landform processes. Every routine is a
 * deterministic function of its typed-array input: integer tie-breaking, a
 * fixed visiting order and only IEEE-exact arithmetic plus `Math.sqrt`.
 * (v2 differed only in incising toward the single steepest D8 receiver.)
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
  /** Rise per cell of distance that fills closed depressions as gently sloping (0.2%) floors. */
  drainageEpsilonM: 0.05,
  /**
   * Rise per cell of distance on the routing surface during erosion, so
   * filled flats drain radially to their spill point instead of along flood
   * parents found in row-major tie order (v2 routed on level flats).
   */
  routingEpsilonM: 0.001,
  /** Least rise over a flood parent, as a share of the epsilon. */
  minimumRiseShare: 0.01,
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
    heap = new IndexHeap(n, filled),
    root = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    root[i] = i;
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
      if (epsilon) {
        // Submerged ground rises by epsilon per cell of Euclidean distance
        // from where the flood entered it (vector propagation), at least a
        // hundredth of epsilon above its flood parent, so filled floors slope
        // radially toward their spill point instead of in D8 rings.
        const r = root[i]!,
          rx = r % columns,
          ry = (r - rx) / columns,
          floor = Math.max(
            filled[r]! + epsilon * Math.sqrt((nx - rx) ** 2 + (ny - ry) ** 2),
            filled[i]! + epsilon * EROSION.minimumRiseShare,
          );
        if (filled[j]! < floor) {
          filled[j] = floor;
          root[j] = r;
        } else root[j] = j;
      } else if (filled[j]! < filled[i]!) filled[j] = filled[i]!;
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

/**
 * Triangular facets around a sample (Tarboton 1997): a cardinal neighbour and
 * the diagonal beside it, as [cardinal dx, dy, diagonal dx, dy].
 */
const FACETS = [
  [1, 0, 1, -1],
  [0, -1, 1, -1],
  [0, -1, -1, -1],
  [-1, 0, -1, -1],
  [-1, 0, -1, 1],
  [0, 1, -1, 1],
  [0, 1, 1, 1],
  [1, 0, 1, 1],
] as const;

/**
 * D-infinity flow directions on the filled surface: each sample drains along
 * the steepest facet slope, toward a point on the edge between a cardinal and
 * a diagonal neighbour at share `t` of the way to the diagonal. Without trig,
 * `t` is the facet slope's cross component over its along component. Both
 * receivers with positive share are strictly lower, so they precede the
 * sample in flood order. Where no facet descends (flats), the flood receiver.
 */
export interface InfinityRouting {
  cardinal: Int32Array;
  diagonal: Int32Array;
  /** Share toward the diagonal receiver, in [0, 1]. */
  share: Float64Array;
  /** Distance to the edge point in cells. */
  length: Float64Array;
}
export function infinityRoute(
  route: FloodRouting,
  columns: number,
  rows: number,
  out?: InfinityRouting,
): InfinityRouting {
  const n = route.filled.length,
    f = route.filled,
    r: InfinityRouting = out ?? {
      cardinal: new Int32Array(n),
      diagonal: new Int32Array(n),
      share: new Float64Array(n),
      length: new Float64Array(n),
    };
  for (let i = 0; i < n; i++) {
    const x = i % columns,
      y = (i - x) / columns;
    r.cardinal[i] = route.receiver[i]!;
    r.diagonal[i] = -1;
    r.share[i] = 0;
    r.length[i] = route.length[i]!;
    if (route.receiver[i]! < 0) continue;
    let best = 0;
    for (const [cx, cy, dx, dy] of FACETS) {
      const ax = x + cx,
        ay = y + cy,
        bx = x + dx,
        by = y + dy;
      if (ax < 0 || ay < 0 || ax >= columns || ay >= rows) continue;
      if (bx < 0 || by < 0 || bx >= columns || by >= rows) continue;
      const a = ay * columns + ax,
        b = by * columns + bx,
        s1 = f[i]! - f[a]!,
        s2 = f[a]! - f[b]!;
      let slope2: number, card: number, diag: number, t: number;
      if (s2 <= 0) {
        if (s1 <= 0) continue;
        [slope2, card, diag, t] = [s1 * s1, a, -1, 0];
      } else if (s2 >= s1) {
        const drop = f[i]! - f[b]!;
        if (drop <= 0) continue;
        [slope2, card, diag, t] = [(drop * drop) / 2, -1, b, 1];
      } else [slope2, card, diag, t] = [s1 * s1 + s2 * s2, a, b, s2 / s1];
      if (slope2 > best) {
        best = slope2;
        r.cardinal[i] = t < 1 ? card : diag;
        r.diagonal[i] = t > 0 && t < 1 ? diag : -1;
        r.share[i] = t > 0 && t < 1 ? t : 0;
        r.length[i] = t === 1 ? Math.SQRT2 : Math.sqrt(1 + t * t);
      }
    }
  }
  return r;
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
  let flow: InfinityRouting | undefined;
  for (let pass = 0; pass < EROSION.iterations; pass++) {
    budget.take(n * 14);
    const route = floodRoute(h, columns, rows, EROSION.routingEpsilonM);
    multipleFlowArea(route, columns, rows, area);
    flow = infinityRoute(route, columns, rows, flow);
    // Receivers precede donors in pop order, so each update uses the new
    // receiver heights. Incision pulls toward the D-infinity edge point, so
    // valleys follow the true fall line rather than eight lattice directions.
    for (let k = 0; k < n; k++) {
      const i = route.order[k]!,
        a = flow.cardinal[i]!;
      if (a < 0) continue;
      const b = flow.diagonal[i]!,
        t = flow.share[i]!,
        target = b < 0 ? h[a]! : h[a]! + t * (h[b]! - h[a]!);
      if (h[i]! <= target) continue;
      const f = (EROSION.coefficient * Math.sqrt(area[i]!)) / flow.length[i]!;
      h[i] = (h[i]! + f * target) / (1 + f);
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
