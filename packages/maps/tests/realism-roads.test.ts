import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importAsset } from '../src/import.js';
import type { GenerationResult, MapAsset } from '../src/contract.js';
import { gridAligned, realismReport } from '../src/realism.js';
import { generateElevation } from '../src/terrain/index.js';
import { generateGeography, geographyPreset } from '../src/geography/index.js';
import { generatePlanning, type RegionalPlanningOutput } from '../src/planning/index.js';
import { expectPlausibleCrossings } from './realism-checks.js';

/**
 * Any-angle roads (#541, D48) over a corpus of 20 seeds of two presets. The
 * regional stages are composed without cover or settlements to keep it cheap;
 * `generatePlanning` certifies every road (grade, water, sites, bounds) and
 * the connection of every site and exit before it returns.
 */
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const PRESETS = ['river-valley', 'wooded-hills'] as const;
/** The issue's threshold: at most 20% of road length on the four grid angles, in total. */
const MAX_GRID_ALIGNED_SHARE = 0.2;

function plan(preset: (typeof PRESETS)[number], seed: number) {
  const settings = geographyPreset(preset),
    bounds = { minX: 0 as const, minY: 0 as const, maxX: settings.widthM, maxY: settings.heightM };
  let geo;
  try {
    const elevation = generateElevation(settings, seed);
    if (!elevation.ok) return undefined;
    const g = generateGeography(
      elevation.value,
      bounds,
      settings,
      seed,
      {},
      {
        cover: false,
      },
    );
    if (!g.ok) return undefined;
    geo = g.value;
  } catch {
    // Geography failures on some seeds are tracked separately (#542).
    return undefined;
  }
  const result: GenerationResult<RegionalPlanningOutput> = generatePlanning({
    settings,
    seed,
    bounds,
    elevation: geo.elevation,
    water: geo.water,
    crossingCandidates: geo.crossingCandidates,
    requireBridge: settings.hydrology.requireRiver,
    preferredSiteExtentM: { farm: 50 },
  });
  // A few seeds fail on main as well (on D47 relief, wooded-hills 2 and 11 throw
  // in geography; #542); the corpus allows four failed maps in all.
  if (!result.ok) return undefined;
  const p = result.value;
  // Only the public layers the report reads; this is not a certified asset.
  const asset = {
    settings,
    bounds,
    elevation: geo.elevation,
    drainage: geo.drainage,
    layers: {
      cover: [],
      water: geo.water,
      roads: p.roads,
      roadNodes: p.roadNodes,
      crossings: p.crossings,
      sites: p.sites,
    },
  } as unknown as MapAsset;
  return { settings, plan: p, report: realismReport(asset) };
}

describe('any-angle regional roads (#541)', () => {
  it('measures grid-aligned length', () => {
    expect(gridAligned([0, 0], [100, 0])).toBe(true);
    expect(gridAligned([0, 0], [100, 4])).toBe(true); // 2.3°
    expect(gridAligned([0, 0], [100, 5])).toBe(false); // 2.9°
    expect(gridAligned([0, 0], [-70, 70])).toBe(true);
    expect(gridAligned([0, 0], [100, 58])).toBe(false); // 30°
    expect(gridAligned([5, 5], [5, 5])).toBe(false);
    // A saved D46 map has lattice roads only.
    const saved = importAsset(
      readFileSync(new URL('./fixtures/d46-saved-map.json', import.meta.url), 'utf8'),
    );
    expect(realismReport(saved).roads.gridAlignedShare).toBeGreaterThan(0.9);
  });

  it(`keeps at most ${MAX_GRID_ALIGNED_SHARE * 100}% of road length on the grid angles over ${SEEDS.length} seeds of ${PRESETS.join(' and ')}`, () => {
    let length = 0,
      aligned = 0,
      maps = 0;
    for (const preset of PRESETS)
      for (const seed of SEEDS) {
        const run = plan(preset, seed);
        if (!run) continue;
        maps++;
        const { settings, plan: p, report } = run;
        // Grade, edge avoidance and crossings still pass the realism checks.
        expect(report.roads.maxGrade).toBeLessThanOrEqual(settings.roads.maxGrade + 1e-9);
        expect(report.roads.marginShare).toBeLessThan(0.2);
        expectPlausibleCrossings(report, settings);
        // Every site is joined to the network.
        for (const site of p.sites) expect(site.entrances.length).toBeGreaterThan(0);
        length += report.roads.lengthM;
        aligned += report.roads.gridAlignedShare * report.roads.lengthM;
      }
    console.info(
      `grid-aligned road length: ${((100 * aligned) / length).toFixed(1)}% of ${(length / 1000).toFixed(0)} km over ${maps} maps`,
    );
    expect(maps).toBeGreaterThanOrEqual(PRESETS.length * SEEDS.length - 4);
    expect(aligned / length).toBeLessThanOrEqual(MAX_GRID_ALIGNED_SHARE);
  }, 900_000);
});
