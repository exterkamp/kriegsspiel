import { type Elevation, type GenerationResult, type MapSettings } from '../contract.js';
import { fail } from '../errors.js';
import { deriveSeed } from '../overrides.js';
import { parseSettings } from '../validation.js';
import { decimal6 } from './precision.js';
import { requireGridPrecision } from './input.js';
import { bounded, information, TerrainLimit, WorkBudget } from './budgets.js';

export const TERRAIN_VERSION = 'value-noise-ridges-v1' as const;
function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function noise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = fade(x - ix),
    v = fade(y - iy);
  return lerp(
    lerp(lattice(seed, ix, iy), lattice(seed, ix + 1, iy), u),
    lerp(lattice(seed, ix, iy + 1), lattice(seed, ix + 1, iy + 1), u),
    v,
  );
}

/** Seeded ground only. Contour/settings/settlement streams cannot consume it. */
export function generateElevation(
  settings: MapSettings,
  seed: number,
): GenerationResult<Elevation> {
  return bounded('terrain', () => {
    const s = parseSettings(settings),
      t = s.terrain;
    requireGridPrecision({ minX: 0, minY: 0, maxX: s.widthM, maxY: s.heightM }, s.sampleSpacingM);
    deriveSeed(seed, `terrain:${TERRAIN_VERSION}`); // validate before any field allocation
    const columns = Math.round(s.widthM / s.sampleSpacingM) + 1,
      rows = Math.round(s.heightM / s.sampleSpacingM) + 1;
    const count = columns * rows;
    const octaves: { seed: number; scale: number; weight: number }[] = [];
    let weight = 1,
      total = 0;
    for (let i = 0; i < t.octaves; i++) {
      const scale = t.featureScaleM / 2 ** i;
      if (scale < 0.001 || Math.max(s.widthM, s.heightM) / scale > 0x7ffffffe)
        fail(
          '$.settings.terrain.featureScaleM',
          'Finest terrain feature scale must be >=.001 m and fit the signed lattice range',
        );
      if (weight) {
        octaves.push({
          seed: deriveSeed(seed, `terrain:${TERRAIN_VERSION}`, `octave:${i}`),
          scale,
          weight,
        });
        total += weight;
      }
      weight *= t.roughness;
    }
    const ridgeSeed = deriveSeed(seed, `terrain:${TERRAIN_VERSION}`, 'ridge'),
      valleySeed = deriveSeed(seed, `terrain:${TERRAIN_VERSION}`, 'valley');
    const work = new WorkBudget(s.limits.maxTopologyChecks, 'terrain', 'sample-octave evaluations');
    const evaluations = t.reliefM
      ? count * (octaves.length + Number(t.ridgeStrength > 0) + Number(t.valleyStrength > 0))
      : count;
    work.take(evaluations); // reserve complete work before allocating samples
    if (
      Math.abs(t.baseHeightM) +
        t.reliefM * (0.5 + 0.5 * Math.max(t.ridgeStrength, t.valleyStrength)) >
      100_000
    )
      throw new TerrainLimit(
        'terrain',
        'height range',
        'Requested terrain may exceed the ±100000 m contract height range.',
      );
    const samples = new Array<number>(count);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const xm = x * s.sampleSpacingM,
          ym = y * s.sampleSpacingM;
        let rolling = 0;
        if (t.reliefM)
          for (const octave of octaves)
            rolling += octave.weight * noise(octave.seed, xm / octave.scale, ym / octave.scale);
        const ridge =
          t.reliefM && t.ridgeStrength
            ? 1 - Math.abs(noise(ridgeSeed, xm / t.featureScaleM, ym / t.featureScaleM))
            : 0;
        const valley =
          t.reliefM && t.valleyStrength
            ? 1 - Math.abs(noise(valleySeed, xm / t.featureScaleM, ym / t.featureScaleM))
            : 0;
        samples[y * columns + x] = decimal6(
          t.baseHeightM +
            t.reliefM *
              0.5 *
              (rolling / total + t.ridgeStrength * ridge - t.valleyStrength * valley),
        );
      }
    return {
      ok: true,
      value: { columns, rows, spacingM: s.sampleSpacingM, samples },
      diagnostics: [
        information(
          'terrain',
          'ELEVATION_GENERATED',
          `${columns}×${rows} row-major ground; ${evaluations} sample-octave evaluations; ${TERRAIN_VERSION}.`,
        ),
      ],
    };
  });
}
