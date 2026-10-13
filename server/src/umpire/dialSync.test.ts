import { DIALS as ENGINE_DIALS, DIAL_CAPS } from '@kriegsspiel/engine';
import { DIALS as PROTOCOL_DIALS, DIAL_INFO } from '@kriegsspiel/protocol';
import { describe, expect, it } from 'vitest';

describe('dial lists', () => {
  it('are the same in the engine and the protocol, with an entry in each table', () => {
    expect([...PROTOCOL_DIALS]).toEqual([...ENGINE_DIALS]);
    for (const dial of PROTOCOL_DIALS) {
      expect(DIAL_CAPS[dial]).toBeTypeOf('number');
      expect(DIAL_INFO[dial].label).toBeTruthy();
    }
    expect(Object.keys(DIAL_CAPS).sort()).toEqual([...PROTOCOL_DIALS].sort());
    expect(Object.keys(DIAL_INFO).sort()).toEqual([...PROTOCOL_DIALS].sort());
  });
});
