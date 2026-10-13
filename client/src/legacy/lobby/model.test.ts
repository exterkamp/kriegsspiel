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
});
