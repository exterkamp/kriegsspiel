import { createHash } from 'node:crypto';
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { describeDefaultBattlefield } from './battlefield.js';
import {
  createNativeScenarioPin,
  decodeNativeScenarioPin,
  nativeCanonicalJson,
  type NativeScenarioPinV1,
} from './native-scenario-pin.js';
import { defaultBridgeV1Input } from './native-scenarios/default-bridge-v1.js';
import { openBridgeV1Input } from './native-scenarios/open-bridge-v1.js';

function pin(open = false, name = 'The bridge battlefield'): NativeScenarioPinV1 {
  return createNativeScenarioPin({
    rawScenario: open ? openBridgeV1Input() : defaultBridgeV1Input(),
    scenarioId: 'hold-the-bridge',
    pairingId: open ? 'hold-the-bridge:open-v1' : 'hold-the-bridge:default',
    name,
    isDefault: !open,
  });
}
// Private checksums detect contradiction/corruption; they are not registry approval or signatures.
function reseal(value: NativeScenarioPinV1): NativeScenarioPinV1 {
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pinIdentity'));
  return {
    ...value,
    pinIdentity: `engine-native-pin-v1:sha256:${createHash('sha256').update(nativeCanonicalJson(body)).digest('hex')}`,
  };
}

describe('private native initial-scenario pins', () => {
  it('retains the exact existing initial bridge and unchanged legacy public projection', () => {
    const stored = pin();
    expect(stored.initialWorld).toEqual(loadScenario(holdTheBridge));
    const legacy = describeDefaultBattlefield(
      loadScenario(holdTheBridge),
      'The bridge battlefield',
    );
    expect(stored.battlefield.map).toEqual(legacy.map);
    expect(stored.battlefield.pairing.scenarioRevision).toBe(legacy.pairing.scenarioRevision);
    expect(stored.battlefield.pairing.revision).not.toBe(legacy.pairing.revision);
    expect(stored.battlefield.pairing.resolvedScenarioId).toBe('hold-the-bridge');
  });

  it.each([false, true])(
    'round-trips durable JSON and returns detached validated state (open=%s)',
    (open) => {
      const original = pin(open);
      const readback = decodeNativeScenarioPin(JSON.parse(JSON.stringify(original)));
      expect(readback).toEqual(original);
      expect(readback.initialWorld).not.toBe(original.initialWorld);
      readback.initialWorld.units[0]!.morale = 0;
      expect(original.initialWorld.units[0]!.morale).toBe(80);
    },
  );

  it('pins distinct terrain/world/assembly identity while display renaming preserves pairing identity', () => {
    const normal = pin();
    const open = pin(true);
    const renamed = pin(false, 'A display name');
    expect(open.publicScenarioId).toBe(normal.publicScenarioId);
    expect(open.battlefield.pairing.resolvedScenarioId).toBe('hold-the-bridge-open-v1');
    expect(open.battlefield.map.terrainIdentity).not.toBe(normal.battlefield.map.terrainIdentity);
    expect(open.battlefield.pairing.scenarioRevision).not.toBe(
      normal.battlefield.pairing.scenarioRevision,
    );
    expect(open.battlefield.pairing.revision).not.toBe(normal.battlefield.pairing.revision);
    expect(renamed.battlefield.pairing).toEqual(normal.battlefield.pairing);
    expect(renamed.pinIdentity).not.toBe(normal.pinIdentity);
    expect(decodeNativeScenarioPin(renamed)).toEqual(renamed);
  });

  it('contains only allowlisted public geography in its public projection', () => {
    const stored = pin();
    const publicJson = JSON.stringify(stored.battlefield);
    for (const secret of [
      'Col. Aubry',
      '1st Battalion',
      '2nd Battalion',
      'morale',
      'hq',
      'victory',
      'intel',
      'units',
      'attrs',
    ])
      expect(publicJson).not.toContain(secret);
    expect(stored.initialWorld.units).toHaveLength(6);
    expect(stored.battlefield.map.preview).toHaveLength(5);
  });

  it('canonicalizes object key order only, preserving arrays and all content', () => {
    expect(nativeCanonicalJson({ b: [2, 1], a: { z: 1, y: 2 } })).toBe(
      nativeCanonicalJson({ a: { y: 2, z: 1 }, b: [2, 1] }),
    );
    expect(nativeCanonicalJson([2, 1])).not.toBe(nativeCanonicalJson([1, 2]));
    const stored = pin();
    const reordered = Object.fromEntries(Object.entries(stored).reverse());
    expect(decodeNativeScenarioPin(reordered)).toEqual(stored);
  });

  it('rejects world contradictions even if the outer checksum is recomputed', () => {
    for (const change of [
      (stored: NativeScenarioPinV1) => {
        stored.initialWorld.time = 1;
      },
      (stored: NativeScenarioPinV1) => {
        stored.initialWorld.units[0]!.center.x += 1000;
      },
      (stored: NativeScenarioPinV1) => {
        stored.initialWorld.map.features[0]!.attrs.cover = 0;
      },
      (stored: NativeScenarioPinV1) => {
        stored.initialWorld.sides[0]!.hq.x += 1000;
      },
      (stored: NativeScenarioPinV1) => {
        Object.assign(stored.initialWorld, { privateExtra: true });
      },
    ]) {
      const stored = pin();
      change(stored);
      expect(() => decodeNativeScenarioPin(reseal(stored))).toThrow(/initial-world/);
    }
  });

  it('rejects preview/pairing/digest contradictions even with a fresh outer checksum', () => {
    for (const change of [
      (stored: NativeScenarioPinV1) => {
        stored.battlefield.map.preview[0]!.layer += 1;
      },
      (stored: NativeScenarioPinV1) => {
        stored.battlefield.pairing.resolvedScenarioId = 'another';
      },
      (stored: NativeScenarioPinV1) => {
        stored.battlefield.pairing.revision = `engine-pairing-v1:sha256:${'b'.repeat(64)}`;
      },
      (stored: NativeScenarioPinV1) => {
        stored.battlefield.map.widthM += 1;
      },
    ]) {
      const stored = pin();
      change(stored);
      expect(() => decodeNativeScenarioPin(reseal(stored))).toThrow(/pin identity/);
    }
    const stored = pin();
    expect(() =>
      decodeNativeScenarioPin({
        ...stored,
        pinIdentity: `engine-native-pin-v1:sha256:${'b'.repeat(64)}`,
      }),
    ).toThrow(/pin identity/);
  });

  it('rejects unsupported/raw unknown fields instead of allowing the loader to ignore them', () => {
    const raw = defaultBridgeV1Input() as Record<string, unknown>;
    expect(() =>
      createNativeScenarioPin({
        rawScenario: { ...raw, unsupportedLayer: [] },
        scenarioId: 'hold-the-bridge',
        pairingId: 'hold-the-bridge:default',
        name: 'Bridge',
        isDefault: true,
      }),
    ).toThrow();
    const stored = pin();
    Object.assign(stored.rawScenario.units[0]!, { ammunition: 999 });
    expect(() => decodeNativeScenarioPin(reseal(stored))).toThrow();
    expect(() => decodeNativeScenarioPin({ ...pin(), extra: true })).toThrow();
  });

  it('runs real engine placement, HQ, bridge/objective and finite-value validation', () => {
    for (const change of [
      (stored: NativeScenarioPinV1) => {
        stored.rawScenario.units[0]!.at = { x: 1000, y: 1500 };
      },
      (stored: NativeScenarioPinV1) => {
        stored.rawScenario.sides[0]!.hq = { x: 1000, y: 1500 };
      },
      (stored: NativeScenarioPinV1) => {
        stored.rawScenario.victory.objective = [
          [900, 900],
          [1000, 900],
          [1000, 1000],
        ];
      },
      (stored: NativeScenarioPinV1) => {
        stored.rawScenario.map.features[0]!.layer = Infinity;
      },
    ]) {
      const stored = pin();
      change(stored);
      expect(() => decodeNativeScenarioPin(reseal(stored))).toThrow();
    }
  });

  it('rejects unsupported pin/assembly versions, missing bodies and resource abuse', () => {
    const stored = pin();
    for (const invalid of [
      { ...stored, schemaVersion: 2 },
      { ...stored, assemblyVersion: 'engine-native-v2' },
      { ...stored, initialWorld: undefined },
      { ...stored, rawScenario: 'x'.repeat(1024 * 1024) },
    ])
      expect(() => decodeNativeScenarioPin(invalid)).toThrow();
    const raw = stored.rawScenario;
    raw.units = Array.from({ length: 129 }, () => structuredClone(raw.units[0]!));
    expect(() => decodeNativeScenarioPin(reseal(stored))).toThrow();
  });
});
