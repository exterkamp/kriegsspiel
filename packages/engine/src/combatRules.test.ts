import { describe, expect, it } from 'vitest';
import { COMBAT_DATA, CombatDataError, parseCombatData } from './combatRules.js';

type Loose = { [group: string]: { [key: string]: unknown } | null };

describe('combat data', () => {
  it('accepts the shipped data', () => {
    expect(parseCombatData(COMBAT_DATA)).toEqual(COMBAT_DATA);
  });

  it('rejects a missing, non-positive or out-of-range number', () => {
    const bad = (mutate: (d: Loose) => void) => {
      const d = structuredClone(COMBAT_DATA) as unknown as Loose;
      mutate(d);
      expect(() => parseCombatData(d)).toThrow(CombatDataError);
    };
    bad((d) => delete d.fire!.meleeFactor);
    bad((d) => (d.morale!.checkFailLoss = 0));
    bad((d) => (d.fire!.longRangeFactor = 1.5));
    bad((d) => (d.rally!.dieAtLeast = 7));
    bad((d) => (d.rally!.moraleAfter = 120));
    bad((d) => (d.rally!.retryMs = 1.5));
    bad((d) => (d.rally = null));
  });
});
