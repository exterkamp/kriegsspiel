import { describe, expect, it } from 'vitest';
import type { GenerationResult, MapAsset, Point } from '../src/contract.js';
import { createElevationQueries } from '../src/queries.js';
import { realismReport } from '../src/realism.js';
import { generateElevation } from '../src/terrain/index.js';
import { generateCover, generateGeography, geographyPreset } from '../src/geography/index.js';
import { MAX_FIELD_SLOPE } from '../src/geography/cover/index.js';
import { SHALLOW_WATER } from '../src/geography/shallow.js';
import { expectPlausibleCrossings, expectRealisticCover } from './realism-checks.js';
import { generatePlanning } from '../src/planning/index.js';

/**
 * Measurable realism of generated ground, water, roads and sites (#490). The
 * regional stages are composed without local settlements to keep the corpus
 * cheap; complete assets get the same report in composition-representatives.
 */
const value = <T>(r: GenerationResult<T>): T => {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
};
function regional(preset: 'wooded-hills' | 'river-valley', seed: number) {
  const settings = geographyPreset(preset),
    bounds = { minX: 0 as const, minY: 0 as const, maxX: settings.widthM, maxY: settings.heightM },
    geo = value(
      generateGeography(value(generateElevation(settings, seed)), bounds, settings, seed),
    ),
    plan = value(
      generatePlanning({
        settings,
        seed,
        bounds,
        elevation: geo.elevation,
        water: geo.water,
        cover: geo.cover,
        crossingCandidates: geo.crossingCandidates,
        requireBridge: settings.hydrology.requireRiver,
        preferredSiteExtentM: { farm: 50 },
      }),
    );
  // Cover is laid out around the planned roads and sites, as composition does.
  const cover = value(
    generateCover(geo.elevation, bounds, geo.water, settings, seed, {
      roads: plan.roads,
      sites: plan.sites,
    }),
  );
  // Only the public layers the report reads; this is not a certified asset.
  const asset = {
    settings,
    bounds,
    elevation: geo.elevation,
    drainage: geo.drainage,
    layers: {
      cover,
      water: geo.water,
      roads: plan.roads,
      roadNodes: plan.roadNodes,
      crossings: plan.crossings,
      sites: plan.sites,
    },
  } as unknown as MapAsset;
  return { settings, geo, asset, report: realismReport(asset) };
}
const corpus = [
  ['river-valley', 97],
  ['river-valley', 3],
  ['wooded-hills', 31],
  ['wooded-hills', 7],
] as const;

