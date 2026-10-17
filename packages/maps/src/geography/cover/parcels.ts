import { CoverWork } from './budget.js';
import { components, hash01, sq, type Grid } from './raster.js';

/** Unit long-axis direction of a field strip at a cell. */
export type Orientation = (cell: number) => [number, number];
/** Smooth displacement of a cell centre, in cells, so partition edges wander. */
export type Warp = (cell: number) => [number, number];

/** Seeds per parcel window searched in each direction (5 x 5 seeds). */
const PARCEL_WINDOW = 2;

/**
 * Field parcels: an anisotropic Voronoi partition of field cells around
 * jittered seeds, each stretched along its own strip direction (along the
 * contour on slopes, back from the road near roads). Roads split parcels.
 * Pieces smaller than `minCells` join the neighbouring parcel they share the
 * longest edge with. Returns a parcel number per cell (-1 for other cells).
 */
export function fieldParcels(
  grid: Grid,
  field: Uint8Array,
  road: Uint8Array,
  orientation: Orientation,
  warp: Warp,
  seed: number,
  spacingCells: number,
  minCells: number,
  work: CoverWork,
): Int32Array {
  const { columns, rows } = grid,
    count = columns * rows,
    seedColumns = Math.ceil(columns / spacingCells) + 1,
    seedRows = Math.ceil(rows / spacingCells) + 1,
    seeds = seedColumns * seedRows;
  work.reserve(
    seeds * 4 + count * ((2 * PARCEL_WINDOW + 1) * (2 * PARCEL_WINDOW + 1) + 16),
    'cover field parcels',
  );
  const sx = new Float64Array(seeds),
    sy = new Float64Array(seeds),
    tx = new Float64Array(seeds),
    ty = new Float64Array(seeds),
    stretch = new Float64Array(seeds);
  for (let j = 0; j < seedRows; j++)
    for (let i = 0; i < seedColumns; i++) {
      const k = j * seedColumns + i;
      sx[k] = (i + 0.15 + 0.7 * hash01(seed, i, j)) * spacingCells;
      sy[k] = (j + 0.15 + 0.7 * hash01(seed ^ 0x5bd1e995, i, j)) * spacingCells;
      const cx = Math.min(columns - 1, Math.floor(sx[k]!)),
        cy = Math.min(rows - 1, Math.floor(sy[k]!));
      const [ux, uy] = orientation(cy * columns + cx);
      tx[k] = ux;
      ty[k] = uy;
      stretch[k] = 1.3 + 0.5 * hash01(seed ^ 0x1b873593, i, j);
    }
  const parcel = new Int32Array(count).fill(-1);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      if (!field[i]) continue;
      const [wx, wy] = warp(i),
        px = x + 0.5 + wx,
        py = y + 0.5 + wy,
        gi = Math.floor(px / spacingCells),
        gj = Math.floor(py / spacingCells);
      let best = Infinity,
        chosen = -1;
      for (let j = gj - PARCEL_WINDOW; j <= gj + PARCEL_WINDOW; j++)
        for (let k = gi - PARCEL_WINDOW; k <= gi + PARCEL_WINDOW; k++) {
          if (j < 0 || k < 0 || j >= seedRows || k >= seedColumns) continue;
          const s = j * seedColumns + k,
            dx = px - sx[s]!,
            dy = py - sy[s]!,
            along = (dx * tx[s]! + dy * ty[s]!) / stretch[s]!,
            across = (dy * tx[s]! - dx * ty[s]!) * stretch[s]!,
            d = along * along + across * across;
          if (d < best) {
            best = d;
            chosen = s;
          }
        }
      parcel[i] = chosen;
    }
  // Roads are barriers: connect parcels only through road-free cells first.
  const label = new Int32Array(count);
  for (let i = 0; i < count; i++) label[i] = field[i] && !road[i] ? parcel[i]! : -1;
  const { component } = components(grid, label);
  const neighbours = (i: number): number[] => {
    const x = i % columns,
      out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x + 1 < columns) out.push(i + 1);
    if (i >= columns) out.push(i - columns);
    if (i + columns < count) out.push(i + columns);
    return out;
  };
  // Road cells under fields join the adjacent piece with the smallest number.
  for (let pass = 0; pass < 4; pass++)
    for (let i = 0; i < count; i++) {
      if (!field[i] || component[i] !== -1) continue;
      let joined = -1;
      for (const n of neighbours(i))
        if (component[n]! >= 0 && (joined < 0 || component[n]! < joined)) joined = component[n]!;
      component[i] = joined;
    }
  // Isolated road-only field cells keep their own pieces.
  let next = 0;
  for (let i = 0; i < count; i++) next = Math.max(next, component[i]! + 1);
  const rest = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) if (field[i] && component[i] === -1) rest[i] = parcel[i]!;
  const leftover = components(grid, rest).component;
  for (let i = 0; i < count; i++) if (leftover[i]! >= 0) component[i] = next + leftover[i]!;
  // Merge small pieces into the neighbour with the longest shared edge.
  let pieces = 0;
  for (let i = 0; i < count; i++) pieces = Math.max(pieces, component[i]! + 1);
  const size = new Int32Array(pieces);
  for (let i = 0; i < count; i++) if (component[i]! >= 0) size[component[i]!]!++;
  const start = new Int32Array(pieces + 1);
  for (let p = 0; p < pieces; p++) start[p + 1] = start[p]! + size[p]!;
  const cells = new Int32Array(start[pieces]!),
    fill = start.slice(0, pieces);
  for (let i = 0; i < count; i++) if (component[i]! >= 0) cells[fill[component[i]!]!++] = i;
  const owner = Int32Array.from({ length: pieces }, (_, p) => p);
  const find = (p: number): number => {
    while (owner[p] !== p) p = owner[p]!;
    return p;
  };
  const total = Int32Array.from(size);
  for (let p = 0; p < pieces; p++) {
    if (total[find(p)]! >= minCells || find(p) !== p) continue;
    const shared = new Map<number, number>();
    for (let c = start[p]!; c < start[p + 1]!; c++)
      for (const n of neighbours(cells[c]!)) {
        if (component[n]! < 0) continue;
        const q = find(component[n]!);
        if (q !== p) shared.set(q, (shared.get(q) ?? 0) + 1);
      }
    let target = -1,
      longest = 0;
    for (const [q, edges] of shared)
      if (edges > longest || (edges === longest && q < target)) {
        target = q;
        longest = edges;
      }
    if (target < 0) continue;
    owner[p] = target;
    total[target] = total[target]! + total[p]!;
  }
  const out = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) if (component[i]! >= 0) out[i] = find(component[i]!);
  return out;
}

