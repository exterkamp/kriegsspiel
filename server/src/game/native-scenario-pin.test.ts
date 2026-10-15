import { createHash } from 'node:crypto';
import { holdTheBridge, loadScenario, ScenarioError } from '@kriegsspiel/engine';
import * as engine from '@kriegsspiel/engine';
import { describe, expect, it, vi } from 'vitest';
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

type RawNativeScenario = NativeScenarioPinV1['rawScenario'];

function createFromRaw(rawScenario: unknown): NativeScenarioPinV1 {
  return createNativeScenarioPin({
    rawScenario,
    scenarioId: 'hold-the-bridge',
    pairingId: 'hold-the-bridge:default',
    name: 'The bridge battlefield',
    isDefault: true,
  });
}

/** Schema-admissible terrain for testing aggregate work gates, not playable content. */
function denseTerrain(count: number): RawNativeScenario['map']['features'] {
  return Array.from({ length: count }, (_, feature) => ({
    id: `budget-field-${feature}`,
    kind: 'field' as const,
    polygon: Array.from({ length: 1024 }, (_, point): [number, number] => [point, 100 + feature]),
  }));
}

describe('native pin creator validation gates (R7-N2)', () => {
  const cases: Array<{
    name: string;
    change: (raw: RawNativeScenario) => void;
    message: string;
  }> = [
    {
      name: 'impassable unit placement',
      change: (raw) => {
        raw.units[0]!.at = { x: 1000, y: 1500 };
      },
      message: 'units[0] has a position on impassable ground',
    },
    {
      name: 'impassable HQ',
      change: (raw) => {
        raw.sides[0]!.hq = { x: 1000, y: 1500 };
      },
      message: 'sides[0].hq must be on passable ground',
    },
    {
      name: 'objective away from a bridge',
      change: (raw) => {
        raw.victory.objective = [
          [900, 900],
          [1000, 900],
          [1000, 1000],
        ];
      },
      message: 'victory.objective must be centred on a bridge',
    },
  ];

  it.each(cases)(
    'rejects $name with the actual engine ScenarioError at creation',
    ({ change, message }) => {
      const raw = defaultBridgeV1Input() as RawNativeScenario;
      change(raw);
      let failure: unknown;
      try {
        createFromRaw(raw);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ScenarioError);
      expect(failure).toHaveProperty('message', `Invalid scenario: ${message}`);
    },
  );

  it('rejects aggregate terrain above 4096 points before calling the engine loader', () => {
    const raw = defaultBridgeV1Input() as RawNativeScenario;
    raw.map.features = denseTerrain(5);
    const counts = raw.map.features.map((feature) =>
      'polygon' in feature ? feature.polygon.length : 0,
    );
    expect(counts).toEqual([1024, 1024, 1024, 1024, 1024]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5120);
    // A sentinel prevents accidental expensive loading if the preflight regresses.
    const loader = vi.spyOn(engine, 'loadScenario').mockImplementation(() => {
      throw new Error('Engine loader must not run for over-budget native input');
    });
    try {
      expect(() => createFromRaw(raw)).toThrowError(
        new Error('Native terrain exceeds point budget'),
      );
      expect(loader).not.toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });

  it('rejects over two million estimated placement checks at 4096 terrain points before loading', () => {
    const raw = defaultBridgeV1Input() as RawNativeScenario;
    raw.map.features = denseTerrain(4);
    const template = raw.units[0]!;
    raw.units = Array.from({ length: 64 }, (_, index) => ({
      ...structuredClone(template),
      id: `budget-unit-${index}`,
      name: `Budget unit ${index}`,
      side: index % 2 === 0 ? ('blue' as const) : ('red' as const),
      at: { x: 100 + (index % 8) * 400, y: 100 + Math.floor(index / 8) * 350 },
      shape: Array.from({ length: 8 }, (_, point): [number, number] => [point, 0]),
    }));
    const points = raw.map.features.reduce(
      (sum, feature) => sum + ('polygon' in feature ? feature.polygon.length : 0),
      0,
    );
    expect(points).toBe(4096);
    expect(raw.units).toHaveLength(64);
    expect(raw.units.map((unit) => unit.shape!.length)).toEqual(Array(64).fill(8));
    expect(raw.sides.map((side) => side.depots?.length ?? 0)).toEqual([0, 0]);
    // Eight shape samples plus four corners per unit, and the two HQ samples.
    const estimatedChecks = (64 * (8 + 4) + 2) * points;
    expect(estimatedChecks).toBe(3_153_920);
    expect(estimatedChecks).toBeGreaterThan(2_000_000);
    const loader = vi.spyOn(engine, 'loadScenario').mockImplementation(() => {
      throw new Error('Engine loader must not run for over-budget native input');
    });
    try {
      expect(() => createFromRaw(raw)).toThrowError(
        new Error('Native scenario exceeds placement work budget'),
      );
      expect(loader).not.toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });
});
