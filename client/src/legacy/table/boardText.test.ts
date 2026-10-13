import { describe, expect, it } from 'vitest';
import { fixtureMap, fixtureView } from './fixture';
import { boardLines, whereText } from './boardText';
import { buildSceneState } from './sceneState';

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
