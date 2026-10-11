import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Elevation,
  type GenerationResult,
  type Polygon,
  type Water,
} from '../src/contract.js';
import { polygonArea, polygonLocation } from '../src/geometry.js';
import { generateHydrology, validateWaterPhysics } from '../src/geography/index.js';
import { Budget, bounded } from '../src/geography/budget.js';
import { cellRegions } from '../src/geography/regions.js';
import { lakeCellsAtLevel } from '../src/geography/water.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function field(columns: number, rows: number, samples: number[], spacingM = 25) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = (columns - 1) * spacingM;
  settings.heightM = (rows - 1) * spacingM;
  settings.sampleSpacingM = spacingM;
  return {
    settings,
    elevation: { columns, rows, spacingM, samples } as Elevation,
    bounds: { minX: 0 as const, minY: 0 as const, maxX: settings.widthM, maxY: settings.heightM },
  };
}
const rectangle = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
  holes: [],
});
describe('whole-area standing water and conservative wet regions', () => {
  it('preserves a dry island as an explicit lake hole and exact grid-cell area', () => {
    const a = field(7, 7, Array(49).fill(0));
    a.elevation.samples[24] = 10;
    const polygons = lakeCellsAtLevel(a.elevation, 5, new Budget(1_000_000, 'test'), 10000);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!.holes).toHaveLength(1);
    expect(polygonLocation([75, 75], polygons[0]!)).toBe('outside');
    expect(polygonArea(polygons[0]!)).toBe((36 - 4) * 625);
    const water: Water[] = [{ id: 'water:lake', kind: 'lake', surfaceElevationM: 5, polygons }];
    expect(
      value(validateWaterPhysics(a.elevation, a.bounds, water, a.settings)).maxGroundExcessM,
    ).toBe(0);
  });
  it('checks river quadratic interiors, rejecting low endpoints over a high saddle interior', () => {
    const samples: number[] = [];
    for (let y = 0; y <= 100; y += 25)
      for (let x = 0; x <= 100; x += 25) samples.push(-(x - 50) * (y - 50));
    const a = field(5, 5, samples),
      river: Water = {
        id: 'river:saddle',
        kind: 'river',
        widthM: 10,
        centreline: [
          [25, 25],
          [75, 75],
        ],
        surfacePolicy: 'standing-water-v1',
        surfaceProfileM: [-625, -625],
        polygons: [
          {
            outer: [
              [24, 24],
              [76, 76],
              [77, 76],
              [25, 24],
              [24, 24],
            ],
            holes: [],
          },
        ],
      };
    expect(validateWaterPhysics(a.elevation, a.bounds, [river], a.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ constraint: 'whole water area' }],
    });
  });
  it('detects a hill inside the polygon even when every polygon boundary point is submerged', () => {
    const a = field(5, 5, Array(25).fill(0));
    a.elevation.samples[12] = 10;
    expect(
      validateWaterPhysics(
        a.elevation,
        a.bounds,
        [
          {
            id: 'lake:hill',
            kind: 'lake',
            surfaceElevationM: 5,
            polygons: [rectangle(0, 0, 100, 100)],
          },
        ],
        a.settings,
      ),
    ).toMatchObject({ ok: false });
  });
  it('reserves the complete elevation query snapshot before physics allocation', () => {
    const a = field(51, 51, Array(2601).fill(0)),
      water: Water[] = [
        {
          id: 'lake:small',
          kind: 'lake',
          surfaceElevationM: 1,
          polygons: [rectangle(10, 10, 20, 20)],
        },
      ];
    expect(
      validateWaterPhysics(a.elevation, a.bounds, water, a.settings, { maxPhysicsWork: 206 }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'GEOGRAPHY_RESOURCE_LIMIT' }] });
    const r = value(validateWaterPhysics(a.elevation, a.bounds, water, a.settings));
    expect(r.work).toBeGreaterThanOrEqual(2601);
    expect(
      validateWaterPhysics(a.elevation, a.bounds, water, a.settings, { maxPhysicsWork: r.work }),
    ).toMatchObject({ ok: true });
    expect(
      validateWaterPhysics(a.elevation, a.bounds, water, a.settings, {
        maxPhysicsWork: r.work - 1,
      }),
    ).toMatchObject({ ok: false });
  });
  it('reports generated corner contacts as typed topology infeasibility, retaining malformed-input errors', () => {
    const a = field(4, 4, Array(16).fill(0));
    const mask = new Uint8Array(9).fill(1);
    mask[0] = mask[4] = 0;
    const r = bounded(() => ({
      ok: true,
      value: cellRegions(mask, a.elevation, new Budget(100000, 'test'), 1000),
      diagnostics: [],
    }));
    expect(r).toMatchObject({
      ok: false,
      kind: 'infeasible',
      diagnostics: [{ code: 'REGION_TOPOLOGY' }],
    });
    expect(() =>
      validateWaterPhysics(
        a.elevation,
        a.bounds,
        [
          {
            id: 'bad',
            kind: 'lake',
            surfaceElevationM: 1,
            polygons: [
              {
                outer: [
                  [0, 0],
                  [25, 25],
                  [0, 25],
                  [25, 0],
                  [0, 0],
                ],
                holes: [],
              },
            ],
          },
        ],
        a.settings,
      ),
    ).toThrow(/intersect|area/);
  });
  it('keeps cropped corner-contact rectangle partitions at their world offset', () => {
    const a = field(4, 4, Array(16).fill(0)),
      mask = new Uint8Array(9).fill(1);
    mask[0] = mask[4] = 0;
    const regions = cellRegions(
      mask,
      a.elevation,
      new Budget(100000, 'test'),
      1000,
      undefined,
      true,
      [250, 350],
    );
    expect(regions.reduce((area, r) => area + polygonArea(r.polygon), 0)).toBe(4375);
    for (let i = 0; i < 9; i++) {
      const p: [number, number] = [
        250 + ((i % 3) + 0.5) * 25,
        350 + (Math.floor(i / 3) + 0.5) * 25,
      ];
      expect(regions.some((r) => polygonLocation(p, r.polygon) === 'inside')).toBe(!!mask[i]);
    }
  });
  it('never invents flat-ground rivers and reports required-river infeasibility', () => {
    const a = field(5, 5, Array(25).fill(100)),
      r = value(generateHydrology(a.elevation, a.bounds, a.settings, 17));
    expect(r.water).toEqual([]);
    expect(r.groundChanged).toBe(false);
    expect(r.elevation).toEqual(a.elevation);
    a.settings.hydrology.requireRiver = true;
    expect(generateHydrology(a.elevation, a.bounds, a.settings, 17)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'RIVER_INFEASIBLE' }],
    });
  });
  it('certifies only explicit constant standing profiles and rejects label-only or nonfinite inputs', () => {
    const a = field(3, 3, Array(9).fill(0)),
      w: Water = {
        id: 'river',
        kind: 'river',
        polygons: [rectangle(10, 10, 40, 40)],
        centreline: [
          [15, 15],
          [35, 35],
        ],
        widthM: 10,
        surfacePolicy: 'standing-water-v1',
        surfaceProfileM: [1, 2],
      };
    expect(validateWaterPhysics(a.elevation, a.bounds, [w], a.settings)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'UNSUPPORTED_WATER_SURFACE' }],
    });
    w.surfaceProfileM = [NaN, NaN];
    expect(() => validateWaterPhysics(a.elevation, a.bounds, [w], a.settings)).toThrow(/water/);
  });
});
