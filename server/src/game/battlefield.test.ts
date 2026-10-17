import { describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { describeDefaultBattlefield, engineTerrainIdentity } from './battlefield.js';
import { scenarioList } from './registry.js';

describe('public scenario battlefield descriptor', () => {
  it('describes the real 4 × 3 km scenario terrain, with north-west metre coordinates', () => {
    const { battlefield } = scenarioList()[0]!;
    expect(battlefield.map.widthM).toBe(4000);
    expect(battlefield.map.heightM).toBe(3000);
    expect(battlefield.map.preview.find((f) => f.id === 'bridge')?.geometry).toEqual({
      shape: 'point',
      at: { x: 2050, y: 1500 },
      radiusM: 110,
    });
    expect(battlefield.map.preview.find((f) => f.id === 'river')?.geometry).toEqual({
      shape: 'polyline',
      points: [
        { x: 0, y: 1500 },
        { x: 4000, y: 1500 },
      ],
      widthM: 200,
    });
    expect(battlefield.pairing).toMatchObject({
      scenarioId: holdTheBridge.id,
      terrainIdentity: battlefield.map.terrainIdentity,
    });
    expect(battlefield.capabilities.addMaps).toBe(false);
  });

  it('whitelists public geography and cannot serialize units, HQs, objectives or observations', () => {
    const world = loadScenario(holdTheBridge);
    const descriptor = describeDefaultBattlefield(world, 'Battlefield');
    expect(Object.keys(descriptor.map).sort()).toEqual([
      'heightM',
      'id',
      'name',
      'preview',
      'source',
      'terrainIdentity',
      'widthM',
    ]);
    for (const feature of descriptor.map.preview) {
      expect(Object.keys(feature).sort()).toEqual(['geometry', 'id', 'kind', 'layer', 'name']);
    }
    const wire = JSON.stringify(descriptor);
    for (const unit of world.units) expect(wire).not.toContain(unit.commander);
    expect(wire).not.toMatch(/"(?:units|sides|hq|victory|intel|attrs|capacity|risk)"/);
  });

  it('returns detached terrain, and full identity includes gameplay attributes', () => {
    const world = loadScenario(holdTheBridge);
    const terrain = world.map;
    const original = engineTerrainIdentity(terrain);
    const descriptor = describeDefaultBattlefield(world, 'Battlefield');
    const wood = terrain.features.find((f) => f.kind === 'wood')!;
    if (wood.geometry.shape !== 'polygon') throw new Error('expected polygon');
    wood.geometry.points[0]!.x += 1000;
    expect(descriptor.map.preview.find((f) => f.id === wood.id)?.geometry).toEqual({
      shape: 'polygon',
      points: [
        { x: 600, y: 300 },
        { x: 1300, y: 350 },
        { x: 1250, y: 900 },
        { x: 650, y: 850 },
      ],
    });
    expect(engineTerrainIdentity(terrain)).not.toBe(original);
    const beforeAttributeChange = engineTerrainIdentity(terrain);
    wood.attrs.cover += 0.01;
    expect(engineTerrainIdentity(terrain)).not.toBe(beforeAttributeChange);
    expect(
      engineTerrainIdentity({
        features: terrain.features,
        height: terrain.height,
        width: terrain.width,
      }),
    ).toBe(engineTerrainIdentity(terrain));
  });

  it('changes pairing revision for army changes, even on identical terrain', () => {
    const world = loadScenario(holdTheBridge);
    const before = describeDefaultBattlefield(world, 'Battlefield');
    world.units[0]!.strength += 1;
    const after = describeDefaultBattlefield(world, 'Battlefield');
    expect(after.map.terrainIdentity).toBe(before.map.terrainIdentity);
    expect(after.pairing.scenarioRevision).not.toBe(before.pairing.scenarioRevision);
    expect(after.pairing.revision).not.toBe(before.pairing.revision);
    world.time = 1;
    expect(() => describeDefaultBattlefield(world, 'Battlefield')).toThrow('initial scenario');
  });
});
