import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovedBattlefield } from '@kriegsspiel/protocol';
import { battlefieldMap, battlefieldPoints } from './battlefieldMap.js';
import { TABLE_MAP_STYLE } from '../map-authoring/map-style.js';
import { RecordedPath, recordCanvas, type PathOp } from './canvasRecorder.testing.js';
import { drawPeriodMap } from './periodMap.js';
import type { BaseFeature } from './types.js';

const parentId = 'hold-the-bridge';

/** Public descriptor fixture only; digests are syntactically valid test identities. */
function descriptor(): ApprovedBattlefield {
  const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
  return {
    map: {
      id: `${parentId}:default`,
      name: 'The bridge battlefield',
      source: 'scenario-default',
      terrainIdentity,
      widthM: 4000,
      heightM: 3000,
      preview: [
        {
          id: 'north-wood',
          kind: 'wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 600, y: 300 },
              { x: 1300, y: 350 },
              { x: 1250, y: 900 },
              { x: 650, y: 850 },
            ],
          },
        },
        {
          id: 'south-wood',
          kind: 'wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 2700, y: 1900 },
              { x: 3400, y: 1950 },
              { x: 3350, y: 2500 },
              { x: 2750, y: 2450 },
            ],
          },
        },
        {
          id: 'river',
          kind: 'river',
          layer: 3,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 0, y: 1500 },
              { x: 4000, y: 1500 },
            ],
            widthM: 200,
          },
        },
        {
          id: 'high-road',
          kind: 'road',
          layer: 2,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 2050, y: 0 },
              { x: 2050, y: 3000 },
            ],
            widthM: 20,
          },
        },
        {
          id: 'bridge',
          kind: 'bridge',
          layer: 4,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
      ],
    },
    pairing: {
      id: `${parentId}:default`,
      revision: `engine-pairing-v1:sha256:${'b'.repeat(64)}`,
      scenarioId: parentId,
      resolvedScenarioId: parentId,
      scenarioRevision: `engine-scenario-v1:sha256:${'c'.repeat(64)}`,
      terrainIdentity,
      assemblyVersion: 'engine-native-v1',
    },
    isDefault: true,
  };
}

