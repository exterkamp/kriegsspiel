// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReferenceAsset, type Polygon } from '@kriegsspiel/maps';
import { loadPreviewAsset } from '../../legacy/map-authoring/asset.js';
import { PERIOD_MAP_STYLE } from '../../legacy/map-authoring/map-style.js';
import { prepareRaster, rasterLayout, TABLE_MAP_STYLE, tableHighContrast } from './raster.js';

class Path {
  rings: number[][][] = [];
  moveTo(x: number, y: number) {
    this.rings.push([[x, y]]);
  }
  lineTo(x: number, y: number) {
    this.rings.at(-1)!.push([x, y]);
  }
  closePath() {}
  addPath(other: Path) {
    this.rings.push(...other.rings.map((r) => r.map((p) => [...p])));
  }
}
type Op = {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  width: number;
};
/** A Canvas2D recorder: every method call is logged with the paint state it was made in. */
function recorder(contextArgs: unknown[]) {
  const ops: Op[] = [];
  const state: Record<string | symbol, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createImageData')
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'getImageData')
        return (...args: unknown[]) => {
          ops.push({ name: 'getImageData', args, fillStyle: '', strokeStyle: '', width: 0 });
          return { data: new Uint8ClampedArray(4) };
        };
      // No createPattern: symbol fills (tree marks, hatching) are left out, as without pattern support.
      if (key === 'createPattern') return undefined;
      return (...args: unknown[]) => {
        ops.push({
          name: String(key),
          args,
          fillStyle: target.fillStyle,
          strokeStyle: target.strokeStyle,
          width: target.lineWidth as number,
        });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  const fills = () =>
    ops
      .filter((o) => o.name === 'fill' && o.args[0] instanceof Path)
      .map((o) => ({ path: o.args[0] as Path, color: o.fillStyle, rule: o.args[1] }));
  const strokes = () =>
    ops
      .filter((o) => o.name === 'stroke' && o.args[0] instanceof Path)
      .map((o) => ({ path: o.args[0] as Path, color: o.strokeStyle, width: o.width }));
  return { ctx, ops, fills, strokes, contextArgs };
}
const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ],
  holes: [],
});
function insideRing(ring: number[][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a[1]! > y !== b[1]! > y && x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!)
      inside = !inside;
  }
  return inside;
}
/** Winding number of a point, for a nonzero fill. */
function winding(rings: number[][][], x: number, y: number) {
  let w = 0;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!,
        b = ring[i]!;
      const cross = (b[0]! - a[0]!) * (y - a[1]!) - (x - a[0]!) * (b[1]! - a[1]!);
      if (a[1]! <= y && b[1]! > y && cross > 0) w++;
      else if (a[1]! > y && b[1]! <= y && cross < 0) w--;
    }
  return w;
}
/** Same ring, whichever way it is traced. */
const sameRing = (actual: number[][], expected: readonly (readonly number[])[]) =>
  JSON.stringify(actual) === JSON.stringify(expected) ||
  JSON.stringify(actual) === JSON.stringify([...expected].reverse());
const regular = TABLE_MAP_STYLE.palette.regular;
const contrast = TABLE_MAP_STYLE.palette.contrast;

