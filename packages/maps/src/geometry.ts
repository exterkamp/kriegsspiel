import type { Point, Polygon } from './contract.js';
import { fail, TopologyBudget } from './errors.js';

export const TOPOLOGY_EPSILON = 1e-9;
export const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const floatBits = new DataView(new ArrayBuffer(8));
// Exact dyadic integer in units of 2^-1074. Used only when the ordinary
// determinant's rounding error cannot establish its sign; no dependency/RNG.
function dyadic(value: number): bigint {
  floatBits.setFloat64(0, value);
  const bits = floatBits.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const magnitude = exponent ? ((1n << 52n) | fraction) << BigInt(exponent - 1) : fraction;
  return bits >> 63n ? -magnitude : magnitude;
}
export function orientation(a: Point, b: Point, c: Point): number {
  if (![...a, ...b, ...c].every(Number.isFinite))
    throw new RangeError('Orientation requires finite coordinates');
  const left = (b[0] - a[0]) * (c[1] - a[1]),
    right = (b[1] - a[1]) * (c[0] - a[0]);
  const determinant = left - right;
  if (
    Number.isFinite(determinant) &&
    Math.abs(determinant) > 8 * Number.EPSILON * (Math.abs(left) + Math.abs(right))
  )
    return Math.sign(determinant);
  const ax = dyadic(a[0]),
    ay = dyadic(a[1]);
  const exact =
    (dyadic(b[0]) - ax) * (dyadic(c[1]) - ay) - (dyadic(b[1]) - ay) * (dyadic(c[0]) - ax);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c),
    abD = orientation(a, b, d),
    cdA = orientation(c, d, a),
    cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (
    pointSegmentDistance(a, c, d) <= TOPOLOGY_EPSILON ||
    pointSegmentDistance(b, c, d) <= TOPOLOGY_EPSILON ||
    pointSegmentDistance(c, a, b) <= TOPOLOGY_EPSILON ||
    pointSegmentDistance(d, a, b) <= TOPOLOGY_EPSILON
  );
}
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  return segmentsIntersect(a, b, c, d)
    ? 0
    : Math.min(
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
      );
}
export function signedRingArea(ring: Point[]): number {
  let area = 0;
  // Translate to the first point to reduce cancellation for remote small rings.
  const origin = ring[0]!;
  for (let i = 1; i < ring.length - 1; i++) area += cross(origin, ring[i]!, ring[i + 1]!);
  return area / 2;
}
export function polygonArea(polygon: Polygon): number {
  return (
    Math.abs(signedRingArea(polygon.outer)) -
    polygon.holes.reduce((sum, ring) => sum + Math.abs(signedRingArea(ring)), 0)
  );
}
export function ringLocation(
  point: Point,
  ring: Point[],
  budget?: TopologyBudget,
  path = '$',
): 'inside' | 'outside' | 'boundary' {
  if (!point.every(Number.isFinite))
    throw new RangeError('Polygon query requires finite coordinates');
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    budget?.consume(path);
    const a = ring[i - 1]!,
      b = ring[i]!;
    if (pointSegmentDistance(point, a, b) <= TOPOLOGY_EPSILON) return 'boundary';
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}
export function polygonLocation(
  point: Point,
  polygon: Polygon,
  budget?: TopologyBudget,
  path = '$',
): 'inside' | 'outside' | 'boundary' {
  const outer = ringLocation(point, polygon.outer, budget, path);
  if (outer !== 'inside') return outer;
  for (const hole of polygon.holes) {
    const location = ringLocation(point, hole, budget, path);
    if (location === 'boundary') return 'boundary';
    if (location === 'inside') return 'outside';
  }
  return 'inside';
}
export function polygonEdges(polygon: Polygon): [Point, Point][] {
  return [polygon.outer, ...polygon.holes].flatMap((ring) =>
    ring.slice(1).map((p, i) => [ring[i]!, p] as [Point, Point]),
  );
}
export function validatePath(
  points: Point[],
  path: string,
  budget: TopologyBudget,
  closedAllowed = false,
): void {
  const closed = distance(points[0]!, points.at(-1)!) <= TOPOLOGY_EPSILON;
  if (closed && !closedAllowed) fail(path, 'Path must have distinct endpoints');
  for (let i = 1; i < points.length; i++) {
    if (distance(points[i - 1]!, points[i]!) <= TOPOLOGY_EPSILON)
      fail(`${path}[${i}]`, 'Zero-length segment');
    if (i > 1 && orientation(points[i - 2]!, points[i - 1]!, points[i]!) === 0) {
      const a = points[i - 2]!,
        b = points[i - 1]!,
        c = points[i]!;
      if ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0)
        fail(`${path}[${i}]`, 'Path backtracks');
    }
    for (let j = i + 2; j < points.length; j++) {
      if (closed && i === 1 && j === points.length - 1) continue;
      budget.consume(path);
      if (segmentsIntersect(points[i - 1]!, points[i]!, points[j - 1]!, points[j]!))
        fail(path, `Segments ${i - 1} and ${j - 1} intersect`);
    }
  }
}
function ringsTouch(a: Point[], b: Point[], budget: TopologyBudget, path: string): boolean {
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      budget.consume(path);
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
    }
  return false;
}
export function validatePolygon(polygon: Polygon, path: string, budget: TopologyBudget): void {
  for (const [i, ring] of [polygon.outer, ...polygon.holes].entries()) {
    const p = i ? `${path}.holes[${i - 1}]` : `${path}.outer`;
    if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1])
      fail(p, 'Ring must close explicitly with its exact first coordinate');
    validatePath(ring, p, budget, true);
    if (signedRingArea(ring) === 0) fail(p, 'Ring has zero area');
  }
  for (const [i, hole] of polygon.holes.entries()) {
    const p = `${path}.holes[${i}]`;
    if (
      ringsTouch(polygon.outer, hole, budget, p) ||
      ringLocation(hole[0]!, polygon.outer, budget, p) !== 'inside'
    )
      fail(p, 'Hole must be strictly inside outer ring without touching');
    for (let j = 0; j < i; j++) {
      const other = polygon.holes[j]!;
      if (
        ringsTouch(other, hole, budget, p) ||
        ringLocation(hole[0]!, other, budget, p) !== 'outside' ||
        ringLocation(other[0]!, hole, budget, p) !== 'outside'
      )
        fail(p, 'Holes must be disjoint, unnested and non-touching');
    }
  }
}
export function polygonsOverlap(
  a: Polygon,
  b: Polygon,
  budget: TopologyBudget,
  path: string,
): boolean {
  for (const ra of [a.outer, ...a.holes])
    for (const rb of [b.outer, ...b.holes]) if (ringsTouch(ra, rb, budget, path)) return true;
  return (
    polygonLocation(a.outer[0]!, b, budget, path) === 'inside' ||
    polygonLocation(b.outer[0]!, a, budget, path) === 'inside'
  );
}
export function polygonContainsPolygon(
  container: Polygon,
  inner: Polygon,
  budget: TopologyBudget,
  path: string,
): boolean {
  // Boundary coincidence is permitted. Partition every inner edge at container
  // boundaries, so testing vertices alone cannot miss a concave notch or hole.
  const edges = polygonEdges(container);
  for (const [a, b] of polygonEdges(inner)) {
    if (polygonLocation(a, container, budget, path) === 'outside') return false;
    const cuts = segmentCuts(a, b, edges, budget, path);
    for (let i = 1; i < cuts.length; i++)
      if (
        polygonLocation(
          interpolate(a, b, (cuts[i - 1]! + cuts[i]!) / 2),
          container,
          budget,
          path,
        ) === 'outside'
      )
        return false;
  }
  for (const hole of container.holes)
    if (polygonLocation(hole[0]!, inner, budget, path) === 'inside') return false;
  return true;
}
export const interpolate = (a: Point, b: Point, t: number): Point => [
  a[0] + t * (b[0] - a[0]),
  a[1] + t * (b[1] - a[1]),
];
export function projection(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
}
export function segmentCuts(
  a: Point,
  b: Point,
  edges: [Point, Point][],
  budget: TopologyBudget,
  path: string,
): number[] {
  const cuts = [0, 1],
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (const [c, d] of edges) {
    budget.consume(path);
    const ex = d[0] - c[0],
      ey = d[1] - c[1];
    // Normalize vectors before cuts: determinants have area units, so a metre
    // distance tolerance must never determine parallelism.
    const scale = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(ex), Math.abs(ey));
    const nx = dx / scale,
      ny = dy / scale,
      ne = ex / scale,
      nf = ey / scale;
    const den = nx * nf - ny * ne;
    if (den !== 0) {
      const ox = (c[0] - a[0]) / scale,
        oy = (c[1] - a[1]) / scale;
      const t = (ox * nf - oy * ne) / den;
      const u = (ox * ny - oy * nx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    } else {
      for (const p of [c, d])
        if (pointSegmentDistance(p, a, b) <= TOPOLOGY_EPSILON)
          cuts.push(Math.max(0, Math.min(1, projection(p, a, b))));
    }
  }
  return [...new Set(cuts)].sort((x, y) => x - y);
}
export function capsuleIntersectsPolygon(
  a: Point,
  b: Point,
  radius: number,
  polygon: Polygon,
  budget: TopologyBudget,
  path: string,
): boolean {
  if (
    polygonLocation(a, polygon, budget, path) === 'inside' ||
    polygonLocation(b, polygon, budget, path) === 'inside'
  )
    return true;
  for (const [c, d] of polygonEdges(polygon)) {
    budget.consume(path);
    if (segmentDistance(a, b, c, d) < radius - TOPOLOGY_EPSILON) return true;
  }
  return false;
}
export function capsuleContainedInPolygon(
  a: Point,
  b: Point,
  radius: number,
  polygon: Polygon,
  budget: TopologyBudget,
  path: string,
): boolean {
  if (
    polygonLocation(a, polygon, budget, path) !== 'inside' ||
    polygonLocation(b, polygon, budget, path) !== 'inside'
  )
    return false;
  for (const [c, d] of polygonEdges(polygon)) {
    budget.consume(path);
    if (segmentDistance(a, b, c, d) < radius - TOPOLOGY_EPSILON) return false;
  }
  return true;
}
export function localToWorld(point: Point, anchor: Point, clockwiseDegrees: number): Point {
  if (![...point, ...anchor, clockwiseDegrees].every(Number.isFinite))
    throw new RangeError('Transform arguments must be finite');
  const theta = (clockwiseDegrees * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  return [anchor[0] + c * point[0] - s * point[1], anchor[1] + s * point[0] + c * point[1]];
}
export function worldToLocal(point: Point, anchor: Point, clockwiseDegrees: number): Point {
  return localToWorld([point[0] - anchor[0], point[1] - anchor[1]], [0, 0], -clockwiseDegrees);
}
export function bearingDegrees(from: Point, to: Point): number {
  if (![...from, ...to].every(Number.isFinite))
    throw new RangeError('Bearing arguments must be finite');
  if (distance(from, to) <= TOPOLOGY_EPSILON)
    throw new RangeError('Bearing requires distinct points');
  return ((Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI + 360) % 360;
}
