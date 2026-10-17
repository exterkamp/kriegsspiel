import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Cover,
  type MapAsset,
  type Point,
  type Polygon,
} from '../src/contract.js';
import { polygonArea, polygonLocation } from '../src/geometry.js';
import { createReferenceAsset } from '../src/fixtures/reference.js';
import { parseAsset } from '../src/import.js';
import { coverRealism } from '../src/realism.js';
import { generateCover, MAX_FIELD_SLOPE, type CoverContext } from '../src/geography/cover/index.js';

/**
 * Land cover that follows the ground (#500): woods on slopes and away from
 * people, fields on gentle ground near settlements and roads, organic outlines
 * and parcels split by roads.
 */
const SIZE = 2000,
  SPACING = 25,
  COLUMNS = SIZE / SPACING + 1;
function ground(height: (x: number, y: number) => number) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = SIZE;
  settings.sampleSpacingM = SPACING;
  settings.cover = { woodFraction: 0.35, fieldFraction: 0.35, coherenceM: 300 };
  settings.settlements.villageCount = settings.settlements.farmCount = 0;
  const samples: number[] = [];
  for (let j = 0; j < COLUMNS; j++)
    for (let i = 0; i < COLUMNS; i++)
      samples.push(Number(height(i * SPACING, j * SPACING).toFixed(6)));
  return {
    settings,
    bounds: { minX: 0 as const, minY: 0 as const, maxX: SIZE, maxY: SIZE },
    elevation: { columns: COLUMNS, rows: COLUMNS, spacingM: SPACING, samples },
  };
}
// Flat farmland to the west, a steep 20% hillside to the east.
const hill = () => ground((x) => 100 + Math.max(0, x - 1100) * 0.2);
const square = (cx: number, cy: number, r: number): Polygon => ({
  outer: [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
    [cx - r, cy - r],
  ],
  holes: [],
});
const village: NonNullable<CoverContext['sites']>[number] = {
  kind: 'village',
  anchor: [400, 1000],
  placementArea: square(400, 1000, 100),
};
const road: Point[] = [
  [0, 1000],
  [SIZE, 1000],
];
function cover(f: ReturnType<typeof ground>, context: CoverContext = {}, seed = 7): Cover[] {
  const result = generateCover(f.elevation, f.bounds, [], f.settings, seed, context);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function asset(f: ReturnType<typeof ground>, value: Cover[], context: CoverContext = {}) {
  const a = createReferenceAsset();
  a.bounds = f.bounds;
  a.elevation = f.elevation;
  a.settings = f.settings;
  a.layers = {
    cover: value,
    water: [],
    contours: [],
    roads: [],
    roadNodes: [],
    sites: [],
    buildings: [],
    landmarks: [],
    crossings: [],
  };
  // The report only reads site anchors.
  return {
    contract: a,
    measured: {
      ...a,
      layers: { ...a.layers, sites: (context.sites ?? []) as MapAsset['layers']['sites'] },
    } as MapAsset,
  };
}

describe('terrain-led land cover', () => {
  it('puts woods on the steep hillside and fields on gentle ground near the village', () => {
    const f = hill(),
      context = { sites: [village], roads: [{ path: road }] },
      value = cover(f, context),
      { contract, measured } = asset(f, value, context);
    expect(parseAsset(contract).layers.cover).toEqual(value);
    const r = coverRealism(measured);
    expect(r.woodMeanSlope).toBeGreaterThan(r.fieldMeanSlope);
    expect(r.woodMeanSlope).toBeGreaterThan(0.1);
    expect(r.fieldMaxSlope).toBeLessThanOrEqual(MAX_FIELD_SLOPE);
    expect(r.fieldMeanSettlementDistanceM).toBeLessThan(r.woodMeanSettlementDistanceM);
    // The village's own ground is open, never wood or field.
    expect(
      value.find((c) => c.polygons.some((p) => polygonLocation([400, 1000], p) === 'inside'))?.kind,
    ).toBe('open');
    // Shares within the recipe.
    expect(Math.abs(r.woodShare - f.settings.cover.woodFraction)).toBeLessThan(0.03);
    expect(Math.abs(r.fieldShare - f.settings.cover.fieldFraction)).toBeLessThan(0.03);
  });

  it('draws organic outlines, not lattice staircases, and never overlaps features', () => {
    const f = ground(() => 100),
      value = cover(f, { sites: [village], roads: [{ path: road }] }),
      r = coverRealism(asset(f, value).measured);
    // Rectangle cover (v1) is 100% axis-aligned; only the map edge may be here.
    expect(r.axisAlignedShare).toBeLessThan(0.05);
    expect(r.sharedAxisAlignedShare).toBeLessThan(0.05);
    // A partition: every probe is inside at most one feature, and the features
    // add up to the whole (dry) map less any uncovered pinch cells.
    let total = 0;
    for (const c of value) for (const p of c.polygons) total += polygonArea(p);
    expect(total).toBeLessThanOrEqual(SIZE * SIZE + 1e-3);
    expect(total).toBeGreaterThan(0.99 * SIZE * SIZE);
    for (let y = 10; y < SIZE; y += 40)
      for (let x = 10; x < SIZE; x += 40) {
        let inside = 0;
        for (const c of value)
          for (const p of c.polygons) if (polygonLocation([x, y], p) === 'inside') inside++;
        expect(inside).toBeLessThanOrEqual(1);
      }
  });

  it('splits field parcels at roads', () => {
    const f = ground(() => 100);
    f.settings.cover = { woodFraction: 0, fieldFraction: 1, coherenceM: 300 };
    const value = cover(f, { roads: [{ path: road }] });
    const fields = value.filter((c) => c.kind === 'field');
    expect(fields.length).toBeGreaterThan(20);
    for (const c of fields)
      for (let x = 50; x < SIZE; x += 100) {
        const north = polygonLocation([x, 1000 - 75], c.polygons[0]!) === 'inside',
          south = polygonLocation([x, 1000 + 75], c.polygons[0]!) === 'inside';
        expect(north && south).toBe(false);
      }
  });

  it('is deterministic, and settlements and roads change the layout', () => {
    const f = hill(),
      context = { sites: [village], roads: [{ path: road }] };
    expect(cover(f, context, 31)).toEqual(cover(f, context, 31));
    expect(cover(f, {}, 31)).not.toEqual(cover(f, context, 31));
    expect(cover(f, context, 32)).not.toEqual(cover(f, context, 31));
  });

  it('outlines valid, non-overlapping features on rough ground with water, roads and sites', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const f = ground(
        (x, y) =>
          100 +
          18 * Math.sin(x / (160 + 9 * seed) + seed) * Math.cos(y / (210 - 7 * seed)) +
          6 * Math.sin((x + 2 * y) / 90 + seed),
      );
      f.settings.cover = {
        woodFraction: 0.1 + 0.05 * seed,
        fieldFraction: 0.5 - 0.03 * seed,
        coherenceM: 150 + 40 * seed,
      };
      const lakeRing: Point[] = [
        [300 + 20 * seed, 300],
        [700, 260 + 15 * seed],
        [760, 650],
        [420, 700 - 10 * seed],
        [300 + 20 * seed, 300],
      ];
      const water = [
        {
          id: 'lake:a',
          kind: 'lake' as const,
          polygons: [{ outer: lakeRing, holes: [] }],
          surfaceElevationM: 90,
        },
      ];
      const context: CoverContext = {
        roads: [
          {
            path: [
              [0, 900 + 30 * seed],
              [1000, 1100],
              [SIZE, 1300 - 20 * seed],
            ],
          },
          {
            path: [
              [1500 - 40 * seed, 0],
              [1400, SIZE],
            ],
          },
        ],
        sites: [
          { kind: 'village', anchor: [1000, 1500], placementArea: square(1000, 1500, 120) },
          { kind: 'farm', anchor: [1700, 500], placementArea: square(1700, 500, 30) },
        ],
      };
      const result = generateCover(f.elevation, f.bounds, water, f.settings, seed, context);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const { contract } = asset(f, result.value);
      contract.layers.water = water;
      expect(parseAsset(contract).layers.cover).toEqual(result.value);
      for (let y = 15; y < SIZE; y += 70)
        for (let x = 15; x < SIZE; x += 70) {
          let inside = 0;
          for (const c of result.value)
            for (const p of c.polygons) if (polygonLocation([x, y], p) === 'inside') inside++;
          expect(inside).toBeLessThanOrEqual(1);
          if (inside) expect(polygonLocation([x, y], water[0]!.polygons[0]!)).not.toBe('inside');
        }
    }
  }, 120_000);

  it('rejects non-finite context coordinates', () => {
    const f = hill();
    expect(() =>
      generateCover(f.elevation, f.bounds, [], f.settings, 7, {
        roads: [
          {
            path: [
              [0, 0],
              [Number.NaN, 5],
            ],
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});
