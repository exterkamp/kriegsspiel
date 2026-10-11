import {
  distPointSegment,
  distance,
  pointInPolygon,
  polygonCentroid,
  polygonIntersectsCircle,
  polygonIntersectsPolyline,
  polygonsIntersect,
  segmentCircleInterval,
  segmentPolygonIntervals,
  segmentPolylineIntervals,
  type Interval,
} from './geometry.js';
import type {
  FeatureGeometry,
  FeatureKind,
  Point,
  RoadClass,
  TerrainAttrs,
  TerrainFeature,
  TerrainMap,
} from './types.js';

/** Ground with no feature on it. */
export const OPEN_GROUND: TerrainAttrs = {
  moveCost: 1,
  cover: 0,
  concealment: 0,
  height: 'flat',
  passable: true,
};

/** A feature this concealing (a wood, a building) blocks sight through it. */
export const BLOCKS_SIGHT = 1;

/**
 * Defaults per feature kind. Where features overlap the higher layer wins: woods and marsh
 * under roads under rivers under bridges, so a road runs through a wood, a river cuts a
 * road, and a bridge carries it across.
 */
export const KIND_DEFAULTS: Record<FeatureKind, { layer: number; attrs: TerrainAttrs }> = {
  field: { layer: 0, attrs: { ...OPEN_GROUND, moveCost: 1.5 } },
  wood: {
    layer: 1,
    attrs: { moveCost: 3, cover: 0.5, concealment: 1, height: 'flat', passable: true },
  },
  marsh: {
    layer: 1,
    attrs: { moveCost: 4, cover: 0, concealment: 0.2, height: 'low', passable: true },
  },
  water: {
    layer: 3,
    attrs: { moveCost: 1, cover: 0, concealment: 0, height: 'low', passable: false },
  },
  road: { layer: 2, attrs: { ...OPEN_GROUND, moveCost: 0.5 } },
  river: {
    layer: 3,
    attrs: { moveCost: 1, cover: 0, concealment: 0, height: 'low', passable: false },
  },
  stream: {
    layer: 3,
    attrs: { moveCost: 2, cover: 0, concealment: 0, height: 'low', passable: true },
  },
  bridge: { layer: 4, attrs: { ...OPEN_GROUND, height: 'flat' } },
  ford: { layer: 4, attrs: { ...OPEN_GROUND, moveCost: 3, height: 'low' } },
  building: {
    layer: 2,
    attrs: { moveCost: 2, cover: 0.8, concealment: 1, height: 'flat', passable: true },
  },
};

/** March-cost multiplier per road class; a plain `road` feature is class `road`. */
export const ROAD_CLASS_COST: Record<RoadClass, number> = { highway: 0.4, road: 0.5, track: 0.8 };

/** What lies at a point: the ground that applies there and the features covering it. */
export interface TerrainSample {
  attrs: TerrainAttrs;
  /** Ids of the features covering the point, highest layer first. */
  featureIds: string[];
}

/** A feature and the part of a segment it covers. */
export interface FeatureSpan {
  feature: TerrainFeature;
  t0: number;
  t1: number;
}

/** A stretch of a segment with one ground type, resolved by layer. */
export interface ProfilePiece {
  t0: number;
  t1: number;
  /** Length of the stretch, in mm. */
  length: number;
  attrs: TerrainAttrs;
  /** The feature deciding the ground here (the top layer); undefined for open ground. */
  featureId?: string;
}

