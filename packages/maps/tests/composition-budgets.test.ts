import { beforeAll, expect, it, vi } from 'vitest';
import type { Polygon, Water } from '../src/contract.js';
import { Meter } from '../src/composition/budget.js';
import { settlementFrame } from '../src/composition/frame.js';
import { clipLocalWater } from '../src/composition/windows.js';
import { createLocalLayouts } from '../src/composition/settlements.js';
import { DEFAULT_SETTINGS } from '../src/contract.js';
import type { PlanningCertificates, RegionalPlanningOutput } from '../src/planning/index.js';
import { compactLocalStreets } from '../src/composition/compact.js';
import type { MapAsset, MapLayers, Point, Road } from '../src/contract.js';
import { generateBattlefield } from '../src/composition/index.js';
import { indexStreetAccesses } from '../src/composition/assemble.js';
import {
  GeometryMeter,
  ValidationIndex,
  validationBounds,
  validateBuilding,
  validateRegionalPlacement,
} from '../src/composition/validate.js';

let control: MapAsset;
beforeAll(() => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 500;
  settings.terrain.reliefM = 0;
  settings.cover.woodFraction = settings.cover.fieldFraction = 0;
  settings.settlements.villageCount = settings.settlements.farmCount = 1;
  settings.settlements.villagePopulation = 12;
  settings.settlements.minSpacingM = 150;
  settings.roads.extraLinks = 0;
  const r = generateBattlefield({ seed: 17, settings });
  if (!r.ok) throw Error(JSON.stringify(r));
  control = r.value;
});

const square = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
  holes: [],
});
const frame = settlementFrame({ anchor: [50, 50], rotationDeg: 0 }),
  window = square(-50, -50, 50, 50);