let records: ReturnType<typeof recorder>[];
let canvases: number;
beforeEach(() => {
  records = [];
  canvases = 0;
  document.documentElement.removeAttribute('data-contrast');
  vi.stubGlobal('Path2D', Path);
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?) => {
    if (tag === 'canvas') canvases++;
    return create(tag, options);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((...args: unknown[]) => {
    const r = recorder(args);
    records.push(r);
    return r.ctx as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement['getContext']);
});
afterEach(() => {
  document.documentElement.removeAttribute('data-contrast');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded full-bounds raster', () => {
  it('pins fractional longest extents to the cap and rejects unrepresentable aspect ratios', () => {
    const r = rasterLayout(7333.123456, 2500.456789, 4096);
    expect(r.contentWidthPx).toBe(4096);
    expect(r.contentHeightPx / 2500.456789).toBeCloseTo(r.scale, 12);
    expect(r.contentHeightPx).toBeLessThanOrEqual(r.height);
    expect(() => rasterLayout(Number.MIN_VALUE, Number.MAX_VALUE, 4096)).toThrow(RangeError);
  });

  it.each([
    [5000, 5000, 4096, 4096, 4096],
    [5000, 10000, 4096, 2048, 4096],
    [15000, 5000, 4096, 4096, 1366],
    [15000, 5000, 2048, 2048, 683],
  ])('uses a single full extent scale for %s × %s at %s pixels', (w, h, cap, pxW, pxH) => {
    const r = rasterLayout(w!, h!, cap!);
    expect([r.width, r.height]).toEqual([pxW, pxH]);
    expect(r.contentWidthPx / w!).toBeCloseTo(r.contentHeightPx / h!, 12);
    expect(r.contentWidthPx).toBeCloseTo((w! * cap!) / Math.max(w!, h!));
    expect(r.contentHeightPx).toBeCloseTo((h! * cap!) / Math.max(w!, h!));
    expect(Math.max(r.width, r.height)).toBe(cap);
  });
  it('rejects invalid limits/dimensions before canvas allocation', () => {
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error('Analytic fixture failed structural parsing');
    for (const cap of [0, 0.5, NaN, Infinity, 4097])
      expect(() => prepareRaster(a.asset, 'fixture', cap)).toThrow(RangeError);
    expect(() => rasterLayout(0, 5000, 2048)).toThrow(RangeError);
    expect(canvases).toBe(0);
  });
  it('reports Canvas2D unavailability before constructing renderer caches', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error('Analytic fixture failed');
    expect(() => prepareRaster(a.asset, 'fixture', 256)).toThrow('Canvas2D');
    expect(canvases).toBe(1);
  });
});

