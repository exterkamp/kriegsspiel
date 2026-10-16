import { type Elevation, type GenerationResult, type MapSettings } from '../contract.js';
import { fail } from '../errors.js';
import { deriveSeed } from '../overrides.js';
import { parseSettings } from '../validation.js';
import { decimal6 } from './precision.js';
import { requireGridPrecision } from './input.js';
import { bounded, information, TerrainLimit, WorkBudget } from './budgets.js';
import { erodeRelief } from './erosion.js';

export const TERRAIN_VERSION = 'gradient-relief-eroded-v3' as const;
function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Uniform in [0, 1) from a lattice hash. */
const unit = (seed: number, x: number, y: number) => lattice(seed, x, y) / 0x100000000;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Twenty-four unit gradients at 7.5 + 15k degrees: literal cosines and sines
 * for the first quadrant, the rest by exact quarter turns. No gradient lies on
 * a lattice axis or diagonal.
 */
const GRADIENTS: readonly (readonly [number, number])[] = (() => {
  const quadrant = [
    [0.9914448613738104, 0.13052619222005157],
    [0.9238795325112867, 0.3826834323650898],
    [0.7933533402912352, 0.6087614290087207],
    [0.6087614290087207, 0.7933533402912352],
    [0.3826834323650898, 0.9238795325112867],
    [0.13052619222005157, 0.9914448613738104],
  ] as const;
  const all: [number, number][] = [];
  for (let turn = 0; turn < 4; turn++)
    for (const [x, y] of quadrant)
      all.push(turn === 0 ? [x, y] : turn === 1 ? [-y, x] : turn === 2 ? [-x, -y] : [y, -x]);
  return Object.freeze(all);
})();

/**
 * One rotated, offset gradient-noise field. Every field (octave, warp, ridge,
 * valley) has its own seeded rotation and lattice offset, so the lattices of
 * different octaves never align and no lattice direction dominates the sum.
 */
interface NoiseField {
  seed: number;
  cos: number;
  sin: number;
  ox: number;
  oy: number;
}
function noiseField(seed: number): NoiseField {
  const [cos, sin] = direction(seed);
  return { seed, cos, sin, ox: unit(seed, 1, 2) * 256, oy: unit(seed, 2, 1) * 256 };
}
/** Perlin gradient noise, scaled to about the unit range (|n| <= 1). */
function noise(f: NoiseField, x: number, y: number): number {
  const px = x * f.cos - y * f.sin + f.ox,
    py = x * f.sin + y * f.cos + f.oy,
    ix = Math.floor(px),
    iy = Math.floor(py),
    fx = px - ix,
    fy = py - iy,
    corner = (cx: number, cy: number) => {
      const g = GRADIENTS[lattice(f.seed, ix + cx, iy + cy) % 24]!;
      return g[0] * (fx - cx) + g[1] * (fy - cy);
    },
    u = fade(fx),
    v = fade(fy);
  return 1.4 * lerp(lerp(corner(0, 0), corner(1, 0), u), lerp(corner(0, 1), corner(1, 1), u), v);
}

/**
 * Fixed v3 landform shape. Grain stretches features along one axis per map,
 * by a factor drawn from `grain`: mild on most maps, occasionally strong.
 * Domain warping bends ridge lines, and a regional tilt of seeded strength
 * gives drainage a direction across the map, as on real dissected uplands.
 */
export const RELIEF_SHAPE = Object.freeze({
  /** Mild stretch 1 + mild·u² for u uniform in [0, 1). */
  grainMild: 0.15,
  /** One map in `strongEvery` gets a strong grain instead, uniform in [strong[0], strong[1]). */
  strongEvery: 8,
  grainStrong: [1.25, 1.4] as const,
  warpScale: 2,
  warpAmplitude: 0.45,
  /** Tilt strength uniform in [tilt[0], tilt[1]) (v2: always 0.3). */
  tilt: [0.03, 0.2] as const,
});
const MAX_STRETCH = RELIEF_SHAPE.grainStrong[1];

/** Seeded unit vector built with a square root only, never trigonometry. */
function direction(seed: number): [number, number] {
  for (let k = 0; ; k++) {
    const a = unit(seed, k, 0) * 2 - 1,
      b = unit(seed, k, 1) * 2 - 1,
      r = a * a + b * b;
    if (r > 0.01 && r <= 1) {
      const m = Math.sqrt(r);
      return [a / m, b / m];
    }
  }
}

