import type { Drainage, Point } from '../contract.js';
import type { Budget } from './budget.js';

/**
 * Frozen `ltd-flowlines-v1` channel routing (#540). Plain steepest-descent D8
 * sends flow on a planar slope along one of eight lattice directions, so
 * channels snap to 0, 45, 90 or 135 degrees whatever the true fall line.
 *
 * Here each sample's flow direction is the D-infinity steepest facet slope
 * (Tarboton 1997) on the filled surface, and the receiver is the cardinal or
 * diagonal neighbour bracketing that direction which keeps the accumulated
 * transverse deviation from the true flow line smallest (D8-LTD, Orlandini et
 * al. 2003). The deviation is carried down the main stem, so a channel on a
 * slope at 20 degrees steps axis, axis, diagonal... and averages 20 degrees.
 * Arithmetic is IEEE-exact apart from `Math.sqrt`; ties resolve by index.
 */
export const FLOWLINES = Object.freeze({
  /** Share of the upstream deviation carried to the next step (1 = full LTD). */
  deviationMemory: 1,
  /** Centreline smoothing: binomial passes over node positions, ends pinned. */
  smoothingPasses: 3,
});

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

export interface FlowRouting {
  downstream: Int32Array;
  /** Upstream sample count along `downstream` (each sample one unit). */
  accumulation: Float64Array;
}

/**
 * LTD receivers on `drainage.filledSamples`, visiting samples by decreasing
 * flood rank so every donor precedes its receiver. Receivers are strictly
 * lower filled neighbours (so lower rank); flats keep the recorded receiver.
 */
export function routeFlowlines(
  drainage: Drainage,
  ranks: readonly number[],
  columns: number,
  rows: number,
  budget: Budget,
): FlowRouting {
  const f = drainage.filledSamples,
    n = f.length,
    order = new Int32Array(n),
    downstream = new Int32Array(n).fill(-1),
    accumulation = new Float64Array(n).fill(1),
    deviation = new Float64Array(n),
    mainDonor = new Float64Array(n);
  budget.take(12 * n);
  for (let i = 0; i < n; i++) order[ranks[i]!] = i;
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!,
      recorded = drainage.downstream[i]!;
    if (recorded < 0) continue;
    const x = i % columns,
      y = (i - x) / columns;
    // Steepest facet: direction (ux, uy) = cardinal + t·(diagonal - cardinal).
    let best = 0,
      card = -1,
      diag = -1,
      ux = 0,
      uy = 0,
      cdx = 0,
      cdy = 0,
      ddx = 0,
      ddy = 0;
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
      let slope2: number, t: number;
      if (s2 <= 0) {
        if (s1 <= 0) continue;
        [slope2, t] = [s1 * s1, 0];
      } else if (s2 >= s1) {
        const drop = f[i]! - f[b]!;
        if (drop <= 0) continue;
        [slope2, t] = [(drop * drop) / 2, 1];
      } else [slope2, t] = [s1 * s1 + s2 * s2, s2 / s1];
      if (slope2 > best) {
        best = slope2;
        card = t < 1 ? a : -1;
        diag = t > 0 ? b : -1;
        [cdx, cdy, ddx, ddy] = [cx, cy, dx, dy];
        ux = cx + t * (dx - cx);
        uy = cy + t * (dy - cy);
      }
    }
    let receiver = recorded,
      out = 0;
    if (best > 0) {
      const length = Math.sqrt(ux * ux + uy * uy),
        carried = FLOWLINES.deviationMemory * deviation[i]!,
        // Signed transverse offset of a step from the flow line (left positive).
        offset = (sx: number, sy: number) => (ux * sy - uy * sx) / length;
      if (card >= 0 && diag >= 0) {
        const viaCard = carried + offset(cdx, cdy),
          viaDiag = carried + offset(ddx, ddy),
          useDiag =
            Math.abs(viaDiag) < Math.abs(viaCard) ||
            (Math.abs(viaDiag) === Math.abs(viaCard) && diag < card);
        receiver = useDiag ? diag : card;
        out = useDiag ? viaDiag : viaCard;
      } else {
        receiver = card >= 0 ? card : diag;
        out = 0;
      }
    }
    downstream[i] = receiver;
    accumulation[receiver] = accumulation[receiver]! + accumulation[i]!;
    // The receiver inherits the deviation of its largest donor (the main stem).
    // Equal donors: the first visited (higher flood rank) keeps it.
    if (accumulation[i]! > mainDonor[receiver]!) {
      mainDonor[receiver] = accumulation[i]!;
      deviation[receiver] = out;
    }
  }
  return { downstream, accumulation };
}

/**
 * Binomial (1, 2, 1) smoothing of a node path, ends pinned. Each pass is a
 * convex combination, so points stay inside the bounds and near the nodes.
 */
export function smoothPath(points: Point[], passes = FLOWLINES.smoothingPasses): Point[] {
  let current = points;
  for (let pass = 0; pass < passes && current.length > 2; pass++) {
    const next: Point[] = [current[0]!];
    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1]!,
        b = current[i]!,
        c = current[i + 1]!;
      next.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
    }
    next.push(current.at(-1)!);
    current = next;
  }
  return current;
}
