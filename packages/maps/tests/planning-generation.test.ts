import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult } from '../src/contract.js';
import { generatePlanning, type PlanningInput } from '../src/planning/index.js';
import { generateElevation } from '../src/terrain/index.js';
import { generateGeography, geographyPreset } from '../src/geography/index.js';
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
const seeds = [1, 2, 3, 7, 17, 31, 97, 55337];
it('records unchanged fixed24 diagnostic recipes and never substitutes seeds', () => {
  const records: { preset: string; seed: number; ok: boolean; hash: string }[] = [];
  for (const preset of ['flat-countryside', 'wooded-hills', 'river-valley'] as const)
    for (const seed of seeds) {
      const s = geographyPreset(preset);
      s.widthM = s.heightM = 1000;
      s.terrain.featureScaleM = 400;
      s.settlements.minSpacingM = 150;
      s.roads.extraLinks = 0;
      if (preset === 'river-valley') s.hydrology.riverThresholdSamples = 10;
      const b = { minX: 0 as const, minY: 0 as const, maxX: 1000, maxY: 1000 },
        ground = value(generateElevation(s, seed)),
        geo = generateGeography(ground, b, s, seed);
      const plan = geo.ok
        ? generatePlanning({
            settings: s,
            seed,
            bounds: b,
            elevation: geo.value.elevation,
            water: geo.value.water,
            crossingCandidates: geo.value.crossingCandidates,
            requireBridge: preset === 'river-valley',
          })
        : geo;
      const again = geo.ok
        ? generatePlanning({
            settings: s,
            seed,
            bounds: b,
            elevation: geo.value.elevation,
            water: geo.value.water,
            crossingCandidates: geo.value.crossingCandidates,
            requireBridge: preset === 'river-valley',
          })
        : geo;
      expect(again).toEqual(plan);
      if (!plan.ok)
        expect(plan.diagnostics[0]!.code).toMatch(/REGION|SITE|CONNECTIVITY|BRIDGE|RESOURCE/);
      records.push({
        preset,
        seed,
        ok: plan.ok,
        hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
      });
    }
  expect(records).toHaveLength(24);
}, 20000);
it('supports unchanged default10km17 and maximum601x601 flat17 with configured sites', () => {
  for (const max of [false, true]) {
    const s = max ? geographyPreset('flat-countryside') : structuredClone(DEFAULT_SETTINGS);
    if (max) s.widthM = s.heightM = 15000;
    const b = { minX: 0 as const, minY: 0 as const, maxX: s.widthM, maxY: s.heightM },
      g = value(generateGeography(value(generateElevation(s, 17)), b, s, 17)),
      p = value(
        generatePlanning({
          settings: s,
          seed: 17,
          bounds: b,
          elevation: g.elevation,
          water: g.water,
          crossingCandidates: g.crossingCandidates,
        }),
      );
    expect(p.sites).toHaveLength(10);
    expect(p.evidence.planningCells).toBe(max ? 361201 : 160801);
    expect(p.evidence.expansions).toBeLessThanOrEqual(s.roads.maxGlobalExpansions);
  }
}, 30000);
it('matches fresh processes/locales and unrelated settlement draws; no clock in content', () => {
  const planning = fileURLToPath(new URL('../dist/planning/index.js', import.meta.url)),
    terrain = fileURLToPath(new URL('../dist/terrain/index.js', import.meta.url)),
    contract = fileURLToPath(new URL('../dist/contract.js', import.meta.url)),
    overrides = fileURLToPath(new URL('../dist/overrides.js', import.meta.url));
  const script = `import{createHash}from'node:crypto';import{generatePlanning}from${JSON.stringify(planning)};import{generateElevation}from${JSON.stringify(terrain)};import{DEFAULT_SETTINGS}from${JSON.stringify(contract)};import{deriveSeed}from${JSON.stringify(overrides)};const s=structuredClone(DEFAULT_SETTINGS);s.widthM=s.heightM=1000;s.terrain.reliefM=0;s.settlements.minSpacingM=150;s.roads.extraLinks=0;if(process.env.EXTRA)for(let i=0;i<1000;i++)deriveSeed(17,'settlements:v1','site:village:0000');const e=generateElevation(s,17);if(!e.ok)throw Error(JSON.stringify(e));const p=generatePlanning({settings:s,seed:17,bounds:{minX:0,minY:0,maxX:1000,maxY:1000},elevation:e.value,water:[]});if(!p.ok)throw Error(JSON.stringify(p));console.log(createHash('sha256').update(JSON.stringify(p)).digest('hex'));`;
  const run = (extra: string, lang: string) =>
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, EXTRA: extra, LANG: lang },
    });
  expect(run('1', 'en_US.UTF-8')).toBe(run('', 'C'));
});
it('keeps exclusion union and ordered hard moves deterministic', () => {
  const s = geographyPreset('flat-countryside');
  s.widthM = s.heightM = 1000;
  s.settlements.minSpacingM = 150;
  s.roads.extraLinks = 0;
  const input: PlanningInput = {
    settings: s,
    seed: 31,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    elevation: value(generateElevation(s, 31)),
    water: [],
    overrides: [
      { kind: 'move-site', siteId: 'site:village:0000', anchor: [200, 200] },
      { kind: 'move-site', siteId: 'site:village:0000', anchor: [250, 250] },
      {
        kind: 'exclude-sites',
        id: 'exclude:one',
        polygon: {
          outer: [
            [400, 400],
            [600, 400],
            [600, 600],
            [400, 600],
            [400, 400],
          ],
          holes: [],
        },
      },
    ],
  };
  const p = value(generatePlanning(input));
  expect(p.sites.find((s) => s.id === 'site:village:0000')!.anchor).toEqual([250, 250]);
  expect(generatePlanning(input)).toEqual({ ok: true, value: p, diagnostics: [] });
});