// Analytic cartographic oracle only: not a generated or composition-certified success fixture.
describe('actual MapRenderer boundary with analytic geometry and recorded Canvas2D', () => {
  it('draws the period staff map (#498) in one complete pass on CPU-backed canvases, with no tiles', () => {
    expect(TABLE_MAP_STYLE.name).toBe('period');
    expect(TABLE_MAP_STYLE.palette).toBe(PERIOD_MAP_STYLE.palette);
    expect(TABLE_MAP_STYLE.neatLine).toBeNull();
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    prepareRaster(a.asset, 'analytic-only', 300);
    // The raster and the hillshade only: no 256 px base tiles, so nothing waits for a later frame.
    expect(canvases).toBe(2);
    expect(records).toHaveLength(2);
    for (const r of records) expect(r.contextArgs).toEqual(['2d', { willReadFrequently: true }]);
    const raster = records.find((r) => r.ops.some((o) => o.name === 'translate'))!;
    expect(raster.ops.filter((o) => o.name === 'drawImage')).toHaveLength(1); // the hillshade
    // Drawing is finished inside prepareRaster: its last act reads one pixel back.
    expect(raster.ops.at(-1)!.name).toBe('getImageData');
    // No neat line round the sheet, and no scale bar on the table's paper.
    expect(raster.ops.some((o) => o.name === 'strokeRect')).toBe(false);
  });

  it('preserves cover holes, dry islands, roads, crossings, buildings and contours in the period palette without mutation', () => {
    const input = createReferenceAsset();
    const water = input.layers.water[0]!.polygons[0]!;
    water.holes.push(rect(45, 95, 10, 10).outer);
    input.layers.contours = [
      {
        id: 'contour:analytic',
        index: true,
        elevationM: 100,
        path: [
          [12, 5],
          [13.125, 16.875],
          [146, 135],
        ],
      },
    ];
    const a = loadPreviewAsset(input);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    const before = JSON.stringify(a.asset);
    const original = JSON.stringify(input);
    const raster = prepareRaster(a.asset, 'analytic-only', 300);
    expect(raster.canvas.width).toBe(300);
    expect(raster.contentWidthPx).toBe(300);
    const r = records.find((x) => x.ops.some((o) => o.name === 'translate'))!;
    const call = (name: string) => r.ops.filter((o) => o.name === name).map((o) => o.args);
    expect(call('translate')).toContainEqual([0, 0]);
    expect(call('scale')).toContainEqual([2, 2]);
    expect(call('rect')).toContainEqual([0, 0, 150, 150]);
    expect(
      r.ops.some(
        (o) =>
          (o.name === 'fillText' || o.name === 'strokeText') && / m$| km$/.test(String(o.args[0])),
      ),
    ).toBe(false);
    const fills = r.fills();
    const strokes = r.strokes();
    // Woods: one evenodd fill of every wood polygon over a stroked edge; holes stay open.
    const cover = input.layers.cover[0]!.polygons[0]!;
    const wood = fills.find((f) => f.color === regular.wood)!;
    expect(wood.path.rings).toEqual([cover.outer, ...cover.holes]);
    expect(wood.rule).toBe('evenodd');
    expect(strokes.find((s) => s.color === regular.woodEdge)!.path).toBe(wood.path);
    // Water: one nonzero union body (D43, #502), its outer ring and hole wound against each other.
    const river = fills.find((f) => f.color === regular.water)!;
    expect(river.rule).toBe('nonzero');
    expect(river.path.rings).toHaveLength(1 + water.holes.length);
    expect(sameRing(river.path.rings[0]!, water.outer)).toBe(true);
    water.holes.forEach((hole, i) => expect(sameRing(river.path.rings[i + 1]!, hole)).toBe(true));
    // Independent parity and winding checks establish that holes and dry islands stay unfilled.
    const occupied = (path: Path, x: number, y: number) =>
      path.rings.filter((ring) => insideRing(ring, x, y)).length % 2 === 1;
    expect(occupied(wood.path, 85, 42)).toBe(false);
    expect(occupied(wood.path, 30, 42)).toBe(true);
    expect(winding(river.path.rings, 50, 100)).toBe(0);
    expect(winding(river.path.rings, 50, 90)).not.toBe(0);
    // Roads: casing then surface, both along the canonical path; the surface is the metre width
    // less the class's casing (4 m regional road at 2 px/m).
    const road = input.layers.roads[0]!;
    const kind = road.kind as 'regional';
    const casing = strokes.find((s) => s.color === regular.roadCasing[kind])!;
    const surface = strokes.find((s) => s.color === regular.road[kind])!;
    expect(casing.path.rings[0]).toEqual(road.path);
    expect(surface.path.rings[0]).toEqual(road.path);
    const rs = TABLE_MAP_STYLE.roads.stroke[kind];
    const outer = Math.max(4, rs.minWidthPx / 2);
    expect(casing.width).toBeCloseTo(outer);
    expect(surface.width).toBeCloseTo(
      outer - 2 * Math.min(outer * rs.casingFraction, rs.casingPx / 2),
    );
    const strokeAt = (colour: string) =>
      r.ops.findIndex((o) => o.name === 'stroke' && o.strokeStyle === colour);
    expect(strokeAt(regular.roadCasing[kind])).toBeLessThan(strokeAt(regular.road[kind]));
    expect(insideRing(wood.path.rings[0]!, 30, 50)).toBe(true);
    // The bridge deck, then its parapets; buildings at their footprint with a dark edge.
    expect(fills.find((f) => f.color === regular.bridge)!.path.rings).toEqual([
      input.layers.crossings[0]!.deck.outer,
    ]);
    expect(fills.find((f) => f.color === regular.building)!.path.rings).toEqual([
      input.layers.buildings[0]!.footprint.outer,
    ]);
    expect(strokes.find((s) => s.color === regular.buildingEdge)!.path.rings).toEqual([
      input.layers.buildings[0]!.footprint.outer,
    ]);
    expect(strokes.find((s) => s.color === regular.contour)!.path.rings[0]).toEqual(
      input.layers.contours[0]!.path,
    );
    // Hachures in sepia on sloping ground.
    expect(strokes.some((s) => s.color === regular.relief)).toBe(true);
    // Nothing from the classic palette remains.
    for (const classic of ['#a4b58e', '#88b6c3', '#faf4e2', '#c5aa7e', '#61584b', '#8e8068'])
      expect(r.ops.some((o) => o.fillStyle === classic || o.strokeStyle === classic)).toBe(false);
    expect(JSON.stringify(a.asset)).toBe(before);
    expect(JSON.stringify(input)).toBe(original);
    expect(Object.isFrozen(a.asset.layers.water[0]!.polygons[0]!.holes[0]![0])).toBe(true);
  });

  it('draws asymmetric north/east/south/west landmarks at their original coordinates using a zero-origin transform', () => {
    const input = createReferenceAsset();
    input.layers.cover = [
      { id: 'corner:nw', kind: 'wood', polygons: [rect(0, 0, 5, 7)] },
      { id: 'corner:ne', kind: 'field', polygons: [rect(139, 0, 11, 9)] },
      { id: 'corner:sw', kind: 'open', polygons: [rect(0, 137, 13, 13)] },
      { id: 'corner:se', kind: 'wood', polygons: [rect(133, 131, 17, 19)] },
    ];
    const a = loadPreviewAsset(input);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    prepareRaster(a.asset, 'analytic-corners', 256);
    const r = records.find((x) => x.ops.some((o) => o.name === 'translate'))!;
    expect(r.ops.find((o) => o.name === 'translate')!.args).toEqual([0, 0]);
    expect(r.ops.find((o) => o.name === 'scale')!.args).toEqual([256 / 150, 256 / 150]);
    // Cover fills by kind, each one path of that kind's polygons, in map metres.
    const fills = r.fills();
    const ring = (i: number) => input.layers.cover[i]!.polygons[0]!.outer;
    expect(fills.find((f) => f.color === regular.field)!.path.rings).toEqual([ring(1)]);
    expect(fills.find((f) => f.color === regular.open)!.path.rings).toEqual([ring(2)]);
    expect(fills.find((f) => f.color === regular.wood)!.path.rings).toEqual([ring(0), ring(3)]);
  });
});

