import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Polygon,
  type Water,
} from '../src/contract.js';
import {
  findCrossingCandidates,
  fordDepthM,
  generateGeography,
  geographyPreset,
  isMinorRoute,
  reachSlope,
  riffleDepthM,
  SHALLOW_WATER,
} from '../src/geography/index.js';
import { generateElevation } from '../src/terrain/index.js';
import { decimal6 } from '../src/terrain/precision.js';
import {
  certifyFord,
  generatePlanning,
  validatePlanning,
  type PlanningInput,
} from '../src/planning/index.js';

const value = <T>(r: GenerationResult<T>): T => {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
};
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
  holes: [],
});
const SIZE = 200,
  SPACING = 5;
const bounds = { minX: 0 as const, minY: 0 as const, maxX: SIZE, maxY: SIZE };
function settings(): MapSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = SIZE;
  s.sampleSpacingM = SPACING;
  return s;
}
/** A straight north-south channel `width` wide in a V valley rising `grade` per metre. */
function valley(width: number, grade: number): { elevation: Elevation; water: Water[] } {
  const n = SIZE / SPACING + 1,
    samples: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const off = Math.abs(x * SPACING - 100);
      samples.push(decimal6(off < width / 2 ? 4 : 5 + grade * (off - width / 2)));
    }
  return {
    elevation: { columns: n, rows: n, spacingM: SPACING, samples },
    water: [
      {
        id: 'water:river:000:000',
        kind: 'river',
        polygons: [rect(100 - width / 2, 0, 100 + width / 2, 200)],
        centreline: [
          [100, 0],
          [100, 200],
        ],
        widthM: width,
        surfacePolicy: 'standing-water-v1',
        surfaceProfileM: [5, 5],
      },
    ],
  };
}
const planningInput = (v: ReturnType<typeof valley>): PlanningInput => ({
  settings: settings(),
  seed: 1,
  bounds,
  elevation: v.elevation,
  water: v.water,
});

describe('shallow-water model (shallow-riffle-v1)', () => {
  it('deepens with width and shallows with slope, from square roots only', () => {
    expect(riffleDepthM(10, 0.003)).toBeCloseTo(SHALLOW_WATER.referenceDepthM, 12);
    // Width^0.75: sixteen times as wide is eight times as deep.
    expect(riffleDepthM(160, 0.003)).toBeCloseTo(8 * SHALLOW_WATER.referenceDepthM, 12);
    // Slope^-0.25: sixteen times steeper is half as deep; the slope is clamped.
    expect(riffleDepthM(10, 0.003 / 16)).toBeCloseTo(riffleDepthM(10, SHALLOW_WATER.minSlope), 12);
    expect(riffleDepthM(10, 0.0005)).toBeCloseTo(2 * riffleDepthM(10, 0.0005 * 16), 12);
    expect(riffleDepthM(10, 1)).toBe(riffleDepthM(10, SHALLOW_WATER.maxSlope));
    for (let w = 5; w < 100; w += 5)
      expect(riffleDepthM(w + 5, 0.003)).toBeGreaterThan(riffleDepthM(w, 0.003));
    // Brooks wade, a broad slow river does not.
    expect(riffleDepthM(10, 0.01)).toBeLessThan(SHALLOW_WATER.maxFordDepthM);
    expect(riffleDepthM(60, 0.001)).toBeGreaterThan(SHALLOW_WATER.maxFordDepthM);
  });
  it('takes reach slope from the downstream neighbour, or still water at an outlet', () => {
    const reach = (id: string, x0: number, x1: number, level: number): Water => ({
      id,
      kind: 'river',
      polygons: [rect(x0, 95, x1, 105)],
      centreline: [
        [x0, 100],
        [x1, 100],
      ],
      widthM: 10,
      surfacePolicy: 'standing-water-v1',
      surfaceProfileM: [level, level],
    });
    const up = reach('water:river:000:000', 0, 100, 10),
      down = reach('water:river:000:001', 100, 200, 9),
      water = [up, down];
    if (up.kind !== 'river' || down.kind !== 'river') throw Error('river');
    expect(reachSlope(up, water)).toBeCloseTo(0.01, 12);
    // The last reach ends on the map edge: still water, so it is deepest.
    expect(reachSlope(down, water)).toBe(0);
    expect(fordDepthM(down, water)).toBeGreaterThan(fordDepthM(up, water));
    // A tributary ending inside a larger reach takes that reach's level.
    const side: Water = {
      id: 'water:river:001:000',
      kind: 'river',
      centreline: [
        [150, 0],
        [150, 100],
      ],
      polygons: [rect(145, 0, 155, 99)],
      widthM: 10,
      surfacePolicy: 'standing-water-v1',
      surfaceProfileM: [9.5, 9.5],
    };
    expect(reachSlope(side, [...water, side])).toBeCloseTo(0.5 / 100, 12);
  });
  it('classifies farm routes as minor and village or boundary routes as main', () => {
    const sites = [
      { id: 'site:village:0000', kind: 'village' as const },
      { id: 'site:village:0001', kind: 'village' as const },
      { id: 'site:farm:0000', kind: 'farm' as const },
    ];
    expect(isMinorRoute('route:site:farm:0000:site:village:0001', sites)).toBe(true);
    expect(isMinorRoute('route:extra:site:village:0000:site:farm:0000', sites)).toBe(true);
    expect(isMinorRoute('route:site:village:0000:site:village:0001', sites)).toBe(false);
    expect(isMinorRoute('route:site:village:0000:boundary:west', sites)).toBe(false);
    expect(isMinorRoute('route:bridge:crossing-candidate:x', sites)).toBe(false);
    expect(isMinorRoute('route:site:farm:0009:site:village:0000', sites)).toBe(false);
    expect(isMinorRoute('route:0000:access', sites)).toBe(false);
  });
});

