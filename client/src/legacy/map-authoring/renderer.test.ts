import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPreviewAsset } from './asset.js';
import { DEFAULT_LAYERS, MapRenderer, type Layers } from './renderer.js';

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