describe('high contrast (#308, #498)', () => {
  const reference = () => {
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    return a.asset;
  };
  const colours = () => {
    const r = records.find((x) => x.ops.some((o) => o.name === 'translate'))!;
    return new Set(r.ops.flatMap((o) => [o.fillStyle, o.strokeStyle]));
  };

  it('follows the app contrast choice, and the OS setting only when the app has none', () => {
    // jsdom has no matchMedia: without one the OS setting reads as not high.
    expect(tableHighContrast()).toBe(false);
    document.documentElement.dataset['contrast'] = 'high';
    expect(tableHighContrast()).toBe(true);
    const queries: string[] = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        queries.push(query);
        return { matches: true } as MediaQueryList;
      },
    });
    try {
      document.documentElement.dataset['contrast'] = 'normal';
      expect(tableHighContrast()).toBe(false);
      document.documentElement.removeAttribute('data-contrast');
      expect(tableHighContrast()).toBe(true);
      expect(queries).toEqual(['(prefers-contrast: more)']);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('draws the contrast palette when the app is in high contrast', () => {
    document.documentElement.dataset['contrast'] = 'high';
    prepareRaster(reference(), 'contrast', 300);
    const used = colours();
    for (const c of [
      contrast.paper,
      contrast.water,
      contrast.wood,
      contrast.building,
      contrast.parapet,
    ])
      expect(used.has(c)).toBe(true);
    expect(used.has(regular.paper)).toBe(false);
    expect(used.has(regular.water)).toBe(false);
  });

  it('lets the caller choose the palette whatever the page says', () => {
    document.documentElement.dataset['contrast'] = 'high';
    prepareRaster(reference(), 'regular', 300, { highContrast: false });
    expect(colours().has(regular.paper)).toBe(true);
    expect(colours().has(contrast.paper)).toBe(false);
    records = [];
    document.documentElement.dataset['contrast'] = 'normal';
    prepareRaster(reference(), 'contrast', 300, { highContrast: true });
    expect(colours().has(contrast.water)).toBe(true);
  });
});
