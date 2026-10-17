import { describe, expect, it, vi } from 'vitest';
import {
  ApprovedBattlefieldSchema,
  BATTLEFIELD_LIMITS,
  NativeBattlefieldMapSchema,
  assertBattlefieldBudget,
  decodeApprovedBattlefield,
  decodeBattlefieldCatalog,
  type ApprovedBattlefield,
} from './battlefield-catalog.js';

const digest = 'a'.repeat(64);
function entry(): ApprovedBattlefield {
  return {
    map: {
      id: 'bridge:default',
      name: 'The bridge battlefield',
      source: 'scenario-default',
      terrainIdentity: `engine-terrain-v1:sha256:${digest}`,
      widthM: 4000,
      heightM: 3000,
      preview: [
        {
          id: 'bridge',
          kind: 'bridge',
          layer: 30,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
      ],
    },
    pairing: {
      id: 'bridge:default',
      revision: `engine-pairing-v1:sha256:${digest}`,
      scenarioId: 'bridge',
      resolvedScenarioId: 'bridge',
      scenarioRevision: `engine-scenario-v1:sha256:${digest}`,
      terrainIdentity: `engine-terrain-v1:sha256:${digest}`,
      assemblyVersion: 'engine-native-v1',
    },
    isDefault: true,
  };
}
const catalog = () => ({ schemaVersion: 1, scenarioId: 'bridge', entries: [entry()] });

describe('native public battlefield transport', () => {
  it('returns detached, unchanged data while retaining asymmetric metre coordinates', () => {
    const input = entry();
    input.map.name = ' The bridge battlefield ';
    const decoded = decodeApprovedBattlefield(input, 'bridge');
    expect(decoded).toEqual(input);
    expect(decoded).not.toBe(input);
    decoded.map.preview.length = 0;
    expect(input.map.preview).toHaveLength(1);
  });

  it('binds entries and collection to the independent parent scenario ID', () => {
    expect(() => decodeApprovedBattlefield(entry(), 'other')).toThrow(/Foreign scenario/);
    expect(() => decodeBattlefieldCatalog(catalog(), 'other')).toThrow(/Foreign scenario/);
    const data = catalog();
    data.entries[0]!.pairing.scenarioId = 'other';
    expect(() => decodeBattlefieldCatalog(data, 'bridge')).toThrow(/Foreign scenario/);
  });

  it('rejects private/unsupported fields rather than silently discarding them', () => {
    expect(() => decodeApprovedBattlefield({ ...entry(), initialWorld: {} }, 'bridge')).toThrow();
    const input = entry();
    Object.assign(input.map.preview[0]!, { attrs: { cover: 1 } });
    expect(() => decodeApprovedBattlefield(input, 'bridge')).toThrow();
  });

  it('distinguishes modern pairing revision from the legacy scenario revision', () => {
    const input = entry();
    input.pairing.revision = input.pairing.scenarioRevision;
    expect(() => decodeApprovedBattlefield(input, 'bridge')).toThrow();
  });

  it('rejects mismatched map identity, logical ID and default designation', () => {
    for (const mutate of [
      (input: ApprovedBattlefield) => {
        input.pairing.terrainIdentity = `engine-terrain-v1:sha256:${'b'.repeat(64)}`;
      },
      (input: ApprovedBattlefield) => {
        input.map.id = 'another';
      },
      (input: ApprovedBattlefield) => {
        input.isDefault = false;
      },
    ]) {
      const input = entry();
      mutate(input);
      expect(ApprovedBattlefieldSchema.safeParse(input).success).toBe(false);
    }
  });

  it.each([NaN, Infinity, -1, 4000.001, 1.0001])(
    'rejects invalid/outside/non-mm coordinate %s',
    (x) => {
      const input = entry();
      input.map.preview[0]!.geometry = { shape: 'point', at: { x, y: 1500 }, radiusM: 110 };
      expect(() => decodeApprovedBattlefield(input, 'bridge')).toThrow();
    },
  );

  it('accepts millimetre values despite binary floating point representation', () => {
    const input = entry();
    input.map.preview[0]!.geometry = {
      shape: 'point',
      at: { x: 1.001, y: 1500.123 },
      radiusM: 0.001,
    };
    expect(decodeApprovedBattlefield(input, 'bridge')).toEqual(input);
  });

  it('bounds extents, widths/radii, text and layers', () => {
    for (const mutate of [
      (input: ApprovedBattlefield) => {
        input.map.widthM = 20_001;
      },
      (input: ApprovedBattlefield) => {
        input.map.name = 'n'.repeat(161);
      },
      (input: ApprovedBattlefield) => {
        input.map.preview[0]!.layer = 1025;
      },
      (input: ApprovedBattlefield) => {
        input.map.preview[0]!.geometry = { shape: 'point', at: { x: 1, y: 1 }, radiusM: 4001 };
      },
    ]) {
      const input = entry();
      mutate(input);
      expect(() => decodeApprovedBattlefield(input, 'bridge')).toThrow();
    }
  });

  it('bounds duplicate/features, per-geometry and aggregate point entries', () => {
    const map = entry().map;
    map.preview.push(structuredClone(map.preview[0]!));
    expect(NativeBattlefieldMapSchema.safeParse(map).success).toBe(false);
    map.preview = Array.from({ length: 129 }, (_, index) => ({
      ...structuredClone(map.preview[0]!),
      id: `p-${index}`,
    }));
    expect(NativeBattlefieldMapSchema.safeParse(map).success).toBe(false);
    map.preview = Array.from({ length: 5 }, (_, index) => ({
      id: `line-${index}`,
      kind: 'road',
      layer: 0,
      geometry: {
        shape: 'polyline',
        widthM: 20,
        points: Array.from({ length: 1024 }, (_, i) => ({ x: i, y: index })),
      },
    }));
    expect(NativeBattlefieldMapSchema.safeParse(map).success).toBe(false);
    map.preview = [map.preview[0]!];
    expect(NativeBattlefieldMapSchema.safeParse(map).success).toBe(true);
    if (map.preview[0]!.geometry.shape === 'polyline')
      map.preview[0]!.geometry.points.push({ x: 1024, y: 0 });
    expect(NativeBattlefieldMapSchema.safeParse(map).success).toBe(false);
  });

  it('requires exactly one default, unique pairing IDs and bounded collection size', () => {
    for (const entries of [[], [entry(), entry()], Array.from({ length: 17 }, entry)]) {
      expect(() => decodeBattlefieldCatalog({ ...catalog(), entries }, 'bridge')).toThrow();
    }
    const data = catalog();
    data.entries[0]!.isDefault = false;
    data.entries[0]!.map.source = 'included';
    expect(() => decodeBattlefieldCatalog(data, 'bridge')).toThrow(/default/);
    expect(decodeBattlefieldCatalog(catalog(), 'bridge').entries).toHaveLength(1);
  });

  it('rejects unsupported kinds/shapes without producing partial geography', () => {
    const data = entry();
    Object.assign(data.map.preview[0]!, { kind: 'mountain' });
    expect(() => decodeApprovedBattlefield(data, 'bridge')).toThrow();
    Object.assign(data.map.preview[0]!, { kind: 'bridge', geometry: { shape: 'circle' } });
    expect(() => decodeApprovedBattlefield(data, 'bridge')).toThrow();
  });
});

describe('preflight before recursive work', () => {
  it('counts UTF-8 bytes, JSON punctuation, cyclic and non-JSON data', () => {
    expect(() => assertBattlefieldBudget('é', 3)).toThrow(/byte/);
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [cycle, { value: undefined }, { value: 1n }, { value: Infinity }])
      expect(() => assertBattlefieldBudget(value, 1024)).toThrow();
    expect(() => assertBattlefieldBudget({ good: [1, null, true, 'é'] }, 1024)).not.toThrow();
  });

  it('rejects excessive depth and node count before invoking schemas/digests', () => {
    let data: unknown = 0;
    for (let depth = 0; depth < 33; depth++) data = [data];
    expect(() => assertBattlefieldBudget(data, BATTLEFIELD_LIMITS.pinBytes)).toThrow(/structural/);
    expect(() =>
      assertBattlefieldBudget(Array(65_536).fill(null), BATTLEFIELD_LIMITS.pinBytes),
    ).toThrow(/structural/);
  });

  it('enforces individual and aggregate wire byte limits', () => {
    const dense = entry();
    dense.map.preview = Array.from({ length: 128 }, (_, i) => ({
      id: `feature-${i}`,
      name: '界'.repeat(160),
      kind: 'bridge',
      layer: 1,
      geometry: { shape: 'point', at: { x: i, y: 1500 }, radiusM: 110 },
    }));
    expect(ApprovedBattlefieldSchema.safeParse(dense).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(dense)).byteLength).toBeGreaterThan(
      BATTLEFIELD_LIMITS.descriptorBytes,
    );
    expect(() => decodeApprovedBattlefield(dense, 'bridge')).toThrow(/byte/);
    const entries = Array.from({ length: 16 }, (_, i) => {
      const value = entry();
      value.isDefault = i === 0;
      value.map.source = i === 0 ? 'scenario-default' : 'included';
      value.map.id = value.pairing.id = `bridge:choice-${i}`;
      value.map.preview = Array.from({ length: 100 }, (_, j) => ({
        id: `p-${j}`,
        name: 'a'.repeat(160),
        kind: 'bridge',
        layer: 1,
        geometry: { shape: 'point', at: { x: j, y: 1500 }, radiusM: 110 },
      }));
      expect(() => decodeApprovedBattlefield(value, 'bridge')).not.toThrow();
      return value;
    });
    expect(() => decodeBattlefieldCatalog({ ...catalog(), entries }, 'bridge')).toThrow(/byte/);
  });
});

