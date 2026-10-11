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
