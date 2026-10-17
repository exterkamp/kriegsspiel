/**
 * The map's impassable ground as the turn umpire needs it (#535): where a unit's centre may not
 * stand, said plainly, rather than a river's centre line and width it must work out itself. In
 * the 11.12 playtest (#408) first replies put units in the river four times, mostly beside the
 * bridge, because the input gave only that line and the bridge's centre and radius.
 *
 * Each impassable feature is given in metres, as points `[x, y]`:
 * - a river (a polyline with a width): its two banks, named by the side they face ("north",
 *   "south", "west", "east"), with the water between them (a bank line is itself water);
 * - a polygon: its outline; a point feature: its centre and radius;
 * - and its `crossings`: the ground over it where a unit may stand (a bridge or a ford: a
 *   passable feature on a higher layer), each as a convex outline lying inside that ground.
 *
 * The engine's rule (`placement.ts`) is checked at a unit's centre (`terrainAt(...).passable`),
 * so these outlines are exactly what the validator and the march check test.
 */
import {
  metres,
  mm,
  terrainAt,
  type Point,
  type TerrainFeature,
  type TerrainMap,
} from '@kriegsspiel/engine';

/** At most this many corners per crossing outline: a disk's arc is cut to a few chords (inside it). */
export const CROSSING_MAX_POINTS = 8;

/** At most this many samples a side when finding a crossing (a 220 m bridge is sampled every 5 m). */
const SAMPLES_PER_SIDE = 60;

type XY = [number, number];

const m = (millimetres: number) => Math.round(metres(millimetres));
const xy = (p: Point): XY => [m(p.x), m(p.y)];

/** Which way a unit vector points, as a bank's name (y grows south). */
function facingName(nx: number, ny: number): string {
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? 'north' : 'south';
  return nx < 0 ? 'west' : 'east';
}

/** The polyline offset by `d` to its left (as drawn: x east, y south), mitred at each corner. */
function offsetLine(points: readonly Point[], d: number): Point[] {
  const normals = points.slice(1).map((b, i) => {
    const a = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  });
  return points.map((p, i) => {
    const before = normals[i - 1];
    const after = normals[i];
    if (!before || !after) {
      const n = (before ?? after)!;
      return { x: p.x + n.x * d, y: p.y + n.y * d };
    }
    // The mitre: along the mean normal, lengthened so the offset is `d` from both segments.
    const sx = before.x + after.x;
    const sy = before.y + after.y;
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return { x: p.x + after.x * d, y: p.y + after.y * d };
    const cos = len / 2;
    const k = d / Math.max(cos, 0.25);
    return { x: p.x + (sx / len) * k, y: p.y + (sy / len) * k };
  });
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of `points` (Andrew's monotone chain), counter-clockwise as drawn. */
function hull(points: Point[]): Point[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (ps.length < 3) return ps;
  const lower: Point[] = [];
  for (const p of ps) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of ps.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * `poly` (convex) cut to at most `max` corners by dropping, one at a time, the corner whose
 * triangle with its neighbours is smallest. Dropping a corner of a convex outline only shrinks it,
 * so the result stays inside the ground it outlines.
 */
function simplified(poly: Point[], max: number): Point[] {
  const out = [...poly];
  while (out.length > max) {
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const area = Math.abs(cross(a, b, c));
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    }
    out.splice(best, 1);
  }
  return out;
}

function bounds(f: TerrainFeature): { x0: number; y0: number; x1: number; y1: number } {
  const g = f.geometry;
  if (g.shape === 'point') {
    return {
      x0: g.at.x - g.radius,
      y0: g.at.y - g.radius,
      x1: g.at.x + g.radius,
      y1: g.at.y + g.radius,
    };
  }
  const pad = g.shape === 'polyline' ? g.width / 2 : 0;
  const xs = g.points.map((p) => p.x);
  const ys = g.points.map((p) => p.y);
  return {
    x0: Math.min(...xs) - pad,
    y0: Math.min(...ys) - pad,
    x1: Math.max(...xs) + pad,
    y1: Math.max(...ys) + pad,
  };
}

/**
 * Where a unit may stand over `water`: for each passable feature on a higher layer whose ground
 * meets it, the outline of the points over `water` that `terrainAt` finds passable (sampled, then
 * hulled and cut to `CROSSING_MAX_POINTS` corners, rounded inward to whole metres).
 */
function crossingsOver(map: TerrainMap, water: TerrainFeature) {
  const out: { id: string; name?: string; kind: string; area: XY[] }[] = [];
  for (const f of map.features) {
    if (f.layer <= water.layer || f.attrs.passable !== true) continue;
    const b = bounds(f);
    const step = Math.max(mm(5), Math.max(b.x1 - b.x0, b.y1 - b.y0) / SAMPLES_PER_SIDE);
    const inside: Point[] = [];
    for (let x = b.x0; x <= b.x1; x += step) {
      for (let y = b.y0; y <= b.y1; y += step) {
        const p = { x: Math.round(x), y: Math.round(y) };
        const t = terrainAt(map, p);
        if (
          t &&
          t.attrs.passable === true &&
          t.featureIds.includes(water.id) &&
          t.featureIds.includes(f.id)
        ) {
          inside.push(p);
        }
      }
    }
    if (inside.length < 3) continue;
    const outline = simplified(hull(inside), CROSSING_MAX_POINTS);
    // Round each corner toward the outline's middle, so a rounded corner is still on the crossing.
    const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length;
    const cy = outline.reduce((s, p) => s + p.y, 0) / outline.length;
    const toward = (v: number, c: number) => (v > c ? Math.floor(metres(v)) : Math.ceil(metres(v)));
    out.push({
      id: f.id,
      ...(f.name ? { name: f.name } : {}),
      kind: f.kind,
      area: outline.map((p): XY => [toward(p.x, cx), toward(p.y, cy)]),
    });
  }
  return out;
}

/** The map's impassable ground in the umpire's input (#535); see the module comment. */
export function impassableInput(map: TerrainMap) {
  return map.features
    .filter((f) => f.attrs.passable !== true)
    .map((f) => {
      const g = f.geometry;
      const head = { id: f.id, ...(f.name ? { name: f.name } : {}), kind: f.kind };
      const crossings = crossingsOver(map, f);
      const over = crossings.length > 0 ? { crossings } : {};
      if (g.shape === 'polyline' && g.points.length >= 2) {
        const a = g.points[0]!;
        const b = g.points[1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const left = facingName((b.y - a.y) / len, -(b.x - a.x) / len);
        const right = facingName(-(b.y - a.y) / len, (b.x - a.x) / len);
        return {
          ...head,
          banks: {
            [left]: offsetLine(g.points, g.width / 2).map(xy),
            [right]: offsetLine(g.points, -g.width / 2).map(xy),
          },
          ...over,
        };
      }
      if (g.shape === 'polygon') return { ...head, area: g.points.map(xy), ...over };
      const at = g.shape === 'point' ? g.at : g.points[0]!;
      const radius = g.shape === 'point' ? g.radius : g.width / 2;
      return { ...head, centre: xy(at), radiusM: m(radius), ...over };
    });
}
