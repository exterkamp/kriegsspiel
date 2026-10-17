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

/** Red's units with their ids, as the umpire's stage and the papers pass them. */
const RED_UNITS = ownTermsOf([
  { id: 'red-1', name: 'Vanguard Battalion', commander: 'Col. Brandt', kind: 'infantry' },
  { id: 'red-2', name: 'Line Battalion', commander: 'Col. Hartmann', kind: 'infantry' },
  { id: 'red-3', name: 'Hussar Squadron', commander: 'Maj. von Reiter', kind: 'cavalry' },
]);

describe('a unit describing itself, and the enemy in passing (#558)', () => {
  const blind = sideSight('red', [], [], false);
  const refused = sideSight(
    'red',
    [{ side: 'red', by: 'red-3', unitId: 'blue-1', when: 'end' }],
    [],
    true,
  );

  it.each([
    // #523's garbled-order, Opus: the Hussars' own account, flagged for "hussars".
    'No orders. Maj. von Reiter keeps the hussars at the edge of the northern wood. Vedettes are out, but there is nothing to report.',
    'Hussars watered at the brook and stood to their horses.',
    'The squadron and its cavalry pickets stood in the wood.',
    'Squadron vedettes watched the road.',
  ])('the Hussars may speak of themselves: %s', (account) => {
    expect(enemyDescribed(account, RED_UNITS, 'red-3')).toBeUndefined();
    expect(accountSightProblem(account, 'red-3', blind, RED_UNITS)).toBeUndefined();
    expect(accountSightProblem(account, 'red-3', refused, RED_UNITS)).toBeUndefined();
  });

  it.each([
    // #523's flank-march-woods, Sonnet: red-1's account, flagged for "enemy".
    'Stood where we were, drawn up in line beside the High road, to hold the enemy’s eye as ordered.',
    'He met no enemy on the road.',
    'Held the bridge-end, on our side of the river; the enemy’s bank was quiet.',
    'He posted pickets to deny the enemy the bridge.',
    'He pushed on to the bridge before the enemy can cross it.',
    'Kept to the wood, in case the enemy should come down the road.',
    'He will hold the ford if the enemy comes on.',
    'The enemy headquarters lies more than a league off, not to be reached in a quarter hour.',
    'He sees nothing of the enemy across the water yet.',
    'He saw nothing of an enemy from where he stood.',
    'He kept his horses in hand and waited for the enemy to come over.',
  ])('the enemy in passing: %s', (account) => {
    expect(enemyDescribed(account, RED_UNITS, 'red-1')).toBeUndefined();
    expect(accountSightProblem(account, 'red-1', blind, RED_UNITS)).toBeUndefined();
  });

  it.each([
    ['He saw infantry in line at the south end of the bridge.', 'red-3', 'infantry'],
    // An arm both sides have is no unit's own word when bare: an infantry unit may see infantry.
    ['He saw infantry in line at the south end of the bridge.', 'red-1', 'infantry'],
    ['Cavalry showed on the ridge.', 'red-3', 'cavalry'],
    ['There was some cavalry behind it.', 'red-3', 'cavalry'],
    ['He found two squadrons of hussars on the far bank.', 'red-3', 'squadrons'],
    ['Other hussars came down to the north bank.', 'red-3', 'hussars'],
    ['He saw the enemy column on the bridge.', 'red-1', 'enemy'],
    ['The enemy in the wood opened fire.', 'red-1', 'enemy'],
    ['Late in the quarter enemy hussars appear on the far bank.', 'red-3', 'enemy'],
    ['He found the enemy’s line drawn up behind the hedge.', 'red-2', 'line'],
    ['He kept the enemy in view all morning.', 'red-1', 'enemy'],
    ['He rode down to the river and found two battalions in line.', 'red-3', 'battalions'],
  ])('still caught: %s', (account, unitId, word) => {
    expect(enemyDescribed(account, RED_UNITS, unitId)).toBe(word);
    expect(accountSightProblem(account, unitId, blind, RED_UNITS)).toMatch(
      new RegExp(`^describes the enemy \\("${word}"\\) though no unit of the side could see one$`),
    );
  });

  it('screens the Hussars’ sightings when they were refused', () => {
    expect(
      accountSightProblem(
        'Maj. von Reiter rode to the bridge and saw infantry in line beyond it.',
        'red-3',
        refused,
        RED_UNITS,
      ),
    ).toBe(
      'describes the enemy ("infantry") though the sight check refused every sighting of this unit',
    );
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
