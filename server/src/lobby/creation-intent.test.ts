import { describe, expect, it } from 'vitest';
import { NativeBattlefieldRegistry } from '../game/native-battlefield-registry.js';
import {
  creationDefaults,
  creationIntentFingerprint,
  decodeCreationRequest,
  normalizeCreationIntent,
  validateNewCreationIntent,
} from './creation-intent.js';
const registry = new NativeBattlefieldRegistry();
const context = () => creationDefaults(registry.resolve('hold-the-bridge'), true);
const fingerprint = (request: unknown) =>
  creationIntentFingerprint(normalizeCreationIntent(decodeCreationRequest(request), context()));

describe('immutable creation intent and accepted default context', () => {
  it('preserves current server defaults, independently of the form clock default', () => {
    const ctx = context();
    const intent = normalizeCreationIntent(decodeCreationRequest({}), ctx);
    expect(intent).toMatchObject({
      scenario: 'hold-the-bridge',
      side: 'blue',
      rate: 1,
      sessionType: 'co_op_vs_ai',
      dial: 'standard',
      persona: 'dry',
      mode: 'realtime',
      turnMinutes: null,
      turnDeadlineHours: null,
      pause: null,
      lobby: false,
      hierarchy: 'shared',
    });
    expect(intent.pairing).toEqual(ctx.defaultPairing);
    expect(() => validateNewCreationIntent(intent, ctx)).not.toThrow();
  });

  it('normalizes explicit defaults and property order to the same effective fingerprint', () => {
    expect(
      fingerprint({
        rate: 1,
        dial: 'standard',
        persona: 'dry',
        mode: 'realtime',
        lobby: false,
        hierarchy: 'shared',
      }),
    ).toBe(fingerprint({}));
    expect(fingerprint({ dial: 'rigid', rate: 4 })).toBe(fingerprint({ rate: 4, dial: 'rigid' }));
    expect(fingerprint({ turnMinutes: 60, turnDeadlineHours: 1 })).toBe(fingerprint({}));
  });

  it('retains the accepted context across latest-default drift without changing retries', () => {
    const accepted = JSON.parse(JSON.stringify(context()));
    const intent = normalizeCreationIntent({}, accepted);
    const latest = context();
    latest.rate = 12;
    latest.persona = 'dramatic';
    expect(creationIntentFingerprint(normalizeCreationIntent({}, accepted))).toBe(
      creationIntentFingerprint(intent),
    );
    expect(creationIntentFingerprint(normalizeCreationIntent({}, latest))).not.toBe(
      creationIntentFingerprint(intent),
    );
  });

  it.each([
    { rate: 4 },
    { scenario: 'other' },
    { side: 'red' },
    { sessionType: 'team_vs_team' },
    { dial: 'rigid' },
    { persona: 'dramatic' },
    { mode: 'turns' },
    { hierarchy: 'chain' },
    { lobby: true },
    { pause: { rule: 'majority' } },
  ])('distinguishes changed effective choice %j', (request) => {
    expect(fingerprint(request)).not.toBe(fingerprint({}));
  });

  it('pins turn timing and pause defaults without inventing a real-time deadline', () => {
    expect(fingerprint({ mode: 'turns', turnMinutes: 20 })).toBe(fingerprint({ mode: 'turns' }));
    expect(fingerprint({ mode: 'turns', turnMinutes: 30 })).not.toBe(
      fingerprint({ mode: 'turns' }),
    );
    expect(fingerprint({ mode: 'turns', turnDeadlineHours: 1 })).not.toBe(
      fingerprint({ mode: 'turns' }),
    );
    expect(fingerprint({ pause: { rule: 'majority' } })).toBe(
      fingerprint({
        pause: {
          rule: 'majority',
          voteTimeoutMs: 60_000,
          holdMs: 300_000,
          holdsPerPlayer: 2,
          holdsPerGame: 6,
        },
      }),
    );
  });

  it('retains existing co-op side/AI rejection and hot-seat initial-side behavior', () => {
    const ctx = context();
    const wrongSide = normalizeCreationIntent({ side: 'red' }, ctx);
    expect(() => validateNewCreationIntent(wrongSide, ctx)).toThrow('bad_side');
    const noAi = creationDefaults(registry.resolve('hold-the-bridge'), false);
    expect(() =>
      validateNewCreationIntent(
        normalizeCreationIntent({ sessionType: 'co_op_vs_ai' }, noAi),
        noAi,
      ),
    ).toThrow('no_ai_opponent');
    expect(normalizeCreationIntent({ sessionType: 'hot_seat', side: 'red' }, ctx).side).toBe(
      'blue',
    );
    expect(normalizeCreationIntent({}, noAi).sessionType).toBe('team_vs_team');
  });

  it('requires complete modern selection/key/capability while preserving no-key legacy input', () => {
    const pairing = context().defaultPairing;
    for (const bad of [
      { pairing },
      { pairing: { pairingId: pairing.pairingId } },
      { pairing, requestId: 'not-a-uuid', battlefieldVersion: 1 },
      { pairing, requestId: 'c2a42098-e40e-4f7c-a592-d374154f6e4b' },
      { map: 'owned:unpaired' },
    ])
      expect(() => decodeCreationRequest(bad)).toThrow();
    expect(decodeCreationRequest({})).toEqual({});
    expect(
      decodeCreationRequest({
        pairing,
        requestId: 'c2a42098-e40e-4f7c-a592-d374154f6e4b',
        battlefieldVersion: 1,
      }).pairing,
    ).toEqual(pairing);
  });

  it('excludes operation key/capability from the playable intent fingerprint', () => {
    expect(
      fingerprint({ requestId: 'c2a42098-e40e-4f7c-a592-d374154f6e4b', battlefieldVersion: 1 }),
    ).toBe(fingerprint({}));
  });
});

describe('intent comparison boundaries', () => {
  it('distinguishes explicit pairing changes while omitting a pairing uses the accepted default', () => {
    const pairing = context().defaultPairing;
    const common = { requestId: 'c2a42098-e40e-4f7c-a592-d374154f6e4b', battlefieldVersion: 1 };
    expect(fingerprint({ ...common, pairing })).toBe(fingerprint({}));
    expect(
      fingerprint({ ...common, pairing: { ...pairing, pairingId: 'hold-the-bridge:open-v1' } }),
    ).not.toBe(fingerprint({}));
    expect(
      fingerprint({
        ...common,
        pairing: { ...pairing, revision: `engine-pairing-v1:sha256:${'b'.repeat(64)}` },
      }),
    ).not.toBe(fingerprint({}));
  });

  it('rejects a new no-human session by policy without crashing during normalization', () => {
    const ctx = context();
    ctx.sides.forEach((side) => {
      side.controller = 'scripted';
    });
    const intent = normalizeCreationIntent({}, ctx);
    expect(() => validateNewCreationIntent(intent, ctx)).toThrow('bad_session');
  });
});
