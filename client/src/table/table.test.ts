import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fixtureMap, fixtureView } from './fixture.js';
import { mapToWorld, onMap, pickFromRay, pickMinSize, worldToMap } from './picking.js';
import { buildSceneState, formatAge } from './sceneState.js';
import type { SceneState } from './types.js';

const state = buildSceneState(fixtureView, fixtureMap);

/** Ray from straight above a map point (metres), looking down. */
function rayDownAt(x: number, y: number): THREE.Ray {
  const w = mapToWorld(fixtureMap, { x, y });
  return new THREE.Ray(new THREE.Vector3(w.x, 5000, w.z), new THREE.Vector3(0, -1, 0));
}

describe('buildSceneState', () => {
  it('passes own units through in metres and compass radians', () => {
    expect(state.own.map((p) => [p.id, p.position, p.facing])).toEqual(
      fixtureView.ownUnits.map((u) => [u.id, u.position, u.facing]),
    );
    expect(state.own.find((p) => p.id === 'blue-4')?.shape).toHaveLength(5);
  });

  it('maps last-known contacts to ghosts with an age tag and uncertainty radius', () => {
    expect(state.ghosts.map((g) => [g.id, g.ageTag, g.uncertaintyRadius])).toEqual([
      ['contact-1', '30m old', 3000],
      ['contact-2', '1h 10m old', 4200],
    ]);
  });

  it('draws live sightings as ghosts with their footprint and no uncertainty', () => {
    const live = buildSceneState(
      {
        ...fixtureView,
        visibleEnemies: [
          {
            id: 'red-1',
            position: { x: 1950, y: 450 },
            facing: Math.PI,
            formation: 'line',
            footprint: { frontage: 80, depth: 10 },
          },
        ],
      },
      fixtureMap,
    );
    expect(live.ghosts[0]).toMatchObject({
      id: 'red-1',
      ageTag: 'just now',
      uncertaintyRadius: 0,
      footprint: { frontage: 80, depth: 10 },
    });
  });

  it('is pure and idempotent', () => {
    const before = JSON.stringify(fixtureView);
    expect(buildSceneState(fixtureView, fixtureMap)).toEqual(state);
    expect(JSON.stringify(fixtureView)).toBe(before);
  });

  it('formats ages', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(2 * 3_600_000)).toBe('2h old');
  });
});

describe('picking in continuous space', () => {
  it('round-trips map and world coordinates', () => {
    const p = worldToMap(fixtureMap, mapToWorld(fixtureMap, { x: 1234.5, y: 678.25 }));
    expect(p.x).toBeCloseTo(1234.5);
    expect(p.y).toBeCloseTo(678.25);
  });

  it('returns the metre coordinates under the pointer, not a cell', () => {
    const r = pickFromRay(state, rayDownAt(937.25, 1123.75));
    expect(r.type).toBe('point');
    if (r.type !== 'point') return;
    expect(r.coord.x).toBeCloseTo(937.25);
    expect(r.coord.y).toBeCloseTo(1123.75);
    expect(r).not.toHaveProperty('tile');
  });

  it('picks an own unit anywhere on its oriented footprint', () => {
    // blue-1: 85 x 8 m line at (1850, 2450) facing north; wider than the minimum pick size.
    const edge = pickFromRay(state, rayDownAt(1850 + 40, 2450));
    expect(edge).toMatchObject({ type: 'piece', pieceKind: 'own', id: 'blue-1' });
    if (edge.type === 'piece') expect(edge.coord.x).toBeCloseTo(1890);
    expect(pickFromRay(state, rayDownAt(1850 + 80, 2450)).type).toBe('point');
  });

  it('respects the facing: a unit turned east is wide along y', () => {
    const turned: SceneState = {
      ...state,
      own: [{ ...state.own[0]!, facing: Math.PI / 2, footprint: { frontage: 200, depth: 8 } }],
      ghosts: [],
    };
    expect(pickFromRay(turned, rayDownAt(1850, 2450 + 90)).type).toBe('piece');
    expect(pickFromRay(turned, rayDownAt(1850 + 90, 2450)).type).toBe('point');
  });

  it('picks an irregular formation at its sub-positions, including outside the footprint', () => {
    const u = state.own.find((p) => p.id === 'blue-4')!;
    const facing = u.facing;
    // Offsets are x to the unit's right, y to its front; bearing 3pi/4 faces south-east.
    const at = (s: { x: number; y: number }) => ({
      x: u.position.x + s.x * Math.cos(facing) + s.y * Math.sin(facing),
      y: u.position.y + s.x * Math.sin(facing) - s.y * Math.cos(facing),
    });
    for (const s of u.shape!) {
      const p = at(s);
      expect(pickFromRay(state, rayDownAt(p.x, p.y))).toMatchObject({
        type: 'piece',
        id: 'blue-4',
      });
    }
    // Well off the line, but inside the unit's bounding rectangle's far corner: a gap.
    const gap = at({ x: 0, y: 55 });
    expect(pickFromRay(state, rayDownAt(gap.x, gap.y)).type).toBe('point');
  });

  it('bounds a sub-position pick by the minimum pick size', () => {
    const u = state.own.find((p) => p.id === 'blue-4')!;
    const minSize = pickMinSize(fixtureMap);
    const facing = u.facing;
    const at = (s: { x: number; y: number }) => ({
      x: u.position.x + s.x * Math.cos(facing) + s.y * Math.sin(facing),
      y: u.position.y + s.x * Math.sin(facing) - s.y * Math.cos(facing),
    });
    // Sub-position (0, 20); the footprint reaches only y = 30 (depth 60). Just inside and
    // just outside minSize/2 of the sub-position, ahead of the footprint's front edge.
    const inside = at({ x: 0, y: 20 + minSize / 2 - 1 });
    const outside = at({ x: 0, y: 20 + minSize / 2 + 2 });
    expect(pickFromRay(state, rayDownAt(inside.x, inside.y))).toMatchObject({ id: 'blue-4' });
    expect(pickFromRay(state, rayDownAt(outside.x, outside.y)).type).toBe('point');
  });

  it('uses the footprint depth, not a fixed size, for the far edge of a deep unit', () => {
    // A 85 x 120 m column facing north at (1850, 2450); minSize is 50 m so half is 25 m.
    const deep: SceneState = {
      ...state,
      own: [
        {
          ...state.own[0]!,
          facing: 0,
          footprint: { frontage: 85, depth: 120 },
          formation: 'column',
        },
      ],
      ghosts: [],
    };
    expect(pickFromRay(deep, rayDownAt(1850, 2450 - 55)).type).toBe('piece');
    expect(pickFromRay(deep, rayDownAt(1850, 2450 + 55)).type).toBe('piece');
    expect(pickFromRay(deep, rayDownAt(1850, 2450 - 65)).type).toBe('point');
  });

  it('reports a ghost contact near its position', () => {
    expect(pickFromRay(state, rayDownAt(2160, 345))).toMatchObject({
      type: 'piece',
      pieceKind: 'ghost',
      id: 'contact-1',
    });
    expect(pickFromRay(state, rayDownAt(2150 + pickMinSize(fixtureMap) * 2, 350)).type).toBe(
      'point',
    );
  });

  it('returns none off the map or for rays that miss the plane', () => {
    expect(onMap(fixtureMap, { x: 4001, y: 0 })).toBe(false);
    expect(pickFromRay(state, rayDownAt(-50, -50))).toEqual({ type: 'none' });
    const up = new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 1, 0));
    expect(pickFromRay(state, up)).toEqual({ type: 'none' });
  });
});
