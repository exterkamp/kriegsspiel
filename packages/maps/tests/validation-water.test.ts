import { expect, it } from 'vitest';
import type { Point, Polygon } from '../src/contract.js';
import { TopologyBudget } from '../src/errors.js';
import {
  capsuleIntersectsPolygon,
  polygonLocation,
  segmentCuts,
  polygonEdges,
} from '../src/geometry.js';
import { WaterPolygonIndex } from '../src/validation-water.js';

const polygon: Polygon = {
  outer: [
    [10, 10],
    [310, 10],
    [310, 310],
    [10, 310],
    [10, 10],
  ],
  holes: [
    [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
      [100, 100],
    ],
  ],
};
it('preserves complete hole, boundary, epsilon and horizontal-ray semantics', () => {
  const indexed = new WaterPolygonIndex(polygon, new TopologyBudget(1_000_000), '$');
  const positions = [-1, 10 - 5e-10, 10, 50, 100 - 5e-10, 100, 150, 200, 250, 310, 311];
  for (const x of positions)
    for (const y of positions) {
      const point: Point = [x, y];
      expect(indexed.location(point, '$')).toBe(polygonLocation(point, polygon));
    }
});
it('retains exact capsule and span cuts for water crossings, dry holes and tangent corridors', () => {
  const indexed = new WaterPolygonIndex(polygon, new TopologyBudget(1_000_000), '$');
  const paths: [Point, Point][] = [
    [
      [0, 150],
      [320, 150],
    ],
    [
      [110, 150],
      [190, 150],
    ],
    [
      [110, 150],
      [205, 150],
    ],
    [
      [0, 0],
      [320, 320],
    ],
    [
      [0, 99.9999999995],
      [320, 99.9999999995],
    ],
    [
      [0, 5],
      [320, 5],
    ],
    [
      [150, 150],
      [150, 150],
    ],
    [
      [-100, -100],
      [-50, -50],
    ],
  ];
  for (const [a, b] of paths)
    for (const radius of [0, 0.5, 5, 5 + 5e-10, 20]) {
      expect(indexed.intersectsCapsule(a, b, radius, '$')).toBe(
        capsuleIntersectsPolygon(a, b, radius, polygon, new TopologyBudget(1_000_000), '$'),
      );
      expect(
        segmentCuts(a, b, indexed.cutEdges(a, b, '$'), new TopologyBudget(1_000_000), '$'),
      ).toEqual(segmentCuts(a, b, polygonEdges(polygon), new TopologyBudget(1_000_000), '$'));
    }
});
it('bounds index construction and repeated distant scans without unmetered copying', () => {
  expect(() => new WaterPolygonIndex(polygon, new TopologyBudget(1), '$')).toThrow();
  const budget = new TopologyBudget(1000);
  const indexed = new WaterPolygonIndex(polygon, budget, '$');
  for (let i = 0; i < 100; i++)
    expect(indexed.intersectsCapsule([-100, -100], [-50, -50], 2, '$')).toBe(false);
  // An unlimited stream of misses still exhausts the caller-owned budget.
  expect(() => {
    for (let i = 0; i < 1000; i++) indexed.intersectsCapsule([-100, -100], [-50, -50], 2, '$');
  }).toThrow();
});
