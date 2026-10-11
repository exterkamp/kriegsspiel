import { createReferenceAsset } from '@kriegsspiel/maps';
import { describe, expect, it } from 'vitest';
import { loadPreviewAsset } from './asset.js';
import { geometryBounds, traceLine, tracePolygon, type PathSink } from './geometry.js';

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
