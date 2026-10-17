import { HARD_LIMITS, type Point, type Polygon } from '../../contract.js';
import { MapValidationError } from '../../errors.js';
import { orientation, signedRingArea, validatePolygon } from '../../geometry.js';
import { CoverLimit, CoverWork, MeteredTopology } from './budget.js';
import { decimal6 } from './input.js';
import { hash01, sq, type Grid } from './raster.js';

const OUTSIDE = -2;

/**
 * Removes diagonal "pinches": a 2x2 block whose diagonal cells share a label
 * that neither other cell has. Afterwards every labelled region's boundary
 * passes each lattice vertex at most once, so its rings are simple and its
 * holes never touch its outer ring. The fix copies the label onto an
 * off-diagonal cell when `allowed`, else copies a neighbour's label onto the
 * pinching cell, else leaves that cell uncovered (-1).
 */
export function removePinches(
  grid: Grid,
  label: Int32Array,
  allowed: (cell: number, label: number) => boolean,
  work: CoverWork,
): void {
  const { columns, rows } = grid,
    blocks = Math.max(0, columns - 1) * Math.max(0, rows - 1);
  const pinch = (a: number, b: number, c: number, d: number): [number, number, number] | null => {
    if (label[a]! >= 0 && label[a] === label[d] && label[b] !== label[a] && label[c] !== label[a])
      return [a, b, c];
    if (label[b]! >= 0 && label[b] === label[c] && label[a] !== label[b] && label[d] !== label[b])
      return [b, a, d];
    return null;
  };
  for (let pass = 0; pass < PINCH_PASSES; pass++) {
    work.reserve(blocks, 'cover pinch repair');
    let changed = false;
    for (let y = 0; y + 1 < rows; y++)
      for (let x = 0; x + 1 < columns; x++) {
        const a = y * columns + x,
          found = pinch(a, a + 1, a + columns, a + columns + 1);
        if (!found) continue;
        const [p, r, s] = found,
          value = label[p]!;
        changed = true;
        if (allowed(r, value)) label[r] = value;
        else if (allowed(s, value)) label[s] = value;
        else if (label[r]! >= 0 && allowed(p, label[r]!)) label[p] = label[r]!;
        else if (label[s]! >= 0 && allowed(p, label[s]!)) label[p] = label[s]!;
        else label[p] = -1;
      }
    if (!changed) return;
  }
  // Fallback: uncover pinching cells until none remain. Each pass that changes
  // anything removes covered cells, so this ends within the covered-cell count.
  for (;;) {
    work.reserve(blocks, 'cover pinch fallback');
    let changed = false;
    for (let y = 0; y + 1 < rows; y++)
      for (let x = 0; x + 1 < columns; x++) {
        const a = y * columns + x,
          found = pinch(a, a + 1, a + columns, a + columns + 1);
        if (!found) continue;
        label[found[0]] = -1;
        changed = true;
      }
    if (!changed) return;
  }
}
export const PINCH_PASSES = 6;

/** Chain smoothing levels: 2 = midpoint + moving average + simplification, 1 = midpoint, 0 = lattice. */
/** Neighbouring outline points averaged on each side of a point (two passes). */
export const SMOOTHING_RADIUS = 2;
type Level = 0 | 1 | 2;
interface Chain {
  vertices: number[];
  closed: boolean;
  left: number;
  right: number;
  level: Level;
  points?: Point[];
}
export interface TraceOptions {
  /** Lattice-step straightening tolerance (about half a cell), metres. */
  straightenM: number;
  /** Point spacing before averaging, metres. */
  spacingM: number;
  /** Simplification tolerance after smoothing, metres. */
  toleranceM: number;
  maxFeatures: number;
  maxVertices: number;
  /** Seed for moving interior land junctions off the lattice. */
  jitterSeed: number;
}
/** Interior land junctions move up to this share of a cell along each axis. */
export const JUNCTION_JITTER = 0.3;
export interface TracedRegion {
  region: number;
  polygon: Polygon;
}
export interface TraceEvidence {
  chains: number;
  demotedChains: number;
}

