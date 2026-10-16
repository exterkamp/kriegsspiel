import clipping, { type MultiPolygon as ClipMultiPolygon, type Ring } from 'polygon-clipping';
import type {
  Bounds,
  Drainage,
  Elevation,
  MapSettings,
  Point,
  Polygon,
  Water,
} from '../contract.js';
import { MapValidationError, TopologyBudget } from '../errors.js';
import { polygonArea, pointSegmentDistance, validatePolygon } from '../geometry.js';
import { decimal6 } from '../terrain/precision.js';
import { deriveSeed } from '../overrides.js';
import { Budget, GeographyFailure } from './budget.js';
import { GEOGRAPHY_VERSION } from './types.js';
import { gradeShoulders, shoulderPolicy } from './shoulders.js';
import type { WaterConstruction } from './water.js';
import { routeFlowlines, smoothPath } from './flowlines.js';

/**
 * Frozen `stepped-network-v2` river policy. A drainage network, not a single
 * trunk: every emitted stream starts at a channel head on higher ground, follows
 * the D8 valley floor and ends at the boundary or at a larger stream. Each
 * stream is split into reaches; every reach is a constant standing surface
 * (`standing-water-v1`), and reach levels never rise downstream, so the river
 * descends in short steps instead of sitting at one map-wide backwater stage.
 */
export const RIVER_NETWORK = Object.freeze({
  /** Channel heads need this share of the largest catchment (and the recorded threshold). */
  sourceFraction: 0.03,
  /** Emitted streams must reach this share of the largest catchment at their mouth. */
  tributaryFraction: 0.12,
  maxStreams: 8,
  minStreamSamples: 6,
  /** A reach ends after this much valley-floor fall or this many samples. */
  reachDropM: 3,
  reachMaxSamples: 28,
  /** Douglas-Peucker tolerance in sample spacings; keeps long straight bank runs. */
  simplifyCells: 0.6,
  /** Douglas-Peucker tolerance for reach outlines; carving covers it. */
  outlineToleranceM: 0.75,
  /**
   * Joins and round ends are chords inscribed in the true buffer circle, so
   * inside the buffer, each within this distance of the arc.
   */
  joinToleranceM: 0.25,
  /**
   * Rivers at least this share of the maximum width (and a road corridor wide)
   * get the full guaranteed approach band; narrower brooks get one sample, so
   * they sit in natural valleys instead of graded trenches.
   */
  wideShare: 0.5,
  brookBandSteps: 1,
  /**
   * Reaches whose valley floor falls less than this grade meander: a lateral
   * offset of parabolic half-waves (wavelength in channel widths, amplitude
   * up to `meanderAmplitude` widths) vanishing at both reach ends.
   */
  meanderMaxSlope: 0.006,
  meanderWavelength: 11,
  meanderAmplitude: 0.9,
  meanderStepsPerHalfWave: 5,
  /** Channel bed below the reach surface, from narrow brooks to the widest river. */
  bedDepthM: [0.5, 2] as const,
  /** Euclidean shoulder caps reach this many samples beyond the gentle band. */
  steepSeedCells: 8,
});

interface Stream {
  nodes: number[];
  /** Index of the receiving stream (lower index), or -1 at the boundary. */
  parent: number;
  mouthAccumulation: number;
}
interface Reach {
  stream: number;
  nodes: number[];
  path: Point[];
  widthM: number;
  levelM: number;
  bedM: number;
  /** Guaranteed shoulder band in samples: full for road-width rivers, narrow for brooks. */
  bandSteps: number;
}

