import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPreviewAsset } from './asset.js';
import { BASE_TILES_PER_FRAME, DEFAULT_LAYERS, MapRenderer, type Layers } from './renderer.js';
import { CLASSIC_MAP_STYLE, PERIOD_MAP_STYLE } from './map-style.js';

class RecordedPath {
  points: number[][] = [];
  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  closePath(): void {}
}
function recordingContext() {
  const fills: { path: RecordedPath; color: string; rule: string }[] = [];
  const strokes: { path: RecordedPath; width: number }[] = [];
  const context = {
    fillStyle: '',
    lineWidth: 0,
    save() {},
    restore() {},
    setTransform() {},
    fillRect() {},
    translate() {},
    scale() {},
    beginPath() {},
    rect() {},
    clip() {},
    fill(path: RecordedPath, rule: string) {
      fills.push({ path, color: this.fillStyle, rule });
    },
    stroke(path: RecordedPath) {
      strokes.push({ path, width: this.lineWidth });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, fills, strokes };
}
const layers: Layers = Object.fromEntries(
  Object.keys(DEFAULT_LAYERS).map((key) => [key, false]),
) as Layers;

describe('renderer presentation regressions (mock Canvas2D)', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', RecordedPath);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData() {},
        }),
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['bridge', 'ford'] as const)(
    'distinguishes a %s deck from water in high contrast without changing its geometry',
    (kind) => {
      const input = createReferenceAsset();
      if (kind === 'ford')
        input.layers.crossings[0] = {
          ...input.layers.crossings[0]!,
          kind,
          depthM: 0.5,
          traversableWidthM: 8,
        };
      const result = loadPreviewAsset(input);
      if (!result.ok) throw new Error('Fixture rejected');
      const before = JSON.stringify(result.asset);
      const renderer = new MapRenderer(result.asset);
      const { context, fills } = recordingContext();
      renderer.render(
        context,
        { width: 150, height: 150, scale: 1, offset: [0, 0] },
        { ...layers, water: true, bridges: true },
        true,
      );
      expect(fills).toHaveLength(2);
      expect(fills[0]!.color).not.toBe(fills[1]!.color);
      expect(fills[1]!.color).toBe('#ffdd70');
      expect(fills[1]!.rule).toBe('evenodd');
      expect(fills[1]!.path.points).toEqual(result.asset.layers.crossings[0]!.deck.outer);
      expect(JSON.stringify(result.asset)).toBe(before);
    },
  );

  it('keeps contour half-strokes and crossing outlines visible at viewport edges at different zooms', () => {
    const input = createReferenceAsset();
    input.layers.contours = [
      {
        id: 'contour:test',
        index: true,
        elevationM: 100,
        path: [
          [10, 1],
          [10, 20],
        ],
      },
    ];
    const result = loadPreviewAsset(input);
    if (!result.ok) throw new Error('Fixture rejected');
    const renderer = new MapRenderer(result.asset);
    for (const scale of [1, 2]) {
      const contour = recordingContext();
      renderer.render(
        contour.context,
        { width: 20, height: 100, scale, offset: [-10 * scale - 0.4, 0] },
        { ...layers, contours: true },
        false,
      );
      expect(contour.strokes).toHaveLength(1);
      expect(contour.strokes[0]!.width).toBe(1.4 / scale);
      const deck = recordingContext();
      renderer.render(
        deck.context,
        { width: 20, height: 30, scale, offset: [-75 * scale - 0.4, -40 * scale] },
        { ...layers, bridges: true },
        true,
      );
      expect(deck.fills).toHaveLength(1);
      expect(deck.strokes).toHaveLength(1);
      const offscreen = recordingContext();
      renderer.render(
        offscreen.context,
        { width: 20, height: 30, scale, offset: [-75 * scale - 2, -40 * scale] },
        { ...layers, bridges: true },
        true,
      );
      expect(offscreen.fills).toHaveLength(0);
    }
  });
});

