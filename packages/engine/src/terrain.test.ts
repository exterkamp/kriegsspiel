import { describe, expect, it } from 'vitest';
import {
  featureAnchor,
  featuresAlong,
  featuresIn,
  mm,
  pointMm,
  profileAlong,
  segmentCost,
  segmentPassable,
  terrainAt,
  KIND_DEFAULTS,
  OPEN_GROUND,
  type FeatureGeometry,
  type FeatureKind,
  type Point,
  type TerrainFeature,
  type TerrainMap,
} from './index.js';

const P = (x: number, y: number): Point => pointMm(x, y);

function feature(
  id: string,
  kind: FeatureKind,
  geometry: FeatureGeometry,
  over: Partial<TerrainFeature> = {},
): TerrainFeature {
  const d = KIND_DEFAULTS[kind];
  return { id, kind, layer: d.layer, attrs: d.attrs, geometry, ...over };
}

const square = (id: string, kind: FeatureKind, x0: number, y0: number, x1: number, y1: number) =>
  feature(id, kind, { shape: 'polygon', points: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)] });

const line = (id: string, kind: FeatureKind, width: number, ...pts: Array<[number, number]>) =>
  feature(id, kind, { shape: 'polyline', points: pts.map(([x, y]) => P(x, y)), width: mm(width) });

const spot = (id: string, kind: FeatureKind, x: number, y: number, r: number) =>
  feature(id, kind, { shape: 'point', at: P(x, y), radius: mm(r) });

const map = (...features: TerrainFeature[]): TerrainMap => ({
  width: mm(1000),
  height: mm(1000),
  features,
});

describe('terrainAt', () => {
  const m = map(
    square('wood', 'wood', 100, 100, 300, 300),
    line('road', 'road', 20, [0, 200], [1000, 200]),
    line('river', 'river', 100, [0, 600], [1000, 600]),
    spot('bridge', 'bridge', 500, 600, 80),
  );

  it('is open ground where no feature lies', () => {
    expect(terrainAt(m, P(800, 800))).toEqual({ attrs: OPEN_GROUND, featureIds: [] });
  });

  it('reports the polygon, with the boundary and corners counting as inside', () => {
    expect(terrainAt(m, P(150, 150))!.featureIds).toEqual(['wood']);
    expect(terrainAt(m, P(100, 150))!.featureIds).toEqual(['wood']);
    expect(terrainAt(m, P(100, 100))!.featureIds).toEqual(['wood']);
    expect(terrainAt(m, P(99.999, 150))!.featureIds).toEqual([]);
  });

  it('lets the higher layer decide: a road runs through a wood, a bridge over a river', () => {
    const onRoad = terrainAt(m, P(200, 200))!;
    expect(onRoad.featureIds).toEqual(['road', 'wood']);
    expect(onRoad.attrs.moveCost).toBe(0.5);
    expect(terrainAt(m, P(300, 600))!.attrs.passable).toBe(false);
    const onBridge = terrainAt(m, P(500, 600))!;
    expect(onBridge.featureIds).toEqual(['bridge', 'river']);
    expect(onBridge.attrs.passable).toBe(true);
  });

  it('treats a polyline as a strip of its width, edges included', () => {
    expect(terrainAt(m, P(700, 210))!.featureIds).toEqual(['road']);
    expect(terrainAt(m, P(700, 210.001))!.featureIds).toEqual([]);
    expect(terrainAt(m, P(700, 550))!.featureIds).toEqual(['river']);
  });

  it('is undefined off the map and defined on its edge', () => {
    expect(terrainAt(m, P(-0.001, 5))).toBeUndefined();
    expect(terrainAt(m, P(1000.001, 5))).toBeUndefined();
    expect(terrainAt(m, P(1000, 1000))).toBeDefined();
  });

  it('breaks layer ties by id so the answer is stable', () => {
    const t = map(square('b', 'field', 0, 0, 10, 10), square('a', 'field', 0, 0, 10, 10));
    expect(terrainAt(t, P(5, 5))!.featureIds).toEqual(['a', 'b']);
  });
});

