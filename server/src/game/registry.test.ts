import { describe, expect, it } from 'vitest';
import { holdTheBridge } from '@kriegsspiel/engine';
import { scenarioList } from './registry.js';

describe('scenarioList (#320)', () => {
  it('reads the length and the win condition from the scenario data', () => {
    const s = scenarioList().find((x) => x.id === holdTheBridge.id)!;
    expect(s.lengthMinutes).toBe(holdTheBridge.victory.holdMinutes);
    expect(s.briefing).toContain(`${holdTheBridge.victory.holdMinutes} minutes`);
    expect(s.briefing).not.toMatch(/three hours/);
  });
});