function byLayer(a: TerrainFeature, b: TerrainFeature): number {
  return b.layer - a.layer || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function covers(f: TerrainFeature, p: Point): boolean {
  const g = f.geometry;
  switch (g.shape) {
    case 'polygon':
      return pointInPolygon(p, g.points);
    case 'point':
      return distance(p, g.at) <= g.radius;
    case 'polyline': {
      const half = g.width / 2;
      for (let i = 1; i < g.points.length; i++) {
        if (distPointSegment(p, g.points[i - 1] as Point, g.points[i] as Point) <= half)
          return true;
      }
      return g.points.length === 1 && distance(p, g.points[0] as Point) <= half;
    }
  }
}

function inBounds(map: TerrainMap, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= map.width && p.y <= map.height;
}

/** The ground at `p`, or undefined if `p` is off the map. */
export function terrainAt(map: TerrainMap, p: Point): TerrainSample | undefined {
  if (!inBounds(map, p)) return undefined;
  const hit = map.features.filter((f) => covers(f, p)).sort(byLayer);
  const top = hit[0];
  return { attrs: top ? top.attrs : OPEN_GROUND, featureIds: hit.map((f) => f.id) };
}

function spans(f: TerrainFeature, a: Point, b: Point): Interval[] {
  const g = f.geometry;
  switch (g.shape) {
    case 'polygon':
      return segmentPolygonIntervals(a, b, g.points);
    case 'polyline':
      return g.points.length === 1
        ? maybe(segmentCircleInterval(a, b, g.points[0] as Point, g.width / 2))
        : segmentPolylineIntervals(a, b, g.points, g.width / 2);
    case 'point':
      return maybe(segmentCircleInterval(a, b, g.at, g.radius));
  }
}

function maybe(iv: Interval | null): Interval[] {
  return iv ? [iv] : [];
}

/**
 * Every feature the segment `a`-`b` passes through, with the parameter range it covers
 * (0 at `a`, 1 at `b`). Ordered by start, then layer. Touching a boundary counts, as a
 * zero-length span. This is raw geometry; `profileAlong` resolves overlaps by layer.
 */
export function featuresAlong(map: TerrainMap, a: Point, b: Point): FeatureSpan[] {
  const out: FeatureSpan[] = [];
  for (const feature of [...map.features].sort(byLayer)) {
    for (const iv of spans(feature, a, b)) out.push({ feature, t0: iv.t0, t1: iv.t1 });
  }
  return out.sort((p, q) => p.t0 - q.t0 || byLayer(p.feature, q.feature));
}

/**
 * The segment cut into stretches of one ground type each, with overlaps resolved by layer.
 * Stretches have positive length and cover the whole segment; a segment off the map is
 * reported as impassable ground there.
 */
export function profileAlong(map: TerrainMap, a: Point, b: Point): ProfilePiece[] {
  const total = distance(a, b);
  const cuts = new Set<number>([0, 1]);
  for (const s of featuresAlong(map, a, b)) {
    cuts.add(s.t0);
    cuts.add(s.t1);
  }
  // Also cut where the segment crosses the map edge, so stretches off the map are their own.
  for (const [from, to, limit] of [
    [a.x, b.x, 0],
    [a.x, b.x, map.width],
    [a.y, b.y, 0],
    [a.y, b.y, map.height],
  ] as const) {
    const t = (limit - from) / (to - from);
    if (to !== from && t > 0 && t < 1) cuts.add(t);
  }
  const ts = [...cuts].sort((p, q) => p - q);
  const out: ProfilePiece[] = [];
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1] as number;
    const t1 = ts[i] as number;
    if (t1 <= t0) continue;
    const mid = { x: a.x + (b.x - a.x) * ((t0 + t1) / 2), y: a.y + (b.y - a.y) * ((t0 + t1) / 2) };
    const sample = terrainAt(map, mid);
    const attrs = sample ? sample.attrs : { ...OPEN_GROUND, passable: false };
    const featureId = sample?.featureIds[0];
    const last = out[out.length - 1];
    if (last && last.attrs === attrs && last.featureId === featureId) {
      last.t1 = t1;
      last.length = (t1 - last.t0) * total;
    } else {
      out.push({ t0, t1, length: (t1 - t0) * total, attrs, ...(featureId ? { featureId } : {}) });
    }
  }
  return out;
}

/** Whether the segment keeps to passable ground the whole way. */
export function segmentPassable(map: TerrainMap, a: Point, b: Point): boolean {
  return profileAlong(map, a, b).every((p) => p.attrs.passable);
}

/** March cost of the segment: its length in mm times the move-cost multiplier of the ground. */
export function segmentCost(map: TerrainMap, a: Point, b: Point): number {
  let cost = 0;
  for (const p of profileAlong(map, a, b)) cost += p.length * p.attrs.moveCost;
  return cost;
}

function intersects(f: TerrainFeature, poly: readonly Point[]): boolean {
  const g = f.geometry;
  switch (g.shape) {
    case 'polygon':
      return polygonsIntersect(g.points, poly);
    case 'point':
      return polygonIntersectsCircle(poly, g.at, g.radius);
    case 'polyline':
      return polygonIntersectsPolyline(poly, g.points, g.width / 2);
  }
}

/** Every feature that overlaps or touches `polygon`, highest layer first. */
export function featuresIn(map: TerrainMap, polygon: readonly Point[]): TerrainFeature[] {
  if (polygon.length < 3) throw new Error('featuresIn needs a polygon of at least 3 points');
  return map.features.filter((f) => intersects(f, polygon)).sort(byLayer);
}

/** A representative point of a feature: polygon centroid, polyline midpoint, or the point. */
export function featureAnchor(g: FeatureGeometry): Point {
  if (g.shape === 'point') return { ...g.at };
  if (g.shape === 'polygon') {
    const c = polygonCentroid(g.points);
    // A concave polygon's centroid may fall outside it; fall back to the nearest vertex.
    if (pointInPolygon(c, g.points)) return { x: Math.round(c.x), y: Math.round(c.y) };
    let best = g.points[0] as Point;
    for (const p of g.points) if (distance(p, c) < distance(best, c)) best = p;
    return { ...best };
  }
  const total = g.points.reduce(
    (s, p, i) => (i === 0 ? 0 : s + distance(g.points[i - 1] as Point, p)),
    0,
  );
  let left = total / 2;
  for (let i = 1; i < g.points.length; i++) {
    const a = g.points[i - 1] as Point;
    const b = g.points[i] as Point;
    const len = distance(a, b);
    if (left <= len && len > 0) {
      const t = left / len;
      return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) };
    }
    left -= len;
  }
  return { ...(g.points[0] as Point) };
}
