/**
 * The name list behind every leak check (#44), and what it leaves out (#524): a name made only of
 * generic arm and size words is a description a commander may give, not a secret.
 */
import { describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import type { GameState } from '@kriegsspiel/engine';
import { hiddenIn, hiddenTerms, isDistinctive } from './leakGuard.js';

/** Hold the Bridge with Red's cavalry (red-3, "Hussar Squadron") given the name to test. */
function world(red3Name: string): GameState {
  const w = loadScenario(holdTheBridge);
  return { ...w, units: w.units.map((u) => (u.id === 'red-3' ? { ...u, name: red3Name } : u)) };
}

describe('isDistinctive', () => {
  it('is false for a name made only of arm, size and joining words', () => {
    for (const n of [
      'Hussar Squadron',
      'Hussars',
      'Cavalry Squadron',
      'Line Battalion',
      'Line infantry',
      'Artillery',
      'Skirmishers',
      'The Guns',
      'a battalion of the line',
      'Horse Battery',
    ])
      expect(isDistinctive(n), n).toBe(false);
  });

  it('is true for a name with a number, a proper name or a commander', () => {
    for (const n of [
      '2nd Hussars',
      '1st Battalion',
      'Red Vanguard',
      'Vanguard Battalion',
      'Hussars of Ostwald',
      'Hold Fast Regiment',
      'Col. Brandt',
      'Maj. von Reiter',
      'Brandt',
    ])
      expect(isDistinctive(n), n).toBe(true);
  });
});

describe('hiddenTerms', () => {
  it("leaves out an enemy's generic name but keeps its commander", () => {
    const terms = hiddenTerms(world('Hussar Squadron'), 'blue');
    expect(terms).not.toContain('Hussar Squadron');
    expect(terms).toContain('Maj. von Reiter');
    expect(terms).toContain('Vanguard Battalion');
  });

  it("keeps an enemy's distinctive name", () => {
    expect(hiddenTerms(world('2nd Hussars'), 'blue')).toContain('2nd Hussars');
    expect(hiddenTerms(world('Red Vanguard'), 'blue')).toContain('Red Vanguard');
  });
});

describe('hiddenIn on the side’s terms', () => {
  it('lets a commander describe an enemy by arm and size', () => {
    const terms = hiddenTerms(world('Hussar Squadron'), 'blue');
    for (const text of [
      'A hussar squadron was seen on the road.',
      'Sir, a Hussar Squadron is upon our flank.',
      'A battalion of the line came on; the guns opened at noon.',
      'Enemy cavalry and a battalion crossed the bridge.',
    ])
      expect(hiddenIn(text, terms), text).toEqual([]);
  });

  it('still refuses a distinctive name or a commander, in any case or spacing', () => {
    const terms = hiddenTerms(world('2nd Hussars'), 'blue');
    expect(hiddenIn('The 2nd Hussars charged.', terms)).toEqual([
      'names the other side ("2nd Hussars")',
    ]);
    expect(hiddenIn('the 2nd   hussars charged.', terms)).toHaveLength(1);
    expect(hiddenIn('We saw the vanguard battalion.', terms)).toEqual([
      'names the other side ("Vanguard Battalion")',
    ]);
    expect(hiddenIn('Maj. von Reiter leads them.', terms)).toEqual([
      'names the other side ("Maj. von Reiter")',
    ]);
    const red = hiddenTerms(world('Red Vanguard'), 'blue');
    expect(hiddenIn('The red vanguard is at the ford.', red)).toHaveLength(1);
    // a generic description next to a distinctive name does not hide the name
    expect(hiddenIn('A hussar squadron, the 2nd Hussars, came on.', terms)).toHaveLength(1);
  });
});
