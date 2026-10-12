import { describe, expect, it } from 'vitest';
import { fixtureMap, fixtureView } from './fixture.js';
import { buildSceneState } from './sceneState.js';

describe('couriers in the scene state (#196)', () => {
  it('carries the side’s own couriers with minutes to arrival, and none when the view has none', () => {
    expect(buildSceneState(fixtureView, fixtureMap).couriers).toEqual([]);
    const view = {
      ...fixtureView,
      couriers: [
        {
          id: 'o1',
          unitId: fixtureView.ownUnits[0]!.id,
          position: { x: 1000, y: 1000 },
          to: { x: 2000, y: 2000 },
          arriveAtGame: fixtureView.atGame + 150_000,
        },
      ],
    };
    expect(buildSceneState(view, fixtureMap).couriers).toEqual([
      { id: 'o1', position: { x: 1000, y: 1000 }, to: { x: 2000, y: 2000 }, etaMin: 3 },
    ]);
  });
});