describe('featuresAlong', () => {
  const m = map(
    square('wood', 'wood', 100, 100, 300, 300),
    line('river', 'river', 100, [0, 600], [1000, 600]),
  );

  it('gives the span a segment spends in a polygon', () => {
    const s = featuresAlong(m, P(0, 200), P(400, 200));
    expect(s.map((x) => x.feature.id)).toEqual(['wood']);
    expect(s[0]!.t0).toBeCloseTo(0.25);
    expect(s[0]!.t1).toBeCloseTo(0.75);
  });

  it('gives a zero-length span where a segment only touches a corner', () => {
    const s = featuresAlong(m, P(0, 0), P(200, 200)); // passes the corner (100,100) then inside
    expect(s[0]!.t0).toBeCloseTo(0.5);
    const touch = featuresAlong(m, P(0, 100), P(100, 100)); // ends exactly on the corner
    expect(touch).toHaveLength(1);
    expect(touch[0]!.t0).toBe(1);
    expect(touch[0]!.t1).toBe(1);
  });

  it('follows a segment running along a polygon edge', () => {
    const s = featuresAlong(m, P(100, 0), P(100, 200));
    expect(s).toHaveLength(1);
    expect(s[0]!.t0).toBeCloseTo(0.5);
    expect(s[0]!.t1).toBe(1);
    const along = featuresAlong(m, P(100, 50), P(100, 350));
    expect(along[0]!.t0).toBeCloseTo(50 / 300);
    expect(along[0]!.t1).toBeCloseTo(250 / 300);
  });

  it('splits around a concave polygon', () => {
    const c = map(
      feature('u', 'wood', {
        shape: 'polygon',
        points: [
          P(0, 0),
          P(300, 0),
          P(300, 300),
          P(200, 300),
          P(200, 100),
          P(100, 100),
          P(100, 300),
          P(0, 300),
        ],
      }),
    );
    const s = featuresAlong(c, P(-50, 200), P(350, 200));
    expect(s).toHaveLength(2);
    expect(s[0]!.t1).toBeCloseTo(150 / 400);
    expect(s[1]!.t0).toBeCloseTo(250 / 400);
  });

  it('crosses a polyline strip, including at a slant and along its length', () => {
    const across = featuresAlong(m, P(500, 500), P(500, 700));
    expect(across[0]!.feature.id).toBe('river');
    expect(across[0]!.t0).toBeCloseTo(0.25);
    expect(across[0]!.t1).toBeCloseTo(0.75);
    const along = featuresAlong(m, P(100, 620), P(900, 620));
    expect(along[0]).toMatchObject({ t0: 0, t1: 1 });
    expect(featuresAlong(m, P(0, 500), P(1000, 500))).toEqual([]); // river edge is at y=550
  });

  it('joins the bends of a polyline and caps its ends with discs', () => {
    const bend = map(line('r', 'river', 20, [0, 500], [500, 500], [500, 1000]));
    const s = featuresAlong(bend, P(400, 400), P(600, 600)); // crosses the corner
    expect(s).toHaveLength(1);
    expect(s[0]!.t0).toBeLessThan(0.5);
    expect(s[0]!.t1).toBeGreaterThan(0.5);
    const cap = featuresAlong(bend, P(-15, 500), P(-5, 500));
    expect(cap).toHaveLength(1); // the round cap reaches 10 m past the end
    expect(featuresAlong(bend, P(-30, 500), P(-12, 500))).toEqual([]);
  });

  it('clips a segment to a point feature disc', () => {
    const b = map(spot('b', 'bridge', 500, 500, 50));
    const s = featuresAlong(b, P(400, 500), P(600, 500));
    expect(s[0]!.t0).toBeCloseTo(0.25);
    expect(s[0]!.t1).toBeCloseTo(0.75);
    expect(featuresAlong(b, P(400, 551), P(600, 551))).toEqual([]);
    expect(featuresAlong(b, P(400, 550), P(600, 550))).toHaveLength(1); // tangent
  });

  it('is empty when nothing is crossed, and handles a zero-length segment', () => {
    expect(featuresAlong(m, P(500, 100), P(900, 100))).toEqual([]);
    expect(featuresAlong(m, P(200, 200), P(200, 200)).map((s) => s.feature.id)).toEqual(['wood']);
    expect(featuresAlong(m, P(800, 800), P(800, 800))).toEqual([]);
  });
});

