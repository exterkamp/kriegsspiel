import type { Point, Polygon, Water } from '../../contract.js';
import { pointSegmentDistance, TOPOLOGY_EPSILON } from '../../geometry.js';
import { CoverWork } from './budget.js';

export interface Lattice {
  xs: number[];
  ys: number[];
  columns: number;
  rows: number;
}
/** Positive-length segment intersection with the OPEN rectangle interior. */
function entersCell(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  let low = 0,
    high = 1;
  for (const [start, delta, min, max] of [
    [a[0], b[0] - a[0], x0, x1],
    [a[1], b[1] - a[1], y0, y1],
  ]) {
    if (delta === 0) {
      if (start! <= min! || start! >= max!) return false;
    } else {
      const t0 = (min! - start!) / delta!,
        t1 = (max! - start!) / delta!;
      low = Math.max(low, Math.min(t0, t1));
      high = Math.min(high, Math.max(t0, t1));
      if (low >= high) return false;
    }
  }
  const t = (low + high) / 2,
    x = a[0] + t * (b[0] - a[0]),
    y = a[1] + t * (b[1] - a[1]);
  return x > x0 && x < x1 && y > y0 && y < y1;
}
/** First index whose value is >= (or >) the threshold, without temporary arrays. */
function lowerBound(
  values: number[] | Float64Array,
  length: number,
  threshold: number,
  strict = false,
): number {
  let low = 0,
    high = length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! < threshold || (strict && values[middle] === threshold)) low = middle + 1;
    else high = middle;
  }
  return low;
}
/** Fixed-size merge buffers; deterministic sort of the active crossing prefix. */
function sortCrossings(values: Float64Array, staging: Float64Array, count: number): Float64Array {
  let source = values,
    target = staging;
  for (let width = 1; width < count; width *= 2) {
    for (let start = 0; start < count; start += 2 * width) {
      const middle = Math.min(count, start + width),
        end = Math.min(count, start + 2 * width);
      let left = start,
        right = middle;
      for (let out = start; out < end; out++) {
        if (left < middle && (right >= end || source[left]! <= source[right]!))
          target[out] = source[left++]!;
        else target[out] = source[right++]!;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
function edgeCount(polygon: Polygon): number {
  return polygon.outer.length - 1 + polygon.holes.reduce((n, h) => n + h.length - 1, 0);
}

/** Same mask as centre polygonLocation + exact open-cell boundary tests, without bbox×ring scans. */
export function waterMask(
  lattice: Lattice,
  water: Water[],
  work: CoverWork,
): { wet: Uint8Array; boundary: Uint8Array } {
  const { xs, ys, columns, rows } = lattice;
  const logX = Math.ceil(Math.log2(columns + 2)),
    logY = Math.ceil(Math.log2(rows + 2));
  let initialWork = 2 * columns * rows + 2 * columns + rows;
  for (const feature of water)
    for (const polygon of feature.polygons) {
      const edges = edgeCount(polygon);
      // Complete row-edge scans, crossing buffers, edge row-range binary searches.
      initialWork += edges * (rows + 2 + 2 * logY);
    }
  work.reserve(initialWork, 'water row-edge scan/mask storage');
  const wet = new Uint8Array(columns * rows),
    boundary = new Uint8Array(columns * rows);
  const centres = Float64Array.from(xs.slice(0, columns), (x, i) => (x + xs[i + 1]!) / 2);
  // Union is commutative; scanline fill never clears another polygon's wet cells.
  for (const feature of water)
    for (const polygon of feature.polygons) {
      const edges = edgeCount(polygon),
        crossings = new Float64Array(edges),
        staging = new Float64Array(edges);
      const rings = [polygon.outer, ...polygon.holes];
      for (let y = 0; y < rows; y++) {
        const cy = (ys[y]! + ys[y + 1]!) / 2;
        let count = 0;
        for (const ring of rings)
          for (let k = 1; k < ring.length; k++) {
            const a = ring[k - 1]!,
              b = ring[k]!;
            // Match frozen ringLocation's half-open ray crossing and arithmetic exactly.
            if (a[1] > cy !== b[1] > cy)
              crossings[count++] = ((b[0] - a[0]) * (cy - a[1])) / (b[1] - a[1]) + a[0];
          }
        if (!count) continue;
        if (count % 2)
          throw new Error('Validated water polygon produced an odd scanline crossing count');
        work.reserve(
          3 * count * Math.ceil(Math.log2(Math.max(2, count))) + 2 * count * logX,
          'water scanline ordering/spans',
        );
        const sorted = sortCrossings(crossings, staging, count);
        for (let k = 0; k + 1 < count; k += 2) {
          const start = lowerBound(centres, columns, sorted[k]!),
            end = lowerBound(centres, columns, sorted[k + 1]!);
          work.reserve(end - start, 'water interior cell writes');
          for (let x = start; x < end; x++) wet[y * columns + x] = 1;
        }
      }
      // Traverse only each edge's row-clipped column span, including an epsilon fringe
      // for the frozen point-to-segment boundary classification. Touching alone never
      // masks a cell: candidates still undergo the unchanged open-interior test.
      for (const ring of rings)
        for (let k = 1; k < ring.length; k++) {
          const a = ring[k - 1]!,
            b = ring[k]!,
            epsilon = TOPOLOGY_EPSILON;
          const top = Math.max(0, lowerBound(ys, rows + 1, Math.min(a[1], b[1]) - epsilon) - 1);
          const bottom = Math.min(
            rows - 1,
            lowerBound(ys, rows + 1, Math.max(a[1], b[1]) + epsilon, true) - 1,
          );
          for (let y = top; y <= bottom; y++) {
            work.reserve(8 + 2 * logX, 'water boundary row clipping/range');
            const y0 = ys[y]!,
              y1 = ys[y + 1]!,
              dy = b[1] - a[1];
            let t0 = 0,
              t1 = 1;
            if (dy) {
              const enter = (y0 - epsilon - a[1]) / dy,
                leave = (y1 + epsilon - a[1]) / dy;
              t0 = Math.max(0, Math.min(enter, leave));
              t1 = Math.min(1, Math.max(enter, leave));
              if (t0 > t1) continue;
            } else if (a[1] < y0 - epsilon || a[1] > y1 + epsilon) continue;
            const xA = a[0] + t0 * (b[0] - a[0]),
              xB = a[0] + t1 * (b[0] - a[0]);
            const left = Math.max(0, lowerBound(xs, columns + 1, Math.min(xA, xB) - epsilon) - 1);
            const right = Math.min(
              columns - 1,
              lowerBound(xs, columns + 1, Math.max(xA, xB) + epsilon, true) - 1,
            );
            work.reserve(Math.max(0, right - left + 1) * 2, 'water boundary candidate cell tests');
            for (let x = left; x <= right; x++) {
              const x0 = xs[x]!,
                x1 = xs[x + 1]!,
                cx = centres[x]!,
                cy = (y0 + y1) / 2;
              if (
                entersCell(a, b, x0, y0, x1, y1) ||
                pointSegmentDistance([cx, cy], a, b) <= epsilon
              ) {
                const i = y * columns + x;
                wet[i] = 1;
                boundary[i] = 1;
              }
            }
          }
        }
    }
  return { wet, boundary };
}
