import { describe, expect, it } from 'vitest';
import { TURN_ACCOUNT_MAX, TURN_ROLLS_MAX, TurnProposal } from './turn.js';

const outcome = {
  unitId: 'a',
  x: 1000,
  y: 600,
  facingDeg: 90,
  formation: 'line',
  strength: 400,
  morale: 60,
  status: 'active',
  continuing: { kind: 'move', x: 1200, y: 600 },
  orders: [{ orderId: 'o1', result: 'carried-out' }],
  account: 'Advanced to the hedge.',
};
const proposal = { turn: 1, units: [outcome], observations: [], summary: 'Blue advanced.' };

describe('TurnProposal', () => {
  it('accepts a well-formed proposal, out-of-range numbers included (the engine clamps them)', () => {
    expect(TurnProposal.parse(proposal)).toEqual(proposal);
    const wild = { ...proposal, units: [{ ...outcome, morale: 140, strength: -5, ammo: 300 }] };
    expect(TurnProposal.safeParse(wild).success).toBe(true);
  });

  it('refuses what is not the schema: unknown fields, bad enums, long strings, odd rolls', () => {
    const bad = [
      { ...proposal, extra: 1 },
      { ...proposal, turn: 0 },
      { ...proposal, units: [{ ...outcome, status: 'resurrected' }] },
      { ...proposal, units: [{ ...outcome, account: 'x'.repeat(TURN_ACCOUNT_MAX + 1) }] },
      { ...proposal, units: [{ ...outcome, orders: [{ orderId: 'o1', result: 'maybe' }] }] },
      { ...proposal, units: [{ ...outcome, x: Number.NaN }] },
      { ...proposal, observations: [{ side: 'blue', unitId: 'c', by: 'a', when: 'during' }] },
      { ...proposal, rolls: [{ id: 'r1', why: 'ford', chance: 1 }] },
      {
        ...proposal,
        rolls: Array.from({ length: TURN_ROLLS_MAX + 1 }, (_, i) => ({
          id: `r${i}`,
          why: '',
          chance: 0.5,
        })),
      },
    ];
    for (const b of bad) expect(TurnProposal.safeParse(b).success).toBe(false);
  });
});
