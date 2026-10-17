/** Deterministic raster helpers on the cover lattice (row-major, columns x rows). */

export interface Grid {
  columns: number;
  rows: number;
  /** Nominal cell width and height, metres. */
  cellW: number;
  cellH: number;
}

/**
 * Two-pass 8-neighbour chamfer distance (metres) from source cells, carrying
 * each cell's nearest source index. Ties keep the earlier-visited source, so
 * the result depends only on the grid and sources.
 */
export function chamferDistance(
  grid: Grid,
  isSource: (i: number) => boolean,
): { distance: Float64Array; nearest: Int32Array } {
  const { columns, rows, cellW, cellH } = grid,
    count = columns * rows,
    diagonal = Math.sqrt(cellW * cellW + cellH * cellH);
  const distance = new Float64Array(count).fill(Infinity),
    nearest = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++)
    if (isSource(i)) {
      distance[i] = 0;
      nearest[i] = i;
    }
  const relax = (i: number, n: number, step: number) => {
    const d = distance[n]! + step;
    if (d < distance[i]!) {
      distance[i] = d;
      nearest[i] = nearest[n]!;
    }
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      if (x > 0) relax(i, i - 1, cellW);
      if (y > 0) {
        relax(i, i - columns, cellH);
        if (x > 0) relax(i, i - columns - 1, diagonal);
        if (x + 1 < columns) relax(i, i - columns + 1, diagonal);
      }
    }
  for (let y = rows - 1; y >= 0; y--)
    for (let x = columns - 1; x >= 0; x--) {
      const i = y * columns + x;
      if (x + 1 < columns) relax(i, i + 1, cellW);
      if (y + 1 < rows) {
        relax(i, i + columns, cellH);
        if (x + 1 < columns) relax(i, i + columns + 1, diagonal);
        if (x > 0) relax(i, i + columns - 1, diagonal);
      }
    }
  return { distance, nearest };
}

/** Mean over a (2r+1)^2 window clipped to the grid, via a summed-area table. */
export function boxMean(grid: Grid, values: Float64Array, radius: number): Float64Array {
  const { columns, rows } = grid,
    stride = columns + 1,
    table = new Float64Array(stride * (rows + 1)),
    out = new Float64Array(columns * rows);
  for (let y = 0; y < rows; y++) {
    let row = 0;
    for (let x = 0; x < columns; x++) {
      row += values[y * columns + x]!;
      table[(y + 1) * stride + x + 1] = table[y * stride + x + 1]! + row;
    }
  }
  for (let y = 0; y < rows; y++) {
    const y0 = Math.max(0, y - radius),
      y1 = Math.min(rows, y + radius + 1);
    for (let x = 0; x < columns; x++) {
      const x0 = Math.max(0, x - radius),
        x1 = Math.min(columns, x + radius + 1);
      const sum =
        table[y1 * stride + x1]! -
        table[y0 * stride + x1]! -
        table[y1 * stride + x0]! +
        table[y0 * stride + x0]!;
      out[y * columns + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Four-connected components of cells with equal non-negative labels. Returns a
 * component index per cell (-1 for negative labels) and the component sizes,
 * numbered in row-major order of each component's first cell.
 */
export function components(
  grid: Grid,
  label: Int32Array,
): { component: Int32Array; sizes: number[] } {
  const { columns, rows } = grid,
    count = columns * rows,
    component = new Int32Array(count).fill(-1),
    queue = new Int32Array(count),
    sizes: number[] = [];
  for (let start = 0; start < count; start++) {
    if (label[start]! < 0 || component[start] !== -1) continue;
    const id = sizes.length,
      value = label[start]!;
    let head = 0,
      tail = 0;
    queue[tail++] = start;
    component[start] = id;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % columns;
      const visit = (n: number) => {
        if (component[n] === -1 && label[n] === value) {
          component[n] = id;
          queue[tail++] = n;
        }
      };
      if (x > 0) visit(i - 1);
      if (x + 1 < columns) visit(i + 1);
      if (i >= columns) visit(i - columns);
      if (i + columns < count) visit(i + columns);
    }
    sizes.push(tail);
  }
  return { component, sizes };
}

/** Coordinate hash in [0, 1]; independent per seed, no shared RNG. */
export function hash01(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export const sq = (value: number): number => value * value;
