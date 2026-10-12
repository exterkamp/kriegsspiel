import { describe, expect, it } from 'vitest';
import type { SideView } from '@kriegsspiel/protocol';
import { engagementsOf } from './sceneState.js';

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
