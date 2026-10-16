import type { GenerationResult, Point, Polygon } from '../contract.js';
import { fail } from '../errors.js';
import {
  TOPOLOGY_EPSILON,
  distance,
  interpolate,
  pointSegmentDistance,
  polygonEdges,
  polygonLocation,
  validatePolygon,
} from '../geometry.js';
import { bounded } from './budget.js';
import { preflightAsset } from '../resources.js';
import { HARD_LIMITS } from '../contract.js';
import { Context, box, touches } from './context.js';
import type { CorridorCertificate, PlanningInput, Suitability } from './types.js';
function clippedRing(ring: Point[], x0: number, y0: number, x1: number, y1: number): Point[] {
  let result = ring.slice(0, -1);
  for (const [axis, bound, sign] of [
    [0, x0, 1],
    [0, x1, -1],
    [1, y0, 1],
    [1, y1, -1],
  ] as const) {
    const next: Point[] = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i]!,
        b = result[(i + 1) % result.length]!,
        insideA = sign * (a[axis] - bound) >= 0,
        insideB = sign * (b[axis] - bound) >= 0;
      if (insideA) next.push(a);
      if (insideA !== insideB)
        next.push(interpolate(a, b, (bound - a[axis]) / (b[axis] - a[axis])));
    }
    result = next;
  }
  return result;
}
/**
 * Whether a closed segment comes within `r` (plus the 1e-9 contact slack) of a
 * closed axis-aligned cell. Equivalent to the generic polygon location and
 * segment-distance predicates for a rectangle, without allocating polygons:
 * an endpoint in the cell, a crossing (Liang-Barsky), or a disjoint distance
 * attained at an endpoint or a cell corner.
 */
