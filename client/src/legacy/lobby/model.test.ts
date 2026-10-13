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

  it('counts the turns of a started or finished turn game (#429, #438)', () => {
    const umpire = { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 } as const;
    const MIN = 60_000;
    const g = { rate: 4, umpire, status: 'started' as const };
    // Over at 00:40 after two turns; over mid-turn at 00:45 after three.
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 40 * MIN })).toBe(
      'Finished after 2 turns',
    );
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 45 * MIN })).toBe(
      'Finished after 3 turns',
    );
    expect(paceLabel({ ...g, finished: true, gameTimeMs: 5 * MIN })).toBe('Finished after 1 turn');
    // Being played: turn 3 is open at 00:40, of about 3 in a 50-minute scenario.
    expect(paceLabel({ ...g, finished: false, gameTimeMs: 40 * MIN }, 50)).toBe(
      'Turn 3 of about 3 (20 min turns)',
    );
    expect(paceLabel({ ...g, finished: false, gameTimeMs: 0 }, 50)).toBe(
      'Turn 1 of about 3 (20 min turns)',
    );
    // Without the scenario's length the count is left out.
    expect(paceLabel({ ...g, finished: false, gameTimeMs: 40 * MIN })).toBe(
      'Turn 3 (20 min turns)',
    );
    // A finished game with a deadline has no orders due; a live one still does.
    const due = { ...g, umpire: { ...umpire, turnDeadlineHours: 24 } };
    expect(paceLabel({ ...due, finished: true, gameTimeMs: 40 * MIN })).toBe(
      'Finished after 2 turns',
    );
    expect(paceLabel({ ...due, finished: false, gameTimeMs: 40 * MIN }, 50)).toBe(
      'Turn 3 of about 3 (20 min turns, orders due in 24 h)',
    );
    // In the lobby, and a real-time game, as before.
    expect(paceLabel({ ...g, status: 'lobby', gameTimeMs: 0 })).toBe('turns of 20 min');
    expect(paceLabel({ rate: 4, status: 'started', finished: true, gameTimeMs: 40 * MIN })).toBe(
      '4:1',
    );
  });
});