/**
 * Converts labelled regions into polygons whose shared edges are identical
 * smoothed chains, so neighbouring features never overlap or leave gaps.
 * Chains between two regions are cut at their lattice corners and smoothed;
 * chains against water or uncovered cells only cut the region's own convex
 * corners (cover never grows into a masked cell); map-edge chains stay exact.
 * Each polygon is checked with the frozen validator; a failing region falls
 * back to coarser smoothing on its chains, down to the exact lattice outline.
 */
export function traceRegions(
  grid: Grid,
  xs: number[],
  ys: number[],
  region: Int32Array,
  regionCount: number,
  options: TraceOptions,
  work: CoverWork,
): { regions: TracedRegion[]; evidence: TraceEvidence } {
  const { columns, rows } = grid,
    vColumns = columns + 1,
    horizontal = (rows + 1) * columns,
    edgeCount = horizontal + (columns + 1) * rows;
  work.reserve(4 * edgeCount + 8 * (columns + 1) * (rows + 1), 'cover boundary chains');
  const cell = (i: number, j: number) =>
    i < 0 || j < 0 || i >= columns || j >= rows ? OUTSIDE : region[j * columns + i]!;
  // Sides of an edge in its forward direction (east for horizontal, +y for vertical).
  const sides = (e: number): [number, number] => {
    if (e < horizontal) {
      const j = Math.floor(e / columns),
        i = e % columns;
      return [cell(i, j), cell(i, j - 1)];
    }
    const k = e - horizontal,
      j = Math.floor(k / vColumns),
      i = k % vColumns;
    return [cell(i - 1, j), cell(i, j)];
  };
  const included = (e: number) => {
    const [a, b] = sides(e);
    return a !== b && (a >= 0 || b >= 0);
  };
  const ends = (e: number): [number, number] => {
    if (e < horizontal) {
      const j = Math.floor(e / columns),
        i = e % columns;
      return [j * vColumns + i, j * vColumns + i + 1];
    }
    const k = e - horizontal,
      j = Math.floor(k / vColumns),
      i = k % vColumns;
    return [j * vColumns + i, (j + 1) * vColumns + i];
  };
  const incident = (v: number): number[] => {
    const i = v % vColumns,
      j = Math.floor(v / vColumns),
      out: number[] = [];
    if (i < columns) out.push(j * columns + i); // east
    if (j < rows) out.push(horizontal + j * vColumns + i); // +y
    if (i > 0) out.push(j * columns + i - 1); // west
    if (j > 0) out.push(horizontal + (j - 1) * vColumns + i); // -y
    return out.filter(included);
  };
  const pair = (e: number) => {
    const [a, b] = sides(e);
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  };
  const vertexCount = (columns + 1) * (rows + 1),
    junction = new Uint8Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const edges = incident(v);
    junction[v] = edges.length !== 2 || pair(edges[0]!) !== pair(edges[1]!) ? 1 : 0;
  }
  const visited = new Uint8Array(edgeCount),
    chains: Chain[] = [];
  const walk = (start: number, first: number): Chain => {
    const vertices = [start];
    let v = start,
      e = first;
    const [a, b] = ends(first),
      forward = a === start;
    const [l, r] = sides(first);
    for (;;) {
      visited[e] = 1;
      const [p, q] = ends(e);
      v = p === v ? q : p;
      vertices.push(v);
      if (junction[v] || v === start) break;
      const next = incident(v).find((n) => n !== e);
      if (next === undefined || visited[next]) break;
      e = next;
    }
    void b;
    return {
      vertices,
      closed: v === start && !junction[start],
      left: forward ? l : r,
      right: forward ? r : l,
      level: 2,
    };
  };
  for (let v = 0; v < vertexCount; v++)
    if (junction[v]) for (const e of incident(v)) if (!visited[e]) chains.push(walk(v, e));
  for (let e = 0; e < edgeCount; e++)
    if (!visited[e] && included(e)) chains.push(walk(ends(e)[0], e));
  const at = (v: number): Point => [xs[v % vColumns]!, ys[Math.floor(v / vColumns)]!];
  // Junctions where only land chains meet, away from the map edge, move off the
  // lattice while every chain there is fully smoothed, so straight lattice runs
  // between junctions do not stay axis-aligned.
  const junctionChains: number[][] = [];
  chains.forEach((c, k) => {
    if (c.closed) return;
    for (const v of [c.vertices[0]!, c.vertices.at(-1)!]) (junctionChains[v] ??= []).push(k);
  });
  const land = (c: Chain) => c.left >= 0 && c.right >= 0;
  const movable = (v: number) => {
    const i = v % vColumns,
      j = Math.floor(v / vColumns);
    return (
      i > 0 &&
      j > 0 &&
      i < columns &&
      j < rows &&
      (junctionChains[v] ?? []).every((k) => land(chains[k]!) && chains[k]!.level === 2)
    );
  };
  const endpoint = (v: number): Point => {
    const p = at(v);
    if (!movable(v)) return p;
    const i = v % vColumns,
      j = Math.floor(v / vColumns),
      dx = (xs[i + 1]! - xs[i - 1]!) / 2,
      dy = (ys[j + 1]! - ys[j - 1]!) / 2;
    return [
      p[0] + 2 * JUNCTION_JITTER * dx * (hash01(options.jitterSeed, i, j) - 0.5),
      p[1] + 2 * JUNCTION_JITTER * dy * (hash01(options.jitterSeed ^ 0x2f8a3b1d, i, j) - 0.5),
    ];
  };

  // Per-region chain uses: [chain, reversed].
  const uses: [number, boolean][][] = Array.from({ length: regionCount }, () => []);
  chains.forEach((c, k) => {
    if (c.left >= 0) uses[c.left]!.push([k, false]);
    if (c.right >= 0) uses[c.right]!.push([k, true]);
  });
  const geometry = (c: Chain): Point[] => {
    if (c.points) return c.points;
    const border = c.left === OUTSIDE || c.right === OUTSIDE,
      masked = !border && (c.left < 0 || c.right < 0);
    let raw = c.vertices.map(at);
    if (!c.closed) {
      raw[0] = endpoint(c.vertices[0]!);
      raw[raw.length - 1] = endpoint(c.vertices.at(-1)!);
    }
    let points: Point[];
    if (border || c.level === 0) points = raw;
    else if (masked) {
      // Orient the covered region to the left, then cut only its convex corners.
      const flip = c.left < 0;
      if (flip) raw = raw.slice().reverse();
      points = cutConvex(raw, c.closed);
      if (flip) points.reverse();
    } else {
      points = midpoints(raw, c.closed);
      if (c.level === 2) {
        // Straighten lattice steps into their underlying lines, then round the
        // corners that remain and drop redundant points.
        points = simplify(points, options.straightenM, c.closed);
        points = densify(points, options.spacingM);
        points = average(points, c.closed, SMOOTHING_RADIUS);
        points = simplify(points, options.toleranceM, c.closed);
      }
    }
    work.reserve(points.length * 4, 'cover chain smoothing');
    c.points = clean(points, c.closed);
    return c.points;
  };
  const assemble = (r: number): Point[][] => {
    const list = uses[r]!,
      rings: Point[][] = [],
      byStart = new Map<number, number>();
    list.forEach(([k, reversed], n) => {
      const c = chains[k]!;
      if (!c.closed) byStart.set(reversed ? c.vertices.at(-1)! : c.vertices[0]!, n);
    });
    const used = new Uint8Array(list.length);
    list.forEach(([k, reversed], n) => {
      if (used[n]) return;
      const c = chains[k]!;
      if (c.closed) {
        used[n] = 1;
        const pts = geometry(c);
        rings.push(reversed ? pts.slice().reverse() : pts.slice());
        return;
      }
      const ring: Point[] = [];
      let m = n;
      const startVertex = reversed ? c.vertices.at(-1)! : c.vertices[0]!;
      for (;;) {
        used[m] = 1;
        const [km, rm] = list[m]!,
          cm = chains[km]!,
          pts = geometry(cm),
          ordered = rm ? pts.slice().reverse() : pts;
        for (let t = ring.length ? 1 : 0; t < ordered.length; t++) ring.push(ordered[t]!);
        const end = rm ? cm.vertices[0]! : cm.vertices.at(-1)!;
        if (end === startVertex) break;
        const next = byStart.get(end);
        if (next === undefined || used[next])
          throw new Error(`Cover region ${r} boundary does not close`);
        m = next;
      }
      rings.push(ring);
    });
    return rings;
  };
  const topology = new MeteredTopology(work);
  const build = (r: number): Polygon | 'invalid' => {
    const rings = assemble(r);
    let outer = 0;
    for (let k = 1; k < rings.length; k++)
      if (Math.abs(signedRingArea(rings[k]!)) > Math.abs(signedRingArea(rings[outer]!))) outer = k;
    if (rings.length - 1 > 64)
      throw new CoverLimit('cover holes', `Cover region ${r} has more than 64 holes.`);
    const polygon: Polygon = {
      outer: rings[outer]!,
      holes: rings.filter((_, k) => k !== outer),
    };
    if (
      [polygon.outer, ...polygon.holes].some(
        (ring) => ring.length < 4 || ring.length > HARD_LIMITS.maxRingVertices,
      )
    )
      return 'invalid';
    try {
      validatePolygon(polygon, `$.cover[${r}]`, topology);
    } catch (error) {
      if (error instanceof MapValidationError) return 'invalid';
      throw error;
    }
    return polygon;
  };
  const polygons: (Polygon | undefined)[] = new Array(regionCount);
  let pending = Array.from({ length: regionCount }, (_, r) => r),
    demoted = 0;
  while (pending.length) {
    const retry = new Set<number>();
    for (const r of pending) {
      const result = build(r);
      if (result !== 'invalid') {
        polygons[r] = result;
        continue;
      }
      let lowered = false;
      for (const [k] of uses[r]!) {
        const c = chains[k]!;
        if (c.level > 0) {
          c.level = (c.level - 1) as Level;
          c.points = undefined;
          demoted++;
          lowered = true;
          // Chains sharing its junctions may lose their junction offsets too.
          const touched = c.closed
            ? [k]
            : [
                k,
                ...(junctionChains[c.vertices[0]!] ?? []),
                ...(junctionChains[c.vertices.at(-1)!] ?? []),
              ];
          for (const t of touched) {
            const other = chains[t]!;
            other.points = undefined;
            for (const side of [other.left, other.right]) if (side >= 0) retry.add(side);
          }
        }
      }
      if (!lowered)
        throw new CoverLimit(
          'cover ring vertices',
          `Cover region ${r} cannot be outlined within ${HARD_LIMITS.maxRingVertices} vertices per ring.`,
        );
      retry.add(r);
    }
    pending = [...retry].sort((a, b) => a - b);
  }
  let vertices = 0;
  for (const p of polygons)
    vertices += p!.outer.length + p!.holes.reduce((n, h) => n + h.length, 0);
  if (regionCount > options.maxFeatures || vertices > options.maxVertices)
    throw new CoverLimit(
      'cover feature/vertex output',
      `Cover needs ${regionCount} features and ${vertices} vertices; the stage allows ${options.maxFeatures} and ${options.maxVertices}. No partial cover is returned.`,
    );
  return {
    regions: polygons.map((polygon, r) => ({ region: r, polygon: polygon! })),
    evidence: { chains: chains.length, demotedChains: demoted },
  };
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const turn = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

