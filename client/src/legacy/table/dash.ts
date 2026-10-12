import type { Coord } from './types';

/**
 * Cuts a polyline into dashes `dash` long with `gap` between them, measured along the line (units are the caller's).
 * Each dash is a short polyline of its own, so a dotted route can be drawn as many small strips or SVG segments.
 * The line always starts with a dash; a dash that runs round a corner keeps the corner.
 */
export function dashPolyline(points: readonly Coord[], dash: number, gap: number): Coord[][] {
  const out: Coord[][] = [];
  if (points.length < 2 || dash <= 0) return out;
  let cur: Coord[] = [points[0]!];
  let drawing = true;
  let left = dash;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1]!;
    const b = points[i]!;
    let len = Math.hypot(b.x - a.x, b.y - a.y);
    while (len > left) {
      const t = left / len;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (drawing) {
        cur.push(p);
        out.push(cur);
        cur = [];
      } else {
        cur = [p];
      }
      drawing = !drawing;
      len -= left;
      left = drawing ? dash : gap;
      a = p;
    }
    left -= len;
    if (drawing) cur.push(b);
  }
  if (drawing && cur.length > 1) out.push(cur);
  return out;
}
