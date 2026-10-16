import { createReferenceAsset } from '@kriegsspiel/maps';
import { describe, expect, it } from 'vitest';
import { loadPreviewAsset } from './asset.js';
import {
  geometryBounds,
  insidePolygon,
  outerBoundary,
  traceLine,
  tracePolygon,
  type PathSink,
  type Position,
} from './geometry.js';

function recorder() {
  const commands: (string | number)[][] = [];
  const sink: PathSink = {
    moveTo: (x, y) => {
      commands.push(['move', x, y]);
    },
    lineTo: (x, y) => {
      commands.push(['line', x, y]);
    },
    closePath: () => {
      commands.push(['close']);
    },
  };
  return { commands, sink };
}
describe('preview asset and geometry boundary', () => {
  it('loads a detached deeply immutable snapshot without rounding or changing the source', () => {
    const input = createReferenceAsset();
    const before = JSON.stringify(input);
    const result = loadPreviewAsset(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Fixture rejected');
    expect(result.asset).toEqual(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result.asset.layers.cover[0]!.polygons[0]!.holes[0]![0])).toBe(true);
    expect(Object.isFrozen(result.asset.elevation.samples)).toBe(true);
    input.layers.roads[0]!.path[0]![0] = 999;
    input.elevation.samples[0] = -999;
    expect(result.asset.layers.roads[0]!.path[0]).toEqual([10, 50]);
    expect(result.asset.elevation.samples[0]).toBe(100);
  });
  it('traces exact outer and hole coordinates separately, retaining winding and closure', () => {
    const result = loadPreviewAsset(createReferenceAsset());
    if (!result.ok) throw new Error('Fixture rejected');
    const polygon = result.asset.layers.cover[0]!.polygons[0]!;
    const before = JSON.stringify(result.asset);
    const { sink, commands } = recorder();
    tracePolygon(sink, polygon);
    expect(commands).toEqual([
      ['move', 20, 35],
      ['line', 120, 35],
      ['line', 120, 85],
      ['line', 20, 85],
      ['line', 20, 35],
      ['close'],
      ['move', 80, 40],
      ['line', 90, 40],
      ['line', 90, 45],
      ['line', 80, 45],
      ['line', 80, 40],
      ['close'],
    ]);
    tracePolygon(sink, { outer: [...polygon.outer].reverse(), holes: polygon.holes });
    expect(commands[12]).toEqual(['move', 20, 35]);
    expect(commands[13]).toEqual(['line', 20, 85]);
    expect(JSON.stringify(result.asset)).toBe(before);
  });
  it('traces all supplied layers without changing geography or elevation', () => {
    const result = loadPreviewAsset(createReferenceAsset());
    if (!result.ok) throw new Error('Fixture rejected');
    const a = result.asset;
    const before = JSON.stringify(a);
    const { sink } = recorder();
    for (const f of [...a.layers.cover, ...a.layers.water])
      for (const p of f.polygons) tracePolygon(sink, p);
    for (const f of [...a.layers.roads, ...a.layers.contours]) traceLine(sink, f.path);
    for (const f of a.layers.crossings) tracePolygon(sink, f.deck);
    for (const f of a.layers.buildings) tracePolygon(sink, f.footprint);
    expect(JSON.stringify(a)).toBe(before);
    expect(a.layers.contours).toEqual([]); // No renderer-generated contour geography.
    expect(geometryBounds(a.layers.roads[0]!.path, a.layers.roads[0]!.surfaceWidthM / 2)).toEqual({
      minX: 8,
      minY: 48,
      maxX: 102,
      maxY: 52,
    });
  });
  it('reports invalid candidates without executing accessors or converting them to empty maps', () => {
    const input = createReferenceAsset();
    input.layers.cover[0]!.polygons[0]!.holes[0]![0] = [500, 500];
    const result = loadPreviewAsset(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Invalid hole accepted');
    expect(result.issues.length).toBeGreaterThan(0);
    let called = false;
    const unsafe = Object.defineProperty({}, 'bounds', {
      enumerable: true,
      get: () => {
        called = true;
        throw new Error('Getter');
      },
    });
    expect(loadPreviewAsset(unsafe).ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('outer boundary of adjoining polygons', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => ({
    outer: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ] as Position[],
    holes: [] as Position[][],
  });
  const length = (lines: Position[][]) =>
    lines.reduce(
      (sum, line) =>
        sum +
        line.slice(1).reduce((s, [x, y], i) => s + Math.hypot(x - line[i]![0], y - line[i]![1]), 0),
      0,
    );

  it('keeps the whole ring of a lone polygon, holes included', () => {
    const square = rect(0, 0, 50, 50);
    square.holes.push(rect(20, 20, 30, 30).outer);
    expect(length(outerBoundary([square]))).toBeCloseTo(240);
    expect(insidePolygon(square, 10, 10)).toBe(true);
    expect(insidePolygon(square, 25, 25)).toBe(false);
  });

  it('drops edges shared by strips, keeping the open part of a partly shared edge', () => {
    // Two 25 m strips, the lower one wider: the stretch y = 25, 0 <= x <= 100 is shared.
    const lines = outerBoundary([rect(0, 0, 100, 25), rect(-25, 25, 125, 50)]);
    expect(length(lines)).toBeCloseTo(100 + 25 + 25 + 50 + 25 + 150 + 25);
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1]!;
        const [bx, by] = line[i]!;
        const shared = ay === 25 && by === 25 && Math.min(ax, bx) >= 0 && Math.max(ax, bx) <= 100;
        expect(shared).toBe(false);
      }
  });
});