/** Lattice outline through the midpoints of its unit edges; endpoints of open chains stay. */
function midpoints(raw: Point[], closed: boolean): Point[] {
  if (closed) {
    const out: Point[] = [];
    for (let k = 0; k + 1 < raw.length; k++) out.push(mid(raw[k]!, raw[k + 1]!));
    out.push(out[0]!);
    return out;
  }
  const out: Point[] = [raw[0]!];
  for (let k = 0; k + 1 < raw.length; k++) out.push(mid(raw[k]!, raw[k + 1]!));
  out.push(raw.at(-1)!);
  return out;
}
/** Cuts only left-hand (convex for the region on the left) lattice corners. */
function cutConvex(raw: Point[], closed: boolean): Point[] {
  const n = closed ? raw.length - 1 : raw.length,
    out: Point[] = [];
  const point = (k: number) => raw[closed ? (k + n) % n : k]!;
  for (let k = 0; k < n; k++) {
    if (!closed && (k === 0 || k === n - 1)) {
      out.push(point(k));
      continue;
    }
    const a = point(k - 1),
      b = point(k),
      c = point(k + 1),
      t = turn(a, b, c);
    if (t > 0) out.push(mid(a, b), mid(b, c));
    else out.push(b);
  }
  if (closed) out.push(out[0]!);
  return out;
}
/**
 * Moving-average smoothing over `radius` neighbours, twice; open chains keep
 * their endpoints and shrink the window symmetrically towards them. Straight
 * lattice steps become straight slanted lines; corners round over a few cells.
 */