function simplify(points: Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1,
      far = tolerance;
    for (let i = a + 1; i < b; i++) {
      const dist = pointSegmentDistance(points[i]!, points[a]!, points[b]!);
      if (dist > far) {
        far = dist;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Deterministic meanders on flat valley floors. Arc length along the simplified
 * path is split into an integral number of half-waves; each half-wave offsets
 * the channel sideways by a parabola `4t(1-t)`, alternating sides, so the path
 * keeps its endpoints (and therefore its junctions) and needs no trigonometry.
 */
function meander(
  path: Point[],
  width: number,
  slope: number,
  side: number,
  bounds: Bounds,
): Point[] {
  const p = RIVER_NETWORK;
  if (slope >= p.meanderMaxSlope || path.length < 2) return path;
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(
      lengths[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]),
    );
  const total = lengths.at(-1)!,
    halves = Math.floor(total / ((p.meanderWavelength * width) / 2));
  if (halves < 1) return path;
  const amplitude = p.meanderAmplitude * width * (1 - slope / p.meanderMaxSlope),
    steps = halves * p.meanderStepsPerHalfWave,
    result: Point[] = [path[0]!];
  let segment = 1;
  for (let k = 1; k < steps; k++) {
    const at = (total * k) / steps;
    while (segment < path.length - 1 && lengths[segment]! < at) segment++;
    const a = path[segment - 1]!,
      b = path[segment]!,
      span = lengths[segment]! - lengths[segment - 1]!,
      u = span ? (at - lengths[segment - 1]!) / span : 0,
      nx = -(b[1] - a[1]) / (span || 1),
      ny = (b[0] - a[0]) / (span || 1),
      wave = k / p.meanderStepsPerHalfWave,
      half = Math.floor(wave),
      t = wave - half,
      offset = side * (half % 2 ? -1 : 1) * amplitude * 4 * t * (1 - t);
    result.push([
      Math.min(bounds.maxX, Math.max(bounds.minX, a[0] + (b[0] - a[0]) * u + nx * offset)),
      Math.min(bounds.maxY, Math.max(bounds.minY, a[1] + (b[1] - a[1]) * u + ny * offset)),
    ]);
  }
  result.push(path.at(-1)!);
  return result;
}

/** Union of segment rectangles and inscribed join polygons: a subset of the true buffer. */
function buffer(path: Point[], radius: number): ClipMultiPolygon {
  const parts: ClipMultiPolygon = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!,
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      nx = (-(b[1] - a[1]) / length) * radius,
      ny = ((b[0] - a[0]) / length) * radius;
    parts.push([
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
        [a[0] + nx, a[1] + ny],
      ],
    ]);
  }
  // Joins and caps are fans of chords inscribed in the true round join,
  // oriented by the path itself: v2 used fixed octagons, whose edges all ran
  // at 0, 45, 90 or 135 degrees and showed as notches on every outer bend.
  const fan = (p: Point, from: Point, to: Point, ring: Ring) => {
    // Bisect the arc from unit vector `from` to `to` (under 180 degrees)
    // until each chord lies within the join tolerance of the circle.
    const half = Math.hypot(from[0] + to[0], from[1] + to[1]) / 2;
    if (radius * (1 - half) > RIVER_NETWORK.joinToleranceM && half > 1e-9) {
      const mid: Point = [(from[0] + to[0]) / (2 * half), (from[1] + to[1]) / (2 * half)];
      fan(p, from, mid, ring);
      fan(p, mid, to, ring);
      return;
    }
    ring.push([p[0] + radius * to[0], p[1] + radius * to[1]]);
  };
  const unitDirection = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  const wedge = (p: Point, arcs: [Point, Point][]) => {
    const start: Point = arcs[0]![0],
      ring: Ring = [p, [p[0] + radius * start[0], p[1] + radius * start[1]]];
    for (const [from, to] of arcs) fan(p, from, to, ring);
    ring.push(p);
    parts.push([ring]);
  };
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (i === 0 || i === path.length - 1) {
      // Round cap: a half disc ahead of the end, as two quarter fans.
      const u = i === 0 ? unitDirection(path[1]!, path[0]!) : unitDirection(path[i - 1]!, path[i]!),
        left: Point = [-u[1], u[0]],
        right: Point = [u[1], -u[0]];
      wedge(p, [
        [left, u],
        [u, right],
      ]);
      continue;
    }
    const u1 = unitDirection(path[i - 1]!, p),
      u2 = unitDirection(p, path[i + 1]!),
      cross = u1[0] * u2[1] - u1[1] * u2[0],
      dot = u1[0] * u2[0] + u1[1] * u2[1];
    // The outer side of the bend: right of the path when it turns left.
    const side = cross > 0 ? -1 : 1,
      n1: Point = [-side * u1[1], side * u1[0]],
      n2: Point = [-side * u2[1], side * u2[0]];
    if (radius * Math.hypot(n1[0] - n2[0], n1[1] - n2[1]) < 1e-3) continue;
    if (dot > -0.5) wedge(p, [[n1, n2]]);
    else {
      // Sharp turn: go round through the bisector of the reversed directions.
      const bx = u1[0] - u2[0],
        by = u1[1] - u2[1],
        bl = Math.hypot(bx, by),
        mid: Point = [bx / bl, by / bl];
      wedge(p, [
        [n1, mid],
        [mid, n2],
      ]);
    }
  }
  return clip(() => clipping.union(parts[0]!, ...parts.slice(1)));
}
/** polygon-clipping signals numerically degenerate input with plain errors. */
function clip(run: () => ClipMultiPolygon): ClipMultiPolygon {
  try {
    return run();
  } catch (e) {
    if (e instanceof GeographyFailure) throw e;
    throw new GeographyFailure('RIVER_GEOMETRY', 'reach polygon', String(e).slice(0, 200));
  }
}

