import { expect, it } from 'vitest';
import type { Point, Road } from '../src/contract.js';
import { TopologyBudget } from '../src/errors.js';
import { boxesMeet, segmentBox } from '../src/validation-water.js';
import { roadIntersectionCandidates } from '../src/validation-roads.js';

const road = (path: Point[]): Road => ({ path }) as Road;
it('finds exactly conservative brute-force segment candidates across cell seams and translations', () => {
  for (const shift of [0, 123.4, -210]) {
    const paths: Point[][] = [
      [
        [100, 0],
        [100, 300],
      ],
      [
        [0, 100],
        [300, 100],
      ],
      [
        [100 + 1e-10, 150],
        [150, 150],
      ],
      [
        [110, 110],
        [110, 190],
      ],
      [
        [400, 400],
        [400, 401],
      ],
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      ...Array.from({ length: 35 }, (_, i): Point[] => [
        [i * 31, i * 17],
        [i * 31 + 180, i * 17 + 65],
      ]),
    ];
    const roads = paths.map((p) => road(p.map(([x, y]) => [x + shift, y - shift])));
    const expected = new Set<string>();
    for (let i = 0; i < roads.length; i++)
      for (let j = 0; j < i; j++)
        for (let ai = 1; ai < roads[i]!.path.length; ai++)
          for (let bi = 1; bi < roads[j]!.path.length; bi++)
            if (
              boxesMeet(
                segmentBox(roads[i]!.path[ai - 1]!, roads[i]!.path[ai]!),
                segmentBox(roads[j]!.path[bi - 1]!, roads[j]!.path[bi]!),
              )
            )
              expected.add(`${i}:${ai}:${j}:${bi}`);
    const observed: string[] = [];
    roadIntersectionCandidates(roads, new TopologyBudget(100_000), (i, ai, j, bi) =>
      observed.push(`${i}:${ai}:${j}:${bi}`),
    );
    expect(observed.length).toBe(new Set(observed).size);
    expect(new Set(observed)).toEqual(expected);
  }
});
it('keeps distant roads bounded without a quadratic all-road scan', () => {
  const roads = Array.from({ length: 4000 }, (_, i) =>
    road([
      [i * 200, 10],
      [i * 200 + 5, 15],
    ]),
  );
  let candidates = 0;
  roadIntersectionCandidates(roads, new TopologyBudget(60_000), () => candidates++);
  expect(candidates).toBe(0);
});
it('charges empty lookups, insertion and dense repeated scans before capacity is exceeded', () => {
  expect(() =>
    roadIntersectionCandidates(
      [
        road([
          [10, 10],
          [20, 20],
        ]),
      ],
      new TopologyBudget(1),
      () => {},
    ),
  ).toThrow(/Topology work/);
  const roads = Array.from({ length: 100 }, () =>
    road([
      [10, 10],
      [20, 20],
    ]),
  );
  let callbacks = 0;
  expect(() =>
    roadIntersectionCandidates(roads, new TopologyBudget(100), () => callbacks++),
  ).toThrow(/Topology work/);
  expect(callbacks).toBeLessThan(100);
});