describe('profileAlong and cost', () => {
  const m = map(
    square('wood', 'wood', 100, 0, 200, 100),
    line('road', 'road', 20, [0, 50], [1000, 50]),
    line('river', 'river', 100, [0, 600], [1000, 600]),
  );

  it('cuts a segment into stretches resolved by layer', () => {
    const pieces = profileAlong(m, P(0, 50), P(300, 50));
    expect(pieces).toHaveLength(1); // the road covers all of it, over the wood
    expect(pieces[0]!.featureId).toBe('road');
    const cross = profileAlong(m, P(150, 0), P(150, 100));
    expect(cross.map((p) => p.attrs.moveCost)).toEqual([3, 0.5, 3]);
    expect(cross.reduce((s, p) => s + p.length, 0)).toBeCloseTo(mm(100));
  });

  it('weights length by the move-cost multiplier', () => {
    expect(segmentCost(m, P(0, 800), P(100, 800))).toBeCloseTo(mm(100));
    expect(segmentCost(m, P(0, 50), P(100, 50))).toBeCloseTo(mm(50));
    expect(segmentCost(m, P(150, 0), P(150, 100))).toBeCloseTo(mm(80) * 3 + mm(20) * 0.5);
  });

  it('blocks on impassable ground and off the map', () => {
    expect(segmentPassable(m, P(500, 500), P(500, 700))).toBe(false);
    expect(segmentPassable(m, P(500, 500), P(500, 540))).toBe(true);
    expect(segmentPassable(m, P(500, 900), P(500, 1100))).toBe(false);
  });
});

describe('featuresIn', () => {
  const m = map(
    square('wood', 'wood', 100, 100, 300, 300),
    line('river', 'river', 100, [0, 600], [1000, 600]),
    spot('bridge', 'bridge', 500, 600, 50),
    spot('farm', 'building', 800, 100, 10),
  );
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    P(x0, y0),
    P(x1, y0),
    P(x1, y1),
    P(x0, y1),
  ];

  it('finds features that overlap, highest layer first', () => {
    expect(featuresIn(m, box(400, 500, 600, 700)).map((f) => f.id)).toEqual(['bridge', 'river']);
  });

  it('finds a feature wholly inside, and a polygon wholly inside a feature', () => {
    expect(featuresIn(m, box(0, 0, 400, 400)).map((f) => f.id)).toEqual(['wood']);
    expect(featuresIn(m, box(150, 150, 250, 250)).map((f) => f.id)).toEqual(['wood']);
    expect(featuresIn(m, box(790, 90, 810, 110)).map((f) => f.id)).toEqual(['farm']);
    expect(featuresIn(m, box(10, 560, 20, 640)).map((f) => f.id)).toEqual(['river']);
  });

  it('counts touching edges and ignores near misses', () => {
    expect(featuresIn(m, box(300, 100, 400, 200)).map((f) => f.id)).toEqual(['wood']); // shared edge
    expect(featuresIn(m, box(300.001, 100, 400, 200))).toEqual([]);
    expect(featuresIn(m, box(0, 0, 100, 100)).map((f) => f.id)).toEqual(['wood']); // shared corner
    expect(featuresIn(m, box(0, 0, 50, 50))).toEqual([]);
  });

  it('accepts a triangle and rejects fewer than three points', () => {
    expect(featuresIn(m, [P(150, 50), P(250, 50), P(200, 150)]).map((f) => f.id)).toEqual(['wood']);
    expect(() => featuresIn(m, [P(0, 0), P(1, 1)])).toThrow(/at least 3/);
  });
});

describe('featureAnchor', () => {
  it('picks a representative point per shape', () => {
    expect(featureAnchor({ shape: 'point', at: P(5, 6), radius: 1 })).toEqual(P(5, 6));
    expect(
      featureAnchor({ shape: 'polygon', points: [P(0, 0), P(100, 0), P(100, 100), P(0, 100)] }),
    ).toEqual(P(50, 50));
    expect(featureAnchor({ shape: 'polyline', points: [P(0, 0), P(100, 0)], width: 1 })).toEqual(
      P(50, 0),
    );
  });

  it('stays inside a concave polygon whose centroid falls outside', () => {
    const g: FeatureGeometry = {
      shape: 'polygon',
      points: [P(0, 0), P(100, 0), P(100, 10), P(10, 10), P(10, 100), P(0, 100)],
    };
    const a = featureAnchor(g);
    expect(
      terrainAt(map({ ...square('x', 'wood', 0, 0, 1, 1), geometry: g }), a)!.featureIds,
    ).toEqual(['x']);
  });
});
