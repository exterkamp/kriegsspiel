import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  battlefieldPreset,
  generateBattlefield,
  validateBattlefield,
  exportBattlefield,
} from '../src/composition/index.js';
import { canonicalGeometry, canonicalizeAsset } from '../src/canonical.js';
import { importAsset } from '../src/import.js';
import { realismReport } from '../src/realism.js';
import { expectRealisticCover } from './realism-checks.js';
import type { GenerationResult, MapAsset } from '../src/contract.js';
const value = <T>(r: GenerationResult<T>): T => {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
};

function independentWalk(asset: MapAsset): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const road of asset.layers.roads)
    for (const [a, b] of [
      [road.fromNodeId, road.toNodeId],
      [road.toNodeId, road.fromNodeId],
    ]) {
      const list = adjacency.get(a!) ?? [];
      list.push(b!);
      adjacency.set(a!, list);
    }
  const seen = new Set<string>(),
    queue = [asset.layers.roadNodes.find((n) => n.kind === 'boundary-exit')!.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(adjacency.get(id) ?? []).filter((n) => !seen.has(n)));
  }
  return seen;
}
const timerYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
for (const name of ['flat-countryside', 'wooded-hills', 'river-valley'] as const)
  it(`composes unchanged actual5km ${name} with four villages/six farms/full1272 demand`, async () => {
    await timerYield();
    const input = battlefieldPreset(name),
      before = JSON.stringify(input),
      asset = value(generateBattlefield(input));
    await timerYield();
    expect(asset.settings).toEqual(input.settings);
    expect(asset.provenance.seed).toBe(input.seed);
    expect(JSON.stringify(input)).toBe(before);
    expect(asset.layers.sites.filter((s) => s.kind === 'village')).toHaveLength(4);
    expect(asset.layers.sites.filter((s) => s.kind === 'farm')).toHaveLength(6);
    expect(asset.layers.buildings).toHaveLength(318);
    expect(asset.layers.sites.reduce((n, s) => n + s.population.assigned, 0)).toBe(1272);
    for (const site of asset.layers.sites) {
      expect(site.population).toEqual({
        requested: site.kind === 'village' ? 300 : 12,
        assigned: site.kind === 'village' ? 300 : 12,
        unassigned: 0,
      });
    }
    const seen = independentWalk(asset);
    for (const road of asset.layers.roads) {
      expect(seen.has(road.fromNodeId)).toBe(true);
      expect(seen.has(road.toNodeId)).toBe(true);
    }
    for (const site of asset.layers.sites)
      for (const entry of site.entrances) expect(seen.has(entry.nodeId)).toBe(true);
    // Realism of the complete certified asset (#490).
    const realism = realismReport(asset);
    expect(realism.rivers.uphillSteps).toBe(0);
    expect(realism.rivers.deadEnds).toBe(0);
    expect(realism.terrain.lakes).toBe(0);
    expect(realism.roads.maxGrade).toBeLessThanOrEqual(asset.settings.roads.maxGrade + 1e-9);
    expect(realism.settlements.maxAnchorSlope).toBeLessThanOrEqual(
      asset.settings.settlements.maxBuildingGradient,
    );
    expect(realism.settlements.summits).toBe(0);
    expect(realism.settlements.lowRiverFlats).toBe(0);
    expectRealisticCover(realism, asset.settings);
    const exported = value(exportBattlefield(asset));
    await timerYield();
    const loaded = importAsset(exported.json);
    expect(canonicalGeometry(loaded)).toBe(canonicalGeometry(asset));
    await timerYield();
    expect(validateBattlefield(loaded).ok).toBe(true);
    await timerYield();
    if (name === 'river-valley') {
      expect(asset.layers.crossings.length).toBeGreaterThan(0);
      for (const bridge of asset.layers.crossings)
        for (const id of bridge.roadIds) {
          const road = asset.layers.roads.find((r) => r.id === id)!;
          expect(road.crossingIds).toContain(bridge.id);
          // Ordinary routes now reuse bridges, so a deck is not limited to the
          // explicit required-bridge route; it must still carry some route.
          expect(road.routeIds.length).toBeGreaterThan(0);
          expect(seen.has(road.fromNodeId) && seen.has(road.toNodeId)).toBe(true);
        }
      const changed = structuredClone(asset),
        crossing = changed.layers.crossings[0]!,
        water = changed.layers.water.find((w) => w.id === crossing.waterId)!;
      expect(water.kind).toBe('river');
      // Recanonicalization may reject earlier than complete validation; neither path may accept.
      changed.layers.roads.find((r) => r.id === crossing.roadIds[0])!.crossingIds = [];
      expect(() => canonicalizeAsset(changed)).toThrow(/reciprocal/);
    }
  }, 90000);
it('replays canonical assets in fresh processes without ambient random/clock/name draw coupling', () => {
  const composition = fileURLToPath(new URL('../dist/composition/index.js', import.meta.url)),
    canonical = fileURLToPath(new URL('../dist/canonical.js', import.meta.url));
  const script = `import{createHash}from'node:crypto';import{battlefieldPreset,generateBattlefield}from${JSON.stringify(composition)};import{canonicalizeAsset,canonicalGeometry}from${JSON.stringify(canonical)};const input=battlefieldPreset('flat-countryside');input.settings.widthM=input.settings.heightM=500;input.settings.settlements.villageCount=1;input.settings.settlements.farmCount=1;input.settings.settlements.villagePopulation=12;input.settings.settlements.minSpacingM=150;input.settings.roads.extraLinks=0;Math.random=()=>{throw Error('ambient random')};Date.now=()=>{throw Error('wall clock')};const r=generateBattlefield(input);if(!r.ok)throw Error(JSON.stringify(r));console.log(JSON.stringify([canonicalizeAsset(r.value),canonicalGeometry(r.value)].map(s=>createHash('sha256').update(s).digest('hex'))));`;
  const run = (LANG: string) =>
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, LANG, TZ: LANG === 'C' ? 'UTC' : 'Pacific/Honolulu' },
    });
  const first = run('C');
  expect(run('en_US.UTF-8')).toBe(first);
  expect(run('C')).toBe(first);
  expect(createHash('sha256').update(first).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
  // Three fresh processes each generate, erode and certify a small map.
}, 30_000);