describe('public battlefield render adapter', () => {
  it('preserves all actual asymmetric geography in NW metres and returns final flat-board paint order', () => {
    const map = battlefieldMap(descriptor(), parentId);
    expect([map.width, map.height]).toEqual([4000, 3000]);
    expect(map.features.map((f) => f.id)).toEqual([
      'south-wood',
      'north-wood',
      'high-road',
      'river',
      'bridge',
    ]);
    expect(map.features.map((f) => f.layer)).toEqual([1, 1, 2, 3, 4]);
    expect(map.features.find((f) => f.id === 'north-wood')?.geometry).toEqual({
      shape: 'polygon',
      points: [
        { x: 600, y: 300 },
        { x: 1300, y: 350 },
        { x: 1250, y: 900 },
        { x: 650, y: 850 },
      ],
    });
    expect(map.features.find((f) => f.id === 'south-wood')?.geometry).toEqual({
      shape: 'polygon',
      points: [
        { x: 2700, y: 1900 },
        { x: 3400, y: 1950 },
        { x: 3350, y: 2500 },
        { x: 2750, y: 2450 },
      ],
    });
    expect(map.features.find((f) => f.id === 'river')?.geometry).toEqual({
      shape: 'polyline',
      points: [
        { x: 0, y: 1500 },
        { x: 4000, y: 1500 },
      ],
      width: 200,
    });
    expect(map.features.find((f) => f.id === 'high-road')?.geometry).toEqual({
      shape: 'polyline',
      points: [
        { x: 2050, y: 0 },
        { x: 2050, y: 3000 },
      ],
      width: 20,
    });
    expect(map.features.find((f) => f.id === 'bridge')?.geometry).toEqual({
      shape: 'point',
      at: { x: 2050, y: 1500 },
      radius: 110,
    });
    expect(Object.keys(map).sort()).toEqual(['features', 'height', 'width']);
    for (const feature of map.features)
      expect(Object.keys(feature).sort()).toEqual(['geometry', 'id', 'kind', 'layer']);
  });

  it('requires the independent parent scenario binding even for an internally coherent descriptor', () => {
    const input = descriptor();
    expect(() => battlefieldMap(input, 'another-scenario')).toThrow(/Foreign scenario/);
    input.pairing.resolvedScenarioId = 'hold-the-bridge-open-v1';
    // A resolved assembly ID need not equal the public parent scenario ID.
    expect(() => battlefieldMap(input, parentId)).not.toThrow();
  });

  it.each([
    ['missing descriptor', () => undefined],
    [
      'old pairing revision',
      () => {
        const d = descriptor();
        d.pairing.revision = d.pairing.scenarioRevision;
        return d;
      },
    ],
    ['private world fields', () => ({ ...descriptor(), initialWorld: { units: [] } })],
    [
      'identity mismatch',
      () => {
        const d = descriptor();
        d.pairing.terrainIdentity = `engine-terrain-v1:sha256:${'d'.repeat(64)}`;
        return d;
      },
    ],
    [
      'off-grid geometry',
      () => {
        const d = descriptor();
        d.map.preview[0]!.geometry = { shape: 'point', at: { x: 0.0001, y: 0 }, radiusM: 1 };
        return d;
      },
    ],
    [
      'missing native layer',
      () => {
        const d = descriptor();
        const f = d.map.preview[0]!;
        return {
          ...d,
          map: { ...d.map, preview: [{ id: f.id, kind: f.kind, geometry: f.geometry }] },
        };
      },
    ],
  ])('rejects %s rather than inventing renderable terrain', (_label, invalid) => {
    expect(() => battlefieldMap(invalid(), parentId)).toThrow();
  });

  it('uses the bounded decoder wrapper without invoking transport accessors', () => {
    const input = descriptor();
    let reads = 0;
    Object.defineProperty(input, 'map', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('Accessor was invoked');
      },
    });
    expect(() => battlefieldMap(input, parentId)).toThrow(/JSON values/);
    expect(reads).toBe(0);
  });

  it('detaches the extent, features and every shape in both directions', () => {
    const input = descriptor();
    const before = structuredClone(input);
    const map = battlefieldMap(input, parentId);
    expect(input).toEqual(before);
    const renderedBefore = structuredClone(map);
    input.map.widthM = 9000;
    for (const f of input.map.preview) {
      if (f.geometry.shape === 'point') {
        f.geometry.at.x = 99;
        f.geometry.radiusM = 2;
      } else {
        f.geometry.points[0]!.y = 17;
        if (f.geometry.shape === 'polyline') f.geometry.widthM = 3;
      }
    }
    expect(map).toEqual(renderedBefore);
    const inputAfter = structuredClone(input);
    map.height = 8000;
    for (const f of map.features) {
      if (f.geometry.shape === 'point') {
        f.geometry.at.y = 1;
        f.geometry.radius = 4;
      } else {
        f.geometry.points[0]!.x = 19;
        if (f.geometry.shape === 'polyline') f.geometry.width = 5;
      }
    }
    map.features.pop();
    expect(input).toEqual(inputAfter);
  });

  it('keeps exact integer-mm coordinates in the SVG string rather than rounding to tenths', () => {
    const points = Object.freeze([
      { x: 0.001, y: 1.001 },
      { x: 2050.123, y: 1500.001 },
      { x: 4000, y: 3000 },
    ]);
    expect(battlefieldPoints(points)).toBe('0.001,1.001 2050.123,1500.001 4000,3000');
    expect(battlefieldPoints([])).toBe('');
    const input = descriptor();
    input.map.preview = [
      {
        id: 'survey',
        kind: 'road',
        layer: 0,
        geometry: { shape: 'polyline', points: [...points], widthM: 0.001 },
      },
    ];
    const geometry = battlefieldMap(input, parentId).features[0]!.geometry;
    expect(geometry).toEqual({ shape: 'polyline', points: [...points], width: 0.001 });
    if (geometry.shape !== 'polyline') throw new Error('Expected line geometry');
    expect(battlefieldPoints(geometry.points)).toBe('0.001,1.001 2050.123,1500.001 4000,3000');
  });

  it('depends on public protocol and render modules, with no private/world imports', () => {
    for (const name of ['battlefieldMap.ts', 'paintOrder.ts']) {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      const dependencies = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      expect(
        dependencies
          .filter((path) => !path.startsWith('.'))
          .every((path) => path === '@kriegsspiel/protocol'),
      ).toBe(true);
      expect(dependencies.some((path) => /engine|server|private|master/i.test(path))).toBe(false);
      expect(source).not.toMatch(
        /\b(?:GameState|MasterState|InitialWorld|ApprovedBattlefieldSchema)\b/,
      );
    }
  });
});

