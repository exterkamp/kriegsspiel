import type { Point } from './contract.js';
import { TopologyBudget } from './errors.js';

/** Self-intersection candidates for long paths. Bounds include the caller's
 * exact predicate tolerance; allocation and every index scan are metered. */
export function pathIntersectionCandidates(
  points: Point[],
  budget: TopologyBudget,
  path: string,
  epsilon: number,
  visit: (earlierEnd: number, laterEnd: number) => void,
): void {
  const spacing = 100;
  const cells = new Map<string, number[]>();
  const boxes: [number, number, number, number][] = [];
  for (let end = 1; end < points.length; end++) {
    budget.consume(path, 2);
    const a = points[end - 1]!,
      b = points[end]!;
    const box: [number, number, number, number] = [
      Math.min(a[0], b[0]) - epsilon,
      Math.min(a[1], b[1]) - epsilon,
      Math.max(a[0], b[0]) + epsilon,
      Math.max(a[1], b[1]) + epsilon,
    ];
    const minCol = Math.floor(box[0] / spacing),
      maxCol = Math.floor(box[2] / spacing),
      minRow = Math.floor(box[1] / spacing),
      maxRow = Math.floor(box[3] / spacing);
    budget.consume(path);
    const seen = new Set<number>();
    for (let row = minRow; row <= maxRow; row++)
      for (let col = minCol; col <= maxCol; col++) {
        budget.consume(path);
        for (const other of cells.get(`${col}:${row}`) ?? []) {
          budget.consume(path);
          if (seen.has(other)) continue;
          budget.consume(path);
          seen.add(other);
          if (end - other < 2) continue;
          const previous = boxes[other - 1]!;
          if (
            box[0] > previous[2] ||
            previous[0] > box[2] ||
            box[1] > previous[3] ||
            previous[1] > box[3]
          )
            continue;
          budget.consume(path);
          visit(other, end);
        }
      }
    budget.consume(path);
    boxes.push(box);
    for (let row = minRow; row <= maxRow; row++)
      for (let col = minCol; col <= maxCol; col++) {
        budget.consume(path, 2);
        const key = `${col}:${row}`;
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(end);
      }
  }
}
