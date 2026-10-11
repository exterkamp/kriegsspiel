import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DiagnosticSchema,
  type Bounds,
  type Cover,
  type Elevation,
  type MapSettings,
  type Polygon,
  type Water,
} from '../src/contract.js';
import {
  polygonArea,
  polygonLocation,
  polygonEdges,
  segmentCuts,
  interpolate,
} from '../src/geometry.js';
import * as geometry from '../src/geometry.js';
import { TopologyBudget } from '../src/errors.js';
import { createReferenceAsset } from '../src/fixtures/reference.js';
import { parseAsset } from '../src/import.js';
import { parseSettings } from '../src/validation.js';
import { generateCover, MAX_COVER_AXIS, COVER_VERSION } from '../src/geography/cover/index.js';
import { waterMask, type Lattice } from '../src/geography/cover/mask.js';
import { CoverWork } from '../src/geography/cover/budget.js';

function fixture(
  size = 400,
  gradient = 0,
): { elevation: Elevation; bounds: Bounds; settings: MapSettings } {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = size;
  settings.sampleSpacingM = 25;
  settings.cover.coherenceM = 100;
  settings.settlements.villageCount = settings.settlements.farmCount = 0;
  const columns = size / 25 + 1;
  const elevation = {
    columns,
    rows: columns,
    spacingM: 25,
    samples: Array.from(
      { length: columns * columns },
      (_, i) => 100 + gradient * (i % columns) * 25,
    ),
  };
  return { elevation, bounds: { minX: 0, minY: 0, maxX: size, maxY: size }, settings };
}
function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return {
    outer: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
    holes: [],
  };
}
function lake(id: string, polygon: Polygon): Water {
  return { id, kind: 'lake', polygons: [polygon], surfaceElevationM: 100 };
}
function success(f: ReturnType<typeof fixture>, water: Water[] = [], seed = 7) {
  const result = generateCover(f.elevation, f.bounds, water, f.settings, seed);
  if (!result.ok) throw new Error(JSON.stringify(result));
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.stage).toBe('cover');
    expect(DiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
  }
  return result;
}
function metrics(result: ReturnType<typeof success>): Record<string, number> {
  return JSON.parse(result.diagnostics.find((d) => d.code === 'COVER_ACHIEVED')!.message);
}
function area(cover: Cover[], kind?: Cover['kind']): number {
  return cover
    .filter((f) => !kind || f.kind === kind)
    .reduce((sum, f) => sum + f.polygons.reduce((n, p) => n + polygonArea(p), 0), 0);
}
function kindAt(cover: Cover[], x: number, y: number): string | undefined {
  return cover.find((f) => f.polygons.some((p) => polygonLocation([x, y], p) === 'inside'))?.kind;
}
function contractCheck(f: ReturnType<typeof fixture>, cover: Cover[], water: Water[] = []): void {
  const asset = createReferenceAsset();
  asset.bounds = f.bounds;
  asset.elevation = f.elevation;
  asset.settings = f.settings;
  asset.layers = {
    cover,
    water,
    contours: [],
    roads: [],
    roadNodes: [],
    sites: [],
    buildings: [],
    landmarks: [],
    crossings: [],
  };
  expect(parseAsset(asset).layers.cover).toEqual(cover);
}

/** Brute-force frozen-query oracle, independent of scanlines and row-local edge spans. */
function referenceMask(lattice: Lattice, water: Water[]) {
  const { xs, ys, columns, rows } = lattice;
  const wet = new Uint8Array(columns * rows),
    boundary = new Uint8Array(columns * rows);
  const topology = new TopologyBudget(5_000_000);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const x0 = xs[x]!,
        x1 = xs[x + 1]!,
        y0 = ys[y]!,
        y1 = ys[y + 1]!,
        i = y * columns + x;
      const cellEdges = polygonEdges(rect(x0, y0, x1, y1));
      for (const feature of water)
        for (const polygon of feature.polygons) {
          const location = polygonLocation([(x0 + x1) / 2, (y0 + y1) / 2], polygon);
          if (location !== 'outside') wet[i] = 1;
          if (location === 'boundary') boundary[i] = 1;
          for (const [a, b] of polygonEdges(polygon)) {
            const cuts = segmentCuts(a, b, cellEdges, topology, 'mask oracle');
            for (let k = 1; k < cuts.length; k++) {
              const [px, py] = interpolate(a, b, (cuts[k - 1]! + cuts[k]!) / 2);
              if (px > x0 && px < x1 && py > y0 && py < y1) {
                wet[i] = 1;
                boundary[i] = 1;
              }
            }
          }
        }
    }
  return { wet, boundary };
}

