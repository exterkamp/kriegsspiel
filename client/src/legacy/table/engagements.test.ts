import { describe, expect, it } from 'vitest';
import type { SideView } from '@kriegsspiel/protocol';
import { buildSceneState, engagementsOf } from './sceneState.js';
import type { BaseMap } from './types.js';

const view = (own: [number, number][], foes: [number, number][]) =>
  ({
    ownUnits: own.map(([x, y], i) => ({ id: `own-${i}`, position: { x, y } })),
    visibleEnemies: foes.map(([x, y], i) => ({ id: `foe-${i}`, position: { x, y } })),
  }) as unknown as SideView;

describe('engagementsOf (#320)', () => {
  it('marks the ground between an own unit and a visible enemy within fire', () => {
    expect(engagementsOf(view([[1000, 1000]], [[1200, 1000]]))).toEqual([
      { id: 'own-0', position: { x: 1100, y: 1000 } },
    ]);
  });

  it('marks nothing when no enemy is in sight or all are out of reach', () => {
    expect(engagementsOf(view([[1000, 1000]], []))).toEqual([]);
    expect(engagementsOf(view([[1000, 1000]], [[2000, 1000]]))).toEqual([]);
  });

  it('ignores a destroyed own unit', () => {
    const v = view([[1000, 1000]], [[1200, 1000]]);
    const dead = { ...v, ownUnits: v.ownUnits.map((u) => ({ ...u, strength: 0 })) } as SideView;
    expect(engagementsOf(dead)).toEqual([]);
  });

  it('draws one marker for units fighting side by side', () => {
    expect(
      engagementsOf(
        view(
          [
            [1000, 1000],
            [1050, 1000],
          ],
          [[1200, 1000]],
        ),
      ),
    ).toHaveLength(1);
  });
});

describe('tags beside a fight marker (#323)', () => {
  const map = {} as BaseMap;
  const full = (foes: [number, number][]) =>
    ({
      ...view([[1000, 1000]], foes),
      side: 'blue',
      atGame: 0,
      lastKnownContacts: [],
    }) as unknown as SideView;

  it('drops the "just now" tag of an enemy that is in the fight the marker names', () => {
    const scene = buildSceneState(full([[1200, 1000]]), map);
    expect(scene.engagements).toHaveLength(1);
    expect(scene.ghosts[0]!.ageTag).toBe('');
  });

  it('keeps it for an enemy in sight that is not fighting', () => {
    const scene = buildSceneState(full([[1900, 1000]]), map);
    expect(scene.engagements).toHaveLength(0);
    expect(scene.ghosts[0]!.ageTag).toBe('just now');
  });
});

describe('order arrows and planned routes (#203)', () => {
  const map = {} as BaseMap;
  const base = {
    side: 'blue',
    atGame: 0,
    ownUnits: [],
    visibleEnemies: [],
    lastKnownContacts: [],
  };
  const points = [
    { x: 100, y: 100 },
    { x: 400, y: 300 },
  ];

  it("maps the side view's own orders and routes into the scene", () => {
    const v = {
      ...base,
      orderRoutes: [
        { id: 'o1', unitId: 'blue-1', kind: 'order', points },
        { id: 'route-blue-1', unitId: 'blue-1', kind: 'route', points },
      ],
    } as unknown as SideView;
    expect(buildSceneState(v, map).orderRoutes).toEqual([
      { id: 'o1', kind: 'order', points },
      { id: 'route-blue-1', kind: 'route', points },
    ]);
  });

  it('is empty when the server sent none', () => {
    expect(buildSceneState(base as unknown as SideView, map).orderRoutes).toEqual([]);
  });
});