describe('native geometry through the period paper (#498)', () => {
  // The table paper is drawn by `drawPeriodMap` (D43); these replace the flat `drawMap` checks of #467
  // with the same guarantees: paint order, exact native widths and radii, and legacy legibility floors.
  const regular = TABLE_MAP_STYLE.palette.regular;
  beforeEach(() => {
    vi.stubGlobal('Path2D', RecordedPath);
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => recordCanvas().ctx }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const extent = (path: readonly PathOp[]) => {
    const pts = path.filter((op): op is ['M' | 'L', number, number] => op.length === 3);
    const xs = pts.map((op) => op[1]);
    const ys = pts.map((op) => op[2]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  it.each([
    [-7, 12],
    [5, 5],
  ])(
    'paints explicit layer/ID order through the period paper for bridge=%s and wood=%s',
    (bridgeLayer, woodLayer) => {
      const input = descriptor();
      input.map.preview = [
        {
          id: 'a',
          kind: 'wood',
          layer: woodLayer,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 600, y: 300 },
              { x: 1300, y: 350 },
              { x: 1250, y: 900 },
            ],
          },
        },
        {
          id: 'z',
          kind: 'bridge',
          layer: bridgeLayer,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
      ];
      const map = battlefieldMap(input, parentId);
      expect(map.features.map((f) => f.id)).toEqual(['z', 'a']);
      const r = recordCanvas();
      drawPeriodMap(r.ctx, map, 1, false);
      const bridge = r.paints.findIndex((p) => p.op === 'fill' && p.style === regular.bridge);
      const wood = r.paints.findIndex((p) => p.op === 'fill' && p.style === regular.wood);
      expect(bridge).toBeGreaterThanOrEqual(0);
      // The wood paints over the bridge although the renderer would put crossings over cover.
      expect(bridge).toBeLessThan(wood);
      expect(extent(r.paints[wood]!.path)).toEqual([600, 300, 1300, 900]);
      expect(extent(r.paints[bridge]!.path)).toEqual([1995, 1390, 2105, 1610]);
    },
  );

  it('uses full scaled native widths and radii below the legibility floors without flipping coordinates', () => {
    const map = battlefieldMap(descriptor(), parentId);
    const r = recordCanvas();
    // 0.01 px/m: the style's 4.2 px road floor would be 420 m wide.
    drawPeriodMap(r.ctx, map, 0.01, false);
    expect(r.calls).toContain('scale');
    const casing = r.painted('stroke', regular.roadCasing.regional)[0]!;
    expect(casing.width).toBe(20);
    expect(casing.path).toEqual([
      ['M', 2050, 0],
      ['L', 2050, 3000],
    ]);
    const water = r.painted('fill', regular.water)[0]!;
    expect(extent(water.path)).toEqual([0, 1400, 4000, 1600]);
    // No centreline floor for a native river.
    expect(r.painted('stroke', regular.waterLine).every((p) => p.width !== 1.6 / 0.01)).toBe(true);
    // The bridge spans its 110 m radius each way, as wide as the 20 m road it carries.
    const deck = r.painted('fill', regular.bridge)[0]!;
    expect(extent(deck.path)).toEqual([2040, 1390, 2060, 1610]);
  });

  it('does not treat explicit layer zero or 0.001 metre native dimensions as legacy', () => {
    const input = descriptor();
    input.map.preview = [
      {
        id: 'tiny-line',
        kind: 'road',
        layer: 0,
        geometry: {
          shape: 'polyline',
          points: [
            { x: 0.001, y: 1.001 },
            { x: 1.001, y: 2.001 },
          ],
          widthM: 0.001,
        },
      },
      {
        id: 'tiny-point',
        kind: 'ford',
        layer: 1,
        geometry: { shape: 'point', at: { x: 1.001, y: 0.001 }, radiusM: 0.001 },
      },
    ];
    const r = recordCanvas();
    drawPeriodMap(r.ctx, battlefieldMap(input, parentId), 0.5, false);
    const line = r.painted('stroke', regular.roadCasing.track)[0]!;
    expect(line.width).toBe(0.001);
    expect(line.path).toEqual([
      ['M', 0.001, 1.001],
      ['L', 1.001, 2.001],
    ]);
    const ford = r.painted('fill', regular.ford)[0]!;
    expect(extent(ford.path).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
      1.0005, 0, 1.0015, 0.002,
    ]);
  });

  it('keeps the legibility floors for legacy features with no layer', () => {
    const native = battlefieldMap(descriptor(), parentId);
    const features: BaseFeature[] = native.features.map((f) => ({
      id: f.id,
      kind: f.kind,
      geometry: f.geometry,
    }));
    const r = recordCanvas();
    drawPeriodMap(r.ctx, { ...native, features }, 0.01, false);
    const casing = r.painted('stroke', regular.roadCasing.regional)[0]!;
    expect(casing.width).toBeCloseTo(TABLE_MAP_STYLE.roads.stroke.regional.minWidthPx / 0.01);
  });
});
