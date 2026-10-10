import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fixtureFacings, fixtureMap, fixtureView, gridFromRows } from './fixture.js';
import { mapToWorld, pickFromRay, tileAt, worldToMap } from './picking.js';
import { buildSceneState, formatAge } from './sceneState.js';

const state = buildSceneState(fixtureView, fixtureMap, fixtureFacings);

/** Ray from straight above the world point of a map coordinate, looking down. */
function rayDownAt(x: number, y: number): THREE.Ray {
  const w = mapToWorld(fixtureMap, { x, y });
  return new THREE.Ray(new THREE.Vector3(w.x, 50, w.z), new THREE.Vector3(0, -1, 0));
}

describe('buildSceneState', () => {
  it('maps own units with facing (default N)', () => {
    expect(state.own.map((p) => [p.id, p.facing])).toEqual([
      ['blue-1', 'N'],
      ['blue-2', 'NE'],
      ['blue-3', 'E'],
    ]);
    expect(buildSceneState(fixtureView, fixtureMap).own.every((p) => p.facing === 'N')).toBe(true);
  });

  it('maps last-known contacts to ghosts with an age tag', () => {
    expect(state.ghosts.map((g) => [g.id, g.ageTag])).toEqual([
      ['contact-1', '30m old'],
      ['contact-2', '1h 10m old'],
    ]);
  });

  it('is pure and idempotent', () => {
    const before = JSON.stringify(fixtureView);
    expect(buildSceneState(fixtureView, fixtureMap, fixtureFacings)).toEqual(state);
    expect(JSON.stringify(fixtureView)).toBe(before);
  });

  it('formats ages', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(2 * 3_600_000)).toBe('2h old');
  });
});

describe('picking', () => {
  it('round-trips map and world coordinates', () => {
    const p = worldToMap(fixtureMap, mapToWorld(fixtureMap, { x: 7.25, y: 3.5 }));
    expect(p.x).toBeCloseTo(7.25);
    expect(p.y).toBeCloseTo(3.5);
  });

  it('reports the tile under the pointer', () => {
    expect(pickFromRay(state, rayDownAt(5.5, 1.5))).toMatchObject({
      type: 'tile',
      tile: { x: 5, y: 1 },
    });
    const terrain = fixtureMap.tiles[2 * fixtureMap.width + 7];
    expect(terrain).toBe('wood');
  });

  it("converts the wire's metres to display tile units", () => {
    expect(state.own[0]!.position).toEqual({ x: 18.5, y: 12.5 });
    expect(state.ghosts.find((g) => g.id === 'contact-1')!.position).toEqual({ x: 21.5, y: 3.5 });
  });

  it('reports the own unit on a tile', () => {
    expect(pickFromRay(state, rayDownAt(18.5, 12.5))).toEqual({
      type: 'piece',
      pieceKind: 'own',
      id: 'blue-1',
      tile: { x: 18, y: 12 },
    });
  });

  it('reports a ghost contact', () => {
    expect(pickFromRay(state, rayDownAt(21.5, 3.5))).toMatchObject({
      type: 'piece',
      pieceKind: 'ghost',
      id: 'contact-1',
    });
  });

  it('returns none off the map or for rays that miss the plane', () => {
    expect(pickFromRay(state, rayDownAt(-5, -5))).toEqual({ type: 'none' });
    const up = new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 1, 0));
    expect(pickFromRay(state, up)).toEqual({ type: 'none' });
  });

  it('tileAt rejects out-of-range coordinates', () => {
    const g = gridFromRows(['..', '..']);
    expect(tileAt(g, { x: 2, y: 0 })).toBeUndefined();
    expect(tileAt(g, { x: 1.9, y: 1.1 })).toEqual({ x: 1, y: 1 });
  });
});