function average(points: Point[], closed: boolean, radius: number): Point[] {
  let current = points;
  for (let pass = 0; pass < 2; pass++) {
    const n = current.length,
      unique = closed ? n - 1 : n,
      out: Point[] = new Array(n);
    for (let k = 0; k < unique; k++) {
      const r = closed
        ? Math.min(radius, Math.floor((unique - 1) / 2))
        : Math.min(radius, k, n - 1 - k);
      let sx = 0,
        sy = 0;
      for (let t = -r; t <= r; t++) {
        const p = current[closed ? (k + t + unique) % unique : k + t]!;
        sx += p[0];
        sy += p[1];
      }
      out[k] = [sx / (2 * r + 1), sy / (2 * r + 1)];
    }
    if (closed) out[n - 1] = out[0]!;
    current = out;
  }
  return current;
}
/** Inserts points so no segment is longer than `spacing`. */
function densify(points: Point[], spacing: number): Point[] {
  const out: Point[] = [points[0]!];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!,
      b = points[k]!,
      pieces = Math.ceil(Math.sqrt(sq(b[0] - a[0]) + sq(b[1] - a[1])) / spacing);
    for (let t = 1; t < pieces; t++)
      out.push([a[0] + ((b[0] - a[0]) * t) / pieces, a[1] + ((b[1] - a[1]) * t) / pieces]);
    out.push(b);
  }
  return out;
}
/** Iterative Douglas-Peucker keeping both ends; a closed chain keeps its start. */
function simplify(points: Point[], tolerance: number, closed: boolean): Point[] {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  if (closed && n > 3) {
    // Split the loop at its farthest point from the start so both halves are open.
    let far = 1,
      best = -1;
    for (let k = 1; k < n - 1; k++) {
      const d = sq(points[k]![0] - points[0]![0]) + sq(points[k]![1] - points[0]![1]);
      if (d > best) {
        best = d;
        far = k;
      }
    }
    keep[far] = 1;
    stack.length = 0;
    stack.push([0, far], [far, n - 1]);
  }
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue;
    const a = points[s]!,
      b = points[e]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.sqrt(dx * dx + dy * dy);
    let worst = -1,
      at = -1;
    for (let k = s + 1; k < e; k++) {
      const p = points[k]!,
        d = length
          ? Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length
          : Math.sqrt(sq(p[0] - a[0]) + sq(p[1] - a[1]));
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, k) => keep[k]);
}
/** Decimal-6 coordinates without repeated points or exactly collinear interior points. */
function clean(points: Point[], closed: boolean): Point[] {
  const rounded: Point[] = [];
  for (const p of points) {
    const r: Point = [decimal6(p[0]), decimal6(p[1])];
    const last = rounded.at(-1);
    if (!last || last[0] !== r[0] || last[1] !== r[1]) rounded.push(r);
  }
  const out: Point[] = [];
  for (let k = 0; k < rounded.length; k++) {
    const p = rounded[k]!;
    if (k > 0 && k < rounded.length - 1 && out.length) {
      const a = out.at(-1)!,
        c = rounded[k + 1]!;
      if (
        orientation(a, p, c) === 0 &&
        (p[0] - a[0]) * (c[0] - p[0]) + (p[1] - a[1]) * (c[1] - p[1]) > 0
      )
        continue;
    }
    out.push(p);
  }
  void closed;
  return out;
}
