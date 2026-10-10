import {
  AssetSchema,
  HARD_LIMITS,
  type Bounds,
  type GenerationResult,
  type MapSettings,
  type Point,
  type Polygon,
  type Water,
} from '../contract.js';
import { fail, TopologyBudget } from '../errors.js';
import {
  capsuleIntersectsPolygon,
  distance,
  interpolate,
  polygonEdges,
  polygonLocation,
  pointSegmentDistance,
  segmentCuts,
  validatePolygon,
} from '../geometry.js';
import { preflightAsset } from '../resources.js';
import { decimal6 } from '../terrain/precision.js';
import { parseSettings } from '../validation.js';
import { Budget, bounded, GeographyFailure } from './budget.js';
import { CROSSING_VERSION, type CrossingCandidate, type GeographyLimits } from './types.js';

class MeteredTopology extends TopologyBudget {
  constructor(private readonly budget: Budget) {
    super(Number.MAX_SAFE_INTEGER);
  }
  override consume(_path: string, count = 1): void {
    this.budget.take(count);
  }
}
function checked(water: Water[], s: MapSettings, budget?: Budget) {
  const usage = preflightAsset(
    { layers: { water } },
    { ...HARD_LIMITS, maxFeatures: s.limits.maxFeatures, maxVertices: s.limits.maxVertices },
    budget ? () => budget.take() : undefined,
  );
  // Reserve schema traversal before it executes, including invalid candidates.
  budget?.take(usage.nodes);
  const parsed = AssetSchema.shape.layers.shape.water.safeParse(water);
  if (!parsed.success) fail('$.water', parsed.error.message);
}
function deckFor(a: Point, b: Point, width: number): Polygon {
  const length = distance(a, b),
    dx = (b[0] - a[0]) / length,
    dy = (b[1] - a[1]) / length,
    r = width / 2;
  const point = (t: number, n: number): Point => [
    decimal6(a[0] + t * dx - n * dy),
    decimal6(a[1] + t * dy + n * dx),
  ];
  const outer = [point(-r, -r), point(length + r, -r), point(length + r, r), point(-r, r)];
  outer.push(outer[0]!);
  return { outer, holes: [] };
}
function validate(
  candidate: CrossingCandidate,
  water: Water[],
  bounds: Bounds,
  s: MapSettings,
  budget: Budget,
): void {
  if (candidate.policy !== CROSSING_VERSION || candidate.kind !== 'bridge')
    fail('$.candidate', 'Unsupported crossing policy/kind');
  const [a, b] = candidate.endpoints,
    span = distance(a, b),
    width = candidate.widthM;
  if (
    ![...a, ...b, span, width, candidate.spanM, candidate.minimumAbutmentM].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    span <= 0
  )
    fail('$.candidate', 'Finite positive crossing dimensions required');
  const target = water.find((w) => w.id === candidate.waterId);
  if (!target || target.kind !== 'river')
    throw new GeographyFailure(
      'CROSSING_WATER',
      'river identity',
      'Crossing must reference an existing river.',
    );
  if (
    width !== s.roads.maxReservedWidthM ||
    candidate.minimumAbutmentM !== s.roads.minimumAbutmentM ||
    Math.abs(span - candidate.spanM) > s.geometry.coordinateToleranceM ||
    span > s.roads.maxCrossingSpanM
  )
    throw new GeographyFailure(
      'CROSSING_DIMENSIONS',
      'reserved width/span',
      'Crossing width/abutment/span violates the recorded reserved corridor policy.',
    );
  const radius = width / 2 + s.roads.minimumAbutmentM;
  const vertices = [candidate.deck.outer, ...candidate.deck.holes].flat();
  budget.take(vertices.length);
  validatePolygon(candidate.deck, '$.candidate.deck', new MeteredTopology(budget));
  const expected = deckFor(a, b, width);
  if (JSON.stringify(candidate.deck) !== JSON.stringify(expected))
    throw new GeographyFailure(
      'CROSSING_DECK',
      'reserved deck',
      'Deck must be the policy-defined conservative rectangle including reserved end caps.',
    );
  for (const p of [a, b])
    if (
      p[0] - radius < 0 ||
      p[1] - radius < 0 ||
      p[0] + radius > bounds.maxX ||
      p[1] + radius > bounds.maxY
    )
      throw new GeographyFailure(
        'CROSSING_BOUNDS',
        'dry abutment disks',
        'Complete dry abutment disks must fit bounds.',
      );
  for (const p of vertices)
    if (p[0] < 0 || p[1] < 0 || p[0] > bounds.maxX || p[1] > bounds.maxY)
      throw new GeographyFailure(
        'CROSSING_BOUNDS',
        'reserved deck',
        'Complete reserved deck must fit bounds.',
      );
  const topology = new MeteredTopology(budget);
  for (const w of water)
    for (const p of w.polygons) {
      budget.take();
      const diskContacts = (center: Point) => {
        if (polygonLocation(center, p, topology, '$.candidate.endpoints') !== 'outside')
          return true;
        for (const [u, v] of polygonEdges(p)) {
          budget.take();
          if (pointSegmentDistance(center, u, v) <= radius + 1e-9) return true;
        }
        return false;
      };
      if (diskContacts(a) || diskContacts(b))
        throw new GeographyFailure(
          'WET_ABUTMENT',
          'dry abutment disks',
          'Endpoint disk intersects authoritative water.',
        );
      if (
        w.id !== target.id &&
        capsuleIntersectsPolygon(a, b, width / 2, p, topology, '$.candidate')
      )
        throw new GeographyFailure(
          'CROSSING_CONFLUENCE',
          'water identity',
          'Reserved corridor intersects a different water body.',
        );
    }
  for (const p of target.polygons)
    for (const hole of p.holes) {
      if (
        capsuleIntersectsPolygon(
          a,
          b,
          width / 2 + 2e-9,
          { outer: hole, holes: [] },
          topology,
          '$.candidate.holes',
        )
      )
        throw new GeographyFailure(
          'CROSSING_HOLE',
          'complete reserved corridor',
          'Reserved corridor intersects or touches a dry island/hole.',
        );
    }
  const edges = target.polygons.flatMap((p) => polygonEdges(p));
  budget.take(edges.length);
  const cuts = segmentCuts(a, b, edges, topology, '$.candidate'),
    wet: boolean[] = [];
  for (let i = 1; i < cuts.length; i++)
    wet.push(
      target.polygons.some(
        (p) =>
          polygonLocation(interpolate(a, b, (cuts[i - 1]! + cuts[i]!) / 2), p, topology) ===
          'inside',
      ),
    );
  let intervals = 0;
  for (let i = 0; i < wet.length; i++) if (wet[i] && !wet[i - 1]) intervals++;
  if (intervals !== 1)
    throw new GeographyFailure(
      'CROSSING_INTERVAL',
      'single bank-to-bank reach',
      'Candidate must cross exactly one wet interval; holes, bends and disjoint reaches are unsuitable.',
    );
  // Restrict accepted crossings to transverse straight reaches. Full reserved
  // corridor must encounter the same two banks, never skim a bend/cap.
  const first = wet.indexOf(true),
    last = wet.lastIndexOf(true),
    wetA = interpolate(a, b, cuts[first]!),
    wetB = interpolate(a, b, cuts[last + 1]!);
  if (distance(wetA, wetB) < s.hydrology.minRiverWidthM - s.geometry.coordinateToleranceM)
    throw new GeographyFailure(
      'CROSSING_NARROW',
      'river width',
      'Wet reach is below minimum river width.',
    );
  const ux = (b[0] - a[0]) / span,
    uy = (b[1] - a[1]) / span;
  // Certify the full transverse strip, including notches between the three
  // traces: only two complete parallel bank graphs may intersect this strip.
  const banks: { u: number; intervals: [number, number][] }[] = [];
  for (const polygon of target.polygons)
    for (let j = 1; j < polygon.outer.length; j++) {
      budget.take();
      const p = polygon.outer[j - 1]!,
        q = polygon.outer[j]!;
      const local = (v: Point): Point => [
        (v[0] - a[0]) * ux + (v[1] - a[1]) * uy,
        -(v[0] - a[0]) * uy + (v[1] - a[1]) * ux,
      ];
      const from = local(p),
        to = local(q),
        du = to[0] - from[0],
        dv = to[1] - from[1];
      let lo = 0,
        hi = 1;
      for (const [direction, offset] of [
        [-du, from[0]],
        [du, span - from[0]],
        [-dv, from[1] + width / 2],
        [dv, width / 2 - from[1]],
      ]) {
        if (direction === 0) {
          if (offset! < 0) {
            lo = 1;
            hi = 0;
            break;
          }
        } else {
          const t = offset! / direction!;
          if (direction! < 0) lo = Math.max(lo, t);
          else hi = Math.min(hi, t);
        }
      }
      if (lo >= hi) continue;
      const u0 = from[0] + lo * du,
        u1 = from[0] + hi * du,
        v0 = from[1] + lo * dv,
        v1 = from[1] + hi * dv;
      if (Math.abs(u1 - u0) > s.geometry.coordinateToleranceM)
        throw new GeographyFailure(
          'CROSSING_BEND',
          'complete transverse banks',
          'A bend, notch, cap or oblique bank enters the reserved corridor.',
        );
      const u = (u0 + u1) / 2;
      let bank = banks.find((b) => Math.abs(b.u - u) <= s.geometry.coordinateToleranceM);
      if (!bank) {
        bank = { u, intervals: [] };
        banks.push(bank);
      }
      bank.intervals.push([Math.min(v0, v1), Math.max(v0, v1)]);
    }
  if (banks.length !== 2)
    throw new GeographyFailure(
      'CROSSING_CORRIDOR',
      'complete transverse banks',
      'Reserved corridor requires exactly two straight opposing banks.',
    );
  for (const bank of banks) {
    budget.take(bank.intervals.length * Math.ceil(Math.log2(bank.intervals.length + 1)));
    bank.intervals.sort((x, y) => x[0] - y[0]);
    let reached = -width / 2;
    for (const [lo, hi] of bank.intervals) {
      if (lo > reached + s.geometry.coordinateToleranceM) break;
      reached = Math.max(reached, hi);
    }
    if (reached < width / 2 - s.geometry.coordinateToleranceM)
      throw new GeographyFailure(
        'CROSSING_CORRIDOR',
        'complete transverse banks',
        'Bank does not cover the complete reserved width.',
      );
  }
  for (const offset of [-width / 2, width / 2]) {
    const sideA: Point = [a[0] - uy * offset, a[1] + ux * offset],
      sideB: Point = [b[0] - uy * offset, b[1] + ux * offset];
    budget.take(edges.length);
    const sideCuts = segmentCuts(sideA, sideB, edges, topology, '$.candidate.corridor');
    let runs = 0,
      inside = false;
    for (let i = 1; i < sideCuts.length; i++) {
      const now = target.polygons.some(
        (p) =>
          polygonLocation(
            interpolate(sideA, sideB, (sideCuts[i - 1]! + sideCuts[i]!) / 2),
            p,
            topology,
          ) === 'inside',
      );
      if (now && !inside) runs++;
      inside = now;
    }
    if (runs !== 1)
      throw new GeographyFailure(
        'CROSSING_CORRIDOR',
        'complete reserved corridor',
        'Reserved corridor side misses the reach or crosses a bend/hole.',
      );
  }
}
export function validateCrossingCandidate(
  candidate: CrossingCandidate,
  water: Water[],
  bounds: Bounds,
  settings: MapSettings,
  limits: GeographyLimits = {},
): GenerationResult<CrossingCandidate> {
  const s = parseSettings(settings);
  return validateCrossingCandidateMetered(
    candidate,
    water,
    bounds,
    s,
    new Budget(limits.maxCrossingWork ?? s.limits.maxTopologyChecks, 'crossing work'),
  );
}
/** Charges a caller-owned budget across all candidate checks, including failed checks. */
export function validateCrossingCandidateMetered(
  candidate: CrossingCandidate,
  water: Water[],
  bounds: Bounds,
  settings: MapSettings,
  budget: Budget,
): GenerationResult<CrossingCandidate> {
  return bounded(() => {
    const usage = preflightAsset(settings, HARD_LIMITS, () => budget.take());
    budget.take(usage.nodes);
    const s = parseSettings(settings);
    checked(water, s, budget);
    preflightAsset({ candidate, bounds }, HARD_LIMITS, () => budget.take());
    validate(candidate, water, bounds, s, budget);
    return { ok: true, value: candidate, diagnostics: [] };
  });
}
/** Public exact proposal constructor for route planners; still requires validation. */
export function crossingCandidate(
  id: string,
  waterId: string,
  endpoints: [Point, Point],
  settings: MapSettings,
): CrossingCandidate {
  const s = parseSettings(settings),
    [a, b] = endpoints;
  if (![...a, ...b].every(Number.isFinite) || distance(a, b) <= 0)
    throw new RangeError('Crossing needs distinct finite endpoints');
  return {
    id,
    kind: 'bridge',
    waterId,
    endpoints,
    spanM: decimal6(distance(a, b)),
    widthM: s.roads.maxReservedWidthM,
    minimumAbutmentM: s.roads.minimumAbutmentM,
    deck: deckFor(a, b, s.roads.maxReservedWidthM),
    policy: CROSSING_VERSION,
  };
}
export function findCrossingCandidates(
  water: Water[],
  bounds: Bounds,
  settings: MapSettings,
  limits: GeographyLimits = {},
): GenerationResult<CrossingCandidate[]> {
  return bounded(() => {
    const s = parseSettings(settings);
    checked(water, s);
    const budget = new Budget(
        limits.maxCrossingWork ?? s.limits.maxTopologyChecks,
        'crossing work',
      ),
      result: CrossingCandidate[] = [],
      output = new Budget(s.limits.maxVertices, 'crossing output vertices');
    for (const river of water) {
      if (river.kind !== 'river') continue;
      const edges = river.polygons.flatMap((p) => polygonEdges(p));
      for (let i = 1; i < river.centreline.length; i++) {
        budget.take(edges.length + 8);
        const a = river.centreline[i - 1]!,
          b = river.centreline[i]!,
          length = distance(a, b),
          middle = interpolate(a, b, 0.5),
          normal: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length],
          half = s.roads.maxCrossingSpanM / 2;
        const p: Point = [middle[0] - normal[0] * half, middle[1] - normal[1] * half],
          q: Point = [middle[0] + normal[0] * half, middle[1] + normal[1] * half];
        const cuts = segmentCuts(p, q, edges, new MeteredTopology(budget), '$.crossing.search');
        const intervals: [number, number][] = [];
        for (let j = 1; j < cuts.length; j++)
          if (
            river.polygons.some(
              (poly) =>
                polygonLocation(
                  interpolate(p, q, (cuts[j - 1]! + cuts[j]!) / 2),
                  poly,
                  new MeteredTopology(budget),
                  '$.crossing.search',
                ) === 'inside',
            )
          )
            intervals.push([cuts[j - 1]!, cuts[j]!]);
        if (intervals.length !== 1) continue;
        const radius = s.roads.maxReservedWidthM / 2 + s.roads.minimumAbutmentM + 0.000002;
        const t0 = intervals[0]![0] - radius / (2 * half),
          t1 = intervals[0]![1] + radius / (2 * half);
        if (t0 < 0 || t1 > 1) continue;
        const from = interpolate(p, q, t0).map(decimal6) as Point,
          to = interpolate(p, q, t1).map(decimal6) as Point;
        const proposal = crossingCandidate(
          `crossing-candidate:${river.id}:${i.toString().padStart(6, '0')}`,
          river.id,
          [from, to],
          s,
        );
        try {
          validate(proposal, water, bounds, s, budget);
        } catch (e) {
          if (e instanceof GeographyFailure && e.code !== 'GEOGRAPHY_RESOURCE_LIMIT') continue;
          throw e;
        }
        if (result.length >= s.limits.maxFeatures)
          throw new GeographyFailure(
            'GEOGRAPHY_RESOURCE_LIMIT',
            'crossing candidates',
            'Crossing output cap exceeded.',
          );
        output.take(7);
        result.push(proposal);
      }
    }
    return { ok: true, value: result, diagnostics: [] };
  });
}
