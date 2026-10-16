import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Point } from '../src/contract.js';
import { Context } from '../src/planning/context.js';
import { assemble } from '../src/planning/network.js';
import { bounded } from '../src/planning/budget.js';
import { validate } from '../src/planning/validation.js';
import { directionalGrade, type PlanningInput } from '../src/planning/index.js';
import type { Router, Edge } from '../src/planning/router.js';
it('revalidates decimal6 planarized subsegments at the unchanged strict grade tolerance', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = 200;
  s.settlements.villageCount = s.settlements.farmCount = 0;
  s.roads.extraLinks = 0;
  const input: PlanningInput = {
    settings: s,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    seed: 7,
    water: [],
    elevation: {
      columns: 9,
      rows: 9,
      spacingM: 25,
      samples: Array.from({ length: 81 }, (_, i) =>
        Number((0.2 * (i % 9) * 25 + 0.1 * Math.floor(i / 9) * 25).toFixed(6)),
      ),
    },
  };
  const points: Point[] = [
      [50, 50],
      [150, 149.123456],
      [62.34567, 25],
      [62.34567, 175],
    ],
    g = directionalGrade(input, points[0]!, points[1]!);
  if (!g.ok) throw Error('fixture');
  s.roads.maxGrade = g.value + 5e-13;
  const edges: Edge[] = [
    { a: 0, b: 1, cost: 141 },
    { a: 0, b: 2, cost: 28 },
    { a: 2, b: 3, cost: 150 },
  ];
  const router = {
    points,
    terminals: [
      { id: 'a', node: 0 },
      { id: 'b', node: 1 },
      { id: 'c', node: 3 },
    ],
    special: new Map(),
    // Routes record emitted edges so later routes can reuse them (v2 network costs).
    used: new Set<string>(),
    route(start: number, end: number) {
      const queue = [start],
        parent = new Map<number, Edge>();
      for (let i = 0; i < queue.length; i++) {
        const n = queue[i]!;
        if (n === end) {
          const out: Edge[] = [];
          let at = end;
          while (at !== start) {
            const e = parent.get(at)!;
            out.push(e);
            at = e.a === at ? e.b : e.a;
          }
          return out.reverse();
        }
        for (const e of edges) {
          const other = e.a === n ? e.b : e.b === n ? e.a : -1;
          if (other < 0 || other === start || parent.has(other)) continue;
          parent.set(other, e);
          queue.push(other);
        }
      }
      return null;
    },
  } as unknown as Router;
  const c = new Context(input),
    plan = assemble(c, router, [], []);
  expect(plan.roads).toHaveLength(5);
  expect(bounded(() => validate(c, plan))).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'ROAD_CORRIDOR' }],
  });
});
