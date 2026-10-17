import type { ViewBounds } from './viewport.js';

export type Position = readonly [number, number];
export interface PolygonShape {
  readonly outer: readonly Position[];
  readonly holes: readonly (readonly Position[])[];
}
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/** Preserve every supplied vertex, ring start, winding and hole; fill with evenodd. */
export function traceLine(sink: PathSink, points: readonly Position[]): void {
  points.forEach(([x, y], index) => (index === 0 ? sink.moveTo(x, y) : sink.lineTo(x, y)));
}
export function tracePolygon(sink: PathSink, polygon: PolygonShape): void {
  for (const ring of [polygon.outer, ...polygon.holes]) {
    traceLine(sink, ring);
    sink.closePath();
  }
}
/** Twice the signed area of a ring, whether or not it repeats its first vertex. */
function ringArea2(ring: readonly Position[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    area += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return area;
}
/**
 * Trace a polygon for a nonzero fill: the outer ring turning one way and every hole the other, whatever
 * winding the data has. Polygons traced this way into one path fill as their union, so pieces that
 * overlap do not cancel as they would under evenodd.
 */
export function traceUnionPolygon(sink: PathSink, polygon: PolygonShape): void {
  const ring = (points: readonly Position[], positive: boolean) => {
    traceLine(sink, ringArea2(points) >= 0 === positive ? points : [...points].reverse());
    sink.closePath();
  };
  ring(polygon.outer, true);
  for (const hole of polygon.holes) ring(hole, false);
}
export function geometryBounds(points: readonly Position[], margin = 0): ViewBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

function insideRing(ring: readonly Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Even-odd point test over a polygon's outer ring and holes. */
export function insidePolygon(polygon: PolygonShape, x: number, y: number): boolean {
  let inside = insideRing(polygon.outer, x, y);
  for (const hole of polygon.holes) if (insideRing(hole, x, y)) inside = !inside;
  return inside;
}

/**
 * `insidePolygon` for many points against one polygon: edges are bucketed into horizontal bands, so a
 * point is tested only against the edges that span its band.
 */
function bandedTest(polygon: PolygonShape, box: ViewBounds): (x: number, y: number) => boolean {
  const edges: [number, number, number, number][] = [];
  for (const ring of [polygon.outer, ...polygon.holes])
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      edges.push([ring[i]![0], ring[i]![1], ring[j]![0], ring[j]![1]]);
  const count = Math.max(1, Math.ceil(Math.sqrt(edges.length)));
  const height = (box.maxY - box.minY) / count || 1;
  const band = (y: number) => Math.min(count - 1, Math.max(0, Math.floor((y - box.minY) / height)));
  const bands: (typeof edges)[] = Array.from({ length: count }, () => []);
  for (const edge of edges)
    for (let k = band(Math.min(edge[1], edge[3])); k <= band(Math.max(edge[1], edge[3])); k++)
      bands[k]!.push(edge);
  return (x, y) => {
    let inside = false;
    for (const [xi, yi, xj, yj] of bands[band(y)]!)
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    return inside;
  };
}

export interface WeldedBoundary {
  /** The boundary facing outside the polygons' union, as polylines. */
  readonly shore: Position[][];
  /**
   * With a weld distance: a thin quadrilateral over each inner boundary piece, as wide on each side as
   * the distance its probe needed, so a union fill with them closes the gap between near neighbours.
   */
  readonly welds: Position[][];
}

/**
 * Split the polygons' boundaries into the part facing outside their union (the shore) and the part
 * between them. Edges are tested in pieces of at most `pieceM`: a piece is inner when points just off
 * it on both sides lie in some polygon, so an edge shared with a neighbouring polygon (water emitted as
 * adjoining strips or river reaches, say) is left out of the shore, and a partly shared edge keeps its
 * open part. With `weldM` the points are also tried further out, up to that distance, so neighbours
 * whose outlines were simplified apart, leaving a sliver gap or overlap, still count as one body.
 */
export function weldedBoundary(
  polygons: readonly PolygonShape[],
  { pieceM = 12.5, weldM = 0 }: { pieceM?: number; weldM?: number } = {},
): WeldedBoundary {
  const cell = 250;
  const boxes = polygons.map((p) => geometryBounds(p.outer));
  const tests = polygons.map((p, i) => bandedTest(p, boxes[i]!));
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let gx = Math.floor(b.minX / cell); gx <= Math.floor(b.maxX / cell); gx++)
      for (let gy = Math.floor(b.minY / cell); gy <= Math.floor(b.maxY / cell); gy++) {
        const key = `${gx}:${gy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
  });
  const inside = (x: number, y: number) =>
    (grid.get(`${Math.floor(x / cell)}:${Math.floor(y / cell)}`) ?? []).some((i) => {
      const b = boxes[i]!;
      return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && tests[i]!(x, y);
    });
  // Probe distances: a centimetre, then four times further each step up to the weld distance.
  const eps = 0.01;
  const probes = [eps];
  for (let d = 4 * eps; d < weldM; d *= 4) probes.push(d);
  if (weldM > eps) probes.push(weldM);
  // Whether another polygon's box comes within the widest probe of a box: if not, it is all shore.
  const reach = Math.max(eps, weldM);
  const near = (self: number, b: ViewBounds) => {
    for (
      let gx = Math.floor((b.minX - reach) / cell);
      gx <= Math.floor((b.maxX + reach) / cell);
      gx++
    )
      for (
        let gy = Math.floor((b.minY - reach) / cell);
        gy <= Math.floor((b.maxY + reach) / cell);
        gy++
      )
        for (const i of grid.get(`${gx}:${gy}`) ?? []) {
          const o = boxes[i]!;
          if (
            i !== self &&
            o.minX <= b.maxX + reach &&
            b.minX - reach <= o.maxX &&
            o.minY <= b.maxY + reach &&
            b.minY - reach <= o.maxY
          )
            return true;
        }
    return false;
  };
  const shore: Position[][] = [];
  const welds: Position[][] = [];
  for (const [index, polygon] of polygons.entries())
    for (const ring of [polygon.outer, ...polygon.holes]) {
      let line: Position[] | null = null;
      // Every edge, including the closing one when the ring does not repeat its first vertex.
      for (let k = 0; k < ring.length; k++) {
        const [ax, ay] = ring[k]!;
        const [bx, by] = ring[(k + 1) % ring.length]!;
        const length = Math.hypot(bx - ax, by - ay);
        if (!(length > 0)) continue;
        const nx = -(by - ay) / length;
        const ny = (bx - ax) / length;
        const at = (t: number): Position => [ax + (bx - ax) * t, ay + (by - ay) * t];
        // The narrowest probe that finds water on both sides of the edge at `t` (how wide its weld
        // must be), or undefined where the edge is shore there. The polygon's own side is wet at a
        // centimetre; the open side is then tried further out, and checked against the own side.
        const gapAt = (t: number) => {
          const [mx, my] = at(t);
          const wet = (side: number, d: number) => inside(mx + side * nx * d, my + side * ny * d);
          const plus = wet(1, eps);
          const minus = wet(-1, eps);
          if (plus === minus) return plus ? eps : undefined;
          const open = plus ? -1 : 1;
          return probes.find((d) => d > eps && wet(open, d) && wet(-open, d));
        };
        const alone = !near(index, geometryBounds([ring[k]!, ring[(k + 1) % ring.length]!]));
        const pieces = alone ? 1 : Math.max(1, Math.ceil(length / pieceM));
        const gaps = Array.from({ length: pieces }, (_, s) =>
          alone ? undefined : gapAt((s + 0.5) / pieces),
        );
        // Pieces meet at even steps, except where shore turns inner: that change is found by
        // bisection to a millimetre, so a partly shared edge's shore stops where its neighbour starts.
        const cuts = [0];
        for (let s = 1; s < pieces; s++) {
          const shoreBefore = gaps[s - 1] === undefined;
          if (shoreBefore === (gaps[s] === undefined)) {
            cuts.push(s / pieces);
            continue;
          }
          let lo = (s - 0.5) / pieces;
          let hi = (s + 0.5) / pieces;
          while ((hi - lo) * length > eps / 10) {
            const t = (lo + hi) / 2;
            if ((gapAt(t) === undefined) === shoreBefore) lo = t;
            else hi = t;
          }
          cuts.push((lo + hi) / 2);
        }
        cuts.push(1);
        for (let s = 0; s < pieces; s++) {
          const start = at(cuts[s]!);
          const end = at(cuts[s + 1]!);
          const gap = gaps[s];
          if (gap !== undefined) {
            line = null;
            if (weldM > 0)
              welds.push([
                [start[0] + nx * gap, start[1] + ny * gap],
                [end[0] + nx * gap, end[1] + ny * gap],
                [end[0] - nx * gap, end[1] - ny * gap],
                [start[0] - nx * gap, start[1] - ny * gap],
              ]);
            continue;
          }
          // Consecutive open pieces of one edge extend its last vertex rather than add one.
          if (line && s > 0) line[line.length - 1] = end;
          else {
            if (!line) shore.push((line = [start]));
            line.push(end);
          }
        }
      }
    }
  return { shore, welds };
}

/**
 * The parts of the polygons' boundaries that face outside their union, as polylines: the shore of
 * `weldedBoundary` with exactly adjoining edges only, so a shore line drawn along it follows the true
 * shore of water emitted as adjoining strips.
 */
export function outerBoundary(polygons: readonly PolygonShape[], pieceM = 12.5): Position[][] {
  return weldedBoundary(polygons, { pieceM }).shore;
}
