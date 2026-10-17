import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApprovedBattlefield } from '@kriegsspiel/protocol';
import { battlefieldMap, battlefieldPoints } from './battlefieldMap.js';
import { drawMap, FEATURE_COLOURS } from './mapTexture.js';
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

type Command =
  ['move' | 'line', number, number] | ['arc', number, number, number, number, number] | ['close'];
type Paint = {
  op: 'fill' | 'stroke';
  colour: CanvasRenderingContext2D['fillStyle'];
  width: number;
  cap: CanvasLineCap;
  path: Command[];
};

/** Record the actual drawMap API calls, including widths at stroke time. */
function recording() {
  const paints: Paint[] = [];
  const backgrounds: number[][] = [];
  let path: Command[] = [];
  const context: Pick<
    CanvasRenderingContext2D,
    | 'fillStyle'
    | 'strokeStyle'
    | 'lineWidth'
    | 'lineCap'
    | 'lineJoin'
    | 'fillRect'
    | 'beginPath'
    | 'moveTo'
    | 'lineTo'
    | 'closePath'
    | 'stroke'
    | 'fill'
    | 'arc'
  > = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    fillRect(x, y, width, height) {
      backgrounds.push([x, y, width, height]);
    },
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push(['move', x, y]);
    },
    lineTo(x, y) {
      path.push(['line', x, y]);
    },
    closePath() {
      path.push(['close']);
    },
    arc(x, y, radius, start, end) {
      path.push(['arc', x, y, radius, start, end]);
    },
    stroke() {
      paints.push({
        op: 'stroke',
        colour: context.strokeStyle,
        width: context.lineWidth,
        cap: context.lineCap,
        path: [...path],
      });
    },
    fill() {
      paints.push({
        op: 'fill',
        colour: context.fillStyle,
        width: context.lineWidth,
        cap: context.lineCap,
        path: [...path],
      });
    },
  };
  return { context: context as CanvasRenderingContext2D, paints, backgrounds };
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

describe('native geometry through actual canvas drawing', () => {
  it.each([
    [-7, 12],
    [5, 5],
  ])(
    'paints explicit layer/ID order through drawMap for bridge=%s and wood=%s',
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
      const trace = recording();
      drawMap(trace.context, map, 1);
      expect(trace.paints.filter((p) => p.op === 'fill').map((p) => p.path[0])).toEqual([
        ['arc', 2050, 1500, 110, 0, Math.PI * 2],
        ['move', 600, 300],
      ]);
      expect(trace.paints.filter((p) => p.op === 'fill').map((p) => p.colour)).toEqual([
        FEATURE_COLOURS.bridge,
        FEATURE_COLOURS.wood,
      ]);
    },
  );

  it('uses full scaled native widths and radii below two pixels without flipping coordinates', () => {
    const map = battlefieldMap(descriptor(), parentId);
    const trace = recording();
    drawMap(trace.context, map, 0.01);
    expect(trace.backgrounds).toEqual([[0, 0, 40, 30]]);
    const road = trace.paints.find((p) => p.op === 'stroke' && p.colour === FEATURE_COLOURS.road)!;
    expect(road.path).toEqual([
      ['move', 20.5, 0],
      ['line', 20.5, 30],
    ]);
    expect(road.width).toBe(0.2);
    expect(road.cap).toBe('round');
    const river = trace.paints.find(
      (p) => p.op === 'stroke' && p.colour === FEATURE_COLOURS.river,
    )!;
    expect(river.path).toEqual([
      ['move', 0, 15],
      ['line', 40, 15],
    ]);
    expect(river.width).toBe(2);
    const bridge = trace.paints.find(
      (p) => p.op === 'fill' && p.colour === FEATURE_COLOURS.bridge,
    )!;
    expect(bridge.path).toEqual([['arc', 20.5, 15, 1.1, 0, Math.PI * 2]]);
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
    const trace = recording();
    drawMap(trace.context, battlefieldMap(input, parentId), 0.5);
    const line = trace.paints.find((p) => p.op === 'stroke' && p.colour === FEATURE_COLOURS.road)!;
    expect(line.width).toBe(0.0005);
    expect(line.path).toEqual([
      ['move', 0.0005, 0.5005],
      ['line', 0.5005, 1.0005],
    ]);
    expect(trace.paints.find((p) => p.op === 'fill')?.path).toEqual([
      ['arc', 0.5005, 0.0005, 0.0005, 0, Math.PI * 2],
    ]);
  });

  it('retains the legacy visibility clamp, line caps and existing colours/outlines when layer is absent', () => {
    const native = battlefieldMap(descriptor(), parentId);
    const features: BaseFeature[] = native.features.map((f) => ({
      id: f.id,
      kind: f.kind,
      geometry: f.geometry,
    }));
    const trace = recording();
    drawMap(trace.context, { ...native, features }, 0.01);
    const road = trace.paints.find((p) => p.op === 'stroke' && p.colour === FEATURE_COLOURS.road)!;
    expect(road.width).toBe(2);
    expect(road.cap).toBe('butt');
    expect(
      trace.paints.find((p) => p.op === 'fill' && p.colour === FEATURE_COLOURS.bridge)?.path,
    ).toEqual([['arc', 20.5, 15, 2, 0, Math.PI * 2]]);
    expect(
      trace.paints
        .filter((p) => p.op === 'stroke' && p.colour === 'rgba(60,45,20,0.45)')
        .map((p) => p.width),
    ).toEqual([1.5, 1.5]);
    expect(
      trace.paints.find((p) => p.op === 'stroke' && p.colour === 'rgba(60,45,20,0.6)')?.width,
    ).toBe(1.5);
  });
});
