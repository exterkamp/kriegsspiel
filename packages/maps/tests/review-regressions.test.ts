import { describe, expect, it } from 'vitest';
import {
  createElevationQueries,
  createReferenceAsset,
  DEFAULT_SETTINGS,
  parseAsset,
  parseSettings,
  type Point,
} from '../src/index.js';
import { orientation, segmentCuts, segmentsIntersect, validatePolygon } from '../src/geometry.js';
import { TopologyBudget } from '../src/errors.js';
import { rectangle } from '../src/fixtures/reference.js';

describe('independent review regressions', () => {
  it('rejects inherited array getters without executing them', () => {
    let reads = 0;
    const prototype = Object.create(Array.prototype) as object;
    Object.defineProperty(prototype, 'limits', {
      get() {
        reads++;
        throw new Error('Inherited getter executed');
      },
    });
    const settings: unknown[] = [];
    Object.setPrototypeOf(settings, prototype);
    expect(() => parseAsset({ ...createReferenceAsset(), settings })).toThrow(/custom prototype/);
    expect(() => parseSettings(settings)).toThrow(/custom prototype/);
    expect(reads).toBe(0);
  });
  it('does not couple elevation or reference arrays to the geometric vertex cap', () => {
    const a = createReferenceAsset();
    a.settings.settlements.villageCount = a.settings.settlements.farmCount = 0;
    for (const key of Object.keys(a.layers) as (keyof typeof a.layers)[]) a.layers[key] = [];
    expect(parseAsset(a, { maxVertices: 4 }).elevation.samples).toHaveLength(49);
    // A road's many logical route identities consume reference/work limits,
    // while its geometry still uses the same two vertices.
    const b = createReferenceAsset();
    b.layers.roads[0]!.routeIds.push(...Array.from({ length: 200 }, (_, i) => `route:r${i}`));
    expect(parseAsset(b, { maxVertices: 100 }).layers.roads[0]!.routeIds).toHaveLength(201);
  });
  it('never executes hidden array or settings getters and rejects symbols', () => {
    let reads = 0;
    const getter = () => {
      reads++;
      throw new Error('Getter executed');
    };
    const hidden: unknown[] = [];
    Object.defineProperty(hidden, 'limits', { get: getter });
    const a = createReferenceAsset();
    expect(() => parseAsset({ ...a, settings: hidden })).toThrow(/named, hidden or symbol/);
    expect(() => parseSettings(hidden)).toThrow(/named, hidden or symbol/);
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.defineProperty(settings, 'roads', { enumerable: true, get: getter });
    expect(() => parseSettings(settings)).toThrow(/Hidden\/accessor/);
    const symbols = createReferenceAsset();
    Object.defineProperty(symbols.elevation.samples, Symbol('hidden'), { get: getter });
    expect(() => parseAsset(symbols)).toThrow(/symbol/);
    const array = createReferenceAsset();
    Object.defineProperty(array.elevation.samples, '0', { enumerable: false, value: 100 });
    expect(() => parseAsset(array)).toThrow(/Hidden\/accessor arrays/);
    expect(reads).toBe(0);
  });
  it.each([
    [0, 0, 1e-5],
    [10000, 9000, 1e-5],
    [0, 0, 1],
    [10000, 9000, 100],
  ])('handles translated/scaled crossings and cuts (%s,%s,%s)', (x, y, size) => {
    const a: Point = [x, y],
      b: Point = [x + size, y + size],
      c: Point = [x, y + size],
      d: Point = [x + size, y];
    expect(segmentsIntersect(a, b, c, d)).toBe(true);
    expect(orientation(a, b, c)).toBe(1);
    expect(segmentCuts(a, b, [[c, d]], new TopologyBudget(10), '$')).toEqual([0, 0.5, 1]);
    expect(() =>
      validatePolygon({ outer: [a, b, c, d, a], holes: [] }, '$.bowtie', new TopologyBudget(100)),
    ).toThrow(/intersect/);
    expect(() =>
      validatePolygon(rectangle(x, y, x + size, y + size), '$.tiny', new TopologyBudget(100)),
    ).not.toThrow();
  });
  it('uses exact dyadic fallback for collinear orientation and rejects nonfinite geometry queries', () => {
    expect(orientation([10000, 10000], [10000.125, 10000.25], [10000.25, 10000.5])).toBe(0);
    expect(() => orientation([NaN, 0], [0, 1], [1, 0])).toThrow(RangeError);
  });
  it('rejects excess sites before polygon topology work', () => {
    const a = createReferenceAsset();
    a.layers.sites.push(structuredClone(a.layers.sites[0]!));
    a.layers.cover[0]!.polygons[0]!.outer = [
      [20, 20],
      [80, 80],
      [20, 80],
      [80, 20],
      [20, 20],
    ];
    expect(() => parseAsset(a)).toThrow(/Site counts.*RESOURCE_LIMIT/);
  });
  it('caps aggregate ground/drainage values before graph allocation', () => {
    const a = createReferenceAsset();
    a.drainage = {
      policy: 'filled-ground-d8-v1',
      filledSamples: [...a.elevation.samples],
      downstream: Array(49).fill(-1) as number[],
      accumulation: Array(49).fill(1) as number[],
      outlets: [],
      sinks: [],
    };
    expect(() => parseAsset(a, { maxSampleValues: 100 })).toThrow(/Aggregate sample-value cap/);
  });
  it('detects a concave escape even with every occupied vertex in the permissible area', () => {
    const a = createReferenceAsset(),
      site = a.layers.sites[0]!;
    site.placementArea = {
      outer: [
        [100, 40],
        [140, 40],
        [140, 100],
        [125, 100],
        [125, 60],
        [115, 60],
        [115, 100],
        [100, 100],
        [100, 40],
      ],
      holes: [],
    };
    site.anchor = [110, 70];
    site.occupiedFootprint = rectangle(105, 65, 135, 95);
    expect(() => parseAsset(a)).toThrow(/Occupied footprint leaves permissible site/);
  });
  it('charges large reciprocal reference lists before graph/geometry reconciliation', () => {
    const a = createReferenceAsset();
    a.layers.roads[0]!.routeIds = Array.from({ length: 200 }, (_, i) => `route:r${i}`);
    expect(() => parseAsset(a, { maxTopologyChecks: 150 })).toThrow(/Topology work/);
  });
  it('clips only a declared boundary exit and rejects wrong sides or undeclared caps', () => {
    const a = createReferenceAsset();
    a.layers.roadNodes[0] = {
      id: 'node:west',
      kind: 'boundary-exit',
      side: 'west',
      position: [0, 50],
    };
    a.layers.roads[0]!.path[0] = [0, 50];
    expect(parseAsset(a).layers.roadNodes[0]!.kind).toBe('boundary-exit');
    const ordinary = structuredClone(a);
    ordinary.layers.roadNodes[0] = { id: 'node:west', kind: 'junction', position: [0, 50] };
    expect(() => parseAsset(ordinary)).toThrow(/without a declared exit/);
    const side = structuredClone(a);
    side.layers.roadNodes[0] = {
      id: 'node:west',
      kind: 'boundary-exit',
      side: 'east',
      position: [0, 50],
    };
    expect(() => parseAsset(side)).toThrow(/declared exit|declared side/);
    const vertex = structuredClone(a);
    vertex.layers.roads[0]!.path.splice(1, 0, [1, 50]);
    expect(() => parseAsset(vertex)).toThrow(/without a declared exit/);
  });
  it('accepts reversed full-width bridge paths and documents tangential dry corridors', () => {
    const a = createReferenceAsset(),
      road = a.layers.roads[0]!;
    road.path.reverse();
    [road.fromNodeId, road.toNodeId] = [road.toNodeId, road.fromNodeId];
    a.layers.crossings[0]!.endpoints.reverse();
    expect(parseAsset(a).layers.crossings[0]!.spanM).toBe(40);
    const tangent = createReferenceAsset();
    tangent.layers.roads = [
      {
        id: 'road:bank',
        kind: 'track',
        fromNodeId: 'node:a',
        toNodeId: 'node:b',
        path: [
          [36, 20],
          [36, 120],
        ],
        widthM: 8,
        surfaceWidthM: 2,
        setbackM: 0,
        routeIds: [],
        crossingIds: [],
      },
    ];
    tangent.layers.roadNodes = [
      { id: 'node:a', kind: 'junction', position: [36, 20] },
      { id: 'node:b', kind: 'junction', position: [36, 120] },
    ];
    tangent.layers.crossings = [];
    tangent.layers.sites[0]!.entrances = [];
    tangent.layers.landmarks = [];
    expect(() => parseAsset(tangent)).not.toThrow();
  });
  it('owns decimal grid seams on their east/south cell, including exact max', () => {
    const q = createElevationQueries({
      bounds: { minX: 0, minY: 0, maxX: 0.4, maxY: 0.1 },
      elevation: { columns: 5, rows: 2, spacingM: 0.1, samples: [0, 1, 2, 3, 5, 0, 1, 2, 3, 5] },
    });
    expect(q.gradientAt(0.3, 0.05).dx).toBe(20);
    expect(q.heightAt(0.3, 0.05)).toBe(3);
    expect(q.gradientAt(0.3 - 1e-10, 0.05).dx).toBe(10);
    expect(q.gradientAt(0.4, 0.1).dx).toBe(20);
  });
  it('rejects uphill carved-ground and buried standing surfaces inside bilinear cells', () => {
    const a = createReferenceAsset();
    a.elevation.samples = a.elevation.samples.map(
      (_, i) => -((i % 7) * 25 - 50) * (Math.floor(i / 7) * 25 - 50),
    );
    const river = a.layers.water[0]!;
    if (river.kind !== 'river') throw new Error('fixture');
    river.centreline = [
      [25, 25],
      [75, 75],
    ];
    river.surfaceProfileM = [-625, -625];
    expect(() => parseAsset(a)).toThrow(/rises inside a bilinear cell/);
    river.surfacePolicy = 'standing-water-v1';
    expect(() => parseAsset(a)).toThrow(/below ground inside a bilinear cell/);
    river.surfaceProfileM = [1, 1];
    expect(() => parseAsset(a)).not.toThrow();
  });
});