describe('realistic generated battlefields', () => {
  for (const [preset, seed] of corpus)
    it(`${preset} seed ${seed}: drained relief, downhill rivers, graded roads, sensible sites`, () => {
      const { settings, geo, asset, report } = regional(preset, seed);
      // Terrain: erosion and filling leave no closed depressions, so every
      // sample drains to the boundary and no scattered ponds remain.
      expect(report.terrain.lakes).toBe(0);
      expect(report.terrain.boundaryDrainedShare).toBe(1);
      expect(report.terrain.reliefM).toBeGreaterThan(0.5 * settings.terrain.reliefM);
      // Rivers: a network that only descends, joins and reaches the edge.
      expect(report.rivers.features).toBeGreaterThan(1);
      expect(report.rivers.uphillSteps).toBe(0);
      expect(report.rivers.deadEnds).toBe(0);
      expect(report.rivers.systems).toBeGreaterThan(0);
      expect(report.rivers.maxFallM).toBeGreaterThan(5);
      if (preset === 'river-valley') expect(report.rivers.confluences).toBeGreaterThan(0);
      // Each reach sits in a valley: below the mean ground 300 m either side.
      const q = createElevationQueries({ elevation: geo.sourceElevation, bounds: asset.bounds });
      for (const w of geo.water) {
        if (w.kind !== 'river') continue;
        const mid = w.centreline[Math.floor(w.centreline.length / 2)]!,
          ring: Point[] = [
            [mid[0] + 300, mid[1]],
            [mid[0] - 300, mid[1]],
            [mid[0], mid[1] + 300],
            [mid[0], mid[1] - 300],
          ].filter(
            (p): p is Point =>
              p[0]! >= 0 && p[1]! >= 0 && p[0]! <= asset.bounds.maxX && p[1]! <= asset.bounds.maxY,
          ) as Point[];
        const around = ring.reduce((n, p) => n + q.heightAt(...p), 0) / ring.length;
        expect(w.surfaceProfileM[0]!).toBeLessThan(around);
      }
      // Roads: every certified segment is within the grade limit, the network
      // mostly follows gentle ground and keeps off the map margin.
      expect(report.roads.maxGrade).toBeLessThanOrEqual(settings.roads.maxGrade + 1e-9);
      expect(report.roads.meanGrade).toBeLessThan(0.05);
      expect(report.roads.marginShare).toBeLessThan(0.2);
      expect(report.roads.junctions).toBeGreaterThan(0);
      // Any bearing, not lattice zigzags (#541): a lattice network is ~97% on
      // the grid angles; the 20-seed total is held to 20% in realism-roads.
      expect(report.roads.gridAlignedShare).toBeLessThan(0.35);
      if (preset === 'river-valley') expect(report.roads.bridges).toBeGreaterThan(0);
      // Settlements: gentle ground, never a summit, never a river flat.
      expect(report.settlements.sites).toBe(
        settings.settlements.villageCount + settings.settlements.farmCount,
      );
      expect(report.settlements.maxAnchorSlope).toBeLessThanOrEqual(
        settings.settlements.maxBuildingGradient,
      );
      expect(report.settlements.summits).toBe(0);
      expect(report.settlements.lowRiverFlats).toBe(0);
      if (preset === 'river-valley')
        expect(report.settlements.villagesNearRiver).toBeGreaterThanOrEqual(0.5);
      expectRealisticCover(report, settings);
      expectPlausibleCrossings(report, settings);
      if (preset === 'wooded-hills') expect(report.crossings.fords).toBeGreaterThan(0);
    }, 60_000);

  it('detects uphill steps, dead ends, over-steep roads and lattice cover in a falsified layout', () => {
    const { asset } = regional('river-valley', 97);
    const broken = structuredClone(asset);
    const rivers = broken.layers.water.filter((w) => w.kind === 'river');
    // Raise one downstream reach above its upstream neighbour.
    const upstream = rivers.find((r) =>
      rivers.some(
        (o) =>
          o.id !== r.id &&
          o.centreline[0]![0] === r.centreline.at(-1)![0] &&
          o.centreline[0]![1] === r.centreline.at(-1)![1],
      ),
    )!;
    const downstream = rivers.find(
      (o) =>
        o.centreline[0]![0] === upstream.centreline.at(-1)![0] &&
        o.centreline[0]![1] === upstream.centreline.at(-1)![1],
    )!;
    if (downstream.kind === 'river')
      downstream.surfaceProfileM = downstream.surfaceProfileM.map(
        () => upstream.surfaceProfileM[0]! + 5,
      );
    // Detach another reach so it ends in open country.
    const last = rivers.find((r) => r.id !== upstream.id && r.id !== downstream.id)!;
    if (last.kind === 'river')
      last.centreline = last.centreline.slice(0, 2).map((p) => [p[0], p[1]]);
    // Send a road straight up the steepest pair of neighbouring samples.
    const e = broken.elevation;
    let steepest = { grade: 0, path: [] as Point[] };
    for (let i = 0; i < e.samples.length; i++)
      if (i % e.columns < e.columns - 1) {
        const grade = Math.abs(e.samples[i + 1]! - e.samples[i]!) / e.spacingM;
        if (grade > steepest.grade) {
          const x = (i % e.columns) * e.spacingM,
            y = Math.floor(i / e.columns) * e.spacingM;
          steepest = {
            grade,
            path: [
              [x, y],
              [x + e.spacingM, y],
            ],
          };
        }
      }
    expect(steepest.grade).toBeGreaterThan(asset.settings.roads.maxGrade);
    broken.layers.roads.push({
      ...broken.layers.roads[0]!,
      kind: 'regional',
      crossingIds: [],
      path: steepest.path,
    });
    // Replace the cover with lattice blocks (v1 style): woods on the flattest
    // ground, fields on the steepest, ignoring the slope limit.
    const e2 = broken.elevation,
      heights = createElevationQueries(broken),
      blocks: typeof broken.layers.cover = [];
    for (let y = 0; y < broken.bounds.maxY; y += 250)
      for (let x = 0; x < broken.bounds.maxX; x += 250) {
        let slope = 0;
        for (let j = y; j <= y + 250; j += e2.spacingM)
          for (let i = x; i <= x + 250; i += e2.spacingM)
            slope = Math.max(slope, heights.slopeAt(i, j));
        blocks.push({
          id: `cover:${blocks.length}`,
          kind: slope > MAX_FIELD_SLOPE ? 'field' : 'wood',
          polygons: [
            {
              outer: [
                [x, y],
                [x + 250, y],
                [x + 250, y + 250],
                [x, y + 250],
                [x, y],
              ],
              holes: [],
            },
          ],
        });
      }
    broken.layers.cover = blocks;
    const report = realismReport(broken);
    expect(report.cover.axisAlignedShare).toBe(1);
    expect(report.cover.fieldMaxSlope).toBeGreaterThan(MAX_FIELD_SLOPE);
    expect(report.cover.woodMeanSlope).toBeLessThan(report.cover.fieldMeanSlope);
    expect(report.rivers.uphillSteps).toBeGreaterThan(0);
    expect(report.rivers.deadEnds).toBeGreaterThan(0);
    expect(report.roads.maxGrade).toBeGreaterThan(asset.settings.roads.maxGrade);
  }, 60_000);

  it('flags a main road fording deep water in a falsified layout', () => {
    const { asset, report } = regional('river-valley', 97);
    expect(report.crossings.mainRoadCrossings).toBeGreaterThan(0);
    expect(report.crossings.bridgeMinDepthM).toBeGreaterThan(SHALLOW_WATER.maxFordDepthM);
    // Turn every bridge into a ford: the main-road ones now ford deep water.
    const broken = structuredClone(asset);
    broken.layers.crossings = broken.layers.crossings.map((c) => ({
      ...c,
      kind: 'ford' as const,
      depthM: 2,
      traversableWidthM: c.widthM,
    }));
    const flagged = realismReport(broken).crossings;
    expect(flagged.bridges).toBe(0);
    expect(flagged.fordsOnMainRoads).toBeGreaterThan(0);
    expect(flagged.fordMaxDepthM).toBeGreaterThan(SHALLOW_WATER.maxFordDepthM);
  }, 60_000);
});
