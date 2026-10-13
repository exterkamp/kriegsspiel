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
