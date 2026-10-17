import { describe, expect, it } from 'vitest';
import type { Elevation, GenerationResult } from '../src/contract.js';
import { grainRealism, summarizeGrain, type GrainRealism } from '../src/realism.js';
import { generateElevation, reliefShape, RELIEF_SHAPE } from '../src/terrain/index.js';
import { generateHydrology, geographyPreset } from '../src/geography/index.js';
import { expectUnbiasedGrain } from './realism-checks.js';

/**
 * Generated ground and rivers have no shared combed angle (#540). Terrain and
 * hydrology only: the measurement reads ground and water, and roads and
 * settlements do not change either at this scale.
 */
const value = <T>(r: GenerationResult<T>): T => {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
};
function measure(preset: 'wooded-hills' | 'river-valley', seed: number): GrainRealism {
  const settings = geographyPreset(preset),
    bounds = { minX: 0 as const, minY: 0 as const, maxX: settings.widthM, maxY: settings.heightM },
    hydro = value(
      generateHydrology(value(generateElevation(settings, seed)), bounds, settings, seed),
    );
  return grainRealism({ bounds, elevation: hydro.elevation, layers: { water: hydro.water } });
}
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

describe('unbiased relief and rivers', () => {
  it('measures elongation, lattice aspect and lattice-aligned banks on a combed field', () => {
    // Ridges along 45 degrees: every slope faces 135 degrees, one river runs
    // along an axis-aligned rectangle following the ridges' cross axis.
    const columns = 41,
      spacing = 25,
      samples: number[] = [];
    for (let y = 0; y < columns; y++)
      for (let x = 0; x < columns; x++)
        samples.push(Number((10 * Math.sin((x - y) / 3)).toFixed(6)));
    const elevation: Elevation = { columns, rows: columns, spacingM: spacing, samples },
      bounds = { minX: 0 as const, minY: 0 as const, maxX: 1000, maxY: 1000 },
      ring: [number, number][] = [
        [100, 480],
        [900, 480],
        [900, 520],
        [100, 520],
        [100, 480],
      ];
    const report = grainRealism({
      bounds,
      elevation,
      layers: {
        water: [
          {
            id: 'water:river:000:000',
            kind: 'river',
            centreline: [
              [100, 500],
              [900, 500],
            ],
            widthM: 40,
            surfacePolicy: 'standing-water-v1',
            surfaceProfileM: [0, 0],
            polygons: [{ outer: ring, holes: [] }],
          },
        ],
      },
    });
    expect(report.anisotropy).toBeGreaterThan(100);
    expect(report.aspectLatticeShare[3]).toBeGreaterThan(0.95);
    // The grain runs along the ridges (45 degrees); the banks cross it at 45.
    expect(Math.abs(report.grainAxis[0] * report.grainAxis[1])).toBeCloseTo(0.5, 6);
    expect(report.riverGrainAlignment).toBeCloseTo(Math.SQRT1_2, 6);
    expect(report.riverGridShare[0] + report.riverGridShare[2]).toBe(1);
    // A level plateau is isotropic and has no aspect.
    const flat = grainRealism({
      bounds,
      elevation: { ...elevation, samples: samples.map(() => 100) },
      layers: { water: [] },
    });
    expect(flat).toMatchObject({ anisotropy: 1, aspectLatticeShare: [0, 0, 0, 0] });
    expect(summarizeGrain([report, flat]).riverGridTotal).toBe(1);
  });

  it('keeps 20 seeds of wooded hills and river valleys free of grain and lattice angles', () => {
    const reports = [
      ...seeds.map((seed) => measure('wooded-hills', seed)),
      ...seeds.map((seed) => measure('river-valley', seed)),
    ];
    expectUnbiasedGrain(summarizeGrain(reports));
  }, 300_000);

  it('draws the grain from the seed and the recipe: mostly mild, occasionally strong', () => {
    const hills = geographyPreset('wooded-hills').terrain,
      valley = geographyPreset('river-valley').terrain,
      shapes = Array.from({ length: 400 }, (_, seed) => reliefShape(hills, seed));
    // One seed, two recipes: different grain axes.
    for (const seed of [1, 2, 3])
      expect(reliefShape(hills, seed).grain).not.toEqual(reliefShape(valley, seed).grain);
    expect(reliefShape(hills, 1)).toEqual(reliefShape(hills, 1));
    const strong = shapes.filter((s) => s.stretch >= RELIEF_SHAPE.grainStrong[0]).length;
    expect(strong / shapes.length).toBeGreaterThan(0.06);
    expect(strong / shapes.length).toBeLessThan(0.2);
    expect(shapes.every((s) => s.stretch >= 1 && s.stretch < RELIEF_SHAPE.grainStrong[1])).toBe(
      true,
    );
    const tilts = shapes.map((s) => s.tilt);
    expect(Math.max(...tilts)).toBeLessThan(0.3); // v2 tilted every map by 0.3
    expect(tilts.reduce((a, b) => a + b) / tilts.length).toBeLessThan(0.15);
    // Grain axes cover every direction.
    const quadrants = new Set(
      shapes.map(
        (s) =>
          (s.grain[0] * s.grain[1] >= 0 ? 'a' : 'b') +
          (Math.abs(s.grain[0]) > Math.abs(s.grain[1]) ? 'x' : 'y'),
      ),
    );
    expect(quadrants.size).toBe(4);
  });
});
