import { describe, expect, it } from 'vitest';
import {
  accountSightProblem,
  enemyDescribed,
  ownTermsOf,
  sideSight,
  type SightObservation,
} from './accountSight.js';

/** Red's units in Hold the Bridge. */
const RED = ownTermsOf([
  { name: 'Vanguard Battalion', commander: 'Col. Brandt', kind: 'infantry' },
  { name: 'Line Battalion', commander: 'Col. Hartmann', kind: 'infantry' },
  { name: 'Hussar Squadron', commander: 'Maj. von Reiter', kind: 'cavalry' },
]);

describe('what describes the enemy (#533)', () => {
  it.each([
    ['He saw infantry in line at the south end of the bridge.', 'infantry'],
    ['There was some cavalry behind it.', 'cavalry'],
    ['A battalion stood across the water.', 'battalion'],
    ['He found it held by two squadrons.', 'squadrons'],
    ['We met a steady line and could not drive it off.', 'line'],
    ['He fired into the flank of the column.', 'column'],
    ['The enemy came up to the far bank.', 'enemy'],
    ['Enemy columns are deploying on the north bank.', 'Enemy'],
    ['He saw guns on the ridge.', 'guns'],
    ['He made out a Hussar Squadron on the far bank.', 'hussar'],
  ])('%s', (account, word) => {
    expect(enemyDescribed(account, RED)).toBe(word);
  });

  it.each([
    'Maj. von Reiter rode down to the river and halted beside the Vanguard.',
    'Kept my squadron out of the fire and did not charge.',
    'The battalion formed column on the road and went onto the bridge.',
    'Hartmann formed line east of the bridge; the left company wheeled to the flank.',
    'He held north of the river and watched the infantry fall back past it.',
    'The Vanguard Battalion’s line held; the Line Battalion came up behind.',
    'Rode a mile west along the bank. Found no ford, and met no enemy.',
    'Saw nothing of the enemy all morning.',
    'He was fired on from the far bank and returned fire.',
    'The men are tired and short of powder.',
  ])('not: %s', (account) => {
    expect(enemyDescribed(account, RED)).toBeUndefined();
  });
});

describe('an account against what its side saw (#533)', () => {
  const obs = (by: string, unitId: string): SightObservation => ({
    side: 'red',
    by,
    unitId,
    when: 'end',
  });
  const SEEN = 'He saw infantry in line at the bridge, with some cavalry behind.';

  it('refuses a description from a unit whose every sighting was refused, whatever its side knows', () => {
    const sight = sideSight(
      'red',
      [obs('red-1', 'blue-1'), obs('red-3', 'blue-1')],
      [obs('red-1', 'blue-1')],
      true,
    );
    expect(sight).toEqual({
      refused: new Set(['red-3']),
      stood: new Set(['red-1']),
      knowsEnemy: true,
    });
    expect(accountSightProblem(SEEN, 'red-3', sight, RED)).toBe(
      'describes the enemy ("infantry") though the sight check refused every sighting of this unit',
    );
    // The unit whose sighting stood says what it saw.
    expect(accountSightProblem(SEEN, 'red-1', sight, RED)).toBeUndefined();
    // A unit with no sighting of its own, on a side that knows the enemy, may repeat what is known.
    expect(accountSightProblem(SEEN, 'red-2', sight, RED)).toBeUndefined();
  });

  it('refuses any description when no unit of the side could see the enemy', () => {
    const sight = sideSight('red', [], [], false);
    expect(accountSightProblem('A battalion stood by the bridge.', 'red-2', sight, RED)).toBe(
      'describes the enemy ("battalion") though no unit of the side could see one',
    );
    expect(accountSightProblem('We marched to the bridge and halted.', 'red-2', sight, RED)).toBe(
      undefined,
    );
  });

  it('keeps a unit with one sighting that stood and one refused', () => {
    const sight = sideSight(
      'red',
      [obs('red-3', 'blue-1'), obs('red-3', 'blue-2')],
      [obs('red-3', 'blue-1')],
      false,
    );
    expect(accountSightProblem(SEEN, 'red-3', sight, RED)).toBeUndefined();
  });

  it('ignores the other side’s observations', () => {
    const blue: SightObservation = { side: 'blue', by: 'blue-1', unitId: 'red-1', when: 'end' };
    expect(sideSight('red', [blue], [], false)).toEqual({
      refused: new Set(),
      stood: new Set(),
      knowsEnemy: false,
    });
  });
});
