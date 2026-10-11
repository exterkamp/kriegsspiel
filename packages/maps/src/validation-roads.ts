import type { Point, Road } from './contract.js';
import { TopologyBudget } from './errors.js';
import { boxesMeet, segmentBox, type Box } from './validation-water.js';

interface Segment {
  road: number;
  end: number;
  bounds: Box;
}
/** Conservative segment broad phase; exact intersection authority stays with the caller.
 * Every staged record, cell insertion and candidate scan reserves work first. */
export function roadIntersectionCandidates(
  roads: Road[],
  budget: TopologyBudget,
  visit: (road: number, end: number, otherRoad: number, otherEnd: number) => void,
): void {
  const spacing = 100;
  const cells = new Map<string, number[]>();
  const segments: Segment[] = [];
  const path = '$.layers.roads';
  for (let road = 0; road < roads.length; road++) {
    budget.consume(path);
    const points = roads[road]!.path;
    for (let end = 1; end < points.length; end++) {
      budget.consume(path, 2);
      const bounds = segmentBox(points[end - 1]! as Point, points[end]! as Point);
      const minCol = Math.floor(bounds[0] / spacing),
        maxCol = Math.floor(bounds[2] / spacing);
      const minRow = Math.floor(bounds[1] / spacing),
        maxRow = Math.floor(bounds[3] / spacing);
      budget.consume(path);
      const seen = new Set<number>();
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          budget.consume(path);
          const bucket = cells.get(`${col}:${row}`);
          for (const id of bucket ?? []) {
            budget.consume(path);
            if (seen.has(id)) continue;
            budget.consume(path);
            seen.add(id);
            const other = segments[id]!;
            if (other.road === road || !boxesMeet(bounds, other.bounds)) continue;
            budget.consume(path);
            visit(road, end, other.road, other.end);
          }
        }
      }
      budget.consume(path);
      const id = segments.length;
      segments.push({ road, end, bounds });
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          budget.consume(path, 2);
          const key = `${col}:${row}`;
          let bucket = cells.get(key);
          if (!bucket) {
            bucket = [];
            cells.set(key, bucket);
          }
          bucket.push(id);
        }
      }
    }
  }
}
