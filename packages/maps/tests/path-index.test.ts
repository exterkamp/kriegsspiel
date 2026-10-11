import { expect, it } from 'vitest';
import type { Point } from '../src/contract.js';
import { TopologyBudget } from '../src/errors.js';
import { pathIntersectionCandidates } from '../src/path-index.js';
import { segmentsIntersect, validatePath } from '../src/geometry.js';
import { boxesMeet, segmentBox } from '../src/validation-water.js';
it('covers exact nonadjacent segment candidates with seams, EPS gaps and negative translation', () => {
  for (const shift of [0, -137.4, 210]) {
    const points: Point[] = Array.from({ length: 80 }, (_, i) => [
      ((i * 37) % 401) + shift,
      ((i * 73) % 503) - shift,
    ]);
    points.push([100 + shift, 100 - shift], [100 + 1e-10 + shift, 200 - shift]);
    const expected = new Set<string>(),
      observed: string[] = [];
    for (let i = 1; i < points.length; i++)
      for (let j = i + 2; j < points.length; j++)
        if (
          boxesMeet(segmentBox(points[i - 1]!, points[i]!), segmentBox(points[j - 1]!, points[j]!))
        )
          expected.add(`${i}:${j}`);
    pathIntersectionCandidates(points, new TopologyBudget(100_000), '$', 1e-9, (i, j) =>
      observed.push(`${i}:${j}`),
    );
    expect(new Set(observed)).toEqual(expected);
    expect(observed.length).toBe(expected.size);
  }
});
it('validates long sparse paths and closed boundaries while rejecting exact crossings', () => {
  const line: Point[] = Array.from({ length: 1000 }, (_, i) => [i * 25, (i % 2) * 5]);
  expect(() => validatePath(line, '$', new TopologyBudget(30_000))).not.toThrow();
  const circle: Point[] = Array.from({ length: 32 }, (_, i) => [
    500 + 100 * Math.cos((i * Math.PI) / 16),
    500 + 100 * Math.sin((i * Math.PI) / 16),
  ]);
  circle.push(circle[0]!);
  expect(() => validatePath(circle, '$', new TopologyBudget(10_000), true)).not.toThrow();
  const crossed = [...line.slice(0, 20), [250, -50], [250, 50]] as Point[];
  expect(segmentsIntersect(crossed[9]!, crossed[10]!, crossed.at(-2)!, crossed.at(-1)!)).toBe(true);
  expect(() => validatePath(crossed, '$', new TopologyBudget(10_000))).toThrow(/intersect/);
});
it('reserves capacity before long-path coordinate reads and dense scans', () => {
  let reads = 0;
  const point = Object.defineProperty([0, 0], '0', {
    get() {
      reads++;
      return 0;
    },
  }) as Point;
  expect(() => validatePath(Array(20).fill(point), '$', new TopologyBudget(1))).toThrow(
    /Topology work/,
  );
  expect(reads).toBe(0);
  const points: Point[] = Array.from({ length: 40 }, (_, i) => [i % 2 ? 10 : 20, i]);
  expect(() =>
    pathIntersectionCandidates(points, new TopologyBudget(50), '$', 1e-9, () => {}),
  ).toThrow(/Topology work/);
});
