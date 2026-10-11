import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  mapToScreen,
  panViewport,
  resizeViewport,
  scaleBar,
  screenToMap,
  visibleBounds,
  zoomViewport,
} from './viewport.js';

const bounds = { minX: 3000, minY: 1000, maxX: 5000, maxY: 2000 };
describe('metre-based preview viewport', () => {
  it('fits asymmetric translated bounds without swapping east/south or distorting aspect', () => {
    const v = fitViewport(bounds, 1000, 600);
    expect(v.scale).toBe(0.44);
    expect(mapToScreen(v, [3000, 1000])).toEqual([60, 80]);
    expect(mapToScreen(v, [5000, 2000])).toEqual([940, 520]);
    expect(screenToMap(v, [500, 300])).toEqual([4000, 1500]);
    for (const [w, h] of [
      [1440, 900],
      [390, 600],
      [900, 390],
    ]) {
      const fitted = fitViewport(bounds, w!, h!);
      const [x, y] = mapToScreen(fitted, [bounds.maxX, bounds.maxY]);
      expect(x).toBeLessThan(w!);
      expect(y).toBeLessThan(h!);
      expect((fitted.scale * 2000) / (fitted.scale * 1000)).toBe(2);
    }
  });
  it('keeps the cursor fixed in metres under repeated and clamped zoom', () => {
    const initial = fitViewport(bounds, 1000, 600);
    const anchor: [number, number] = [217, 413];
    const world = screenToMap(initial, anchor);
    let v = initial;
    for (const factor of [1.7, 0.8, 1e20, 1e-30, 2]) {
      v = zoomViewport(v, anchor, factor, bounds);
      const actual = screenToMap(v, anchor);
      expect(actual[0]).toBeCloseTo(world[0], 9);
      expect(actual[1]).toBeCloseTo(world[1], 9);
      expect(v.scale).toBeGreaterThanOrEqual(initial.scale / 8);
      expect(v.scale).toBeLessThanOrEqual(80);
    }
    expect(initial).toEqual(fitViewport(bounds, 1000, 600));
  });
  it('preserves centre and scale on resize, and pans in CSS pixels', () => {
    const initial = fitViewport(bounds, 1000, 600);
    const moved = panViewport(initial, [44, -88]);
    expect(screenToMap(moved, [500, 300])).toEqual([3900, 1700]);
    const resized = resizeViewport(moved, 390, 740);
    expect(screenToMap(resized, [195, 370])).toEqual([3900, 1700]);
    expect(resized.scale).toBe(initial.scale);
    expect(initial.offset).toEqual([-1260, -360]);
    const visible = visibleBounds(resized);
    expect(visible.maxX - visible.minX).toBeCloseTo(390 / resized.scale);
  });
  it('scale bars always express the same metre transform as vectors at every zoom', () => {
    for (const scale of [0.01, 0.44, 3.12, 80]) {
      const v = { ...fitViewport(bounds, 390, 600), scale };
      const bar = scaleBar(v);
      const start = screenToMap(v, [24, 572]);
      const end = screenToMap(v, [24 + bar.pixels, 572]);
      expect(end[0] - start[0]).toBeCloseTo(bar.metres, 8);
      expect(bar.pixels).toBeLessThanOrEqual(117);
      expect(bar.pixels).toBeGreaterThan(0);
    }
  });
  it('rejects invalid viewport sizes, deltas and zoom factors', () => {
    const v = fitViewport(bounds, 1000, 600);
    expect(() => fitViewport(bounds, 0, 600)).toThrow(RangeError);
    expect(() => fitViewport({ ...bounds, maxY: 1000 }, 100, 100)).toThrow(RangeError);
    expect(() => resizeViewport(v, Infinity, 1)).toThrow(RangeError);
    expect(() => zoomViewport(v, [0, 0], NaN, bounds)).toThrow(RangeError);
    expect(() => panViewport(v, [0, Infinity])).toThrow(RangeError);
  });
});
