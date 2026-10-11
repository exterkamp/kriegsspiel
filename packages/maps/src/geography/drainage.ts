import {
  HARD_LIMITS,
  type Bounds,
  type Elevation,
  type GenerationResult,
  type MapSettings,
} from '../contract.js';
import { fail } from '../errors.js';
import { preflightAsset } from '../resources.js';
import { checkField } from '../terrain/input.js';
import { Budget, bounded } from './budget.js';
import type { DrainageOutput, GeographyLimits } from './types.js';

const offsets = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
/** Validates arbitrary receiver graphs; every sample contributes one unit. */
export function accumulateFlow(receivers: number[], maxWork = 10_000_000): number[] {
  preflightAsset(receivers, HARD_LIMITS);
  const n = receivers.length;
  if (n < 1 || n > HARD_LIMITS.maxSamples)
    fail('$.downstream', 'Unsupported receiver count', 'RESOURCE_LIMIT');
  const work = new Budget(maxWork, 'accumulation work');
  work.take(3 * n);
  const degrees = new Uint32Array(n),
    accumulation = new Array<number>(n).fill(1),
    queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = receivers[i]!;
    if (!Number.isInteger(r) || r < -1 || r >= n || r === i)
      fail(`$.downstream[${i}]`, 'Invalid receiver');
    if (r >= 0) degrees[r] = degrees[r]! + 1;
  }
  let tail = 0,
    head = 0;
  for (let i = 0; i < n; i++) if (degrees[i] === 0) queue[tail++] = i;
  while (head < tail) {
    work.take();
    const i = queue[head++]!,
      r = receivers[i]!;
    if (r >= 0) {
      accumulation[r] = accumulation[r]! + accumulation[i]!;
      degrees[r] = degrees[r]! - 1;
      if (degrees[r] === 0) queue[tail++] = r;
    }
  }
  if (head !== n) fail('$.downstream', 'Receiver graph contains a cycle');
  return accumulation;
}
export function streamSamples(accumulation: number[], threshold: number): number[] {
  preflightAsset(accumulation, HARD_LIMITS);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > HARD_LIMITS.maxSamples)
    throw new RangeError('Invalid river threshold');
  if (accumulation.length > HARD_LIMITS.maxSamples)
    fail('$.accumulation', 'Sample limit', 'RESOURCE_LIMIT');
  const indices: number[] = [];
  for (let i = 0; i < accumulation.length; i++) {
    if (
      !Number.isInteger(accumulation[i]) ||
      accumulation[i]! < 1 ||
      accumulation[i]! > accumulation.length
    )
      fail(`$.accumulation[${i}]`, 'Invalid accumulation');
    if (accumulation[i]! >= threshold) indices.push(i);
  }
  return indices;
}
export function deriveDrainage(
  elevation: Elevation,
  bounds: Bounds,
  settings: MapSettings,
  limits: GeographyLimits = {},
): GenerationResult<DrainageOutput> {
  return bounded(() => {
    const s = checkField(elevation, bounds, settings),
      n = elevation.samples.length,
      columns = elevation.columns,
      rows = elevation.rows;
    const budget = new Budget(
      limits.maxFloodWork ?? Math.min(100_000_000, s.limits.maxTopologyChecks * 16),
      'priority-flood work',
    );
    // Reserve fixed buffers and all mandatory scans before allocation.
    budget.take(7 * n);
    const filled = elevation.samples.slice(),
      seen = new Uint8Array(n),
      parent = new Int32Array(n).fill(-1),
      ranks = new Array<number>(n),
      downstream = new Array<number>(n).fill(-1),
      heap = new Int32Array(n),
      outlets: number[] = [];
    let size = 0,
      enqueued = 0,
      popped = 0,
      neighbourChecks = 0;
    const less = (a: number, b: number) => {
      budget.take();
      return filled[a]! < filled[b]! || (filled[a] === filled[b] && a < b);
    };
    const push = (i: number) => {
      budget.take();
      seen[i] = 1;
      enqueued++;
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (!less(i, heap[p]!)) break;
        heap[k] = heap[p]!;
        k = p;
      }
      heap[k] = i;
    };
    const pop = () => {
      budget.take();
      const first = heap[0]!,
        last = heap[--size]!;
      if (size) {
        let k = 0;
        while (k * 2 + 1 < size) {
          let c = k * 2 + 1;
          if (c + 1 < size && less(heap[c + 1]!, heap[c]!)) c++;
          if (!less(heap[c]!, last)) break;
          heap[k] = heap[c]!;
          k = c;
        }
        heap[k] = last;
      }
      return first;
    };
    for (let i = 0; i < n; i++) {
      const x = i % columns,
        y = Math.floor(i / columns);
      if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) {
        outlets.push(i);
        push(i);
      }
    }
    while (size) {
      const i = pop();
      ranks[i] = popped++;
      const x = i % columns,
        y = Math.floor(i / columns);
      for (const [dx, dy] of offsets) {
        budget.take();
        neighbourChecks++;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const j = ny * columns + nx;
        if (seen[j]) continue;
        parent[j] = i;
        filled[j] = Math.max(elevation.samples[j]!, filled[i]!);
        push(j);
      }
    }
    for (let i = 0; i < n; i++) {
      const x = i % columns,
        y = Math.floor(i / columns);
      if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) continue;
      let best = -1,
        slope = 0;
      for (const [dx, dy] of offsets) {
        budget.take();
        const j = (y + dy) * columns + x + dx,
          drop = filled[i]! - filled[j]!;
        if (drop <= 0) continue;
        const g = drop / (elevation.spacingM * Math.hypot(dx, dy));
        if (g > slope || (g === slope && j < best)) {
          slope = g;
          best = j;
        }
      }
      downstream[i] = best < 0 ? parent[i]! : best;
      if (downstream[i]! < 0 || ranks[downstream[i]!]! >= ranks[i]!)
        throw new Error('Non-decreasing flood rank receiver');
    }
    budget.take(4 * n);
    const accumulation = accumulateFlow(downstream, 4 * n);
    return {
      ok: true,
      value: {
        drainage: {
          policy: 'filled-ground-d8-v1',
          filledSamples: filled,
          downstream,
          accumulation,
          outlets,
          sinks: [],
        },
        ranks,
        evidence: { enqueued, popped, neighbourChecks, work: budget.used },
      },
      diagnostics: [],
    };
  });
}
