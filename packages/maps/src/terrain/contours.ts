import {
  type Bounds,
  type Contour,
  type Elevation,
  type GenerationResult,
  type MapSettings,
  type Point,
} from '../contract.js';
import { orientation } from '../geometry.js';
import { bounded, information, TerrainLimit, WorkBudget } from './budgets.js';
import { checkField } from './input.js';
import { validateContourHeights } from './validation.js';
import { decimal6 } from './precision.js';

export const CONTOUR_VERSION = 'bilinear-graph-v1' as const;
interface Node {
  key: string;
  point: Point;
  edges: number[];
}
interface Edge {
  a: Node;
  b: Node;
  path: Point[];
  visited: boolean;
}
interface Cell {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
  spacing: number;
}
interface Endpoint {
  node: Node;
  uv: Point;
}
interface GridEdge {
  key: string;
  row: number;
  col: number;
  horizontal: boolean;
  f0: number;
  f1: number;
}
interface ZeroEdge {
  edge: GridEdge;
  cuts: Map<number, Node>;
}

const sample = (cell: Cell, [u, v]: Point) => cell.a + cell.b * u + cell.c * v + cell.d * u * v;
function chordError(cell: Cell, p: Point, q: Point): number {
  const du = q[0] - p[0],
    dv = q[1] - p[1];
  const constant = sample(cell, p),
    linear = cell.b * du + cell.c * dv + cell.d * (p[0] * dv + p[1] * du),
    quadratic = cell.d * du * dv;
  const root = quadratic ? -linear / (2 * quadratic) : -1;
  return Math.max(
    Math.abs(constant),
    Math.abs(constant + linear + quadratic),
    root > 0 && root < 1 ? Math.abs(constant + linear * root + quadratic * root * root) : 0,
  );
}

