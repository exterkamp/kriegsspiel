import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TurnProposal as EngineTurnProposal } from '@kriegsspiel/engine';
import { TurnProposal } from '@kriegsspiel/protocol';

describe('TurnProposal', () => {
  it('the protocol schema parses to what the engine applies (D39)', () => {
    expectTypeOf<TurnProposal>().toExtend<EngineTurnProposal>();
    expectTypeOf<EngineTurnProposal>().toExtend<TurnProposal>();
    expect(
      TurnProposal.safeParse({ turn: 1, units: [], observations: [], summary: '' }).success,
    ).toBe(true);
  });
});

describe('UnitOutcome.departure (#523)', () => {
  const outcome = (extra: Record<string, unknown>) => ({
    unitId: 'blue-1',
    x: 100,
    y: 200,
    facingDeg: 0,
    formation: 'line',
    strength: 600,
    morale: 80,
    status: 'active',
    continuing: { kind: 'hold' },
    orders: [],
    account: 'We held.',
    ...extra,
  });
  const proposal = (u: unknown, top: Record<string, unknown> = {}) => ({
    turn: 1,
    units: [u],
    observations: [],
    summary: '',
    ...top,
  });

  it('reads a null departure as none', () => {
    const r = TurnProposal.safeParse(proposal(outcome({ departure: null })));
    expect(r.success).toBe(true);
    expect(r.data!.units[0]!.departure).toBeUndefined();
  });

  it('keeps a stated departure, and an absent one stays absent', () => {
    const r = TurnProposal.safeParse(proposal(outcome({ departure: 'Fell back to the hedge.' })));
    expect(r.data!.units[0]!.departure).toBe('Fell back to the hedge.');
    const none = TurnProposal.safeParse(proposal(outcome({})));
    expect(none.success).toBe(true);
    expect(Object.keys(none.data!.units[0]!)).not.toContain('departure');
  });

  it('still refuses a departure that is not a string, too long, or at the top level', () => {
    expect(TurnProposal.safeParse(proposal(outcome({ departure: 3 }))).success).toBe(false);
    expect(TurnProposal.safeParse(proposal(outcome({ departure: 'x'.repeat(601) }))).success).toBe(
      false,
    );
    expect(TurnProposal.safeParse(proposal(outcome({}), { departure: 'Fell back.' })).success).toBe(
      false,
    );
  });
});
