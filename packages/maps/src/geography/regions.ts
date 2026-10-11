import type { Elevation, Point, Polygon } from '../contract.js';
import { signedRingArea, ringLocation, validatePolygon } from '../geometry.js';
import { MapValidationError, TopologyBudget } from '../errors.js';
import { decimal6 } from '../terrain/precision.js';
import { Budget, GeographyFailure } from './budget.js';
export interface CellRegion {
  polygon: Polygon;
  cells: number[];
}
/** Exact union of full grid cells, no smoothing or lost dry holes. */
export function cellRegions(
  mask: Uint8Array,
  elevation: Elevation,
  budget: Budget,
  maxVertices: number,
  output?: Budget,
  splitContacts = false,
  origin: Point = [0, 0],
): CellRegion[] {
  const w = elevation.columns - 1,
    h = elevation.rows - 1,
    n = w * h;
  if (mask.length !== n) throw new RangeError('Cell mask size mismatch');
  budget.take(2 * n);
  const seen = new Uint8Array(n),
    queue = new Int32Array(n),
    result: CellRegion[] = [];
  let vertices = 0;
  for (let seed = 0; seed < n; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    seen[seed] = 1;
    const cells: number[] = [];
    while (head < tail) {
      budget.take();
      const i = queue[head++]!,
        x = i % w,
        y = Math.floor(i / w);
      cells.push(i);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        budget.take();
        const nx = x + dx!,
          ny = y + dy!;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    const edges: { a: number; b: number; dir: number }[] = [],
      starts = new Map<number, number[]>(),
      stride = w + 1;
    const add = (ax: number, ay: number, bx: number, by: number, dir: number) => {
      budget.take();
      const a = ay * stride + ax,
        b = by * stride + bx,
        index = edges.length;
      edges.push({ a, b, dir });
      const list = starts.get(a);
      if (list) list.push(index);
      else starts.set(a, [index]);
    };
    for (const i of cells) {
      const x = i % w,
        y = Math.floor(i / w);
      if (y === 0 || !mask[i - w]) add(x, y, x + 1, y, 0);
      if (x === w - 1 || !mask[i + 1]) add(x + 1, y, x + 1, y + 1, 1);
      if (y === h - 1 || !mask[i + w]) add(x + 1, y + 1, x, y + 1, 2);
      if (x === 0 || !mask[i - 1]) add(x, y + 1, x, y, 3);
    }
    const used = new Uint8Array(edges.length),
      rings: Point[][] = [];
    for (let start = 0; start < edges.length; start++) {
      if (used[start]) continue;
      const grid: number[] = [];
      let next = start;
      do {
        budget.take();
        if (used[next])
          throw new GeographyFailure(
            'REGION_TOPOLOGY',
            'cell union',
            'Ambiguous grid-cell boundary.',
          );
        used[next] = 1;
        const e = edges[next]!;
        grid.push(e.a);
        const choices = (starts.get(e.b) ?? []).filter((j) => !used[j] || j === start);
        if (!choices.length) throw new Error('Open cell boundary');
        choices.sort((a, b) => {
          const priority = (j: number) => [1, 0, 3, 2].indexOf((edges[j]!.dir - e.dir + 4) % 4);
          return priority(a) - priority(b) || a - b;
        });
        next = choices[0]!;
      } while (next !== start);
      const ring: Point[] = [];
      for (let j = 0; j < grid.length; j++) {
        const a = grid[(j + grid.length - 1) % grid.length]!,
          b = grid[j]!,
          c = grid[(j + 1) % grid.length]!;
        if (
          (a % stride === b % stride && b % stride === c % stride) ||
          (Math.floor(a / stride) === Math.floor(b / stride) &&
            Math.floor(b / stride) === Math.floor(c / stride))
        )
          continue;
        if (++vertices > maxVertices)
          throw new GeographyFailure(
            'GEOGRAPHY_RESOURCE_LIMIT',
            'region vertices',
            'Region output exceeds vertex limit.',
          );
        output?.take();
        ring.push([
          decimal6(origin[0] + (b % stride) * elevation.spacingM),
          decimal6(origin[1] + Math.floor(b / stride) * elevation.spacingM),
        ]);
      }
      if (ring.length > 2047)
        throw new GeographyFailure(
          'GEOGRAPHY_RESOURCE_LIMIT',
          'ring vertices',
          'Region ring exceeds frozen 2048 vertex cap.',
        );
      if (++vertices > maxVertices)
        throw new GeographyFailure(
          'GEOGRAPHY_RESOURCE_LIMIT',
          'region vertices',
          'Region output exceeds vertex limit.',
        );
      output?.take();
      ring.push(ring[0]!);
      rings.push(ring);
    }
    const outers = rings.filter((r) => signedRingArea(r) > 0),
      holes = rings.filter((r) => signedRingArea(r) < 0);
    if (outers.length !== 1 || holes.length > 64)
      throw new GeographyFailure(
        'REGION_TOPOLOGY',
        'cell union',
        'Region has touching shells or more than 64 holes.',
      );
    const polygon = { outer: outers[0]!, holes };
    const topology = new TopologyBudget(budget.max - budget.used || 1);
    // Charge quadratic ring tests before invoking the frozen topology checker.
    const ringSizes = rings.map((r) => r.length);
    const total = ringSizes.reduce((a, b) => a + b, 0);
    budget.take(total * total + total);
    for (const hole of holes)
      if (ringLocation(hole[0]!, polygon.outer) !== 'inside')
        throw new GeographyFailure('REGION_TOPOLOGY', 'cell union', 'Uncontained dry hole.');
    try {
      validatePolygon(polygon, '$.geography.region', topology);
    } catch (error) {
      if (
        error instanceof MapValidationError &&
        error.issues.every((i) => i.code === 'INVALID_MAP')
      ) {
        if (!splitContacts)
          throw new GeographyFailure(
            'REGION_TOPOLOGY',
            'cell union',
            `Generated cell boundary has a corner contact: ${error.message}`,
          );
        // Exact fallback partition: closed grid rectangles cannot self-touch.
        // This preserves every wet cell and every dry hole/gap in the union.
        budget.take(cells.length * Math.ceil(Math.log2(cells.length + 1)));
        cells.sort((a, b) => a - b);
        for (let j = 0; j < cells.length;) {
          const first = cells[j]!,
            y = Math.floor(first / w),
            x = first % w;
          let end = j + 1;
          while (
            end < cells.length &&
            cells[end] === cells[end - 1]! + 1 &&
            Math.floor(cells[end]! / w) === y
          )
            end++;
          budget.take(5);
          output?.take(5);
          vertices += 5;
          if (vertices > maxVertices)
            throw new GeographyFailure(
              'GEOGRAPHY_RESOURCE_LIMIT',
              'region vertices',
              'Rectangle partition exceeds vertex limit.',
            );
          const x0 = decimal6(origin[0] + x * elevation.spacingM),
            x1 = decimal6(origin[0] + ((cells[end - 1]! % w) + 1) * elevation.spacingM),
            y0 = decimal6(origin[1] + y * elevation.spacingM),
            y1 = decimal6(origin[1] + (y + 1) * elevation.spacingM);
          result.push({
            polygon: {
              outer: [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
              ],
              holes: [],
            },
            cells: cells.slice(j, end),
          });
          j = end;
        }
        continue;
      }
      throw error;
    }
    result.push({ polygon, cells });
  }
  return result;
}
