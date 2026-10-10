import { describe, expect, it } from 'vitest';
import {
  convexOverlap,
  distSegmentSegment,
  footprintCorners,
  footprintsOverlap,
  metres,
  mm,
  pointInPolygon,
  polygonCentroid,
  polygonsIntersect,
  segmentCircleInterval,
  segmentsIntersect,
  toWorld,
  type Point,
} from './index.js';

const p = (x: number, y: number): Point => ({ x, y });
const box = (x0: number, y0: number, x1: number, y1: number) => [
  p(x0, y0),
  p(x1, y0),
  p(x1, y1),
  p(x0, y1),
];

describe('quantisation', () => {
  it('rounds metres to whole millimetres and back exactly', () => {
    expect(mm(1.2344)).toBe(1234);
    expect(mm(1.2346)).toBe(1235);
    expect(mm(-0.0004)).toBe(-0);
    expect(metres(mm(1234.567))).toBe(1234.567);
  });
});

describe('segments and polygons', () => {
  it('detects crossing, touching and collinear overlap, and rejects near misses', () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(10, 10))).toBe(true); // endpoints meet
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true); // collinear overlap
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(11, 0), p(15, 0))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBe(false);
  });

  it('measures the gap between segments', () => {
    expect(distSegmentSegment(p(0, 0), p(10, 0), p(0, 3), p(10, 3))).toBe(3);
    expect(distSegmentSegment(p(0, 0), p(10, 0), p(13, 4), p(20, 4))).toBe(5);
    expect(distSegmentSegment(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(0);
  });

  it('puts boundary points inside a polygon', () => {
    const sq = box(0, 0, 10, 10);
    for (const q of [p(5, 5), p(0, 5), p(10, 10), p(0, 0)])
      expect(pointInPolygon(q, sq)).toBe(true);
    for (const q of [p(-0.1, 5), p(5, 10.1), p(11, 11)]) expect(pointInPolygon(q, sq)).toBe(false);
  });

  it('intersects polygons that cross, nest or touch, not ones apart', () => {
    expect(polygonsIntersect(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(polygonsIntersect(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBe(true);
    expect(polygonsIntersect(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(true);
    expect(polygonsIntersect(box(0, 0, 10, 10), box(10.5, 0, 20, 10))).toBe(false);
  });

  it('clips a segment to a circle, including a miss and a segment inside it', () => {
    expect(segmentCircleInterval(p(0, 0), p(10, 0), p(5, 0), 2)).toEqual({ t0: 0.3, t1: 0.7 });
    expect(segmentCircleInterval(p(0, 0), p(10, 0), p(5, 3), 2)).toBeNull();
    expect(segmentCircleInterval(p(4, 0), p(6, 0), p(5, 0), 2)).toEqual({ t0: 0, t1: 1 });
  });

  it('finds the centroid of a polygon by area', () => {
    expect(polygonCentroid(box(0, 0, 10, 4))).toEqual(p(5, 2));
    expect(polygonCentroid([p(0, 0), p(6, 0), p(0, 6)])).toEqual(p(2, 2));
  });
});

describe('unit footprints', () => {
  const u = (x: number, y: number, facing: number, frontage = 100_000, depth = 20_000) => ({
    center: p(x, y),
    facing,
    footprint: { frontage, depth },
  });

  it('turns a local point to a world point by compass bearing', () => {
    // Facing north (-y): front is -y, right is +x.
    expect(toWorld(p(1000, 1000), 0, p(10, 20))).toEqual(p(1010, 980));
    // Facing east (+x): front is +x, right is +y.
    expect(toWorld(p(1000, 1000), Math.PI / 2, p(10, 20))).toEqual(p(1020, 1010));
    // Facing south: front is +y, right is -x.
    expect(toWorld(p(1000, 1000), Math.PI, p(10, 20))).toEqual(p(990, 1020));
  });

  it('places the corners of an oriented footprint', () => {
    const c = footprintCorners(u(0, 0, 0, 100, 20));
    expect(c).toEqual([p(-50, -10), p(50, -10), p(50, 10), p(-50, 10)]);
    const east = footprintCorners(u(0, 0, Math.PI / 2, 100, 20));
    expect(east.map((q) => [Math.abs(q.x), Math.abs(q.y)])).toEqual([
      [10, 50],
      [10, 50],
      [10, 50],
      [10, 50],
    ]);
  });

  it('overlaps footprints at any angle, but not ones that merely touch', () => {
    expect(footprintsOverlap(u(0, 0, 0), u(0, 15_000, 0))).toBe(true);
    expect(footprintsOverlap(u(0, 0, 0), u(0, 20_000, 0))).toBe(false); // edge to edge
    expect(footprintsOverlap(u(0, 0, 0), u(0, 21_000, 0))).toBe(false);
    // A line turned square-on across the end of another overlaps only if it reaches.
    expect(footprintsOverlap(u(0, 0, 0), u(55_000, 0, Math.PI / 2))).toBe(true);
    expect(footprintsOverlap(u(0, 0, 0), u(75_000, 0, Math.PI / 2))).toBe(false);
    // Oblique: a corner poking into the neighbour.
    expect(footprintsOverlap(u(0, 0, 0), u(45_000, 30_000, Math.PI / 4))).toBe(true);
    expect(convexOverlap(box(0, 0, 1, 1), box(1, 0, 2, 1))).toBe(false);
  });
});
