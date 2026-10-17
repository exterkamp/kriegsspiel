import { describe, expect, it } from 'vitest';
import { hachureLayout, hachureStrokes, type GradientField } from './hachures.js';
import { PERIOD_MAP_STYLE } from './map-style.js';

const style = PERIOD_MAP_STYLE.relief.hachures!;
const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
const plane = (dx: number, dy: number): GradientField => ({ gradientAt: () => ({ dx, dy }) });
const layout = { spacingM: 5, lengthM: 6 };

describe('hachures', () => {
  it('draws nothing on level ground or below the minimum slope', () => {
    expect(hachureStrokes(plane(0, 0), bounds, bounds, layout, style)).toEqual([]);
    expect(hachureStrokes(plane(style.minSlope * 0.9, 0), bounds, bounds, layout, style)).toEqual(
      [],
    );
  });

  it('runs every stroke down the fall line', () => {
    // Ground rising to the east and south: downhill is north-west.
    const strokes = hachureStrokes(plane(0.06, 0.08), bounds, bounds, layout, style);
    expect(strokes.length).toBeGreaterThan(0);
    for (const { points } of strokes) {
      const dx = points.at(-2)! - points[0]!;
      const dy = points.at(-1)! - points[1]!;
      expect(Math.hypot(dx, dy)).toBeCloseTo(layout.lengthM, 6);
      expect(dx / dy).toBeCloseTo(0.06 / 0.08, 6);
      expect(dx).toBeLessThan(0);
    }
  });

  it('is denser and heavier on steeper slopes', () => {
    const gentle = hachureStrokes(plane(0.04, 0), bounds, bounds, layout, style);
    const steep = hachureStrokes(plane(0.3, 0), bounds, bounds, layout, style);
    expect(steep.length).toBeGreaterThan(gentle.length * 2);
    expect(Math.max(...gentle.map((s) => s.weight))).toBeLessThan(0.1);
    expect(steep.every((s) => s.weight === 1)).toBe(true);
  });

  it('places the same seeds whichever tile asks, so neighbouring tiles join', () => {
    const ground = plane(0.1, 0.05);
    const whole = hachureStrokes(ground, bounds, bounds, layout, style);
    const west = hachureStrokes(ground, bounds, { ...bounds, maxX: 200 }, layout, style);
    const east = hachureStrokes(ground, bounds, { ...bounds, minX: 200 }, layout, style);
    const key = (s: { points: readonly number[] }) => s.points.map((v) => v.toFixed(6)).join();
    const tiled = new Set([...west, ...east].map(key));
    expect(new Set(whole.map(key))).toEqual(tiled);
  });

  it('keeps a ground spacing floor at close zoom so a village plan is not furred', () => {
    expect(hachureLayout(style, 0.25).spacingM).toBeCloseTo(style.spacingPx / 0.25);
    expect(hachureLayout(style, 64).spacingM).toBe(style.minSpacingM);
    expect(hachureLayout(style, 64).lengthM).toBeLessThanOrEqual(style.maxLengthPx / 64);
  });
});
