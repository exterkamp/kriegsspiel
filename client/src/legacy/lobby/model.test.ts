import { describe, expect, it } from 'vitest';
import { paceLabel, rateLabel } from './model.js';

describe('paceLabel', () => {
  it('is the clock rate for a real-time game', () => {
    expect(paceLabel({ rate: 12 })).toBe('12:1');
    expect(paceLabel({ rate: 4, umpire: { dial: 'standard', persona: 'dry' } })).toBe(rateLabel(4));
  });

  it('names the turns of a turn-mode game, and its deadline when there is one (D39)', () => {
    const umpire = { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 30 } as const;
    expect(paceLabel({ rate: 12, umpire })).toBe('turns of 30 min');
    expect(paceLabel({ rate: 12, umpire: { ...umpire, turnDeadlineHours: 24 } })).toBe(
      'turns of 30 min, orders due in 24 h',
    );
    expect(paceLabel({ rate: 1, umpire: { dial: 'free', persona: 'dry', mode: 'turns' } })).toBe(
      'turns of 20 min',
    );
  });

  it('counts the turns of a started or finished turn game (#429)', () => {
    const umpire = { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 } as const;
    const MIN = 60_000;
    const g = { rate: 4, umpire, status: 'started' as const };
    // Over at 00:40 after two turns; over mid-turn at 00:45 after three.
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 40 * MIN })).toBe('2 turns of 20 min');
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 45 * MIN })).toBe('3 turns of 20 min');
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 5 * MIN })).toBe('1 turn of 20 min');
    // Being played: turn 3 is open at 00:40.
    expect(paceLabel({ ...g, finished: false, gameTimeMs: 40 * MIN })).toBe(
      'turn 3, turns of 20 min',
    );
    // In the lobby, and a real-time game, as before.
    expect(paceLabel({ ...g, status: 'lobby', gameTimeMs: 0 })).toBe('turns of 20 min');
    expect(paceLabel({ rate: 4, status: 'started', finished: true, gameTimeMs: 40 * MIN })).toBe(
      '4:1',
    );
  });
});