export function segmentNearCell(
  a: Point,
  b: Point,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): boolean {
  const e = TOPOLOGY_EPSILON,
    inside = (p: Point) => p[0] >= x0 - e && p[0] <= x1 + e && p[1] >= y0 - e && p[1] <= y1 + e;
  if (inside(a) || inside(b)) return true;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let t0 = 0,
    t1 = 1;
  for (const [p, q] of [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dy, a[1] - y0],
    [dy, y1 - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) {
        t0 = 1;
        t1 = 0;
        break;
      }
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  if (t0 <= t1) return true;
  const limit = r + 1e-9,
    toCell = (p: Point) =>
      Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1));
  if (toCell(a) <= limit || toCell(b) <= limit) return true;
  for (const corner of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as Point[])
    if (pointSegmentDistance(corner, a, b) <= limit) return true;
  return false;
}
/** Affine gradient of one bilinear cell, evaluated using the authoritative query. */
export function cellGradient(
  c: Context,
  col: number,
  row: number,
  p: Point,
): { dx: number; dy: number } {
  const h = c.input.elevation.spacingM,
    x = col * h,
    y = row * h;
  const key = row * c.input.elevation.columns + col;
  let g = c.gradientCells.get(key);
  if (!g) {
    c.validation.take(3);
    const a = c.q.gradientAt(x + h * 0.25, y + h * 0.25),
      b = c.q.gradientAt(x + h * 0.75, y + h * 0.25),
      d = c.q.gradientAt(x + h * 0.25, y + h * 0.75);
    g = { dx: a.dx, dy: a.dy, dxy: (d.dx - a.dx) / 0.5, dyx: (b.dy - a.dy) / 0.5 };
    c.gradientCells.set(key, g);
  }
  c.validation.take();
  return { dx: g.dx + g.dxy * ((p[1] - y) / h - 0.25), dy: g.dy + g.dyx * ((p[0] - x) / h - 0.25) };
}
export function footprint(
  c: Context,
  p: Polygon,
  limit = c.settings.settlements.maxBuildingGradient,
): Suitability {
  preflightAsset(
    { polygon: p },
    { ...HARD_LIMITS, maxVertices: c.settings.limits.maxVertices },
    () => c.validation.take(),
  );
  validatePolygon(p, '$.footprint', c.meter);
  const b = box(p.outer);
  if (!p.outer.every((v) => c.inBounds(v)))
    return { suitable: false, maxGradient: 0, reason: 'bounds' };
  const edges = polygonEdges(p);
  c.validation.take(edges.length);
  for (const item of c.polygons) {
    c.validation.take();
    if (!touches(b, item.box)) continue;
    for (const [a, d] of edges)
      if (!c.drySegment(a, d, 0)) return { suitable: false, maxGradient: 0, reason: 'water' };
    if (
      polygonLocation(item.polygon.outer[0]!, p, c.meter) !== 'outside' ||
      polygonLocation(p.outer[0]!, item.polygon, c.meter) !== 'outside'
    )
      return { suitable: false, maxGradient: 0, reason: 'water' };
  }
  const h = c.input.elevation.spacingM;
  let max = 0;
  for (
    let row = Math.max(0, Math.floor(b[1] / h));
    row <= Math.min(c.input.elevation.rows - 2, Math.floor(b[3] / h));
    row++
  )
    for (
      let col = Math.max(0, Math.floor(b[0] / h));
      col <= Math.min(c.input.elevation.columns - 2, Math.floor(b[2] / h));
      col++
    ) {
      c.validation.take();
      const vertices: Point[] = [];
      for (const ring of [p.outer, ...p.holes]) {
        c.validation.take(ring.length);
        vertices.push(...clippedRing(ring, col * h, row * h, (col + 1) * h, (row + 1) * h));
      }
      vertices.push(
        [col * h, row * h],
        [(col + 1) * h, row * h],
        [(col + 1) * h, (row + 1) * h],
        [col * h, (row + 1) * h],
      );
      for (const v of vertices) {
        if (polygonLocation(v, p, c.meter) === 'outside') continue;
        const g = cellGradient(c, col, row, v);
        max = Math.max(max, Math.hypot(g.dx, g.dy));
      }
    }
  return {
    suitable: max <= limit + 1e-12,
    maxGradient: max,
    ...(max > limit + 1e-12 ? { reason: 'gradient' as const } : {}),
  };
}
/** Complete centreline extrema, splitting exactly at every elevation seam. */
export function segmentGrade(c: Context, a: Point, b: Point): number {
  if (!c.inBounds(a) || !c.inBounds(b) || distance(a, b) === 0)
    throw new RangeError('Grade requires distinct in-bounds endpoints');
  const cuts = [0, 1],
    h = c.input.elevation.spacingM;
  for (const axis of [0, 1] as const) {
    const delta = b[axis] - a[axis];
    if (!delta) continue;
    const lo = Math.min(a[axis], b[axis]),
      hi = Math.max(a[axis], b[axis]);
    const n = Math.floor(hi / h) - Math.ceil(lo / h) + 1;
    c.validation.take(Math.max(0, n));
    for (let k = Math.ceil(lo / h); k <= Math.floor(hi / h); k++) {
      const t = (k * h - a[axis]) / delta;
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  c.validation.take(cuts.length * Math.ceil(Math.log2(cuts.length + 1)));
  cuts.sort((x, y) => x - y);
  let max = 0;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1]!,
      hi = cuts[i]!;
    if (hi - lo <= 1e-14) continue;
    const p = interpolate(a, b, lo),
      q = interpolate(a, b, hi),
      m = interpolate(p, q, 0.5),
      length = distance(p, q);
    c.validation.take(3);
    const z0 = c.q.heightAt(...p),
      zm = c.q.heightAt(...m),
      z1 = c.q.heightAt(...q),
      quadratic = 2 * (z1 + z0 - 2 * zm),
      linear = z1 - z0 - quadratic;
    max = Math.max(max, Math.abs(linear) / length, Math.abs(linear + 2 * quadratic) / length);
  }
  return max;
}
export function corridor(
  c: Context,
  a: Point,
  b: Point,
  width: number,
  exit?: 'north' | 'east' | 'south' | 'west',
  knownDry = false,
): CorridorCertificate {
  if (!Number.isFinite(width) || width <= 0 || distance(a, b) <= 0)
    throw new RangeError('Corridor requires finite positive width and distinct endpoints');
  const r = width / 2;
  let bounds = c.inBounds(a, r) && c.inBounds(b, r);
  if (exit) {
    const on =
      exit === 'north'
        ? b[1] === 0
        : exit === 'south'
          ? b[1] === c.bounds.maxY
          : exit === 'west'
            ? b[0] === 0
            : b[0] === c.bounds.maxX;
    const normal = exit === 'north' || exit === 'south' ? a[0] === b[0] : a[1] === b[1];
    bounds =
      c.inBounds(a, r) &&
      c.inBounds(b) &&
      on &&
      normal &&
      (exit === 'north' || exit === 'south'
        ? b[0] >= r && b[0] + r <= c.bounds.maxX
        : b[1] >= r && b[1] + r <= c.bounds.maxY);
  }
  if (!bounds) return { traversable: false, maxDirectionalGrade: 0, reason: 'bounds' };
  if (!c.drySegment(a, b, r, knownDry))
    return { traversable: false, maxDirectionalGrade: 0, reason: 'water' };
  const length = distance(a, b),
    ux = (b[0] - a[0]) / length,
    uy = (b[1] - a[1]) / length,
    h = c.input.elevation.spacingM,
    rect = box([a, b]);
  let max = segmentGrade(c, a, b);
  // Conservative complete-capsule bound: the directional derivative is affine;
  // all corners of every touched cell bound its clipped subset, including bends/caps.
  for (
    let row = Math.max(0, Math.floor((rect[1] - r) / h));
    row <= Math.min(c.input.elevation.rows - 2, Math.floor((rect[3] + r) / h));
    row++
  )
    for (
      let col = Math.max(0, Math.floor((rect[0] - r) / h));
      col <= Math.min(c.input.elevation.columns - 2, Math.floor((rect[2] + r) / h));
      col++
    ) {
      c.validation.take();
      // Bbox cells off the capsule are harmlessly conservative but avoid distant diagonals.
      c.validation.take(4);
      if (!segmentNearCell(a, b, col * h, row * h, (col + 1) * h, (row + 1) * h, r)) continue;
      const corners: Point[] = [
        [col * h, row * h],
        [(col + 1) * h, row * h],
        [(col + 1) * h, (row + 1) * h],
        [col * h, (row + 1) * h],
      ];
      for (const v of corners) {
        const g = cellGradient(c, col, row, v);
        max = Math.max(max, Math.abs(g.dx * ux + g.dy * uy));
      }
    }
  return {
    traversable: max <= c.settings.roads.maxGrade + 1e-12,
    maxDirectionalGrade: max,
    ...(max > c.settings.roads.maxGrade + 1e-12 ? { reason: 'grade' as const } : {}),
  };
}
export function certifyFootprint(input: PlanningInput, p: Polygon): GenerationResult<Suitability> {
  return bounded(() => footprint(new Context(input), p));
}
export function certifyRoadSegment(
  input: PlanningInput,
  a: Point,
  b: Point,
  width?: number,
  exit?: 'north' | 'east' | 'south' | 'west',
): GenerationResult<CorridorCertificate> {
  return bounded(() => {
    const c = new Context(input);
    preflightAsset({ a, b }, HARD_LIMITS, () => c.validation.take());
    return corridor(c, a, b, width ?? c.settings.roads.maxReservedWidthM, exit);
  });
}
export function directionalGrade(
  input: PlanningInput,
  a: Point,
  b: Point,
): GenerationResult<number> {
  return bounded(() => {
    const c = new Context(input);
    preflightAsset({ a, b }, HARD_LIMITS, () => c.validation.take());
    return segmentGrade(c, a, b);
  });
}
export function requireFinitePoint(p: Point, path: string): void {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
    fail(path, 'Finite two-dimensional point required');
}