describe('bounded standalone cover generation', () => {
  it.each(['open', 'wood'] as const)(
    'analytically covers full flat bounds with all-%s including maximum edges',
    (kind) => {
      const f = fixture();
      f.settings.cover.woodFraction = kind === 'wood' ? 1 : 0;
      f.settings.cover.fieldFraction = 0;
      const result = success(f);
      expect(result.value).toEqual([{ id: 'cover:00000', kind, polygons: [rect(0, 0, 400, 400)] }]);
      expect(area(result.value)).toBe(160000);
      expect(metrics(result).dryEligibleAreaM2).toBe(160000);
      contractCheck(f, result.value);
    },
  );
  it('flat all-field is eligible, steep ground produces an honest constrained fallback', () => {
    const flat = fixture();
    flat.settings.cover.woodFraction = 0;
    flat.settings.cover.fieldFraction = 1;
    const field = success(flat);
    expect(area(field.value, 'field')).toBe(160000);
    const steep = fixture(400, 0.12);
    steep.settings.cover = flat.settings.cover;
    const result = success(steep);
    expect(area(result.value, 'field')).toBe(0);
    expect(area(result.value, 'open')).toBe(160000);
    expect(metrics(result).fieldFraction).toBe(0);
    expect(metrics(result).fieldSuitableAreaM2).toBe(0);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'COVER_FIELD_SHORTFALL' && d.severity === 'warning',
      ),
    ).toBe(true);
    contractCheck(steep, result.value);
  });
  it('checks full ground cells: a flat centre cannot hide an unsuitable corner', () => {
    const f = fixture(100);
    f.settings.cover = { woodFraction: 0, fieldFraction: 1, coherenceM: 400 };
    f.elevation.samples.fill(100);
    f.elevation.samples[0] = 120;
    const result = success(f);
    expect(kindAt(result.value, 12.5, 12.5)).toBe('open');
    expect(metrics(result).fieldFraction).toBeLessThan(1);
  });
  it('retains dry islands inside water holes and uncovered water holes inside cover', () => {
    const f = fixture();
    f.settings.cover = { woodFraction: 1, fieldFraction: 0, coherenceM: 100 };
    const pond = rect(50, 50, 350, 350);
    pond.holes = [rect(150, 150, 250, 250).outer];
    const water = [lake('lake:ring', pond)];
    const before = JSON.stringify(water);
    const result = success(f, water);
    expect(kindAt(result.value, 187.5, 187.5)).toBe('wood'); // Dry island.
    expect(kindAt(result.value, 87.5, 87.5)).toBeUndefined(); // Wet ring.
    expect(kindAt(result.value, 12.5, 12.5)).toBe('wood'); // Exterior.
    expect(area(result.value)).toBe(80000); // 160000 - (90000 - 10000).
    expect(metrics(result).dryAreaLossUpperBoundM2).toBe(0); // Aligned boundaries.
    expect(JSON.stringify(water)).toBe(before);
    contractCheck(f, result.value, water);
    // Independent 5 m interior probes, away from boundaries, detect any wet cover.
    for (const c of result.value)
      for (const p of c.polygons)
        for (let y = p.outer[0]![1] + 2.5; y < p.outer[2]![1]; y += 5)
          for (let x = p.outer[0]![0] + 2.5; x < p.outer[2]![0]; x += 5)
            expect(polygonLocation([x, y], pond)).not.toBe('inside');
  });
  it('masks sub-cell water and diagonal edge penetration missed by centre sampling', () => {
    const f = fixture(100);
    f.settings.cover = { woodFraction: 0, fieldFraction: 0, coherenceM: 100 };
    const narrow = rect(1, 0, 2, 100);
    const triangle: Polygon = {
      outer: [
        [50, 50],
        [74, 50],
        [50, 51],
        [50, 50],
      ],
      holes: [],
    };
    const result = success(f, [lake('lake:narrow', narrow), lake('lake:edge', triangle)]);
    expect(kindAt(result.value, 12.5, 12.5)).toBeUndefined();
    expect(kindAt(result.value, 62.5, 62.5)).toBeUndefined();
    expect(kindAt(result.value, 37.5, 12.5)).toBe('open');
    expect(metrics(result).dryAreaLossUpperBoundM2).toBeGreaterThan(0);
    expect(metrics(result).maskedAreaM2).toBeGreaterThan(
      polygonArea(narrow) + polygonArea(triangle),
    );
    contractCheck(f, result.value);
  });
  it('provides an explicit all-wet fallback and restricts fields in the riparian band', () => {
    const f = fixture(100);
    f.settings.cover = { woodFraction: 0, fieldFraction: 1, coherenceM: 100 };
    const wet = success(f, [lake('lake:all', rect(0, 0, 100, 100))]);
    expect(wet.value).toEqual([]);
    expect(metrics(wet).dryEligibleAreaM2).toBe(0);
    expect(wet.diagnostics.some((d) => d.code === 'COVER_NO_DRY_AREA')).toBe(true);
    const bank = success(f, [lake('lake:bank', rect(0, 0, 25, 100))]);
    expect(kindAt(bank.value, 37.5, 12.5)).toBe('open');
    expect(kindAt(bank.value, 87.5, 12.5)).toBe('field');
  });
  it('has spatially coherent canopy, not independent per-cell salt-and-pepper', () => {
    const f = fixture(2000);
    f.settings.cover = { woodFraction: 0.5, fieldFraction: 0, coherenceM: 300 };
    for (const seed of [7, 17, 31]) {
      const result = success(f, [], seed);
      let same = 0,
        total = 0;
      for (let y = 25; y < 2000; y += 50)
        for (let x = 25; x < 2000; x += 50) {
          const wood = kindAt(result.value, x, y) === 'wood';
          for (const [nx, ny] of [
            [x + 50, y],
            [x, y + 50],
          ])
            if (nx! < 2000 && ny! < 2000) {
              total++;
              if ((kindAt(result.value, nx!, ny!) === 'wood') === wood) same++;
            }
        }
      expect(same / total).toBeGreaterThan(0.85); // Independent .5 Bernoulli canopy expects .5.
      expect(metrics(result).woodFraction).toBeCloseTo(0.5, 3);
    }
  });
  it('reproduces density/geometry and keeps ground/water/settings unchanged as cover controls vary', () => {
    const f = fixture(800);
    const water = [lake('lake:a', rect(0, 0, 50, 800)), lake('lake:b', rect(400, 350, 450, 450))];
    const original = JSON.stringify({ ...f, water });
    const a = success(f, water, 17),
      b = success(f, [...water].reverse(), 17);
    expect(b).toEqual(a);
    expect(success(f, water, 17)).toEqual(a);
    expect(JSON.stringify({ ...f, water })).toBe(original);
    const ground = JSON.stringify(f.elevation),
      waters = JSON.stringify(water);
    f.settings.cover = { woodFraction: 0.7, fieldFraction: 0.1, coherenceM: 200 };
    const changed = success(f, water, 17);
    expect(changed.value).not.toEqual(a.value);
    expect(JSON.stringify(f.elevation)).toBe(ground);
    expect(JSON.stringify(water)).toBe(waters);
    for (const result of [a, changed]) {
      const m = metrics(result);
      expect(area(result.value)).toBeCloseTo(m.dryEligibleAreaM2!, 5);
      expect(m.woodFraction! + m.fieldFraction! + m.openFraction!).toBeCloseTo(1, 5);
      for (const c of result.value)
        for (const p of c.polygons)
          for (const point of p.outer)
            for (const number of point) expect(Number(number.toFixed(6))).toBe(number);
      expect(result.value.map((c) => c.id)).toEqual(result.value.map((c) => c.id).sort());
      contractCheck(f, result.value);
    }
  });
  it('reports achieved fractions against dry eligible area with at most one-cell density quantization', () => {
    const f = fixture(800);
    const result = success(f);
    const m = metrics(result);
    const tolerance = m.maxCellAreaM2! / m.dryEligibleAreaM2!;
    expect(Math.abs(m.woodFraction! - f.settings.cover.woodFraction)).toBeLessThanOrEqual(
      tolerance + 1e-6,
    );
    expect(Math.abs(m.fieldFraction! - f.settings.cover.fieldFraction)).toBeLessThanOrEqual(
      tolerance + 1e-6,
    );
    expect(area(result.value, 'wood') / area(result.value)).toBeCloseTo(m.woodFraction!, 5);
  });
  it('covers rectangular extents with a partial last lattice row/column', () => {
    const f = fixture(400);
    f.settings.widthM = 375;
    f.bounds.maxX = 375;
    f.elevation.columns = 16;
    f.elevation.samples = new Array(16 * 17).fill(100);
    f.settings.cover = { woodFraction: 0, fieldFraction: 0, coherenceM: 500 };
    const result = success(f);
    expect(area(result.value)).toBe(375 * 400);
    expect(result.value[0]!.polygons[0]!.outer[2]).toEqual([375, 400]);
    contractCheck(f, result.value);
  });
  it('supports maximum ground size with a prebounded coherent lattice', () => {
    const f = fixture(15000);
    f.settings.cover = { woodFraction: 0, fieldFraction: 0, coherenceM: 300 };
    const result = success(f);
    expect(result.value).toHaveLength(1);
    expect(area(result.value)).toBe(225000000);
    const message = result.diagnostics.find((d) => d.code === 'COVER_LATTICE')!.message;
    expect(message).toContain('120x120');
    expect(MAX_COVER_AXIS).toBe(128);
    expect(COVER_VERSION).toBe('coherent-dry-runs-v1');
  });
  it('matches the brute-force frozen geometry oracle across holes, islands, slivers, diagonals and corner/side contacts', () => {
    const lattice: Lattice = {
      xs: [0, 25, 50, 75, 100],
      ys: [0, 25, 50, 75, 100],
      columns: 4,
      rows: 4,
    };
    const pond = rect(0, 0, 100, 100);
    pond.holes = [rect(25, 25, 75, 75).outer];
    const cases: Water[][] = [
      [lake('lake:ring', pond), lake('lake:island', rect(35, 35, 45, 45))],
      [lake('lake:sliver', rect(1, 0, 2, 100))],
      [
        lake('lake:diagonal', {
          outer: [
            [0, 0],
            [100, 99],
            [100, 100],
            [0, 1],
            [0, 0],
          ],
          holes: [],
        }),
      ],
      [
        lake('lake:corner', {
          outer: [
            [25, 25],
            [49, 25],
            [25, 26],
            [25, 25],
          ],
          holes: [],
        }),
      ],
      [lake('lake:aligned', rect(0, 0, 25, 100))],
      [lake('lake:centre', rect(12.5, 12.5, 87.5, 87.5))],
      [
        lake('lake:concave', {
          outer: [
            [5, 5],
            [95, 5],
            [95, 35],
            [45, 35],
            [45, 65],
            [95, 65],
            [95, 95],
            [5, 95],
            [5, 5],
          ],
          holes: [],
        }),
      ],
      [lake('lake:partial', rect(10, 10, 80, 80)), lake('lake:overlap', rect(60, 60, 100, 100))],
    ];
    const ragged: Lattice = {
      xs: [0, 25, 50, 75, 100, 113],
      ys: [0, 25, 50, 75, 100, 107],
      columns: 5,
      rows: 5,
    };
    for (const grid of [lattice, ragged])
      for (const water of cases) {
        const expected = referenceMask(grid, water);
        expect(waterMask(grid, water, new CoverWork(5_000_000))).toEqual(expected);
        const reversed = water
          .map((feature) => ({
            ...feature,
            polygons: feature.polygons.map((p) => ({
              outer: [...p.outer].reverse(),
              holes: p.holes.map((h) => [...h].reverse()),
            })),
          }))
          .reverse();
        expect(waterMask(grid, reversed, new CoverWork(5_000_000))).toEqual(expected);
      }
  });
  it('scales sparse complex water at default 10 km under the unchanged five-million work cap', () => {
    const f = fixture(10000);
    f.settings.cover.coherenceM = 300;
    const centres: [number, number][] = Array.from({ length: 201 }, (_, i) => {
      const x = 100 + 49 * i;
      return [x, Number((1000 + 0.7 * x + 100 * Math.sin(i / 12)).toFixed(6))];
    });
    const upper = centres.map(([x, y]) => [x, Number((y - 10).toFixed(6))] as [number, number]);
    const lower = centres
      .map(([x, y]) => [x, Number((y + 10).toFixed(6))] as [number, number])
      .reverse();
    const polygon: Polygon = { outer: [...upper, ...lower, upper[0]!], holes: [] };
    const water = [lake('lake:sparse-complex', polygon)];
    const before = JSON.stringify(water);
    expect(98 * 65 * ((polygon.outer.length - 1) * 6 + 1)).toBeGreaterThan(5_000_000);
    const result = success(f, water, 17);
    expect(f.settings.limits.maxTopologyChecks).toBe(5_000_000);
    expect(metrics(result).dryEligibleAreaM2).toBeGreaterThan(90_000_000);
    for (let i = 10; i < 190; i += 20) expect(kindAt(result.value, ...centres[i]!)).toBeUndefined();
    expect(success(f, water, 17)).toEqual(result);
    expect(JSON.stringify(water)).toBe(before);
    contractCheck(f, result.value, water);
  });
  it('fails work/output reservations without returning truncated geography', () => {
    const f = fixture();
    f.settings.limits.maxTopologyChecks = 1;
    const work = generateCover(f.elevation, f.bounds, [], f.settings, 7);
    expect(work.ok).toBe(false);
    expect(work.diagnostics[0]!.stage).toBe('cover');
    expect(work).not.toHaveProperty('value');
    f.settings.limits.maxTopologyChecks = 5000000;
    f.settings.limits.maxVertices = 4;
    const vertices = generateCover(f.elevation, f.bounds, [], f.settings, 7);
    expect(vertices.ok).toBe(false);
    expect(vertices).not.toHaveProperty('value');
    f.settings.limits.maxVertices = 1000000;
    f.settings.limits.maxFeatures = 1;
    const features = generateCover(f.elevation, f.bounds, [], f.settings, 7);
    expect(features.ok).toBe(false);
    expect(features).not.toHaveProperty('value');
  });
  it('hard-fails invalid parameters/unstable authority and never executes accessors', () => {
    const f = fixture();
    expect(() => generateCover(f.elevation, f.bounds, [], f.settings, -1)).toThrow(RangeError);
    const invalid = structuredClone(f.settings);
    invalid.cover.woodFraction = 0.8;
    invalid.cover.fieldFraction = 0.8;
    expect(() => generateCover(f.elevation, f.bounds, [], invalid, 7)).toThrow(
      /Requested cover fractions/,
    );
    f.elevation.samples[0] = 100.00000049;
    expect(() => success(f)).toThrow(/decimal-6/);
    f.elevation.samples[0] = 100;
    let called = false;
    const unsafe = Object.defineProperty({}, 'columns', {
      enumerable: true,
      get: () => {
        called = true;
        return 17;
      },
    });
    expect(() => generateCover(unsafe as Elevation, f.bounds, [], f.settings, 7)).toThrow();
    expect(called).toBe(false);
    expect(() =>
      success(f, [
        lake('lake:invalid', {
          outer: [
            [0, 0],
            [50, 50],
            [0, 50],
            [50, 0],
            [0, 0],
          ],
          holes: [],
        }),
      ]),
    ).toThrow();
  });
  it('uses the frozen settings parser for dimensions, planning allocation and policy relationships', () => {
    const f = fixture();
    const variants = [
      { ...f.settings, widthM: 401 },
      { ...f.settings, roads: { ...f.settings.roads, maxPlanningCells: 4 } },
      { ...f.settings, contours: { ...f.settings.contours, indexIntervalM: 51 } },
      {
        ...f.settings,
        hydrology: { ...f.settings.hydrology, minRiverWidthM: 50, maxRiverWidthM: 40 },
      },
    ];
    for (const invalid of variants) {
      let expected: Error | undefined;
      try {
        parseSettings(invalid);
      } catch (error) {
        expected = error as Error;
      }
      expect(expected).toBeDefined();
      expect(() => generateCover(f.elevation, f.bounds, [], invalid, 7)).toThrow(expected!.message);
    }
  });
  it('propagates unexpected programming exceptions instead of reporting infeasibility', () => {
    const f = fixture();
    const fault = new Error('Unexpected geometry fault');
    const spy = vi.spyOn(geometry, 'pointSegmentDistance').mockImplementation(() => {
      throw fault;
    });
    try {
      expect(() => success(f, [lake('lake:test', rect(0, 0, 100, 100))])).toThrow(fault);
    } finally {
      spy.mockRestore();
    }
  });
});
