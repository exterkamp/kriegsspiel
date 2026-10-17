// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_MAP_STYLE } from '../map-authoring/map-style.js';
import { RecordedPath, recordCanvas } from './canvasRecorder.testing.js';
import { fixtureMap } from './fixture.js';
import { MAX_TEXTURE_PX, mapCanvas } from './mapTexture.js';
import { paintOrder } from './paintOrder.js';
import {
  drawPeriodMap,
  passStyle,
  periodAsset,
  periodPasses,
  roadClass,
  tableHighContrast,
} from './periodMap.js';
import type { BaseFeature, BaseMap, FeatureKind } from './types.js';

const regular = TABLE_MAP_STYLE.palette.regular;
const contrast = TABLE_MAP_STYLE.palette.contrast;
/** The flat painter's colours before #498 (`FEATURE_COLOURS`); none may survive in the period paper. */
const FLAT = [
  '#d8cfa6',
  '#cfc58f',
  '#5f7a4a',
  '#8a9a6a',
  '#6f9bb5',
  '#7fa8c0',
  '#b99f73',
  '#8a6a43',
];

let helpers: ReturnType<typeof recordCanvas>[];
beforeEach(() => {
  helpers = [];
  vi.stubGlobal('Path2D', RecordedPath);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((...args: unknown[]) => {
    const r = recordCanvas();
    helpers.push(r);
    (r.ctx as unknown as { args: unknown[] }).args = args;
    return r.ctx;
  }) as unknown as HTMLCanvasElement['getContext']);
});
afterEach(() => {
  document.documentElement.removeAttribute('data-contrast');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const point = (id: string, kind: FeatureKind, layer?: number, x = 50, y = 50): BaseFeature => ({
  id,
  kind,
  ...(layer === undefined ? {} : { layer }),
  geometry: { shape: 'point', at: { x, y }, radius: 10 },
});
const ids = (features: readonly BaseFeature[]) => features.map((f) => f.id);

describe('passes keep the paint order (#467)', () => {
  it('draws Hold the Bridge in two passes: woods and road, then the river over the road and the bridge', () => {
    expect(periodPasses(fixtureMap).map((p) => [p.painter, p.exact, ids(p.features)])).toEqual([
      ['renderer', false, ['north-wood', 'south-wood', 'high-road']],
      ['renderer', false, ['river', 'bridge']],
    ]);
  });

  it('keeps every feature once, in paintOrder, and splits wherever the renderer would reorder', () => {
    const features = [
      point('wood-high', 'wood', 12),
      point('bridge-low', 'bridge', -7),
      point('road', 'road', 0),
      point('river', 'river', -8),
      point('field', 'field', 3),
      point('house', 'building', 3),
      point('marsh', 'marsh', 4),
      point('ford', 'ford', 4),
    ];
    const map: BaseMap = { width: 100, height: 100, features };
    const passes = periodPasses(map);
    expect(passes.flatMap((p) => ids(p.features))).toEqual(ids(paintOrder(features)));
    expect(passes.map((p) => [p.painter, ids(p.features)])).toEqual([
      // River (water) then bridge (crossing): one pass, as the renderer paints them.
      ['renderer', ['river', 'bridge-low']],
      // The road would go under the bridge, so it starts a pass; a house may follow it.
      ['renderer', ['road', 'house']],
      // Equal layer 3: the smaller ID paints last, so the field goes over the house.
      ['renderer', ['field']],
      ['marsh', ['marsh']],
      ['renderer', ['ford']],
      // A wood would go under a crossing in one pass, so it is a pass of its own.
      ['renderer', ['wood-high']],
    ]);
    expect(passes.every((p) => p.exact)).toBe(true);
  });

  it('keeps native and legacy features apart, so each keeps its own width rules', () => {
    const passes = periodPasses({
      width: 100,
      height: 100,
      features: [point('legacy', 'wood'), point('native', 'wood', 1)],
    });
    expect(passes.map((p) => [p.exact, ids(p.features)])).toEqual([
      [false, ['legacy']],
      [true, ['native']],
    ]);
  });
});

describe('BaseMap to renderer layers', () => {
  const asset = periodAsset(fixtureMap, fixtureMap.features, fixtureMap.features);
  const l = asset.layers;

  it('keeps every coordinate in metres and the whole extent', () => {
    expect(asset.bounds).toEqual({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 });
    expect(l.cover.map((c) => [c.id, c.kind, c.polygons[0]!.outer])).toEqual([
      [
        'north-wood',
        'wood',
        [
          [600, 300],
          [1300, 350],
          [1250, 900],
          [650, 850],
          [600, 300],
        ],
      ],
      [
        'south-wood',
        'wood',
        [
          [2700, 1900],
          [3400, 1950],
          [3350, 2500],
          [2750, 2450],
          [2700, 1900],
        ],
      ],
    ]);
    const river = l.water[0]!;
    expect(river.kind).toBe('river');
    if (river.kind !== 'river') throw new Error('river');
    expect(river.centreline).toEqual([
      [0, 1500],
      [4000, 1500],
    ]);
    expect(river.widthM).toBe(200);
    // The full width as one strip, 100 m either side of the centreline.
    const ys = river.polygons.flatMap((p) => p.outer.map(([, y]) => y));
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([1400, 1600]);
    expect(l.roads.map((r) => [r.id, r.kind, r.path, r.surfaceWidthM])).toEqual([
      [
        'high-road',
        'regional',
        [
          [2050, 0],
          [2050, 3000],
        ],
        20,
      ],
    ]);
  });

  it('lays a point bridge along the road through it, as wide as the road, across its diameter', () => {
    const bridge = l.crossings[0]!;
    expect(bridge.kind).toBe('bridge');
    expect(bridge.endpoints).toEqual([
      [2050, 1390],
      [2050, 1610],
    ]);
    expect([bridge.spanM, bridge.widthM]).toEqual([220, 20]);
    const xs = bridge.deck.outer.map(([x]) => x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2040, 2060]);
  });

  it('turns a crossing with no road across its river, and other shapes into areas', () => {
    const map: BaseMap = {
      width: 500,
      height: 500,
      features: [
        {
          id: 'brook',
          kind: 'stream',
          geometry: {
            shape: 'polyline',
            points: [
              { x: 0, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 300 },
            ],
            width: 6,
          },
        },
        {
          id: 'ford',
          kind: 'ford',
          geometry: { shape: 'point', at: { x: 100, y: 101 }, radius: 8 },
        },
        {
          id: 'house',
          kind: 'building',
          geometry: { shape: 'point', at: { x: 400, y: 400 }, radius: 5 },
        },
        {
          id: 'lane-end',
          kind: 'road',
          geometry: { shape: 'point', at: { x: 10, y: 10 }, radius: 1 },
        },
      ],
    };
    const a = periodAsset(map, map.features, map.features).layers;
    const ford = a.crossings[0]!;
    expect(ford.kind).toBe('ford');
    // The brook runs east here, so the ford runs north to south over it.
    expect(ford.endpoints[0][0]).toBeCloseTo(100);
    expect(ford.endpoints[1][0]).toBeCloseTo(100);
    expect(Math.abs(ford.endpoints[1][1] - ford.endpoints[0][1])).toBeCloseTo(16);
    // Two segments and a round joint at the bend.
    expect(a.water[0]!.polygons).toHaveLength(3);
    expect(a.buildings[0]!.footprint.outer.slice(0, 4)).toEqual([
      [395, 405],
      [405, 405],
      [405, 395],
      [395, 395],
    ]);
    expect(a.roads[0]!.path).toEqual([
      [10, 10],
      [10, 10],
    ]);
    expect(a.roads[0]!.kind).toBe(roadClass(2));
  });

  it('classes roads by width: high road, lane, cart track', () => {
    expect([roadClass(20), roadClass(8), roadClass(5), roadClass(3)]).toEqual([
      'regional',
      'regional',
      'street',
      'track',
    ]);
  });
});

describe('the period paper', () => {
  const draw = (map: BaseMap, high = false) => {
    const r = recordCanvas();
    drawPeriodMap(r.ctx, map, 2048 / 4000, high);
    return r;
  };

  it('lays the paper once and paints woods, road, river and bridge in that order', () => {
    const r = draw(fixtureMap);
    const fills = (style: unknown) =>
      r.paints.findIndex((p) => p.op === 'fill' && p.style === style);
    const strokes = (style: unknown) =>
      r.paints.findIndex((p) => p.op === 'stroke' && p.style === style);
    const first = {
      wood: fills(regular.wood),
      road: strokes(regular.road.regional),
      water: fills(regular.water),
      bridge: fills(regular.bridge),
      parapet: strokes(regular.parapet),
    };
    expect(Object.values(first).every((i) => i >= 0)).toBe(true);
    expect(first.wood).toBeLessThan(first.road);
    // The river cuts the road; the bridge then carries the road over it.
    expect(first.road).toBeLessThan(first.water);
    expect(first.water).toBeLessThan(first.bridge);
    expect(first.bridge).toBeLessThan(first.parapet);
    // Only the first pass lays paper; the second draws on clear paper.
    expect(r.calls.filter((c) => c === 'fillRect')).toHaveLength(4);
    expect(passStyle(false, false).palette.regular.paper).toBe('rgba(0, 0, 0, 0)');
    expect(passStyle(true, false).palette.regular.paper).toBe(regular.paper);
    // No neat line, names or scale bar on the table paper.
    expect(r.calls).not.toContain('strokeRect');
    expect(r.calls).not.toContain('fillText');
  });

  it('keeps the legibility minimums for a legacy fixture: the road is cased at least the style width', () => {
    const s = 2048 / 4000;
    const r = draw(fixtureMap);
    const casing = r.painted('stroke', regular.roadCasing.regional)[0]!;
    expect(casing.width).toBe(Math.max(20, TABLE_MAP_STYLE.roads.stroke.regional.minWidthPx / s));
  });

  it('uses the high-contrast palette when asked, and none of the flat colours either way', () => {
    const normal = draw(fixtureMap);
    const high = draw(fixtureMap, true);
    const styles = (r: ReturnType<typeof draw>) => new Set(r.paints.map((p) => p.style));
    for (const c of [contrast.water, contrast.roadCasing.regional, contrast.wood, contrast.parapet])
      expect(styles(high).has(c)).toBe(true);
    expect(styles(high).has(regular.water)).toBe(false);
    for (const colour of FLAT) {
      expect(styles(normal).has(colour)).toBe(false);
      expect(styles(high).has(colour)).toBe(false);
    }
  });

  it('draws marsh as a wash of the water colour inside a broken water line, in its place', () => {
    const marsh: BaseFeature = {
      id: 'fen',
      kind: 'marsh',
      geometry: {
        shape: 'polygon',
        points: [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 300 },
        ],
      },
    };
    const r = draw({ ...fixtureMap, features: [...fixtureMap.features, marsh] });
    const wash = r.paints.find((p) => p.op === 'fill' && p.alpha < 1 && p.style === regular.water)!;
    expect(wash.path.slice(0, 3)).toEqual([
      ['M', 100, 100],
      ['L', 300, 100],
      ['L', 300, 300],
    ]);
    const edge = r.paints.find(
      (p) => p.op === 'stroke' && p.dash.length && p.style === regular.waterLine,
    )!;
    expect(edge).toBeDefined();
    // Legacy marsh shares the woods' layer and is listed after them, so it lies over them, under the road.
    const passes = periodPasses({ ...fixtureMap, features: [...fixtureMap.features, marsh] });
    expect(passes.map((p) => ids(p.features))).toEqual([
      ['north-wood', 'south-wood'],
      ['fen'],
      ['high-road'],
      ['river', 'bridge'],
    ]);
  });

  it('draws an empty map as bare paper', () => {
    const r = draw({ width: 100, height: 50, features: [] });
    // The margin and the paper of one pass, and nothing on it.
    expect(r.calls.filter((c) => c === 'fillRect')).toHaveLength(2);
    expect(r.paints).toHaveLength(0);
  });
});

describe('mapCanvas', () => {
  it('draws the whole map once on a CPU-backed canvas and reads a pixel back so it is finished', () => {
    const canvas = mapCanvas(fixtureMap, false);
    expect([canvas.width, canvas.height]).toEqual([MAX_TEXTURE_PX, 1536]);
    const paper = helpers.find((h) => h.calls.includes('getImageData'))!;
    expect((paper.ctx as unknown as { args: unknown[] }).args).toEqual([
      '2d',
      { willReadFrequently: true },
    ]);
    expect(paper.calls.at(-1)).toBe('getImageData');
    // Every helper canvas (tree marks) is CPU-backed too.
    for (const h of helpers)
      expect((h.ctx as unknown as { args: unknown[] }).args).toEqual([
        '2d',
        { willReadFrequently: true },
      ]);
  });

  it('follows the app contrast by default', () => {
    document.documentElement.dataset['contrast'] = 'high';
    expect(tableHighContrast()).toBe(true);
    mapCanvas(fixtureMap);
    const paper = helpers.find((h) => h.calls.includes('getImageData'))!;
    expect(paper.painted('fill', contrast.water).length).toBeGreaterThan(0);
  });
});
