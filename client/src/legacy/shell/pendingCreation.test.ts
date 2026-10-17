import { describe, expect, it } from 'vitest';
import { MIN_TURN_DEADLINE_HOURS, MAX_TURN_DEADLINE_HOURS } from '@kriegsspiel/protocol';
import { decodePendingCreation } from './pendingCreation.js';
const pairing = {
  pairingId: 'hold-the-bridge:default',
  revision: 'engine-pairing-v1:sha256:' + 'a'.repeat(64),
};
const value = () => ({
  request: {
    scenario: 'hold-the-bridge',
    side: 'blue',
    rate: 4,
    dial: 'standard',
    persona: 'dry',
    pairing: { ...pairing },
    requestId: 'ca0bb489-7c7e-4e6d-9d8f-ff5a76da4cce',
    battlefieldVersion: 1,
  },
  form: {
    scenario: 'hold-the-bridge',
    side: 'blue',
    rate: '4',
    customRate: '',
    dial: 'standard',
    persona: 'dry',
    mode: 'realtime',
    turnMinutes: '20',
    deadlineHours: '',
  },
  selection: { ...pairing },
});
describe('owner-scoped pending creation draft decoding', () => {
  it('retains exact accepted request and detached selection', () => {
    const input = value();
    const decoded = decodePendingCreation(JSON.stringify(input));
    expect(decoded).toEqual(input);
    decoded.selection.revision = 'changed';
    expect(decoded.request.pairing!.revision).toBe(pairing.revision);
  });
  it.each([MIN_TURN_DEADLINE_HOURS, MAX_TURN_DEADLINE_HOURS])(
    'accepts the actual protocol deadline boundary %s',
    (hours) => {
      const input = value();
      const extended = {
        ...input,
        request: { ...input.request, mode: 'turns', turnMinutes: 20, turnDeadlineHours: hours },
        form: { ...input.form, mode: 'turns', deadlineHours: String(hours) },
      };
      expect(decodePendingCreation(JSON.stringify(extended)).request.turnDeadlineHours).toBe(hours);
    },
  );
  it.each([
    'bad-json',
    'oversized',
    'foreign-choice',
    'changed-clock',
    'private-field',
    'unknown-version',
    'bad-uuid',
  ])('rejects %s without making a new request', (kind) => {
    const input = value();
    if (kind === 'bad-json') {
      expect(() => decodePendingCreation('{')).toThrow();
      return;
    }
    if (kind === 'oversized') {
      expect(() => decodePendingCreation(' '.repeat(32769))).toThrow();
      return;
    }
    if (kind === 'foreign-choice') input.selection.pairingId = 'other';
    if (kind === 'changed-clock') input.form.rate = '12';
    if (kind === 'private-field') Object.assign(input.request, { initialWorld: { units: [] } });
    if (kind === 'unknown-version') input.request.battlefieldVersion = 2;
    if (kind === 'bad-uuid') input.request.requestId = 'bad';
    expect(() => decodePendingCreation(JSON.stringify(input))).toThrow();
  });
});

describe('pending mode-dependent visible deadline', () => {
  it('rejects a visible deadline that disagrees with the exact retained request', () => {
    const input = value();
    const changed = {
      ...input,
      request: { ...input.request, mode: 'turns', turnMinutes: 20, turnDeadlineHours: 2 },
      form: { ...input.form, mode: 'turns', deadlineHours: '1' },
    };
    expect(() => decodePendingCreation(JSON.stringify(changed))).toThrow();
  });
  it.each(['turnMinutes', 'turnDeadlineHours'])('rejects realtime request field %s', (field) => {
    const input = value();
    Object.assign(input.request, { [field]: field === 'turnMinutes' ? 20 : 2 });
    expect(() => decodePendingCreation(JSON.stringify(input))).toThrow();
  });
  it('allows an absent turn deadline only with the matching empty form value', () => {
    const input = value();
    const noDeadline = {
      ...input,
      request: { ...input.request, mode: 'turns', turnMinutes: 20 },
      form: { ...input.form, mode: 'turns', deadlineHours: '' },
    };
    expect(decodePendingCreation(JSON.stringify(noDeadline))).toEqual(noDeadline);
    noDeadline.form.deadlineHours = '2';
    expect(() => decodePendingCreation(JSON.stringify(noDeadline))).toThrow();
  });
});