describe('ford sites and certificates', () => {
  it('fords a shallow brook with low banks and gentle sides, and certifies it', () => {
    const v = valley(10, 0.03),
      s = settings(),
      found = value(findCrossingCandidates(v.water, bounds, s, {}, v.elevation)),
      fords = found.filter((c) => c.kind === 'ford');
    expect(fords.length).toBeGreaterThan(0);
    const river = v.water[0]!;
    if (river.kind !== 'river') throw Error('river');
    for (const f of fords) {
      expect(f.depthM).toBe(fordDepthM(river, v.water));
      expect(f.depthM!).toBeLessThanOrEqual(SHALLOW_WATER.maxFordDepthM);
      // Fords keep clear of each other and of bridges.
      for (const other of found)
        if (other !== f)
          expect(Math.abs(other.endpoints[0][1] - f.endpoints[0][1])).toBeGreaterThan(
            s.roads.maxReservedWidthM,
          );
    }
    const profile = value(certifyFord(planningInput(v), fords[0]!));
    expect(profile.policy).toBe('shallow-riffle-v1');
    expect(profile.depthM).toBe(fords[0]!.depthM);
    expect(Math.max(...profile.bankHeightsM)).toBeLessThanOrEqual(SHALLOW_WATER.maxBankM);
    expect(profile.maxGrade).toBeLessThanOrEqual(s.roads.maxGrade);
    // Deterministic.
    expect(value(findCrossingCandidates(v.water, bounds, s, {}, v.elevation))).toEqual(found);
    // Without ground there is nothing to judge banks by: bridges only.
    expect(
      value(findCrossingCandidates(v.water, bounds, s)).every((c) => c.kind === 'bridge'),
    ).toBe(true);
  });
  it('leaves deep water, high banks and steep sides to bridges', () => {
    const s = settings();
    // A wide still river is too deep to wade.
    const deep = valley(60, 0.03);
    expect(
      value(findCrossingCandidates(deep.water, bounds, s, {}, deep.elevation)).some(
        (c) => c.kind === 'ford',
      ),
    ).toBe(false);
    // Steep valley sides: high banks and steep ramps.
    const steep = valley(10, 0.3);
    expect(
      value(findCrossingCandidates(steep.water, bounds, s, {}, steep.elevation)).some(
        (c) => c.kind === 'ford',
      ),
    ).toBe(false);
  });
  it('rejects a forged depth, a ford over deep water and a ford on a high bank', () => {
    const v = valley(10, 0.03),
      s = settings(),
      ford = value(findCrossingCandidates(v.water, bounds, s, {}, v.elevation)).find(
        (c) => c.kind === 'ford',
      )!;
    expect(certifyFord(planningInput(v), { ...ford, depthM: ford.depthM! - 0.1 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'FORD_DEPTH' }],
    });
    // The same crossing over a river recorded twice as wide is too deep.
    const wide = structuredClone(v);
    const river = wide.water[0]!;
    if (river.kind === 'river') river.widthM = 60;
    expect(
      certifyFord(planningInput(wide), { ...ford, depthM: fordDepthM(river as never, wide.water) }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'FORD_DEPTH' }] });
    // Raise the ground under one end well above the water.
    const high = structuredClone(v),
      [a] = ford.endpoints,
      n = SIZE / SPACING + 1;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (Math.abs(x * SPACING - a[0]) <= 2 * SPACING && Math.abs(y * SPACING - a[1]) <= 15)
          high.elevation.samples[y * n + x] = 8;
    expect(certifyFord(planningInput(high), ford)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'FORD_BANK' }],
    });
    // A bridge is not a ford.
    expect(certifyFord(planningInput(v), { ...ford, kind: 'bridge' })).toMatchObject({
      ok: false,
    });
  });
});

describe('fords in a planned wooded-hills network', () => {
  it('fords brooks on farm roads only and certifies the plan; a main-road ford fails', () => {
    // Seed 7 fords two brooks. Seed 31 forded one before D48; its knight moves
    // reach that farm by a shorter road on its own bank, so it no longer fords.
    const s = geographyPreset('wooded-hills'),
      seed = 7,
      b = { minX: 0 as const, minY: 0 as const, maxX: s.widthM, maxY: s.heightM },
      geo = value(
        generateGeography(value(generateElevation(s, seed)), b, s, seed, {}, { cover: false }),
      ),
      input: PlanningInput = {
        settings: s,
        seed,
        bounds: b,
        elevation: geo.elevation,
        water: geo.water,
        crossingCandidates: geo.crossingCandidates,
        preferredSiteExtentM: { farm: 50 },
      },
      plan = value(generatePlanning(input));
    const fords = plan.crossings.filter((c) => c.kind === 'ford');
    expect(fords.length).toBeGreaterThan(0);
    expect(plan.fords.map((f) => f.crossingId)).toEqual(fords.map((f) => f.id));
    for (const f of fords)
      for (const id of f.roadIds)
        for (const route of plan.roads.find((r) => r.id === id)!.routeIds)
          expect(isMinorRoute(route, plan.sites)).toBe(true);
    expect(validatePlanning(input, plan).ok).toBe(true);
    const forged = structuredClone(plan),
      road = forged.roads.find((r) => r.id === fords[0]!.roadIds[0])!,
      main = plan.routes.find((r) => !isMinorRoute(r.id, plan.sites))!;
    road.routeIds = [...road.routeIds, main.id].sort();
    expect(validatePlanning(input, forged)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'FORD_MAIN_ROAD' }],
    });
  }, 60_000);
});
