import { describe, expect, it } from 'vitest';
import { fixtureMap, fixtureView } from './fixture';
import { boardLines, whereText } from './boardText';
import { buildSceneState, withTurnOverlays } from './sceneState';

describe('board text', () => {
  it('places a point in a compass ninth with rounded metres', () => {
    expect(whereText(fixtureMap, { x: 10, y: 10 })).toMatch(/^north-west, 0 m east and 0 m south/);
    expect(whereText(fixtureMap, { x: fixtureMap.width, y: fixtureMap.height })).toMatch(
      /^south-east/,
    );
  });

  it('lists every own unit, enemy and fight, and says so when empty', () => {
    const lines = boardLines(buildSceneState(fixtureView, fixtureMap), fixtureMap);
    expect(lines.filter((l) => l.startsWith('Your unit')).length).toBe(fixtureView.ownUnits.length);
    expect(boardLines(undefined, fixtureMap)).toEqual(['No map yet.']);
  });
});

describe('turn mode on the table (#439)', () => {
  const view = { ...fixtureView, hq: { x: 100, y: 100 } };
  const unit = view.ownUnits[0]!;

  it("draws each held order as its courier ride from HQ, and the last turn's fights", () => {
    const scene = withTurnOverlays(buildSceneState(view, fixtureMap), view, {
      held: [
        { orderId: 't-1', to: unit.id, text: 'Hold' },
        { orderId: 't-2', to: 'gone', text: 'x' },
      ],
      fights: [{ id: 'fought-1-0', position: { x: 5000, y: 5000 }, label: 'Fought 00:12' }],
    });
    expect(scene.orderRoutes?.filter((r) => r.kind === 'held')).toEqual([
      { id: 'held-t-1', kind: 'held', points: [{ x: 100, y: 100 }, unit.position] },
    ]);
    expect(scene.engagements?.at(-1)).toEqual({
      id: 'fought-1-0',
      position: { x: 5000, y: 5000 },
      past: { label: 'Fought 00:12' },
    });
    const lines = boardLines(scene, fixtureMap);
    expect(lines.some((l) => l.startsWith('Fought 00:12: '))).toBe(true);
    expect(lines.some((l) => l.startsWith('Order for this turn, to the unit at '))).toBe(true);
  });

  it('leaves a scene with nothing to add alone, and does not mark a fight twice', () => {
    const base = buildSceneState(view, fixtureMap);
    expect(withTurnOverlays(base, view, { held: [], fights: [] })).toBe(base);
    const live = { ...base, engagements: [{ id: 'u', position: { x: 10, y: 10 } }] };
    const out = withTurnOverlays(live, view, {
      held: [],
      fights: [{ id: 'f', position: { x: 60, y: 10 }, label: 'Fought 00:12' }],
    });
    expect(out.engagements).toEqual(live.engagements);
  });
});