/**
 * The grain belongs to the landscape recipe as well as the seed: one seed
 * gives different axes on different presets. Ridge and valley strengths are
 * left out so those controls only raise or lower the same ground.
 */
function recipeKey(t: MapSettings['terrain']): string {
  const text = `${t.featureScaleM}|${t.reliefM}|${t.roughness}|${t.octaves}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

/** Per-map grain stretch, grain axis (unit vector) and tilt strength and axis. */
export interface ReliefShape {
  stretch: number;
  grain: [number, number];
  tilt: number;
  tiltAxis: [number, number];
}
export function reliefShape(terrain: MapSettings['terrain'], seed: number): ReliefShape {
  const stream = `terrain:${TERRAIN_VERSION}`,
    key = recipeKey(terrain),
    draw = deriveSeed(seed, stream, `grain:${key}`),
    strong = lattice(draw, 0, 7) % RELIEF_SHAPE.strongEvery === 0,
    u = unit(draw, 3, 5),
    [lo, hi] = RELIEF_SHAPE.grainStrong,
    t = deriveSeed(seed, stream, `tilt:${key}`);
  return {
    stretch: strong ? lo + (hi - lo) * u : 1 + RELIEF_SHAPE.grainMild * u * u,
    grain: direction(draw),
    tilt: RELIEF_SHAPE.tilt[0] + (RELIEF_SHAPE.tilt[1] - RELIEF_SHAPE.tilt[0]) * unit(t, 4, 4),
    tiltAxis: direction(t),
  };
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
    const octaves: { field: NoiseField; scale: number; weight: number }[] = [];
    let weight = 1,
      total = 0;
    for (let i = 0; i < t.octaves; i++) {
      const scale = t.featureScaleM / 2 ** i;
      if (
        scale < 0.001 ||
        (MAX_STRETCH * 2 * Math.max(s.widthM, s.heightM)) / scale + 512 > 0x7ffffffe
      )
        fail(
          '$.settings.terrain.featureScaleM',
          'Finest terrain feature scale must be >=.001 m and fit the signed lattice range',
        );
      if (weight) {
        octaves.push({ field: noiseField(deriveSeed(seed, stream, `octave:${i}`)), scale, weight });
        total += weight;
      }
      weight *= t.roughness;
    }
    const ridge = noiseField(deriveSeed(seed, stream, 'ridge')),
      valley = noiseField(deriveSeed(seed, stream, 'valley')),
      warpX = noiseField(deriveSeed(seed, stream, 'warp-x')),
      warpY = noiseField(deriveSeed(seed, stream, 'warp-y')),
      shape = reliefShape(t, seed),
      [gx, gy] = shape.grain,
      [tx, ty] = shape.tiltAxis;
    const work = new WorkBudget(s.limits.maxTopologyChecks, 'terrain', 'sample-octave evaluations');
    const evaluations = t.reliefM
      ? count * (octaves.length + 2 + Number(t.ridgeStrength > 0) + Number(t.valleyStrength > 0))
      : count;
    work.take(evaluations); // reserve complete work before allocating samples
    if (
      Math.abs(t.baseHeightM) +
        t.reliefM * (0.5 + 0.5 * Math.max(t.ridgeStrength, t.valleyStrength) + shape.tilt) >
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
          u = (wx * gx + wy * gy) / shape.stretch,
          v = -wx * gy + wy * gx;
        let rolling = 0;
        for (const octave of octaves)
          rolling += octave.weight * noise(octave.field, u / octave.scale, v / octave.scale);
        const r = t.ridgeStrength ? 1 - Math.min(1, Math.abs(noise(ridge, u / F, v / F))) : 0,
          w = t.valleyStrength ? 1 - Math.min(1, Math.abs(noise(valley, u / F, v / F))) : 0,
          tilt = ((xm - s.widthM / 2) * tx + (ym - s.heightM / 2) * ty) / half;
        field[y * columns + x] =
          t.baseHeightM +
          t.reliefM *
            0.5 *
            (rolling / total +
              t.ridgeStrength * r * r -
              t.valleyStrength * w * w +
              shape.tilt * tilt);
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
