import { distPointSegment, distance, pointInPolygon } from './geometry.js';
import { profileAlong, terrainAt } from './terrain.js';
import type { Point, TerrainFeature, TerrainMap } from './types.js';

/**
 * Route planning over continuous space (docs/decisions.md D15, D16). The planner is a
 * visibility graph built per query and private to this file: its nodes are free points
 * placed just outside the corners of woods, marsh and water, around the ends and bends of
 * rivers, along roads and on bridges and fords, plus the start and goal. Two nodes are
 * joined when the straight line between them stays on passable ground (and, for a wide
 * unit, only crosses bridges and fords wide enough for it); the edge costs what the ground
 * along it costs. Routes are therefore lists of free points joined by straight legs at any
 * angle. No cell, lattice or adjacency rule appears in the model.
 */

/** A route as free points, `from` first and `to` last, and its cost in mm weighted by ground. */
export interface Path {
  waypoints: Point[];
  cost: number;
}

export interface RouteOptions {
  /**
   * Width in mm of the unit's marching column (its frontage). A leg over a bridge or ford
   * that spans impassable ground and is too narrow to carry it is not usable. Omit for a
   * courier or a lone rider.
   */
  width?: number;
}

/** How far outside a corner a waypoint is placed, so the legs either side clear it. */
const MARGIN_MM = 1_500;
/** Features a wide unit has to squeeze over. */
const CROSSING_KINDS: ReadonlySet<string> = new Set(['bridge', 'ford']);

/**
 * How wide a unit the crossing `f` carries: its own width, or infinity if it is no bottleneck.
 * A bridge or ford is a bottleneck only where it spans ground that cannot be walked, so it is
 * checked for impassable ground just beyond its edge; a bridge over open ground constrains
 * nobody.
 */
function carries(map: TerrainMap, f: TerrainFeature): number {
  if (f.capacity !== undefined) return f.capacity;
  const g = f.geometry;
  const centres = g.shape === 'point' ? [g.at] : g.shape === 'polyline' ? g.points : [];
  const radius = g.shape === 'point' ? g.radius : g.shape === 'polyline' ? g.width / 2 : 0;
  const spans = centres.some((c) =>
    ring(c, radius + MARGIN_MM).some((p) => terrainAt(map, p)?.attrs.passable === false),
  );
  return spans ? radius * 2 : Infinity;
}

/**
 * Cost in mm-weighted ground of the straight leg `a`-`b`, or null if it leaves passable
 * ground or squeezes a unit `width` mm across over a bridge or ford too narrow for it.
 */
export function legCost(map: TerrainMap, a: Point, b: Point, width = 0): number | null {
  let cost = 0;
  for (const piece of profileAlong(map, a, b)) {
    if (!piece.attrs.passable) return null;
    if (width > 0 && piece.featureId !== undefined) {
      const f = map.features.find((x) => x.id === piece.featureId);
      if (f && CROSSING_KINDS.has(f.kind) && carries(map, f) < width) return null;
    }
    cost += piece.length * piece.attrs.moveCost;
  }
  return cost;
}

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

function add(p: Point, v: Point, k: number): Point {
  return { x: p.x + v.x * k, y: p.y + v.y * k };
}

/** Waypoints just outside each corner of a polygon, whether the corner is convex or reflex. */
function polygonCorners(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i] as Point;
    const a = unit(
      (pts[(i + pts.length - 1) % pts.length] as Point).x - v.x,
      (pts[(i + pts.length - 1) % pts.length] as Point).y - v.y,
    );
    const c = unit(
      (pts[(i + 1) % pts.length] as Point).x - v.x,
      (pts[(i + 1) % pts.length] as Point).y - v.y,
    );
    let bis = unit(a.x + c.x, a.y + c.y);
    if (bis.x === 0 && bis.y === 0) bis = { x: -a.y, y: a.x };
    const outward = add(v, bis, -MARGIN_MM);
    const other = add(v, bis, MARGIN_MM);
    if (!pointInPolygon(outward, pts)) out.push(outward);
    else if (!pointInPolygon(other, pts)) out.push(other);
  }
  return out;
}

/** Waypoints either side of each vertex of a thick line, and round its two ends. */
function lineFlanks(pts: readonly Point[], width: number): Point[] {
  const out: Point[] = [];
  const r = width / 2 + MARGIN_MM;
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i] as Point;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const t = unit((next ?? v).x - (prev ?? v).x, (next ?? v).y - (prev ?? v).y);
    const n = { x: -t.y, y: t.x };
    // A sharp bend needs the flank pushed out so it still clears the inside of the bend.
    const d = next ? unit(next.x - v.x, next.y - v.y) : t;
    const k = prev && next ? Math.min(3, 1 / Math.max(0.35, Math.abs(d.x * t.x + d.y * t.y))) : 1;
    out.push(add(v, n, r * k), add(v, n, -r * k));
    if (!prev || !next) {
      const end = add(v, t, prev ? r : -r);
      out.push(add(end, n, r), add(end, n, -r));
    }
  }
  return out;
}

