import { createHash } from 'node:crypto';
import {
  createState,
  holdTheBridge,
  loadScenario,
  polygonCentroid,
  terrainAt,
  type GameState,
} from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { engineTerrainIdentity } from '../battlefield.js';
import { createRegistry, startingState } from '../registry.js';
import { advanceUntilOver, replayLog } from '../replay.js';
import { openBridgeV1Input } from './open-bridge-v1.js';

// This tests authored content only. It does not publish an alternative or certify
// balanced play, generated-map conversion, game persistence or a live renderer.
describe('retained authored Open bridge approaches v1', () => {
  it('pins its authored input independently of a mutable latest default', () => {
    expect(createHash('sha256').update(JSON.stringify(openBridgeV1Input())).digest('hex')).toBe(
      '9d9fe71d6eb1ddedcc38d38ba0d185064af5a5c7b0ba94adb93e397e5da18339',
    );
    const first = openBridgeV1Input() as { id: string };
    first.id = 'mutated-caller';
    expect(loadScenario(openBridgeV1Input()).scenarioId).toBe('hold-the-bridge-open-v1');
  });

  it('changes only the two named woods and resolved identity in the loaded world', () => {
    const original = loadScenario(holdTheBridge);
    const alternative = loadScenario(openBridgeV1Input());
    const expected = structuredClone(original);
    expected.scenarioId = 'hold-the-bridge-open-v1';
    expected.map.features = expected.map.features.filter(
      (feature) => feature.id !== 'north-wood' && feature.id !== 'south-wood',
    );
    expect(alternative).toEqual(expected);
    expect(original.map.features.map((feature) => feature.id)).toEqual([
      'north-wood',
      'south-wood',
      'river',
      'high-road',
      'bridge',
    ]);
    expect(engineTerrainIdentity(alternative.map)).not.toBe(engineTerrainIdentity(original.map));
  });

  it('retains asymmetric coordinates, passable bridge and exact authored objective', () => {
    const world = loadScenario(openBridgeV1Input());
    expect(world.map.width).toBe(4_000_000);
    expect(world.map.height).toBe(3_000_000);
    const centre = polygonCentroid(world.victory.objective);
    expect(centre).toEqual({ x: 2_050_000, y: 1_500_000 });
    const crossing = terrainAt(world.map, centre)!;
    expect(crossing.featureIds).toContain('bridge');
    expect(crossing.attrs.passable).toBe(true);
    expect(terrainAt(world.map, { x: 1_000_000, y: 1_500_000 })!.attrs.passable).toBe(false);
    expect(world.sides.map((side) => side.hq)).toEqual([
      { x: 2_050_000, y: 2_950_000 },
      { x: 2_050_000, y: 50_000 },
    ]);
  });

  it.each([1815, 17, 97])('loads, completes and replays deterministically at seed %i', (seed) => {
    for (const input of [holdTheBridge, openBridgeV1Input()]) {
      const world: GameState = { ...loadScenario(input), seed };
      const registry = createRegistry();
      const state = startingState(createState(seed, world, 0));
      const until = 60 * 60_000;
      const result = advanceUntilOver(state, until, registry);
      expect(result.state.world.outcome).toBeDefined();
      expect(result.state.world.outcome!.winner).toBe('blue');
      expect(result.state.time).toBeLessThanOrEqual(until);
      const replay = replayLog(
        { gameId: 'authored-content-probe', scenarioId: world.scenarioId, seed },
        world,
        [],
        registry,
        until,
        startingState,
      );
      expect(replay).toEqual(result);
    }
  });
});
