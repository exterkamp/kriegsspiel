// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReferenceAsset, type Polygon } from '@kriegsspiel/maps';
import { loadPreviewAsset } from '../../legacy/map-authoring/asset.js';
import { prepareRaster, rasterLayout } from './raster.js';

class Path {
  rings: number[][][] = [];
  moveTo(x: number, y: number) {
    this.rings.push([[x, y]]);
  }
  lineTo(x: number, y: number) {
    this.rings.at(-1)!.push([x, y]);
  }
  closePath() {}
}
function recorder() {
  const fills: { path: Path; color: string; rule: string }[] = [];
  const strokes: { path: Path; color: string; width: number }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    measureText: () => ({ width: 10 }),
    fillText: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: vi.fn(),
    fill(path: Path, rule: string) {
      fills.push({ path, color: this.fillStyle, rule });
    },
    stroke(path: Path) {
      strokes.push({ path, color: this.strokeStyle, width: this.lineWidth });
    },
  };
  return { ctx, fills, strokes };
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
let records: ReturnType<typeof recorder>[];
beforeEach(() => {
  records = [];
  vi.stubGlobal('Path2D', Path);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const r = recorder();
    records.push(r);
    return r.ctx as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => {
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
    const allocate = vi.spyOn(document, 'createElement');
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error('Analytic fixture failed structural parsing');
    for (const cap of [0, 0.5, NaN, Infinity, 4097])
      expect(() => prepareRaster(a.asset, 'fixture', cap)).toThrow(RangeError);
    expect(() => rasterLayout(0, 5000, 2048)).toThrow(RangeError);
    expect(allocate).not.toHaveBeenCalled();
  });
  it('reports Canvas2D unavailability before constructing renderer caches', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const a = loadPreviewAsset(createReferenceAsset());
    if (!a.ok) throw new Error('Analytic fixture failed');
    const allocate = vi.spyOn(document, 'createElement');
    expect(() => prepareRaster(a.asset, 'fixture', 256)).toThrow('Canvas2D');
    expect(allocate).toHaveBeenCalledTimes(1);
  });
});

// Analytic cartographic oracle only: not a generated or composition-certified success fixture.
describe('actual MapRenderer boundary with analytic geometry and recorded Canvas2D', () => {
  it('preserves cover holes, dry islands, roads through cover, deck/building polygons and contours without mutation', () => {
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
    const { ctx, fills, strokes } = records[0]!;
    expect(ctx.translate).toHaveBeenCalledWith(0, 0);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 150, 150);
    expect(ctx.fillText.mock.calls.some((call) => / m$| km$/.test(String(call[0])))).toBe(false);
    const wood = fills.find((f) => f.color === '#a4b58e')!;
    const river = fills.find((f) => f.color === '#88b6c3')!;
    expect(wood.path.rings).toEqual([
      input.layers.cover[0]!.polygons[0]!.outer,
      ...input.layers.cover[0]!.polygons[0]!.holes,
    ]);
    expect(river.path.rings).toEqual([water.outer, ...water.holes]);
    expect(wood.rule).toBe('evenodd');
    expect(river.rule).toBe('evenodd');
    // Independent parity checks establish that the recorded paths preserve holes/dry islands.
    const occupied = (path: Path, x: number, y: number) =>
      path.rings.filter((r) => insideRing(r, x, y)).length % 2 === 1;
    expect(occupied(wood.path, 85, 42)).toBe(false);
    expect(occupied(wood.path, 30, 42)).toBe(true);
    expect(occupied(river.path, 50, 100)).toBe(false);
    expect(occupied(river.path, 50, 90)).toBe(true);
    const road = strokes.filter((s) => s.color === '#faf4e2');
    expect(road[0]!.path.rings[0]).toEqual(input.layers.roads[0]!.path);
    expect(road[0]!.width).toBeCloseTo(3.5); // canonical 4m surface, with renderer outline inset
    expect(insideRing(wood.path.rings[0]!, 30, 50)).toBe(true);
    expect(fills.find((f) => f.color === '#c5aa7e')!.path.rings).toEqual([
      input.layers.crossings[0]!.deck.outer,
    ]);
    expect(fills.find((f) => f.color === '#61584b')!.path.rings).toEqual([
      input.layers.buildings[0]!.footprint.outer,
    ]);
    expect(strokes.find((s) => s.color === '#8e8068')!.path.rings[0]).toEqual(
      input.layers.contours[0]!.path,
    );
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
    const r = records[0]!;
    expect(r.ctx.translate).toHaveBeenCalledWith(0, 0);
    expect(r.ctx.scale).toHaveBeenCalledWith(256 / 150, 256 / 150);
    expect(r.fills.slice(0, 4).map((f) => f.path.rings[0])).toEqual(
      input.layers.cover.map((c) => c.polygons[0]!.outer),
    );
  });
});
