import { describe, expect, it } from 'vitest';
import { Rng, seedRng } from './rng.js';
import { TURN_ROLLS_PER_TURN, rollTurnDice, screenRollRequests, turnDice } from './turnDice.js';

const ask = (id: string, chance = 0.5) => ({ id, why: `question ${id}`, chance });

describe('the umpire’s dice (D39, 11.7)', () => {
  it('rolls in id order, one draw each, on a stream seeded from the turn’s start and number', () => {
    const r0 = seedRng(1815);
    const rolls = rollTurnDice(r0, 3, [ask('b', 0.3), ask('a', 0.9)]);
    expect(rolls.map((r) => r.id)).toEqual(['a', 'b']);
    const rng = new Rng(seedRng(r0 ^ 3));
    const first = rng.next();
    const second = rng.next();
    expect(rolls[0]).toEqual({ ...ask('a', 0.9), roll: first, success: first < 0.9 });
    expect(rolls[1]).toEqual({ ...ask('b', 0.3), roll: second, success: second < 0.3 });
    expect(turnDice(r0, 3).next()).toBe(first);
  });

  it('is pure: the same state, turn and requests give the same rolls; another turn others', () => {
    const r0 = seedRng(42);
    const reqs = [ask('r1'), ask('r2'), ask('r3')];
    expect(rollTurnDice(r0, 2, reqs)).toEqual(rollTurnDice(r0, 2, [...reqs].reverse()));
    expect(rollTurnDice(r0, 2, reqs).map((r) => r.roll)).not.toEqual(
      rollTurnDice(r0, 3, reqs).map((r) => r.roll),
    );
  });

  it('succeeds about as often as the stated chance', () => {
    let wins = 0;
    for (let n = 1; n <= 2000; n++) {
      if (rollTurnDice(seedRng(7), n, [ask('r', 0.25)])[0]!.success) wins++;
    }
    expect(wins / 2000).toBeGreaterThan(0.21);
    expect(wins / 2000).toBeLessThan(0.29);
  });

  it('refuses odds outside 0.05..0.95, a repeated id and a fourth roll, each with a problem', () => {
    const s = screenRollRequests([
      ask('r1', 0.05),
      ask('r2', 0.99),
      ask('r1', 0.5),
      ask('r3', 0.95),
      ask('r4', 0.02),
      ask('r5', 0.5),
      ask('r6', 0.5),
    ]);
    expect(TURN_ROLLS_PER_TURN).toBe(3);
    expect(s.accepted.map((r) => r.id)).toEqual(['r1', 'r3', 'r5']);
    expect(s.problems).toEqual([
      'rolls: r2: its chance 0.99 is outside 0.05..0.95; decide it without a roll',
      'rolls: r1: the id is used by an earlier roll; decide it without a roll',
      'rolls: r4: its chance 0.02 is outside 0.05..0.95; decide it without a roll',
      'rolls: r6: at most 3 rolls a turn; decide it without a roll',
    ]);
  });
});