/** Closest point of a polyline to `p`. */
function nearestOn(pts: readonly Point[], p: Point): Point {
  let best = pts[0] as Point;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const d = distPointSegment(p, a, b);
    if (d < bestD) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = { x: a.x + dx * t, y: a.y + dy * t };
      bestD = d;
    }
  }
  return best;
}

function ring(at: Point, r: number): Point[] {
  const out: Point[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    out.push({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r });
  }
  return out;
}

/** Candidate waypoints for a query. Order is fixed by the map, so routes are deterministic. */
function candidates(map: TerrainMap, from: Point, to: Point): Point[] {
  const out: Point[] = [];
  for (const f of map.features) {
    const g = f.geometry;
    // Cheaper than open ground: hug it. Dearer or blocked: go round it.
    const hug = f.attrs.passable && f.attrs.moveCost < 1;
    if (g.shape === 'polygon') {
      if (hug) out.push(...g.points);
      else out.push(...polygonCorners(g.points));
    } else if (g.shape === 'polyline') {
      if (hug) {
        out.push(...g.points, nearestOn(g.points, from), nearestOn(g.points, to));
      } else if (!f.attrs.passable) {
        out.push(...lineFlanks(g.points, g.width));
      }
    } else if (f.attrs.passable) {
      out.push(g.at, ...ring(g.at, g.radius * 0.9));
    } else {
      out.push(...ring(g.at, g.radius + MARGIN_MM));
    }
  }
  return out;
}

/**
 * Plan a route from `from` to `to` over passable ground, preferring cheap ground (roads) over
 * short ground (woods) and honouring `opts.width`. Deterministic: ties on f are broken by
 * smaller h, then by node index. Returns null if either end is impassable or off the map,
 * or no route exists.
 */
export function findPath(
  map: TerrainMap,
  from: Point,
  to: Point,
  opts: RouteOptions = {},
): Path | null {
  const ok = (p: Point) => terrainAt(map, p)?.attrs.passable === true;
  if (!ok(from) || !ok(to)) return null;
  if (from.x === to.x && from.y === to.y) return { waypoints: [{ ...from }], cost: 0 };

  const width = opts.width ?? 0;
  const nodes: Point[] = [{ ...from }, { ...to }];
  const seen = new Set<string>([`${from.x},${from.y}`, `${to.x},${to.y}`]);
  for (const c of candidates(map, from, to)) {
    const p = { x: Math.round(c.x), y: Math.round(c.y) };
    const key = `${p.x},${p.y}`;
    if (seen.has(key) || !ok(p)) continue;
    seen.add(key);
    nodes.push(p);
  }

  const edges = new Map<number, number | null>();
  const edge = (i: number, j: number): number | null => {
    const key = i < j ? i * nodes.length + j : j * nodes.length + i;
    let v = edges.get(key);
    if (v === undefined) {
      v = legCost(map, nodes[i] as Point, nodes[j] as Point, width);
      edges.set(key, v);
    }
    return v;
  };

  const minCost = Math.min(
    1,
    ...map.features.filter((f) => f.attrs.passable).map((f) => f.attrs.moveCost),
  );
  const h = (n: number) => distance(nodes[n] as Point, to) * minCost;
  const g = new Map<number, number>([[0, 0]]);
  const prev = new Map<number, number>();
  const closed = new Set<number>();
  const open: Array<{ f: number; h: number; n: number }> = [{ f: h(0), h: h(0), n: 0 }];
  const less = (a: (typeof open)[number], b: (typeof open)[number]) =>
    a.f - b.f || a.h - b.h || a.n - b.n;

  while (open.length > 0) {
    // Pop the minimum (graphs are small, so a scan beats a heap for clarity).
    let best = 0;
    for (let k = 1; k < open.length; k++) if (less(open[k]!, open[best]!) < 0) best = k;
    const cur = open.splice(best, 1)[0]!;
    if (closed.has(cur.n)) continue;
    closed.add(cur.n);
    if (cur.n === 1) {
      const chain: number[] = [];
      for (let n: number | undefined = 1; n !== undefined; n = prev.get(n)) chain.push(n);
      return {
        waypoints: chain.reverse().map((n) => ({ ...(nodes[n] as Point) })),
        cost: g.get(1)!,
      };
    }
    for (let m = 0; m < nodes.length; m++) {
      if (m === cur.n || closed.has(m)) continue;
      const c = edge(cur.n, m);
      if (c === null) continue;
      const ng = g.get(cur.n)! + c;
      if (ng < (g.get(m) ?? Infinity)) {
        g.set(m, ng);
        prev.set(m, cur.n);
        open.push({ f: ng + h(m), h: h(m), n: m });
      }
    }
  }
  return null;
}
