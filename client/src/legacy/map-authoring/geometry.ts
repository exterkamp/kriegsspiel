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
 * The parts of the polygons' boundaries that face outside their union, as polylines. An edge shared
 * with a neighbouring polygon (water emitted as adjoining strips, say) is interior and left out, so a
 * shore line drawn along the result follows only the true shore. Edges are tested in pieces of at most
 * `pieceM`, so a partly shared edge keeps its open part.
 */
export function outerBoundary(polygons: readonly PolygonShape[], pieceM = 12.5): Position[][] {
  const cell = 250;
  const boxes = polygons.map((p) => geometryBounds(p.outer));
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
      return (
        x >= b.minX &&
        x <= b.maxX &&
        y >= b.minY &&
        y <= b.maxY &&
        insidePolygon(polygons[i]!, x, y)
      );
    });
  const eps = 0.01;
  const lines: Position[][] = [];
  for (const polygon of polygons)
    for (const ring of [polygon.outer, ...polygon.holes]) {
      let line: Position[] | null = null;
      // Every edge, including the closing one when the ring does not repeat its first vertex.
      for (let k = 0; k < ring.length; k++) {
        const [ax, ay] = ring[k]!;
        const [bx, by] = ring[(k + 1) % ring.length]!;
        const length = Math.hypot(bx - ax, by - ay);
        if (!(length > 0)) continue;
        const nx = (-(by - ay) / length) * eps;
        const ny = ((bx - ax) / length) * eps;
        const pieces = Math.max(1, Math.ceil(length / pieceM));
        for (let s = 0; s < pieces; s++) {
          const t0 = s / pieces;
          const t1 = (s + 1) / pieces;
          const mx = ax + (bx - ax) * ((t0 + t1) / 2);
          const my = ay + (by - ay) * ((t0 + t1) / 2);
          if (inside(mx + nx, my + ny) && inside(mx - nx, my - ny)) {
            line = null;
            continue;
          }
          const end: Position = [ax + (bx - ax) * t1, ay + (by - ay) * t1];
          // Consecutive open pieces of one edge extend its last vertex rather than add one.
          if (line && s > 0) line[line.length - 1] = end;
          else {
            if (!line) lines.push((line = [[ax + (bx - ax) * t0, ay + (by - ay) * t0]]));
            line.push(end);
          }
        }
      }
    }
  return lines;
}