/** All-or-nothing isolines on the actual bilinear surface; no terrain RNG. */
export function extractContours(
  elevation: Elevation,
  bounds: Bounds,
  settings: MapSettings,
): GenerationResult<Contour[]> {
  return bounded('contours', () => {
    const s = checkField(elevation, bounds, settings),
      recipe = s.contours;
    const { columns, rows, spacingM, samples } = elevation;
    let min = Infinity,
      max = -Infinity;
    for (const height of samples) {
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
    if (min === max)
      return {
        ok: true,
        value: [],
        diagnostics: [
          information(
            'contours',
            'FLAT_FIELD',
            `Flat ${min} m field has no isolines or plateau interior lines.`,
          ),
        ],
      };
    const integral = (q: number) =>
      Math.abs(q - Math.round(q)) <= 8 * Number.EPSILON * Math.max(1, Math.abs(q))
        ? Math.round(q)
        : q;
    const first = Math.ceil(integral(min / recipe.minorIntervalM)),
      last = Math.floor(integral(max / recipe.minorIntervalM));
    const levels = Math.max(0, last - first + 1);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      !Number.isSafeInteger(levels) ||
      levels > recipe.maxLevels
    )
      throw new TerrainLimit(
        'contours',
        'levels',
        `Contour level count exceeds ${recipe.maxLevels}.`,
      );
    for (let i = 1; i < levels; i++)
      if (
        decimal6((first + i) * recipe.minorIntervalM) ===
        decimal6((first + i - 1) * recipe.minorIntervalM)
      )
        throw new TerrainLimit(
          'contours',
          'level precision',
          'Distinct levels collapse under decimal-6-v1.',
        );
    const cellWork = new WorkBudget(recipe.maxCellLevelWork, 'contours', 'cell-level work');
    cellWork.take((columns - 1) * (rows - 1) * levels); // before any graph allocation
    const refinement = new WorkBudget(recipe.maxRefinementWork, 'contours', 'refinement work');
    const stitching = new WorkBudget(s.limits.maxTopologyChecks, 'contours', 'stitch work');
    const vertices = new WorkBudget(
      Math.min(recipe.maxVertices, s.limits.maxVertices),
      'contours',
      'staged/output vertices',
    );
    const contours: Contour[] = [];
    let emittedVertices = 0;
    for (let ordinal = 0; ordinal < levels; ordinal++) {
      const levelIndex = first + ordinal,
        level = levelIndex * recipe.minorIntervalM;
      const nodes = new Map<string, Node>(),
        edges: Edge[] = [],
        signatures = new Set<string>(),
        zeros = new Map<string, ZeroEdge>();
      const node = (key: string, point: Point): Node => {
        let n = nodes.get(key);
        if (!n) {
          stitching.take();
          n = { key, point, edges: [] };
          nodes.set(key, n);
        }
        return n;
      };
      const gridNode = (x: number, y: number) =>
        node(`p:${y * columns + x}`, [x * spacingM, y * spacingM]);
      const onEdge = (edge: GridEdge, t: number): Node => {
        if (t === 0) return gridNode(edge.col, edge.row);
        if (t === 1)
          return gridNode(edge.col + Number(edge.horizontal), edge.row + Number(!edge.horizontal));
        const key = edge.f0 === 0 && edge.f1 === 0 ? `z:${edge.key}:${t}` : edge.key;
        const n = node(key, [
          (edge.col + (edge.horizontal ? t : 0)) * spacingM,
          (edge.row + (edge.horizontal ? 0 : t)) * spacingM,
        ]);
        if (edge.f0 === 0 && edge.f1 === 0) zero(edge).cuts.set(t, n);
        return n;
      };
      const zero = (edge: GridEdge): ZeroEdge => {
        let z = zeros.get(edge.key);
        if (!z) {
          if ((zeros.size + 1) * 2 > vertices.max)
            throw new TerrainLimit(
              'contours',
              'zero-edge staging',
              'Level-edge staging exceeds the vertex cap.',
            );
          stitching.take();
          z = {
            edge,
            cuts: new Map([
              [0, gridNode(edge.col, edge.row)],
              [
                1,
                gridNode(edge.col + Number(edge.horizontal), edge.row + Number(!edge.horizontal)),
              ],
            ]),
          };
          zeros.set(edge.key, z);
        }
        return z;
      };
      const add = (a: Endpoint, b: Endpoint, cell: Cell): void => {
        if (a.node === b.node) return; // isolated exact-level point, not a path
        const signature =
          a.node.key < b.node.key ? `${a.node.key}|${b.node.key}` : `${b.node.key}|${a.node.key}`;
        if (signatures.has(signature)) return; // shared exact grid edge, first row-major owner
        stitching.take();
        const path: Point[] = [];
        const append = (point: Point) => {
          vertices.take();
          path.push(point);
        };
        append(a.node.point);
        refinement.take(); // reserve the root frame before allocating its stack
        const stack = [{ p: a.uv, q: b.uv, endpoint: b.node.point, depth: 0 }];
        while (stack.length) {
          const segment = stack.pop()!;
          // Leave half the requested tolerance as a numerical/serialization margin.
          if (chordError(cell, segment.p, segment.q) <= recipe.verticalToleranceM / 2) {
            append(segment.endpoint);
            continue;
          }
          if (segment.depth >= 52)
            throw new TerrainLimit(
              'contours',
              'refinement precision',
              'Contour refinement reached binary64 subdivision precision.',
            );
          let u: number, v: number;
          if (Math.abs(segment.q[0] - segment.p[0]) >= Math.abs(segment.q[1] - segment.p[1])) {
            u = (segment.p[0] + segment.q[0]) / 2;
            v = -(cell.a + cell.b * u) / (cell.c + cell.d * u);
          } else {
            v = (segment.p[1] + segment.q[1]) / 2;
            u = -(cell.a + cell.c * v) / (cell.b + cell.d * v);
          }
          if (
            ![u, v].every(Number.isFinite) ||
            u < -1e-12 ||
            u > 1 + 1e-12 ||
            v < -1e-12 ||
            v > 1 + 1e-12
          )
            throw new TerrainLimit(
              'contours',
              'branch precision',
              'Cannot refine the bilinear branch within its cell.',
            );
          refinement.take(2); // reserve both children before midpoint/frame allocation
          const midpoint: Point = [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
          if (
            (midpoint[0] === segment.p[0] && midpoint[1] === segment.p[1]) ||
            (midpoint[0] === segment.q[0] && midpoint[1] === segment.q[1])
          )
            throw new TerrainLimit(
              'contours',
              'refinement precision',
              'Bilinear branch subdivision cannot make numerical progress.',
            );
          const world: Point = [
            (cell.x + midpoint[0]) * cell.spacing,
            (cell.y + midpoint[1]) * cell.spacing,
          ];
          stack.push({
            p: midpoint,
            q: segment.q,
            endpoint: segment.endpoint,
            depth: segment.depth + 1,
          });
          stack.push({ p: segment.p, q: midpoint, endpoint: world, depth: segment.depth + 1 });
        }
        const id = edges.length;
        edges.push({ a: a.node, b: b.node, path, visited: false });
        a.node.edges.push(id);
        b.node.edges.push(id);
        signatures.add(signature);
      };
      for (let y = 0; y < rows - 1; y++)
        for (let x = 0; x < columns - 1; x++) {
          const offset = y * columns + x;
          const a = samples[offset]! - level,
            b = samples[offset + 1]! - level,
            c = samples[offset + columns]! - level,
            d = samples[offset + columns + 1]! - level;
          if (
            (a > 0 && b > 0 && c > 0 && d > 0) ||
            (a < 0 && b < 0 && c < 0 && d < 0) ||
            (a === 0 && b === 0 && c === 0 && d === 0)
          )
            continue;
          const cell: Cell = { a, b: b - a, c: c - a, d: d - b - (c - a), x, y, spacing: spacingM };
          const gridEdges: GridEdge[] = [
            { key: `h:${y}:${x}`, row: y, col: x, horizontal: true, f0: a, f1: b },
            { key: `v:${y}:${x + 1}`, row: y, col: x + 1, horizontal: false, f0: b, f1: d },
            { key: `h:${y + 1}:${x}`, row: y + 1, col: x, horizontal: true, f0: c, f1: d },
            { key: `v:${y}:${x}`, row: y, col: x, horizontal: false, f0: a, f1: c },
          ]; // N,E,S,W; horizontal edges always west→east, vertical north→south
          let hasZeroEdge = false;
          for (const edge of gridEdges)
            if (edge.f0 === 0 && edge.f1 === 0) {
              zero(edge);
              hasZeroEdge = true;
            }
          const endpoint = (side: number, t: number): Endpoint => ({
            node: onEdge(gridEdges[side]!, t),
            uv: side === 0 ? [t, 0] : side === 1 ? [1, t] : side === 2 ? [t, 1] : [0, t],
          });
          const qSign = orientation([0, 0], [a, b], [c, d]);
          if (cell.d !== 0 && qSign === 0) {
            // Exact factorization D(u-us)(v-vs). Preserve four branches and
            // boundary T-junctions; defer zero edges until every cut is known.
            const us = -cell.c / cell.d,
              vs = -cell.b / cell.d;
            const ui = us > 0 && us < 1,
              vi = vs > 0 && vs < 1;
            const centre: Endpoint | undefined =
              ui && vi
                ? {
                    node: node(`s:${y}:${x}`, [(x + us) * spacingM, (y + vs) * spacingM]),
                    uv: [us, vs],
                  }
                : undefined;
            if (ui) {
              const n = endpoint(0, us),
                south = endpoint(2, us);
              if (centre) {
                add(n, centre, cell);
                add(centre, south, cell);
              } else add(n, south, cell);
            }
            if (vi) {
              const west = endpoint(3, vs),
                east = endpoint(1, vs);
              if (centre) {
                add(west, centre, cell);
                add(centre, east, cell);
              } else add(west, east, cell);
            }
            continue;
          }
          if (hasZeroEdge) continue; // linear level edge: already deferred
          const hits: { side: number; point: Endpoint }[] = [];
          for (let side = 0; side < 4; side++) {
            const edge = gridEdges[side]!;
            if (edge.f0 >= 0 === edge.f1 >= 0) continue; // symbolic-positive classification
            hits.push({ side, point: endpoint(side, edge.f0 / (edge.f0 - edge.f1)) });
          }
          if (hits.length === 2) add(hits[0]!.point, hits[1]!.point, cell);
          else if (hits.length === 4) {
            const at = (side: number) => hits.find((h) => h.side === side)!.point;
            if (qSign < 0) {
              add(at(0), at(3), cell);
              add(at(2), at(1), cell);
            } else {
              add(at(0), at(1), cell);
              add(at(3), at(2), cell);
            }
          }
        }
      for (const z of zeros.values()) {
        stitching.take(z.cuts.size * Math.ceil(Math.log2(z.cuts.size + 1)));
        const cuts = [...z.cuts].sort(([a], [b]) => a - b);
        for (let i = 1; i < cuts.length; i++) {
          const [t0, n0] = cuts[i - 1]!,
            [t1, n1] = cuts[i]!;
          add(
            { node: n0, uv: [t0, 0] },
            { node: n1, uv: [t1, 0] },
            { a: 0, b: 0, c: 0, d: 0, x: 0, y: 0, spacing: spacingM },
          );
        }
      }
      const emit = (start: Node, firstEdge: number) => {
        if (contours.length >= s.limits.maxFeatures)
          throw new TerrainLimit(
            'contours',
            'contour features',
            'Contour path count exceeds the feature cap.',
          );
        const path: Point[] = [];
        let current = start,
          next = firstEdge;
        while (true) {
          stitching.take();
          const edge = edges[next]!;
          if (edge.visited) break;
          edge.visited = true;
          const forward = edge.a === current;
          const count = edge.path.length - Number(path.length > 0);
          if (count > vertices.max - emittedVertices)
            throw new TerrainLimit(
              'contours',
              'output vertices',
              'Stitched contour output exceeds the vertex cap.',
            );
          for (let j = path.length ? 1 : 0; j < edge.path.length; j++) {
            const raw = edge.path[forward ? j : edge.path.length - 1 - j]!;
            const point: Point = [decimal6(raw[0]), decimal6(raw[1])];
            if (point[0] > bounds.maxX || point[1] > bounds.maxY)
              throw new TerrainLimit(
                'contours',
                'coordinate precision',
                'Rounded contour coordinates leave the exact bounds.',
              );
            const previous = path.at(-1);
            if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
              path.push(point);
              emittedVertices++;
            }
          }
          current = forward ? edge.b : edge.a;
          if (current === start || current.edges.length !== 2) break; // saddle is a junction, not an arbitrary continuation
          next = current.edges[0] === next ? current.edges[1]! : current.edges[0]!;
        }
        const closed = path[0]?.[0] === path.at(-1)?.[0] && path[0]?.[1] === path.at(-1)?.[1];
        if (path.length < 2 || (closed && path.length < 4))
          throw new TerrainLimit(
            'contours',
            'coordinate precision',
            'Contour path collapses under decimal-6-v1.',
          );
        const indexRatio = level / recipe.indexIntervalM;
        contours.push({
          id: `contour:l${ordinal}:p${contours.length}`,
          elevationM: decimal6(level),
          index:
            Math.abs(indexRatio - Math.round(indexRatio)) <=
            8 * Number.EPSILON * Math.max(1, Math.abs(indexRatio)),
          path,
        });
      };
      // Discovery order is defined by level,row,column,N/E/S/W, edge insertion.
      // Open endpoints and true junctions first, remaining degree-2 loops last.
      for (const n of nodes.values())
        if (n.edges.length !== 2) for (const id of n.edges) if (!edges[id]!.visited) emit(n, id);
      for (let id = 0; id < edges.length; id++) if (!edges[id]!.visited) emit(edges[id]!.a, id);
    }
    const certification = validateContourHeights(elevation, bounds, contours, s);
    if (!certification.ok) return certification;
    return {
      ok: true,
      value: contours,
      diagnostics: [
        information(
          'contours',
          'CONTOURS_GENERATED',
          `${contours.length} paths, ${emittedVertices} vertices; ${cellWork.used} cell-level, ${refinement.used} refinement, ${stitching.used} stitch work; max height error ${certification.value.maxErrorM} m; ${CONTOUR_VERSION}.`,
        ),
      ],
    };
  });
}