it('reserves transformation/overlay before any water-coordinate transformation', () => {
  const polygon: Polygon = {
    outer: Array.from({ length: 97 }, (_, i) => {
      const a = ((i % 96) * Math.PI) / 48;
      return [50 + 20 * Math.cos(a), 50 + 20 * Math.sin(a)];
    }),
    holes: [],
  };
  const localPolygon = vi.fn(frame.localPolygon);
  expect(() =>
    clipLocalWater(
      [{ id: 'water:lake', kind: 'lake', surfaceElevationM: 10, polygons: [polygon] }],
      { ...frame, localPolygon },
      window,
      5,
      new Meter(1, 'water'),
      'site:farm:0000',
    ),
  ).toThrow(/Work reservation/);
  expect(localPolygon).not.toHaveBeenCalled();
});
it('clips water preserving authoritative identity/dry island holes without source mutation', () => {
  const polygon = square(20, 20, 80, 80);
  polygon.holes = [square(40, 40, 60, 60).outer];
  const water: Water[] = [
      { id: 'water:lake', kind: 'lake', surfaceElevationM: 10, polygons: [polygon] },
    ],
    before = JSON.stringify(water);
  const cut = clipLocalWater(water, frame, window, 5, new Meter(100000, 'water'), 'site:farm:0000');
  expect(cut).toHaveLength(1);
  expect(cut[0]!.id).toBe('water:lake');
  expect(cut[0]!.polygons[0]!.holes).toHaveLength(1);
  expect(JSON.stringify(water)).toBe(before);
});
it('rejects aggregate clipped point count before mapping/appending the excess polygon', () => {
  const waters: Water[] = Array.from({ length: 2001 }, (_, i) => ({
    id: `water:lake:${i}`,
    kind: 'lake',
    surfaceElevationM: 10,
    polygons: [square(20, 20, 21, 21)],
  }));
  const localPolygon = vi.fn(frame.localPolygon),
    meter = new Meter(1000000, 'water');
  expect(() =>
    clipLocalWater(waters, { ...frame, localPolygon }, window, 6, meter, 'site:farm:0000'),
  ).toThrow(/aggregate input caps/);
  expect(localPolygon).toHaveBeenCalledTimes(1999); // 6+1998×5=9996; next cannot be appended.
});
it('active callback budget restores in finally when authoritative code throws', () => {
  const settings = structuredClone(DEFAULT_SETTINGS),
    site = {
      id: 'site:farm:0000',
      kind: 'farm' as const,
      name: 'Farm',
      anchor: [50, 50] as [number, number],
      rotationDeg: 0,
      placementArea: square(25, 25, 75, 75),
      occupiedFootprint: null,
      population: { requested: 12, assigned: 0, unassigned: 12 },
      entrances: [
        {
          id: 'entrance:farm',
          routeId: 'route:one',
          roadId: 'road:one',
          nodeId: 'node:one',
          endpoint: [50, 25] as [number, number],
          widthM: 4,
          bearingDeg: 0,
        },
      ],
    };
  const plan = {
    sites: [site],
    roads: [{ id: 'road:one', surfaceWidthM: 2.4, setbackM: 0.3 }],
  } as unknown as RegionalPlanningOutput;
  const sentinel = new Error('authority programming failure'),
    state: { active?: { used: number; take(n: number): void }; charged: number } = { charged: 0 };
  const cert = {
    roadSegment: () => {
      expect(state.active).toBeDefined();
      throw sentinel;
    },
  } as unknown as PlanningCertificates;
  expect(() =>
    createLocalLayouts(plan, [], settings, 17, cert, new Meter(200000000, 'attempts'), state),
  ).toThrow(sentinel);
  expect(state.active).toBeUndefined();
});
it('compacts degree-two street chains without losing bends, route identity or real access junctions', () => {
  const make = (id: string, a: string, b: string, path: [number, number][]): Road => ({
    id,
    kind: 'street',
    siteId: 'site:village:0000',
    fromNodeId: a,
    toNodeId: b,
    path,
    widthM: 4,
    surfaceWidthM: 2.4,
    setbackM: 0.3,
    routeIds: ['route:one'],
    crossingIds: [],
  });
  const first = make('road:village:0000:street:0000', 'node:a', 'node:b', [
      [0, 0],
      [10, 0],
    ]),
    second = make('road:village:0000:street:0001', 'node:b', 'node:c', [
      [10, 0],
      [10, 10],
    ]);
  const layers = {
    roads: [first, second],
    roadNodes: [
      { id: 'node:a', kind: 'junction', position: [0, 0] },
      { id: 'node:b', kind: 'junction', position: [10, 0] },
      { id: 'node:c', kind: 'junction', position: [10, 10] },
    ],
  } as unknown as MapLayers;
  compactLocalStreets(layers, new Meter(10000, 'compact'));
  expect(layers.roads).toHaveLength(1);
  expect(layers.roads[0]!.path).toEqual([
    [0, 0],
    [10, 0],
    [10, 10],
  ]);
  expect(layers.roads[0]!.routeIds).toEqual(['route:one']);
  expect(layers.roadNodes.map((n) => n.id)).toEqual(['node:a', 'node:c']);
  const access = {
    ...make('road:village:0000:0000:access', 'node:d', 'node:b', [
      [10, -5],
      [10, 0],
    ]),
    kind: 'track' as const,
  };
  const joined = {
    roads: [first, second, access],
    roadNodes: [...layers.roadNodes, { id: 'node:b', kind: 'junction', position: [10, 0] }],
  } as unknown as MapLayers;
  compactLocalStreets(joined, new Meter(10000, 'compact'));
  expect(joined.roads).toHaveLength(3);
  expect(joined.roadNodes.some((n) => n.id === 'node:b')).toBe(true);
});
it('reserves coordinate bounds/index work before reads, and reuses distant path bounds', () => {
  let coordinateReads = 0;
  const path: Point[] = Array.from(
    { length: 1000 },
    (_, i) =>
      new Proxy([10000 + i, 10000] as Point, {
        get(target, key, receiver) {
          if (key === '0' || key === '1') coordinateReads++;
          return Reflect.get(target, key, receiver);
        },
      }),
  );
  expect(() => validationBounds(path, new Meter(1, 'bounds'))).toThrow(/Work reservation/);
  expect(coordinateReads).toBe(0);
  const asset = structuredClone(control),
    road = { ...asset.layers.roads[0]!, path };
  asset.layers.roads = [road];
  asset.layers.sites = [asset.layers.sites[0]!];
  expect(() => new ValidationIndex(asset, new Meter(1, 'index'))).toThrow(/Work reservation/);
  expect(coordinateReads).toBe(0);
  const index = new ValidationIndex(asset, new Meter(100000, 'index'));
  expect(coordinateReads).toBe(2000);
  coordinateReads = 0;
  const meter = new Meter(1, 'regional scan');
  validateRegionalPlacement(asset, [road], new GeometryMeter(meter), meter, index);
  expect(meter.used).toBe(1);
  expect(coordinateReads).toBe(0);
});
it('certificate exhaustion stops before any subsequent road or incident scan', () => {
  const index = new ValidationIndex(control, new Meter(100000, 'index')),
    meter = new Meter(10000, 'building'),
    geom = new GeometryMeter(meter),
    roadsVisited = vi.spyOn(index.roads, 'values'),
    incidentVisited = vi.spyOn(index.incident, 'get');
  const cert = {
    footprint: vi.fn(() => {
      meter.take(meter.remaining);
      return { ok: true, value: { suitable: true }, diagnostics: [] };
    }),
  } as unknown as PlanningCertificates;
  expect(() =>
    validateBuilding(control, control.layers.buildings[0]!, cert, index, geom, meter),
  ).toThrow(/Work reservation/);
  expect(cert.footprint).toHaveBeenCalledOnce();
  expect(roadsVisited).not.toHaveBeenCalled();
  expect(incidentVisited).not.toHaveBeenCalled();
  expect(meter.used).toBe(meter.max);
});
it('indexes all accesses once with reservation before even unmatched street-key reads', () => {
  let keysRead = 0;
  const accesses = Array.from({ length: 100 }, (_, i) => ({
    get streetId() {
      keysRead++;
      return `street:${i % 10}`;
    },
    ordinal: i,
  }));
  expect(() => indexStreetAccesses(accesses, new Meter(1, 'access index'))).toThrow(
    /Work reservation/,
  );
  expect(keysRead).toBe(0);
  const indexed = indexStreetAccesses(accesses, new Meter(1000, 'access index'));
  expect(indexed.size).toBe(10);
  expect(indexed.get('street:9')).toHaveLength(10);
  expect(keysRead).toBe(200); // Two bounded Map-key reads per access, independent of street count.
});
