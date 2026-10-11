import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createElevationQueries,
  deriveSeed,
  type GenerationResult,
} from '../src/index.js';
import {
  generateElevation,
  generateTerrain,
  extractContours,
  validateContourHeights,
  TERRAIN_VERSION,
  CONTOUR_VERSION,
} from '../src/terrain/index.js';

function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
function settings() {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = 500;
  s.heightM = 400;
  s.terrain.featureScaleM = 200;
  return s;
}
describe('independently seeded multiscale ground', () => {
  it('repeats field/contours exactly regardless of unrelated settlement draws', () => {
    const s = settings(),
      a = value(generateTerrain(s, 17));
    for (let i = 0; i < 100; i++) deriveSeed(17, 'settlements:v1', `building:${i}`);
    expect(value(generateTerrain(s, 17))).toEqual(a);
    expect(value(generateElevation(s, 31)).samples).not.toEqual(a.elevation.samples);
    expect(TERRAIN_VERSION).toBe('value-noise-ridges-v1');
    expect(CONTOUR_VERSION).toBe('bilinear-graph-v1');
  });
  it('contour interval/tolerance/index changes leave elevation bit-for-bit unchanged', () => {
    const s = settings(),
      a = value(generateTerrain(s, 31));
    s.contours.minorIntervalM = 5;
    s.contours.indexIntervalM = 25;
    s.contours.verticalToleranceM = 0.01;
    const b = value(generateTerrain(s, 31));
    expect(b.elevation).toEqual(a.elevation);
    expect(b.contours).not.toEqual(a.contours);
  });
  it('certifies output after decimal-6-v1 normalization, which is idempotent', () => {
    const s = settings();
    s.contours.verticalToleranceM = 0.01;
    const result = value(generateTerrain(s, 31));
    const normalized = JSON.parse(
      JSON.stringify(result, (_, v: unknown) => (typeof v === 'number' ? Number(v.toFixed(6)) : v)),
    ) as typeof result;
    expect(normalized).toEqual(result);
    const bounds = { minX: 0 as const, minY: 0 as const, maxX: s.widthM, maxY: s.heightM };
    expect(
      value(validateContourHeights(normalized.elevation, bounds, normalized.contours, s)).maxErrorM,
    ).toBeLessThanOrEqual(0.01);
  });
  it('ridge and valley controls are effective independently and in the declared direction', () => {
    const s = settings();
    s.terrain.ridgeStrength = s.terrain.valleyStrength = 0;
    const base = value(generateElevation(s, 97));
    s.terrain.ridgeStrength = 1;
    const ridges = value(generateElevation(s, 97));
    s.terrain.ridgeStrength = 0;
    s.terrain.valleyStrength = 1;
    const valleys = value(generateElevation(s, 97));
    expect(ridges.samples.every((h, i) => h >= base.samples[i]!)).toBe(true);
    expect(valleys.samples.every((h, i) => h <= base.samples[i]!)).toBe(true);
    expect(Math.max(...ridges.samples.map((h, i) => h - base.samples[i]!))).toBeGreaterThan(10);
    expect(Math.min(...valleys.samples.map((h, i) => h - base.samples[i]!))).toBeLessThan(-10);
  });
  it('relief/baseHeight/octaves/roughness/feature scale all affect the field and zero relief is flat', () => {
    const s = settings(),
      original = value(generateElevation(s, 7));
    for (const change of [
      { octaves: 1 },
      { roughness: 0.8 },
      { featureScaleM: 500 },
      { reliefM: 20 },
    ]) {
      const changed = structuredClone(s);
      Object.assign(changed.terrain, change);
      expect(value(generateElevation(changed, 7)).samples).not.toEqual(original.samples);
    }
    s.terrain.baseHeightM = -35;
    s.terrain.reliefM = 0;
    const flat = value(generateTerrain(s, 7));
    expect(new Set(flat.elevation.samples)).toEqual(new Set([-35]));
    expect(flat.contours).toEqual([]);
    const q = createElevationQueries({
      bounds: { minX: 0, minY: 0, maxX: 500, maxY: 400 },
      elevation: flat.elevation,
    });
    expect(q.gradientAt(500, 400)).toEqual({ dx: 0, dy: 0 });
  });
  it('certifies fixed future seeds at small diagnostic extents without claiming later preset composition', () => {
    for (const seed of [1, 2, 3, 7, 17, 31, 97, 55337]) {
      const s = settings(),
        result = value(generateTerrain(s, seed));
      const bounds = { minX: 0 as const, minY: 0 as const, maxX: s.widthM, maxY: s.heightM };
      const evidence = value(validateContourHeights(result.elevation, bounds, result.contours, s));
      expect(evidence.maxErrorM).toBeLessThanOrEqual(s.contours.verticalToleranceM);
      expect(result.elevation.samples.every(Number.isFinite)).toBe(true);
      expect(extractContours(result.elevation, bounds, s)).toMatchObject({
        ok: true,
        value: result.contours,
      });
    }
  });
  it('generates and certifies default and supported601×601 maximum fields with default budgets', () => {
    for (const size of [10_000, 15_000]) {
      const s = structuredClone(DEFAULT_SETTINGS);
      s.widthM = s.heightM = size;
      const result = value(generateTerrain(s, 17));
      expect(result.elevation.columns).toBe(size / 25 + 1);
      expect(result.elevation.samples).toHaveLength((size / 25 + 1) ** 2);
      expect(result.contours.length).toBeGreaterThan(0);
    }
  }, 20_000);
  it('reserves evaluation/sample budgets and returns infeasibility without partial fields', () => {
    const s = settings();
    s.limits.maxTopologyChecks = 1;
    expect(generateTerrain(s, 17)).toMatchObject({
      ok: false,
      kind: 'infeasible',
      diagnostics: [{ constraint: 'sample-octave evaluations' }],
    });
    const t = settings();
    t.limits.maxSamples = 4;
    expect(generateTerrain(t, 17)).toMatchObject({ ok: false, kind: 'infeasible' });
    const u = settings();
    u.terrain.baseHeightM = 100_000;
    expect(generateElevation(u, 17)).toMatchObject({
      ok: false,
      diagnostics: [{ constraint: 'height range' }],
    });
  });
  it('rejects invalid seeds/parameters/unsupported lattice scales as errors with no ambient state', () => {
    expect(() => generateElevation(settings(), NaN)).toThrow(RangeError);
    expect(() => generateElevation(settings(), -1)).toThrow(RangeError);
    const s = settings();
    s.terrain.roughness = Infinity;
    expect(() => generateElevation(s, 17)).toThrow(/roughness.*finite/);
    const t = settings();
    t.terrain.featureScaleM = 1e-100;
    expect(() => generateElevation(t, 17)).toThrow(/featureScaleM/);
  });
  it('matches fresh-process complete terrain hashes across locales and unrelated streams', () => {
    const terrain = fileURLToPath(new URL('../dist/terrain/index.js', import.meta.url));
    const contract = fileURLToPath(new URL('../dist/index.js', import.meta.url));
    const script = `
      import {createHash} from 'node:crypto';
      import {generateTerrain} from ${JSON.stringify(terrain)};
      import {DEFAULT_SETTINGS,deriveSeed} from ${JSON.stringify(contract)};
      const settings=structuredClone(DEFAULT_SETTINGS);
      settings.widthM=500;settings.heightM=400;settings.terrain.featureScaleM=200;
      if(process.env.EXTRA_DRAWS) for(let i=0;i<1000;i++) deriveSeed(31,'settlements:v1','site:village:0000');
      const result=generateTerrain(settings,31);
      if(!result.ok) throw new Error(JSON.stringify(result));
      console.log(createHash('sha256').update(JSON.stringify(result)).digest('hex'));
    `;
    const a = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'UTC', LANG: 'C', EXTRA_DRAWS: '' },
    });
    const b = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Pacific/Honolulu', LANG: 'en_US.UTF-8', EXTRA_DRAWS: '1' },
    });
    expect(b).toBe(a);
    expect(a.trim()).toMatch(/^[0-9a-f]{64}$/);
  });
});
