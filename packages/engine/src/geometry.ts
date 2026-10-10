import type { Point } from './types.js';

/** Millimetres per metre. Master state keeps every coordinate as integer millimetres. */
export const MM_PER_METRE = 1000;

/** Metres to integer millimetres (the quantisation applied to everything entering state). */
export function mm(metres: number): number {
  return Math.round(metres * MM_PER_METRE);
}

/** Millimetres to metres. Exact to the millimetre. */
export function metres(millimetres: number): number {
  return millimetres / MM_PER_METRE;
}

/** A point in metres to a point in integer millimetres. */
export function pointMm(x: number, y: number): Point {
  return { x: mm(x), y: mm(y) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A closed parameter range `[t0, t1]` along a segment, with 0 at its start and 1 at its end. */
export interface Interval {
  t0: number;
  t1: number;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Union of intervals, sorted and with overlapping or touching ones merged. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((p, q) => p.t0 - q.t0 || p.t1 - q.t1);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.t0 <= last.t1) last.t1 = Math.max(last.t1, iv.t1);
    else out.push({ ...iv });
  }
  return out;
}

export function distPointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** Whether segments `ab` and `cd` share a point (touching and collinear overlap count). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

/** Shortest distance between two segments (0 if they touch). */
export function distSegmentSegment(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distPointSegment(a, c, d),
    distPointSegment(b, c, d),
    distPointSegment(c, a, b),
    distPointSegment(d, a, b),
  );
}

/** Whether `p` is inside `poly` or on its boundary. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The part of segment `ab` inside the circle, or null. */
export function segmentCircleInterval(a: Point, b: Point, c: Point, r: number): Interval | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return fx * fx + fy * fy <= r * r ? { t0: 0, t1: 1 } : null;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r * r;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, (-qb - root) / (2 * qa));
  const t1 = Math.min(1, (-qb + root) / (2 * qa));
  return t0 <= t1 ? { t0, t1 } : null;
}

/** The part of segment `ab` inside the rectangle spanning `p`..`q` and `half` either side of it. */
function segmentBarInterval(a: Point, b: Point, p: Point, q: Point, half: number): Interval | null {
  const len = distance(p, q);
  if (len === 0) return null;
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  // Local frame of the bar: u along it, v across it.
  const u = (pt: Point) => (pt.x - p.x) * ux + (pt.y - p.y) * uy;
  const v = (pt: Point) => -(pt.x - p.x) * uy + (pt.y - p.y) * ux;
  let t0 = 0;
  let t1 = 1;
  for (const [c0, c1, lo, hi] of [
    [u(a), u(b), 0, len],
    [v(a), v(b), -half, half],
  ] as const) {
    const dc = c1 - c0;
    if (dc === 0) {
      if (c0 < lo || c0 > hi) return null;
      continue;
    }
    const ta = (lo - c0) / dc;
    const tb = (hi - c0) / dc;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1 ? { t0, t1 } : null;
}

/** The parts of segment `ab` within `half` of the polyline `pts` (a capsule chain). */
export function segmentPolylineIntervals(
  a: Point,
  b: Point,
  pts: readonly Point[],
  half: number,
): Interval[] {
  const found: Interval[] = [];
  for (const p of pts) {
    const iv = segmentCircleInterval(a, b, p, half);
    if (iv) found.push(iv);
  }
  for (let i = 1; i < pts.length; i++) {
    const iv = segmentBarInterval(a, b, pts[i - 1] as Point, pts[i] as Point, half);
    if (iv) found.push(iv);
  }
  return mergeIntervals(found);
}

/**
 * The parts of segment `ab` inside `poly` (boundary included). A segment that only touches the
 * boundary at one point gives a zero-length interval there.
 */
export function segmentPolygonIntervals(a: Point, b: Point, poly: readonly Point[]): Interval[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts = new Set<number>([0, 1]);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = poly[j] as Point;
    const d = poly[i] as Point;
    const ex = d.x - c.x;
    const ey = d.y - c.y;
    const denom = dx * ey - dy * ex;
    if (denom !== 0) {
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denom;
      const s = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denom;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) ts.add(t);
    } else if (cross(a, b, c) === 0) {
      // Collinear with this edge: its ends may start or stop the overlap.
      const len2 = dx * dx + dy * dy;
      if (len2 > 0) {
        for (const e of [c, d]) {
          const t = ((e.x - a.x) * dx + (e.y - a.y) * dy) / len2;
          if (t >= 0 && t <= 1) ts.add(t);
        }
      }
    }
  }
  const sorted = [...ts].sort((p, q) => p - q);
  const found: Interval[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const t0 = sorted[i - 1] as number;
    const t1 = sorted[i] as number;
    if (pointInPolygon(lerp(a, b, (t0 + t1) / 2), poly)) found.push({ t0, t1 });
  }
  for (const t of sorted) {
    if (pointInPolygon(lerp(a, b, t), poly)) found.push({ t0: t, t1: t });
  }
  return mergeIntervals(found);
}

/** Whether two polygons overlap or touch (including one inside the other). */
export function polygonsIntersect(p: readonly Point[], q: readonly Point[]): boolean {
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    for (let k = 0, l = q.length - 1; k < q.length; l = k++) {
      if (segmentsIntersect(p[j] as Point, p[i] as Point, q[l] as Point, q[k] as Point))
        return true;
    }
  }
  return pointInPolygon(p[0] as Point, q) || pointInPolygon(q[0] as Point, p);
}

/** Whether a polygon and a disc overlap or touch. */
export function polygonIntersectsCircle(poly: readonly Point[], c: Point, r: number): boolean {
  if (pointInPolygon(c, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distPointSegment(c, poly[j] as Point, poly[i] as Point) <= r) return true;
  }
  return false;
}

/** Whether a polygon and the polyline thickened to `half` either side overlap or touch. */
export function polygonIntersectsPolyline(
  poly: readonly Point[],
  pts: readonly Point[],
  half: number,
): boolean {
  if (pts.some((p) => pointInPolygon(p, poly))) return true;
  for (let k = 1; k < pts.length; k++) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (
        distSegmentSegment(
          pts[k - 1] as Point,
          pts[k] as Point,
          poly[j] as Point,
          poly[i] as Point,
        ) <= half
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Whether two convex polygons overlap by more than a shared edge or corner (separating axis). */
export function convexOverlap(p: readonly Point[], q: readonly Point[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j] as Point;
      const b = poly[i] as Point;
      const nx = b.y - a.y;
      const ny = a.x - b.x;
      const proj = (shape: readonly Point[]) => {
        const vals = shape.map((pt) => pt.x * nx + pt.y * ny);
        return [Math.min(...vals), Math.max(...vals)] as const;
      };
      const [p0, p1] = proj(p);
      const [q0, q1] = proj(q);
      if (p1 <= q0 || q1 <= p0) return false;
    }
  }
  return true;
}

/** Signed-area centroid of a polygon; falls back to the vertex mean for a degenerate one. */
export function polygonCentroid(poly: readonly Point[]): Point {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j] as Point;
    const q = poly[i] as Point;
    const w = p.x * q.y - q.x * p.y;
    a2 += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (a2 === 0) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}
