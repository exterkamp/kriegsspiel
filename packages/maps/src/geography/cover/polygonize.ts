import type { Cover } from '../../contract.js';
import { CoverLimit, CoverWork } from './budget.js';
import type { Lattice } from './mask.js';
import { ordered } from './order.js';

const kinds = ['open', 'wood', 'field'] as const;
interface Run {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  kind: number;
}
/** Exact rectangle partition: merge identical horizontal runs across rows. */
export function polygonize(
  lattice: Lattice,
  classes: Uint8Array,
  work: CoverWork,
  maxFeatures: number,
  maxVertices: number,
): Cover[] {
  const { columns, rows, xs, ys } = lattice;
  work.reserve(columns * rows * 3, 'run polygonization');
  const finished: Run[] = [];
  let active = new Map<string, Run>();
  const finish = (run: Run) => {
    if (finished.length + 1 > maxFeatures || (finished.length + 1) * 5 > maxVertices)
      throw new CoverLimit(
        'cover feature/vertex output',
        `Complete rectangle partition exceeds ${maxFeatures} features or ${maxVertices} vertices; no partial cover returned.`,
      );
    finished.push(run);
  };
  for (let y = 0; y < rows; y++) {
    const next = new Map<string, Run>();
    for (let x = 0; x < columns;) {
      const kind = classes[y * columns + x]!,
        x0 = x;
      while (x < columns && classes[y * columns + x] === kind) x++;
      if (kind === 255) continue;
      const key = `${kind}:${x0}:${x}`,
        previous = active.get(key);
      const run = previous ?? { x0, x1: x, y0: y, y1: y + 1, kind };
      run.y1 = y + 1;
      next.set(key, run);
      active.delete(key);
    }
    for (const run of active.values()) finish(run);
    active = next;
  }
  for (const run of active.values()) finish(run);
  // At most N runs. Reserve a comparison upper bound before deterministic sort.
  work.reserve(
    finished.length * Math.ceil(Math.log2(Math.max(2, finished.length))) * 3,
    'rectangle ordering',
  );
  const sorted = ordered(
    finished,
    (a, b) => a.y0 - b.y0 || a.x0 - b.x0 || a.kind - b.kind || a.y1 - b.y1 || a.x1 - b.x1,
  );
  return sorted.map((r, i) => {
    const x0 = xs[r.x0]!,
      x1 = xs[r.x1]!,
      y0 = ys[r.y0]!,
      y1 = ys[r.y1]!;
    return {
      id: `cover:${String(i).padStart(5, '0')}`,
      kind: kinds[r.kind]!,
      polygons: [
        {
          outer: [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
          ],
          holes: [],
        },
      ],
    };
  });
}
