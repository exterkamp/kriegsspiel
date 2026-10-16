import { type Elevation, type GenerationResult, type MapSettings } from '../contract.js';
import { fail } from '../errors.js';
import { deriveSeed } from '../overrides.js';
import { parseSettings } from '../validation.js';
import { decimal6 } from './precision.js';
import { requireGridPrecision } from './input.js';
import { bounded, information, TerrainLimit, WorkBudget } from './budgets.js';
import { erodeRelief } from './erosion.js';

export const TERRAIN_VERSION = 'structured-relief-eroded-v2' as const;
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

/**
 * Fixed v2 landform shape. Grain stretches features along one seeded axis,
 * domain warping bends ridge lines, and a regional tilt gives drainage a
 * dominant direction across the map, as on real dissected uplands.
 */
export const RELIEF_SHAPE = Object.freeze({
  grainAnisotropy: 2.5,
  warpScale: 2,
  warpAmplitude: 0.45,
  tilt: 0.3,
});

/** Seeded unit vector built with a square root only, never trigonometry. */
function direction(seed: number): [number, number] {
  for (let k = 0; ; k++) {
    const a = lattice(seed, k, 0),
      b = lattice(seed, k, 1),
      r = a * a + b * b;
    if (r > 0.01 && r <= 1) {
      const m = Math.sqrt(r);
      return [a / m, b / m];
    }
  }
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
    const stream = `terrain:${TERRAIN_VERSION}`;
    deriveSeed(seed, stream); // validate before any field allocation
    const columns = Math.round(s.widthM / s.sampleSpacingM) + 1,
      rows = Math.round(s.heightM / s.sampleSpacingM) + 1;
    const count = columns * rows;
    const octaves: { seed: number; scale: number; weight: number }[] = [];
    let weight = 1,
      total = 0;
    for (let i = 0; i < t.octaves; i++) {
      const scale = t.featureScaleM / 2 ** i;
      if (
        scale < 0.001 ||
        (RELIEF_SHAPE.grainAnisotropy * 2 * Math.max(s.widthM, s.heightM)) / scale > 0x7ffffffe
      )
        fail(
          '$.settings.terrain.featureScaleM',
          'Finest terrain feature scale must be >=.001 m and fit the signed lattice range',
        );
      if (weight) {
        octaves.push({ seed: deriveSeed(seed, stream, `octave:${i}`), scale, weight });
        total += weight;
      }
      weight *= t.roughness;
    }
    const ridgeSeed = deriveSeed(seed, stream, 'ridge'),
      valleySeed = deriveSeed(seed, stream, 'valley'),
      warpX = deriveSeed(seed, stream, 'warp-x'),
      warpY = deriveSeed(seed, stream, 'warp-y'),
      [gx, gy] = direction(deriveSeed(seed, stream, 'grain')),
      [tx, ty] = direction(deriveSeed(seed, stream, 'tilt'));
    const work = new WorkBudget(s.limits.maxTopologyChecks, 'terrain', 'sample-octave evaluations');
    const evaluations = t.reliefM
      ? count * (octaves.length + 2 + Number(t.ridgeStrength > 0) + Number(t.valleyStrength > 0))
      : count;
    work.take(evaluations); // reserve complete work before allocating samples
    if (
      Math.abs(t.baseHeightM) +
        t.reliefM * (0.5 + 0.5 * Math.max(t.ridgeStrength, t.valleyStrength) + RELIEF_SHAPE.tilt) >
      100_000
    )
      throw new TerrainLimit(
        'terrain',
        'height range',
        'Requested terrain may exceed the ±100000 m contract height range.',
      );
    if (!t.reliefM)
      return {
        ok: true,
        value: {
          columns,
          rows,
          spacingM: s.sampleSpacingM,
          samples: new Array<number>(count).fill(decimal6(t.baseHeightM)),
        },
        diagnostics: [
          information(
            'terrain',
            'ELEVATION_GENERATED',
            `${columns}×${rows} level plateau; zero relief; ${TERRAIN_VERSION}.`,
          ),
        ],
      };
    const field = new Float64Array(count),
      F = t.featureScaleM,
      half = Math.max(s.widthM, s.heightM) / 2,
      warp = F * RELIEF_SHAPE.warpScale;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const xm = x * s.sampleSpacingM,
          ym = y * s.sampleSpacingM;
        // Domain warp in metres, then rotate into the grain frame and stretch along it.
        const wx = xm + RELIEF_SHAPE.warpAmplitude * F * noise(warpX, xm / warp, ym / warp),
          wy = ym + RELIEF_SHAPE.warpAmplitude * F * noise(warpY, xm / warp, ym / warp),
          u = (wx * gx + wy * gy) / RELIEF_SHAPE.grainAnisotropy,
          v = -wx * gy + wy * gx;
        let rolling = 0;
        for (const octave of octaves)
          rolling += octave.weight * noise(octave.seed, u / octave.scale, v / octave.scale);
        const r = t.ridgeStrength ? 1 - Math.abs(noise(ridgeSeed, u / F, v / F)) : 0,
          w = t.valleyStrength ? 1 - Math.abs(noise(valleySeed, u / F, v / F)) : 0,
          tilt = ((xm - s.widthM / 2) * tx + (ym - s.heightM / 2) * ty) / half;
        field[y * columns + x] =
          t.baseHeightM +
          t.reliefM *
            0.5 *
            (rolling / total +
              t.ridgeStrength * r * r -
              t.valleyStrength * w * w +
              RELIEF_SHAPE.tilt * tilt);
      }
    erodeRelief(
      field,
      columns,
      rows,
      new WorkBudget(
        Math.min(100_000_000, 20 * s.limits.maxTopologyChecks),
        'terrain',
        'erosion work',
      ),
    );
    const samples = Array.from(field, decimal6);
    return {
      ok: true,
      value: { columns, rows, spacingM: s.sampleSpacingM, samples },
      diagnostics: [
        information(
          'terrain',
          'ELEVATION_GENERATED',
          `${columns}×${rows} row-major ground; ${evaluations} sample-octave evaluations; eroded and drained; ${TERRAIN_VERSION}.`,
        ),
      ],
    };
  });
}