interface Call {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
}
/** Records every Canvas2D call with the style in force; enough of the API for the period renderer. */
function proxyContext(calls: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    globalAlpha: 1,
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createImageData')
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'measureText') return (text: string) => ({ width: text.length * 7 });
      if (key === 'createPattern') return () => ({ setTransform() {} });
      return (...args: unknown[]) => {
        calls.push({
          name: String(key),
          args,
          fillStyle: target.fillStyle,
          strokeStyle: target.strokeStyle,
          lineWidth: target.lineWidth as number,
          font: target.font as string,
        });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
class PeriodPath {
  readonly ops: unknown[][] = [];
  moveTo(x: number, y: number): void {
    this.ops.push(['M', x, y]);
  }
  lineTo(x: number, y: number): void {
    this.ops.push(['L', x, y]);
  }
  closePath(): void {}
  addPath(path: PeriodPath): void {
    this.ops.push(...path.ops);
  }
}

describe('period staff-map style (recorded Canvas2D)', () => {
  let canvases: Call[][];
  beforeEach(() => {
    canvases = [];
    vi.stubGlobal('Path2D', PeriodPath);
    vi.stubGlobal('document', {
      createElement: () => {
        const calls: Call[] = [];
        canvases.push(calls);
        return { width: 0, height: 0, getContext: () => proxyContext(calls) };
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const reference = (edit: (asset: ReturnType<typeof createReferenceAsset>) => void = () => {}) => {
    const input = createReferenceAsset();
    edit(input);
    const result = loadPreviewAsset(input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.asset;
  };
  const palette = PERIOD_MAP_STYLE.palette;

  it('keeps the classic style as the default, so the table raster is unchanged', () => {
    const renderer = new MapRenderer(reference());
    expect(renderer.style).toBe(CLASSIC_MAP_STYLE);
    const calls: Call[] = [];
    const view = { width: 150, height: 150, scale: 1, offset: [0, 0] as [number, number] };
    expect(renderer.render(proxyContext(calls), view, DEFAULT_LAYERS, false)).toBe(false);
    expect(calls.some((c) => c.name === 'setLineDash' || c.name === 'strokeText')).toBe(false);
  });

  it('makes base tiles a few per frame, reports the frame incomplete, then serves them from cache', () => {
    const asset = reference();
    const before = JSON.stringify(asset);
    const renderer = new MapRenderer(asset, PERIOD_MAP_STYLE);
    // 8 px/m: 32 m tiles, so the 150 m map needs 5 × 5 of them.
    const view = { width: 1200, height: 1200, scale: 8, offset: [0, 0] as [number, number] };
    const made = () => canvases.length;
    const setup = made();
    const frames: boolean[] = [];
    let blits = 0;
    for (let i = 0; i < 8; i++) {
      const calls: Call[] = [];
      frames.push(renderer.render(proxyContext(calls), view, DEFAULT_LAYERS, false));
      blits = calls.filter((c) => c.name === 'drawImage').length;
      if (!frames.at(-1)) break;
    }
    const frameCount = Math.ceil(25 / BASE_TILES_PER_FRAME);
    expect(frames).toEqual([...Array<boolean>(frameCount - 1).fill(true), false]);
    expect(blits).toBe(25);
    const tiles = made() - setup;
    // One more frame of the same view makes no tile at all.
    expect(renderer.render(proxyContext([]), view, DEFAULT_LAYERS, false)).toBe(false);
    expect(made() - setup).toBe(tiles);
    expect(JSON.stringify(asset)).toBe(before);
  });

  it('hachures sloping ground in sepia on the base tile, heavier strokes wider', () => {
    const renderer = new MapRenderer(reference(), PERIOD_MAP_STYLE);
    const view = { width: 150, height: 150, scale: 1, offset: [0, 0] as [number, number] };
    const before = canvases.length;
    expect(renderer.render(proxyContext([]), view, DEFAULT_LAYERS, false)).toBe(false);
    const tile = canvases.slice(before).find((c) => c.some((call) => call.name === 'fillRect'))!;
    const hachures = tile.filter(
      (c) => c.name === 'stroke' && c.strokeStyle === palette.regular.relief,
    );
    expect(hachures.length).toBeGreaterThan(0);
    const widths = hachures.map((c) => c.lineWidth);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    // Turning the layer off leaves the relief plate out of a freshly made tile.
    const off = canvases.length;
    renderer.render(proxyContext([]), view, { ...DEFAULT_LAYERS, hachures: false }, false);
    const plain = canvases.slice(off).find((c) => c.some((call) => call.name === 'fillRect'))!;
    expect(plain.some((c) => c.strokeStyle === palette.regular.relief)).toBe(false);
  });

  it('lines the water along its shore and marks crossings apart from water in high contrast', () => {
    for (const kind of ['bridge', 'ford'] as const) {
      const asset = reference((input) => {
        if (kind === 'ford')
          input.layers.crossings[0] = {
            ...input.layers.crossings[0]!,
            kind,
            depthM: 0.5,
            traversableWidthM: 8,
          };
      });
      const renderer = new MapRenderer(asset, PERIOD_MAP_STYLE);
      const view = { width: 150, height: 150, scale: 1, offset: [0, 0] as [number, number] };
      const calls: Call[] = [];
      const before = canvases.length;
      renderer.render(proxyContext(calls), view, DEFAULT_LAYERS, true);
      const tile = canvases.slice(before).find((c) => c.some((call) => call.name === 'fillRect'))!;
      const hc = palette.contrast;
      expect(tile.some((c) => c.name === 'fill' && c.fillStyle === hc.water)).toBe(true);
      expect(tile.some((c) => c.name === 'clip')).toBe(true);
      expect(
        tile.filter((c) => c.name === 'stroke' && c.strokeStyle === hc.waterLine),
      ).toHaveLength(PERIOD_MAP_STYLE.water.liningPx.length);
      const deck = calls.find((c) => c.name === 'fill' && c.args[0] instanceof PeriodPath)!;
      expect(deck.fillStyle).toBe(kind === 'bridge' ? hc.bridge : hc.ford);
      expect(deck.fillStyle).not.toBe(hc.water);
      expect((deck.args[0] as PeriodPath).ops.slice(0, 1)).toEqual([
        ['M', ...asset.layers.crossings[0]!.deck.outer[0]!],
      ]);
      // A ford's edges are broken; a bridge's parapets are solid lines with splayed wings.
      const dashed = calls.some(
        (c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0,
      );
      expect(dashed).toBe(kind === 'ford');
    }
  });

  it('cases roads by class with a minimum screen width and breaks cart tracks', () => {
    const view = { width: 150, height: 150, scale: 0.5, offset: [0, 0] as [number, number] };
    const only = { ...layers, roads: true };
    const regional = new MapRenderer(reference(), PERIOD_MAP_STYLE);
    const calls: Call[] = [];
    regional.render(proxyContext(calls), view, only, false);
    const strokes = calls.filter((c) => c.name === 'stroke');
    const stroke = PERIOD_MAP_STYLE.roads.stroke.regional;
    // The 4 m surface is under 4.2 px at 0.5 px/m, so the casing widens to the minimum.
    expect(strokes.map((c) => [c.strokeStyle, c.lineWidth])).toEqual([
      [palette.regular.roadCasing.regional, stroke.minWidthPx / 0.5],
      [palette.regular.road.regional, (stroke.minWidthPx - 2 * stroke.casingPx) / 0.5],
    ]);
    const track = new MapRenderer(
      reference((input) => {
        input.layers.roads[0]!.kind = 'track';
      }),
      PERIOD_MAP_STYLE,
    );
    const trackCalls: Call[] = [];
    track.render(proxyContext(trackCalls), view, only, false);
    const dashes = trackCalls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0]);
    expect(dashes).toEqual([PERIOD_MAP_STYLE.roads.stroke.track.dashPx!.map((d) => d / 0.5), []]);
  });

  it('letters names in serif over a paper halo', () => {
    const renderer = new MapRenderer(reference(), PERIOD_MAP_STYLE);
    const calls: Call[] = [];
    const view = { width: 300, height: 300, scale: 2, offset: [0, 0] as [number, number] };
    renderer.render(proxyContext(calls), view, { ...layers, names: true }, false);
    const halo = calls.find((c) => c.name === 'strokeText' && c.args[0] === 'Westbank')!;
    expect(halo.strokeStyle).toBe(palette.regular.halo);
    expect(halo.font).toBe(PERIOD_MAP_STYLE.labels.fonts.village);
    // A halo, not the classic paper box, sits behind the letters.
    expect(calls[calls.indexOf(halo) - 1]!.name).not.toBe('fillRect');
    const text = calls[calls.indexOf(halo) + 1]!;
    expect([text.name, text.args[0], text.fillStyle]).toEqual([
      'fillText',
      'Westbank',
      palette.regular.ink,
    ]);
  });
});
