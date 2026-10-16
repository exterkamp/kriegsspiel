import { createReferenceAsset } from '@kriegsspiel/maps';
import { describe, expect, it } from 'vitest';
import { loadPreviewAsset } from './asset.js';
import {
  geometryBounds,
  insidePolygon,
  outerBoundary,
  traceLine,
  tracePolygon,
  traceUnionPolygon,
  weldedBoundary,
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

  it('ends the open part of a partly shared edge where the neighbour ends, not at a piece end', () => {
    // The upper strip's bottom edge is shared for 0 <= x <= 93.7 and open for its last 6.3 m.
    const lines = outerBoundary([rect(0, 0, 100, 25), rect(-25, 25, 93.7, 50)]);
    expect(length(lines)).toBeCloseTo(100 + 25 + 25 + 6.3 + 25 + 25 + 25 + 118.7, 2);
  });

  // Two reaches of one river 20 m wide whose cut edges were simplified apart: a 3 cm gap at the
  // west bank closing to a 2 cm overlap at the east bank, as D44's reaches meet.
  const upper = rect(0, 0, 20, 100);
  const lower = {
    outer: [
      [0, 100.03],
      [20, 99.98],
      [20, 200],
      [0, 200],
      [0, 100.03],
    ] as Position[],
    holes: [] as Position[][],
  };
  // Some piece of a line runs across the river's middle near the junction.
  const crossesRiver = (lines: Position[][]) =>
    lines.some((line) =>
      line.some(([x, y], i) => {
        const [px, py] = line[i - 1] ?? [x, y];
        return (
          i > 0 &&
          Math.abs(y - 100) < 0.5 &&
          Math.abs(py - 100) < 0.5 &&
          Math.min(x, px) < 19 &&
          Math.max(x, px) > 1
        );
      }),
    );

  it('keeps a seam across a river where reaches only nearly adjoin, without a weld', () => {
    expect(crossesRiver(outerBoundary([upper, lower]))).toBe(true);
  });

  it('welds reaches within the weld distance into one body: no shore across, the gap filled', () => {
    const { shore, welds } = weldedBoundary([upper, lower], { pieceM: 2.5, weldM: 0.5 });
    expect(crossesRiver(shore)).toBe(false);
    // The banks are still shore, both sides, the whole 200 m.
    const banks = (x: number) =>
      length(shore.map((line) => line.filter(([px]) => Math.abs(px - x) < 1e-9)));
    expect(banks(0)).toBeCloseTo(200, 0);
    expect(banks(20)).toBeCloseTo(200, 0);
    // Every point of the gap lies in a weld, and the welds stay within the weld distance.
    const inWeld = (x: number, y: number) =>
      welds.some((quad) => insidePolygon({ outer: quad, holes: [] }, x, y));
    for (let x = 0.5; x < 19.5; x += 0.5) {
      const gapY = 100 + 0.03 - (0.05 * x) / 20;
      if (gapY > 100) expect(inWeld(x, (100 + gapY) / 2)).toBe(true);
    }
    for (const quad of welds) for (const [, y] of quad) expect(Math.abs(y - 100)).toBeLessThan(0.6);
  });

  it('keeps a true shore whose neighbour lies beyond the weld distance', () => {
    const apart = rect(0, 101, 20, 200);
    const { shore, welds } = weldedBoundary([upper, apart], { pieceM: 2.5, weldM: 0.5 });
    expect(crossesRiver(shore)).toBe(true);
    expect(welds).toHaveLength(0);
  });
});

describe('union tracing', () => {
  const area2 = (ring: number[][]) =>
    ring.reduce((sum, [x, y], i) => {
      const [px, py] = ring[(i + ring.length - 1) % ring.length]!;
      return sum + px! * y! - x! * py!;
    }, 0);
  const rings = (polygon: { outer: Position[]; holes: Position[][] }) => {
    const out: number[][][] = [];
    traceUnionPolygon(
      {
        moveTo: (x, y) => out.push([[x, y]]),
        lineTo: (x, y) => out.at(-1)!.push([x, y]),
        closePath: () => {},
      },
      polygon,
    );
    return out;
  };
  const square = (x0: number, x1: number): Position[] => [
    [x0, x0],
    [x1, x0],
    [x1, x1],
    [x0, x1],
  ];

  it('winds the outer ring positive and holes negative whatever the input winding', () => {
    for (const reverseOuter of [false, true])
      for (const reverseHole of [false, true]) {
        const outer = square(0, 10);
        const hole = square(3, 6);
        const traced = rings({
          outer: reverseOuter ? [...outer].reverse() : outer,
          holes: [reverseHole ? [...hole].reverse() : hole],
        });
        expect(traced).toHaveLength(2);
        expect(area2(traced[0]!)).toBeGreaterThan(0);
        expect(area2(traced[1]!)).toBeLessThan(0);
      }
  });
});
