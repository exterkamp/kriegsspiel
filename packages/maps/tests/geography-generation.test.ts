import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult } from '../src/contract.js';
import { deriveSeed } from '../src/overrides.js';
import {
  generateElevation,
  extractContours,
  validateContourHeights,
} from '../src/terrain/index.js';
import {
  generateGeography,
  generateHydrology,
  findCrossingCandidates,
  validateCrossingCandidate,
  validateWaterPhysics,
  geographyPreset,
} from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
const fixedSeeds = [1, 2, 3, 7, 17, 31, 97, 55337];
const bounds = (s: { widthM: number; heightM: number }) => ({
  minX: 0 as const,
  minY: 0 as const,
  maxX: s.widthM,
  maxY: s.heightM,
});
function diagnostic(name: 'flat-countryside' | 'wooded-hills' | 'river-valley') {
  const s = geographyPreset(name);
  s.widthM = s.heightM = 1000;
  s.terrain.featureScaleM = 400;
  if (name === 'river-valley') s.hydrology.riverThresholdSamples = 10;
  return s;
}
describe('versioned geography integration and deterministic recipes', () => {
  it('succeeds early for production river-valley seed97 with drainage-derived geometry and feasible crossings', () => {
    const s = geographyPreset('river-valley'),
      elevation = value(generateElevation(s, 97)),
      original = structuredClone(elevation),
      geo = value(generateGeography(elevation, bounds(s), s, 97));
    expect(geo.groundChanged).toBe(true);
    expect(geo.sourceElevation).toEqual(original);
    expect(elevation).toEqual(original);
    expect(geo.elevation).not.toEqual(original);
    expect(geo.water[0]).toMatchObject({ kind: 'river', surfacePolicy: 'standing-water-v1' });
    const river = geo.water[0]!;
    if (river.kind === 'river') {
      expect(river.centreline.length).toBeGreaterThan(100);
      expect(new Set(river.surfaceProfileM).size).toBe(1);
    }
    expect(geo.crossingCandidates.length).toBeGreaterThan(0);
    for (const c of geo.crossingCandidates)
      expect(validateCrossingCandidate(c, geo.water, bounds(s), s)).toMatchObject({ ok: true });
    expect(
      value(validateWaterPhysics(geo.elevation, bounds(s), geo.water, s)).maxGroundExcessM,
    ).toBe(0);
    expect(geo.cover.length).toBeGreaterThan(0);
    expect(geo.evidence.flood.popped).toBe(elevation.samples.length);
  }, 20000);
  it('matches flat17 and wooded-hills31 representative component fixtures', () => {
    for (const [name, seed] of [
      ['flat-countryside', 17],
      ['wooded-hills', 31],
    ] as const) {
      const s = geographyPreset(name),
        ground = value(generateElevation(s, seed)),
        geo = value(generateGeography(ground, bounds(s), s, seed));
      expect(geo.groundChanged).toBe(false);
      expect(geo.cover.some((c) => c.kind === 'wood')).toBe(true);
      if (name === 'flat-countryside') expect(geo.water).toEqual([]);
    }
  }, 20000);
  it('records all24 fixed diagnostic recipes without retrying or changing seeds', () => {
    const records: { preset: string; seed: number; ok: boolean; hash: string }[] = [];
    for (const name of ['flat-countryside', 'wooded-hills', 'river-valley'] as const)
      for (const seed of fixedSeeds) {
        const s = diagnostic(name),
          ground = value(generateElevation(s, seed)),
          geo = generateGeography(ground, bounds(s), s, seed);
        const again = generateGeography(ground, bounds(s), s, seed);
        expect(again).toEqual(geo);
        if (geo.ok)
          expect(
            value(validateWaterPhysics(geo.value.elevation, bounds(s), geo.value.water, s))
              .maxGroundExcessM,
          ).toBe(0);
        else expect(geo.kind).toBe('infeasible');
        records.push({
          preset: name,
          seed,
          ok: geo.ok,
          hash: createHash('sha256').update(JSON.stringify(geo)).digest('hex'),
        });
      }
    expect(records).toHaveLength(24);
    expect(records.filter((r) => r.preset === 'river-valley' && r.seed === 97)[0]!.ok).toBe(true);
  }, 20000);
  it('cover settings and unrelated draws cannot perturb source ground, hydrology or crossings', () => {
    const s = diagnostic('river-valley'),
      e = value(generateElevation(s, 97)),
      a = value(generateGeography(e, bounds(s), s, 97));
    for (let i = 0; i < 100; i++) deriveSeed(97, 'settlements:v1', `building:${i}`);
    s.cover.woodFraction = 0.8;
    s.cover.fieldFraction = 0;
    s.cover.coherenceM = 100;
    const b = value(generateGeography(e, bounds(s), s, 97));
    expect(b.sourceElevation).toEqual(a.sourceElevation);
    expect(b.elevation).toEqual(a.elevation);
    expect(b.water).toEqual(a.water);
    expect(b.drainage).toEqual(a.drainage);
    expect(b.crossingCandidates).toEqual(a.crossingCandidates);
    expect(b.cover).not.toEqual(a.cover);
  });
  it('regenerates independently certified contours from changed authoritative ground', () => {
    const s = diagnostic('river-valley'),
      e = value(generateElevation(s, 97)),
      geo = value(generateHydrology(e, bounds(s), s, 97));
    s.contours.verticalToleranceM = 0.01;
    const contours = value(extractContours(geo.elevation, bounds(s), s));
    expect(
      value(validateContourHeights(geo.elevation, bounds(s), contours, s)).maxErrorM,
    ).toBeLessThanOrEqual(0.01);
  });
  it('keeps height/geometry decimal6 stable and fails aggregate resources without truncated success', () => {
    const s = diagnostic('river-valley'),
      e = value(generateElevation(s, 97)),
      a = value(generateGeography(e, bounds(s), s, 97));
    expect(
      JSON.parse(
        JSON.stringify(a, (_, v: unknown) => (typeof v === 'number' ? Number(v.toFixed(6)) : v)),
      ),
    ).toEqual(a);
    s.limits.maxFeatures = 1;
    expect(generateGeography(e, bounds(s), s, 97)).toMatchObject({ ok: false, kind: 'infeasible' });
    const t = diagnostic('flat-countryside'),
      flat = value(generateElevation(t, 17));
    expect(generateGeography(flat, bounds(t), t, 17, { maxRegionWork: 1 })).toMatchObject({
      ok: false,
    });
  });
  it('matches complete geography in fresh processes/locales with unrelated seeded draws', () => {
    const geography = fileURLToPath(new URL('../dist/geography/index.js', import.meta.url)),
      terrain = fileURLToPath(new URL('../dist/terrain/index.js', import.meta.url)),
      overrides = fileURLToPath(new URL('../dist/overrides.js', import.meta.url));
    const script = `import{createHash}from'node:crypto';import{geographyPreset,generateGeography}from${JSON.stringify(geography)};import{generateElevation}from${JSON.stringify(terrain)};import{deriveSeed}from${JSON.stringify(overrides)};const s=geographyPreset('river-valley');s.widthM=s.heightM=1000;s.terrain.featureScaleM=400;s.hydrology.riverThresholdSamples=10;if(process.env.EXTRA)for(let i=0;i<1000;i++)deriveSeed(97,'settlements:v1','site:village:0000');const e=generateElevation(s,97);if(!e.ok)throw Error(JSON.stringify(e));const r=generateGeography(e.value,{minX:0,minY:0,maxX:1000,maxY:1000},s,97);if(!r.ok)throw Error(JSON.stringify(r));console.log(createHash('sha256').update(JSON.stringify(r)).digest('hex'));`;
    const run = (extra: string, lang: string) =>
      execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8',
        env: { ...process.env, EXTRA: extra, LANG: lang },
      });
    expect(run('1', 'en_US.UTF-8')).toBe(run('', 'C'));
  });
  it('produces useful default10km seed17 geography under unchanged frozen limits', () => {
    const s = structuredClone(DEFAULT_SETTINGS),
      e = value(generateElevation(s, 17)),
      r = value(generateGeography(e, bounds(s), s, 17));
    expect(r.elevation.samples).toHaveLength(160801);
    expect(r.water.length).toBeGreaterThan(0);
    expect(r.cover.length).toBeGreaterThan(0);
    expect(r.groundChanged).toBe(false);
    expect(s.limits.maxTopologyChecks).toBe(5000000);
    expect(s.sampleSpacingM).toBe(25);
  }, 20000);
  it('supports maximum601×601 flat drainage/cover with explicit no-river fallback', () => {
    const s = geographyPreset('flat-countryside');
    s.widthM = s.heightM = 15000;
    const e = value(generateElevation(s, 17)),
      geo = value(generateGeography(e, bounds(s), s, 17));
    expect(geo.elevation.samples).toHaveLength(361201);
    expect(geo.water).toEqual([]);
    expect(geo.evidence.flood.enqueued).toBe(361201);
    expect(findCrossingCandidates([], bounds(s), s)).toMatchObject({ ok: true, value: [] });
  }, 20000);
});