/**
 * Wood and open compartments: nearest jittered seed (isotropic), bounding the
 * size of every wood/open feature so outlines and hole counts stay small.
 */
export function compartments(
  grid: Grid,
  warp: Warp,
  seed: number,
  spacingCells: number,
  work: CoverWork,
): Int32Array {
  const { columns, rows } = grid,
    count = columns * rows,
    seedColumns = Math.ceil(columns / spacingCells) + 1;
  work.reserve(count * 10, 'cover compartments');
  const out = new Int32Array(count);
  const position = (i: number, j: number): [number, number] => [
    (i + 0.2 + 0.6 * hash01(seed, i, j)) * spacingCells,
    (j + 0.2 + 0.6 * hash01(seed ^ 0x68e31da4, i, j)) * spacingCells,
  ];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const [wx, wy] = warp(y * columns + x),
        cx = x + 0.5 + wx,
        cy = y + 0.5 + wy,
        gi = Math.floor(cx / spacingCells),
        gj = Math.floor(cy / spacingCells);
      let best = Infinity,
        chosen = 0;
      for (let j = Math.max(0, gj - 1); j <= gj + 1; j++)
        for (let i = Math.max(0, gi - 1); i <= gi + 1; i++) {
          const [px, py] = position(i, j),
            d = sq(cx - px) + sq(cy - py);
          if (d < best) {
            best = d;
            chosen = j * seedColumns + i;
          }
        }
      out[y * columns + x] = chosen;
    }
  return out;
}
