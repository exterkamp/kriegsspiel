import { distPointSegment, distance, pointInPolygon } from './geometry.js';
import type { FeatureKind, Point, TerrainFeature, TerrainMap } from './types.js';

/** A named landmark this close (500 m) is "near" it. */
const NEAR_MM = 500_000;
/** A named road or water course this close (300 m) anchors a "east of the road" clause. */
const LINE_NEAR_MM = 300_000;

const LANDMARKS: readonly FeatureKind[] = ['building', 'bridge', 'ford', 'wood', 'marsh', 'water'];
const LINES: readonly FeatureKind[] = ['road', 'river', 'stream'];

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Distance from `p` to the edge of the feature (0 inside it), and the nearest point on it. */
function reach(f: TerrainFeature, p: Point): { dist: number; nearest: Point } {
  const g = f.geometry;
  if (g.shape === 'point') {
    return { dist: Math.max(0, distance(p, g.at) - g.radius), nearest: g.at };
  }
  const closed = g.shape === 'polygon';
  const pts = g.points;
  let best = { dist: Infinity, nearest: pts[0] as Point };
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % pts.length] as Point;
    const q = nearestOnSegment(p, a, b);
    const d = distPointSegment(p, a, b);
    if (d < best.dist) best = { dist: d, nearest: q };
  }
  if (g.shape === 'polygon') {
    return pointInPolygon(p, pts) ? { dist: 0, nearest: p } : best;
  }
  return { dist: Math.max(0, best.dist - g.width / 2), nearest: best.nearest };
}

/** "the mill", "the Northern wood": a feature name as it reads mid-sentence. */
function article(name: string): string {
  return /^the\s/i.test(name) ? `the ${name.slice(4)}` : `the ${name}`;
}

/** Which side of `from` the point `p` lies on, by the dominant compass axis (x east, y south). */
function side(p: Point, from: Point): 'north' | 'south' | 'east' | 'west' {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/** Eight-point compass word for the direction from `from` to `p`. */
function compass(p: Point, from: Point): string {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const names = [
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
    'north',
    'north-east',
  ];
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return names[((octant % 8) + 8) % 8] as string;
}

function byDistance<T extends { f: TerrainFeature; dist: number }>(list: T[]): T | undefined {
  return [...list].sort((a, b) => a.dist - b.dist || (a.f.id < b.f.id ? -1 : 1))[0];
}

/**
 * A plain-language place for a point, from the named features near it, for example "near the
 * mill, east of the road". Pure and deterministic. Only features with a name are used.
 */
export function describePlace(map: TerrainMap, p: Point): string {
  const named = map.features.filter((f) => f.name).map((f) => ({ f, ...reach(f, p) }));
  const landmark = byDistance(named.filter((c) => LANDMARKS.includes(c.f.kind)));
  const line = byDistance(named.filter((c) => LINES.includes(c.f.kind) && c.dist <= LINE_NEAR_MM));
  const lineClause =
    line && line.dist === 0
      ? `on ${article(line.f.name as string)}`
      : line
        ? `${side(p, line.nearest)} of ${article(line.f.name as string)}`
        : '';
  let main: string;
  if (
    landmark &&
    landmark.dist === 0 &&
    landmark.f.kind !== 'bridge' &&
    landmark.f.kind !== 'ford'
  ) {
    main = `in ${article(landmark.f.name as string)}`;
  } else if (landmark && landmark.dist <= NEAR_MM) {
    main = `${landmark.dist === 0 ? 'at' : 'near'} ${article(landmark.f.name as string)}`;
  } else {
    const any = byDistance(named);
    if (!any) return 'in open country';
    if (!lineClause) {
      const away = Math.max(100, Math.round(any.dist / 100_000) * 100);
      return `${away} m ${compass(p, any.nearest)} of ${article(any.f.name as string)}`;
    }
    return lineClause;
  }
  return lineClause ? `${main}, ${lineClause}` : main;
}