/** Decimal6 rings with duplicate and collinear vertices removed, then strictly validated. */
function toPolygons(geometry: ClipMultiPolygon, minimumArea: number, path: string): Polygon[] {
  const result: Polygon[] = [];
  for (const raw of geometry) {
    const rings: Point[][] = [];
    for (const ring of raw) {
      let points: Point[] = ring.map((p) => [decimal6(p[0]), decimal6(p[1])]);
      points = points.filter(
        (p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
      );
      if (
        points.length &&
        (points[0]![0] !== points.at(-1)![0] || points[0]![1] !== points.at(-1)![1])
      )
        points.push(points[0]!);
      for (let changed = true; changed && points.length > 4;) {
        changed = false;
        for (let i = 1; i < points.length - 1; i++) {
          const a = points[i - 1]!,
            b = points[i]!,
            c = points[i + 1]!;
          if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) === 0) {
            points.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      rings.push(points);
    }
    if (rings[0]!.length < 4) continue;
    const polygon: Polygon = {
      outer: rings[0]!,
      holes: rings.slice(1).filter((r) => r.length >= 4),
    };
    if (polygonArea(polygon) < minimumArea) continue;
    // Outline simplification moves edges at most the tolerance outside the
    // buffer, which the carving margin covers; keep the exact outline if the
    // simplified one is not a valid simple polygon.
    const simple = (ring: Point[]) => {
      const kept = simplify(ring, RIVER_NETWORK.outlineToleranceM);
      return kept.length >= 4 ? kept : ring;
    };
    const reduced: Polygon = { outer: simple(polygon.outer), holes: polygon.holes.map(simple) };
    try {
      validatePolygon(reduced, path, new TopologyBudget(10_000_000));
      result.push(reduced);
    } catch (e) {
      if (!(e instanceof MapValidationError)) throw e;
      validatePolygon(polygon, path, new TopologyBudget(10_000_000));
      result.push(polygon);
    }
  }
  return result;
}

/**
 * Select, carve and represent a stepped river network on drained ground.
 * Returns undefined when no stream qualifies; geometric failures of a tributary
 * drop that tributary (and streams feeding it) rather than inventing water.
 */
export function carveRiverNetwork(
  elevation: Elevation,
  bounds: Bounds,
  drainage: Drainage,
  ranks: number[],
  s: MapSettings,
  seed: number,
  budget: Budget,
  output?: Budget,
): WaterConstruction | undefined {
  const n = elevation.samples.length,
    c = elevation.columns,
    rows = elevation.rows,
    d = elevation.spacingM,
    ground = elevation.samples,
    { accumulation: acc, downstream: down } = routeFlowlines(drainage, ranks, c, rows, budget);
  let minimum = Infinity,
    maximum = -Infinity,
    largest = 0;
  for (let i = 0; i < n; i++) {
    minimum = Math.min(minimum, ground[i]!);
    maximum = Math.max(maximum, ground[i]!);
    largest = Math.max(largest, acc[i]!);
  }
  if (maximum - minimum <= 1e-6) return;
  const threshold = s.hydrology.riverThresholdSamples,
    source = Math.max(threshold, Math.ceil(RIVER_NETWORK.sourceFraction * largest)),
    mouth = Math.max(source, Math.ceil(RIVER_NETWORK.tributaryFraction * largest));
  if (largest < mouth) return;
  budget.take(4 * n);
  // Main-stem decomposition: the largest channel donor continues a stream.
  const channel = new Uint8Array(n),
    main = new Int32Array(n).fill(-1),
    donors = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (acc[i]! >= source) channel[i] = 1;
  for (let i = 0; i < n; i++) {
    const r = down[i]!;
    if (!channel[i] || r < 0 || !channel[r]) continue;
    donors[r] = 1;
    const m = main[r]!;
    if (m < 0 || acc[i]! > acc[m]! || (acc[i] === acc[m] && i < m)) main[r] = i;
  }
  const candidates: { nodes: number[]; end: number; mouthAccumulation: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!channel[i] || donors[i]) continue;
    const nodes = [i];
    let cur = i,
      end = -1;
    for (;;) {
      budget.take();
      const r = down[cur]!;
      if (r < 0) break;
      if (main[r] !== cur) {
        end = r;
        break;
      }
      nodes.push(r);
      cur = r;
    }
    const mouthAccumulation = acc[nodes.at(-1)!]!;
    if (mouthAccumulation >= mouth && nodes.length >= RIVER_NETWORK.minStreamSamples)
      candidates.push({ nodes, end, mouthAccumulation });
  }
  candidates.sort((a, b) => b.mouthAccumulation - a.mouthAccumulation || a.nodes[0]! - b.nodes[0]!);
  // Streams join only larger, already accepted streams, so the set stays closed downstream.
  const owner = new Int32Array(n).fill(-1),
    streams: Stream[] = [];
  for (const cand of candidates) {
    if (streams.length >= RIVER_NETWORK.maxStreams) break;
    const parent = cand.end < 0 ? -1 : owner[cand.end]!;
    if (cand.end >= 0 && parent < 0) continue;
    const id = streams.length;
    streams.push({
      nodes: cand.end >= 0 ? [...cand.nodes, cand.end] : cand.nodes,
      parent,
      mouthAccumulation: cand.mouthAccumulation,
    });
    for (const node of cand.nodes) owner[node] = id;
  }
  if (!streams.length) return;
  // Junction nodes split their receiving stream so levels can step at confluences.
  const junction = new Uint8Array(n);
  for (const st of streams) if (st.parent >= 0) junction[st.nodes.at(-1)!] = 1;
  const policy = shoulderPolicy(s),
    span = Math.max(1, largest - source),
    minW = s.hydrology.minRiverWidthM,
    maxW = Math.max(minW, s.hydrology.maxRiverWidthM);
  // Brooks narrower than a road corridor get only an abutment-sized graded
  // band; a full road-approach floodplain would read as an artificial trench.
  const narrowBand = Math.min(policy.guaranteedBandSteps, RIVER_NETWORK.brookBandSteps),
    wideWidth = Math.max(s.roads.maxReservedWidthM, RIVER_NETWORK.wideShare * maxW);
  const offset = (bandSteps: number) => 1 + bandSteps * d * policy.axisGradeCap;
  // Smoothed centrelines per stream, ends pinned; a tributary ends on its
  // parent's smoothed centreline, so reaches still meet exactly.
  const centres: Point[][] = [];
  for (const st of streams) {
    const points = st.nodes.map((k): Point => [(k % c) * d, Math.floor(k / c) * d]);
    if (st.parent >= 0)
      points[points.length - 1] =
        centres[st.parent]![streams[st.parent]!.nodes.indexOf(st.nodes.at(-1)!)]!;
    centres.push(smoothPath(points));
  }
  const reaches: Reach[] = [];
  for (const [id, st] of streams.entries()) {
    let start = 0;
    for (let i = 1; i < st.nodes.length; i++) {
      const last = i === st.nodes.length - 1;
      if (
        last ||
        (junction[st.nodes[i]!] && owner[st.nodes[i]!] === id) ||
        ground[st.nodes[start]!]! - ground[st.nodes[i]!]! >= RIVER_NETWORK.reachDropM ||
        i - start >= RIVER_NETWORK.reachMaxSamples
      ) {
        const nodes = st.nodes.slice(start, i + 1),
          own = owner[nodes.at(-1)!] === id ? nodes.at(-1)! : nodes.at(-2)!,
          share = Math.min(1, Math.max(0, (acc[own]! - source) / span)),
          widthM = decimal6(minW + (maxW - minW) * Math.sqrt(share));
        const points = centres[id]!.slice(start, i + 1),
          run = Math.max(d, (nodes.length - 1) * d),
          fall = ground[nodes[0]!]! - ground[nodes.at(-1)!]!,
          side =
            deriveSeed(seed, `hydrology:${GEOGRAPHY_VERSION}`, `meander:${nodes[0]}`) % 2 ? 1 : -1;
        reaches.push({
          stream: id,
          nodes,
          path: meander(
            simplify(points, RIVER_NETWORK.simplifyCells * d),
            widthM,
            Math.max(0, fall / run),
            side,
            bounds,
          ),
          widthM,
          levelM: 0,
          bedM: 0,
          bandSteps: widthM >= wideWidth ? policy.guaranteedBandSteps : narrowBand,
        });
        start = i;
      }
    }
  }
  // Level: lowest ground within the guaranteed band minus the shoulder offset,
  // then never above any reach that drains into it (upstream reaches first).
  for (const reach of reaches) {
    const radius =
      Math.ceil((reach.widthM / 2 + RIVER_NETWORK.meanderAmplitude * reach.widthM) / d) +
      1 +
      reach.bandSteps;
    budget.take(reach.nodes.length * (2 * radius + 1) ** 2);
    let low = Infinity;
    for (const k of reach.nodes) {
      const x = k % c,
        y = Math.floor(k / c);
      for (let yy = Math.max(0, y - radius); yy <= Math.min(rows - 1, y + radius); yy++)
        for (let xx = Math.max(0, x - radius); xx <= Math.min(c - 1, x + radius); xx++)
          low = Math.min(low, ground[yy * c + xx]!);
    }
    reach.levelM = low - offset(reach.bandSteps);
  }
  const order = reaches
    .map((_, i) => i)
    .sort((a, b) => ranks[reaches[b]!.nodes[0]!]! - ranks[reaches[a]!.nodes[0]!]! || a - b);
  const byStart = new Map<number, number[]>();
  for (const [i, r] of reaches.entries()) {
    const list = byStart.get(r.nodes[0]!) ?? [];
    list.push(i);
    byStart.set(r.nodes[0]!, list);
  }
  for (const i of order) {
    const r = reaches[i]!;
    r.levelM = decimal6(r.levelM);
    if (r.levelM < -100_000)
      throw new GeographyFailure(
        'HEIGHT_RANGE',
        'carved ground',
        'Carving exceeds supported elevation range.',
      );
    for (const j of byStart.get(r.nodes.at(-1)!) ?? [])
      reaches[j]!.levelM = Math.min(reaches[j]!.levelM, r.levelM);
    const t = (r.widthM - minW) / Math.max(1e-9, maxW - minW);
    r.bedM = decimal6(
      r.levelM -
        (RIVER_NETWORK.bedDepthM[0] +
          (RIVER_NETWORK.bedDepthM[1] - RIVER_NETWORK.bedDepthM[0]) * t),
    );
  }
  // Polygons: complete buffers clipped to bounds; earlier (larger, lower) water
  // owns any overlap, so features never overlap and tributaries end at banks.
  const box: ClipMultiPolygon = [
    [
      [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.minY],
        [bounds.maxX, bounds.maxY],
        [bounds.minX, bounds.maxY],
        [bounds.minX, bounds.minY],
      ],
    ],
  ];
  const dropped = new Set<number>(),
    shapes = new Map<number, Polygon[]>();
  // Claimed water, kept per reach with its box so each difference only sees neighbours.
  const claimed: { geometry: ClipMultiPolygon; box: [number, number, number, number] }[] = [];
  const geometryBox = (g: ClipMultiPolygon): [number, number, number, number] => {
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of g)
      for (const [x, y] of polygon[0]!) {
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], y);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], y);
      }
    return b;
  };
  const reachOrder = reaches
    .map((_, i) => i)
    .sort((a, b) => reaches[a]!.stream - reaches[b]!.stream || b - a);
  for (const i of reachOrder) {
    const r = reaches[i]!;
    if (
      dropped.has(r.stream) ||
      (streams[r.stream]!.parent >= 0 && dropped.has(streams[r.stream]!.parent))
    ) {
      dropped.add(r.stream);
      continue;
    }
    budget.take(64 * r.path.length * 16);
    try {
      let geometry = clip(() => clipping.intersection(buffer(r.path, r.widthM / 2), box));
      const own = geometryBox(geometry),
        neighbours = claimed
          .filter(
            (c) =>
              c.box[0] <= own[2] && own[0] <= c.box[2] && c.box[1] <= own[3] && own[1] <= c.box[3],
          )
          .map((c) => c.geometry);
      if (neighbours.length) geometry = clip(() => clipping.difference(geometry, ...neighbours));
      const polygons = toPolygons(geometry, (r.widthM * d) / 4, `$.water.reach[${i}]`);
      if (!polygons.length) throw new GeographyFailure('RIVER_GEOMETRY', 'reach', 'Empty reach.');
      shapes.set(i, polygons);
      if (geometry.length) claimed.push({ geometry, box: geometryBox(geometry) });
    } catch (e) {
      if (!(e instanceof GeographyFailure) && !(e instanceof MapValidationError)) throw e;
      if (r.stream === 0) return;
      dropped.add(r.stream);
    }
  }
  const kept = reaches
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        !dropped.has(r.stream) &&
        !(streams[r.stream]!.parent >= 0 && dropped.has(streams[r.stream]!.parent)),
    );
  // Carve: every cell whose centre lies within half width + half a cell diagonal
  // (+ the outline tolerance) of a kept reach is wet, so every point of its
  // polygon lies in a cell whose four corners are at or below its surface.
  const w = c - 1,
    h = rows - 1,
    cellLevel = new Float64Array(w * h).fill(Infinity),
    cellBand = new Int32Array(w * h),
    bed = new Float64Array(n).fill(Infinity);
  budget.take(w * h);
  for (const { r } of kept) {
    const reachOut = r.widthM / 2 + (d * Math.SQRT2) / 2 + RIVER_NETWORK.outlineToleranceM + 1e-3,
      bedRadius = r.widthM / 2 + (d * Math.SQRT2) / 2;
    for (let j = 1; j < r.path.length; j++) {
      const a = r.path[j - 1]!,
        b = r.path[j]!,
        left = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reachOut) / d)),
        right = Math.min(w - 1, Math.floor((Math.max(a[0], b[0]) + reachOut) / d)),
        top = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reachOut) / d)),
        bottom = Math.min(h - 1, Math.floor((Math.max(a[1], b[1]) + reachOut) / d));
      budget.take(2 * (right - left + 2) * (bottom - top + 2));
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++)
          if (pointSegmentDistance([(x + 0.5) * d, (y + 0.5) * d], a, b) <= reachOut) {
            const k = y * w + x;
            cellLevel[k] = Math.min(cellLevel[k]!, r.levelM);
            cellBand[k] = Math.max(cellBand[k]!, r.bandSteps);
          }
      // A parabolic channel across the centreline, from the bed at the centre
      // to the surface half a cell diagonal beyond the banks (v2: a flat bed
      // of whole nodes, a staircase of 0.5-2 m steps along every bank).
      for (let y = top; y <= bottom + 1; y++)
        for (let x = left; x <= right + 1; x++) {
          const dist = pointSegmentDistance([x * d, y * d], a, b);
          if (dist < bedRadius) {
            const k = y * c + x,
              share = dist / bedRadius;
            bed[k] = Math.min(bed[k]!, decimal6(r.bedM + (r.levelM - r.bedM) * share * share));
          }
        }
    }
  }
  const samples = elevation.samples.slice(),
    anchors = new Float64Array(n).fill(NaN),
    nodeBand = new Int32Array(n),
    riverCells = new Uint8Array(w * h);
  budget.take(2 * n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const level = cellLevel[y * w + x]!;
      if (level === Infinity) continue;
      riverCells[y * w + x] = 1;
      for (const k of [y * c + x, y * c + x + 1, (y + 1) * c + x, (y + 1) * c + x + 1]) {
        anchors[k] = Number.isNaN(anchors[k]!) ? level : Math.min(anchors[k]!, level);
        nodeBand[k] = Math.max(nodeBand[k]!, cellBand[y * w + x]!);
      }
    }
  for (let k = 0; k < n; k++)
    if (!Number.isNaN(anchors[k]!)) samples[k] = Math.min(samples[k]!, anchors[k]!, bed[k]!);
  // Shoulders hang from each wet node's own valley floor (lowest original ground
  // within its band, less the stage offset), never below its water surface. The
  // in-band cap still wins, but valleys are not cut down to a whole reach's
  // lowest level, which would leave steep-walled trenches at every reach step.
  const floors = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(anchors[k]!)) continue;
    const x = k % c,
      y = (k - x) / c,
      band = nodeBand[k]!;
    budget.take((2 * band + 1) ** 2);
    let low = Infinity;
    // A disc of the band radius (v2: a square, whose corners made the floor
    // step along lattice rows and diagonals).
    for (let yy = Math.max(0, y - band); yy <= Math.min(rows - 1, y + band); yy++)
      for (let xx = Math.max(0, x - band); xx <= Math.min(c - 1, x + band); xx++)
        if ((xx - x) ** 2 + (yy - y) ** 2 <= band * band + band)
          low = Math.min(low, ground[yy * c + xx]!);
    floors[k] = Math.max(anchors[k]!, decimal6(low - offset(band)));
  }
  // Euclidean shoulder seeds: dry nodes near a reach get the floor at their
  // nearest centreline point (bilinear over that wet cell's corner floors)
  // plus the gentle grade beyond the widest wet extent. Measured from the
  // continuous centreline, not the wet-cell staircase, the graded valley
  // sides face across the channel instead of along lattice rows.
  const seeds = new Float64Array(n).fill(NaN),
    floorAt = (p: Point) => {
      const cx = Math.min(w - 1, Math.max(0, Math.floor(p[0] / d))),
        cy = Math.min(h - 1, Math.max(0, Math.floor(p[1] / d))),
        u = Math.min(1, Math.max(0, p[0] / d - cx)),
        v = Math.min(1, Math.max(0, p[1] / d - cy)),
        k = cy * c + cx,
        f00 = floors[k]!,
        f10 = floors[k + 1]!,
        f01 = floors[k + c]!,
        f11 = floors[k + c + 1]!;
      return (f00 * (1 - u) + f10 * u) * (1 - v) + (f01 * (1 - u) + f11 * u) * v;
    };
  for (const { r } of kept) {
    const wetExtent = r.widthM / 2 + d * Math.SQRT2 + RIVER_NETWORK.outlineToleranceM + 1e-3,
      bandM = r.bandSteps * d,
      reach = wetExtent + bandM + RIVER_NETWORK.steepSeedCells * d;
    for (let j = 1; j < r.path.length; j++) {
      const a = r.path[j - 1]!,
        b = r.path[j]!,
        left = Math.max(0, Math.ceil((Math.min(a[0], b[0]) - reach) / d)),
        right = Math.min(c - 1, Math.floor((Math.max(a[0], b[0]) + reach) / d)),
        top = Math.max(0, Math.ceil((Math.min(a[1], b[1]) - reach) / d)),
        bottom = Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) + reach) / d)),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length2 = dx * dx + dy * dy;
      budget.take(2 * (right - left + 1) * (bottom - top + 1));
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const k = y * c + x;
          if (!Number.isNaN(anchors[k]!)) continue;
          const px = x * d,
            py = y * d,
            t = length2
              ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length2))
              : 0,
            q: Point = [a[0] + t * dx, a[1] + t * dy],
            dist = Math.hypot(px - q[0], py - q[1]);
          if (dist > reach) continue;
          const f = floorAt(q);
          if (Number.isNaN(f)) continue;
          // The bank rises from the water level at the widest wet extent to
          // the floor one sample further out, along a smooth line rather
          // than the wet-cell staircase.
          const out = Math.max(0, dist - wetExtent),
            bank = Math.min(1, out / d),
            value =
              r.levelM +
              (Math.max(f, r.levelM) - r.levelM) * bank +
              policy.axisGradeCap * Math.min(out, bandM) +
              policy.steepGrade * Math.max(0, out - bandM);
          if (Number.isNaN(seeds[k]!) || value < seeds[k]!) seeds[k] = value;
        }
    }
  }
  const grading = gradeShoulders(samples, floors, elevation, policy, budget, nodeBand, seeds);
  const water: Water[] = [];
  let vertices = 0;
  const streamIds = new Map<number, number>(),
    reachCounts = new Map<number, number>();
  for (const { r, i } of kept.sort((a, b) => a.r.stream - b.r.stream || a.i - b.i)) {
    if (!streamIds.has(r.stream)) streamIds.set(r.stream, streamIds.size);
    const ordinal = reachCounts.get(r.stream) ?? 0;
    reachCounts.set(r.stream, ordinal + 1);
    const polygons = shapes.get(i)!;
    for (const p of polygons)
      vertices += p.outer.length + p.holes.reduce((m, q) => m + q.length, 0);
    vertices += r.path.length;
    water.push({
      id: `water:river:${streamIds.get(r.stream)!.toString().padStart(3, '0')}:${ordinal.toString().padStart(3, '0')}`,
      kind: 'river',
      centreline: r.path.map((p): Point => [decimal6(p[0]), decimal6(p[1])]),
      widthM: r.widthM,
      surfacePolicy: 'standing-water-v1',
      surfaceProfileM: r.path.map(() => r.levelM),
      polygons,
    });
  }
  if (water.length > s.limits.maxFeatures)
    throw new GeographyFailure(
      'GEOGRAPHY_RESOURCE_LIMIT',
      'water features',
      'Water feature cap exceeded.',
    );
  output?.take(vertices);
  return {
    elevation: { ...elevation, samples },
    water,
    groundChanged: true,
    riverCells,
    grading,
  };
}