describe('resource and exact-millimetre review regressions', () => {
  it.each([1e-10, Number.MIN_VALUE, 0.001 + Number.EPSILON, 1.001000000000001])(
    'rejects non-mm coordinate/radius/width %s without changing it',
    (value) => {
      for (const geometry of [
        { shape: 'point', at: { x: value, y: 1500 }, radiusM: 110 },
        { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: value },
        {
          shape: 'polyline',
          points: [
            { x: 2050, y: 0 },
            { x: 2050, y: 3000 },
          ],
          widthM: value,
        },
      ])
        expect(() =>
          decodeApprovedBattlefield(
            {
              ...entry(),
              map: {
                ...entry().map,
                preview: [{ id: 'bridge', kind: 'bridge', layer: 4, geometry }],
              },
            },
            'bridge',
          ),
        ).toThrow();
    },
  );

  it('accepts exact zero coordinates and positive one-millimetre geometry unchanged', () => {
    const input = entry();
    input.map.preview[0]!.geometry = { shape: 'point', at: { x: 0, y: 0.001 }, radiusM: 0.001 };
    expect(decodeApprovedBattlefield(input, 'bridge')).toEqual(input);
  });

  it('rejects cumulative strings and oversized keys before full serialization or encoding', () => {
    const inputs = [Array(32).fill('x'.repeat(60_000)), { ['x'.repeat(70_000)]: null }];
    for (const value of inputs) {
      const stringify = vi.spyOn(JSON, 'stringify');
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      let rejected = false;
      try {
        assertBattlefieldBudget(value, 65_536);
      } catch {
        rejected = true;
      }
      const calls = [stringify.mock.calls.length, encode.mock.calls.length];
      stringify.mockRestore();
      encode.mockRestore();
      expect(rejected).toBe(true);
      expect(calls).toEqual([0, 0]);
    }
  });

  it('rejects a wide object without allocating an Object.values staging array', () => {
    const value = Object.fromEntries(Array.from({ length: 65_536 }, (_, i) => [`k${i}`, null]));
    const values = vi.spyOn(Object, 'values');
    let rejected = false;
    try {
      assertBattlefieldBudget(value, 1024 * 1024);
    } catch {
      rejected = true;
    }
    const calls = values.mock.calls.length;
    values.mockRestore();
    expect(rejected).toBe(true);
    expect(calls).toBe(0);
  });

  it('counts exact JSON bytes at Unicode, escape, numeric and punctuation boundaries', () => {
    for (const value of [
      null,
      true,
      false,
      0,
      -0,
      1e-7,
      [],
      {},
      '\\"\n\b\u0000é界😀\ud800',
      { 'key"\n': ['a', '😀', 0.001] },
    ]) {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      expect(() => assertBattlefieldBudget(value, bytes)).not.toThrow();
      expect(() => assertBattlefieldBudget(value, bytes - 1)).toThrow(/byte/);
    }
  });
});
