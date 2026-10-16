import {
  AssetSchema,
  HARD_LIMITS,
  type Elevation,
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
  segmentDistance,
  validatePolygon,
} from '../geometry.js';
import { preflightAsset } from '../resources.js';
import { createElevationQueries } from '../queries.js';
import { segmentGradeOnSurface } from '../realism.js';
import { decimal6 } from '../terrain/precision.js';
import { parseSettings } from '../validation.js';
import { Budget, bounded, GeographyFailure } from './budget.js';
import { SHALLOW_WATER, fordDepthM, isShallow } from './shallow.js';
import {
  CROSSING_VERSION,
  LEGACY_CROSSING_VERSION,
  type CrossingCandidate,
  type CrossingPolicy,
  type GeographyLimits,
} from './types.js';

export const DECK_ROUNDING_MARGIN_M = 0.000002;
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
/**
 * Rectangle containing the round-capped reserved corridor. Inflated by
 * 2 micrometres before decimal6 rounding so oblique decks still contain the
 * whole capsule after their corners are rounded.
 */
function deckFor(
  a: Point,
  b: Point,
  width: number,
  policy: CrossingPolicy = CROSSING_VERSION,
): Polygon {
  const length = distance(a, b),
    dx = (b[0] - a[0]) / length,
    dy = (b[1] - a[1]) / length,
    r = width / 2 + (policy === CROSSING_VERSION ? DECK_ROUNDING_MARGIN_M : 0);
  const point = (t: number, n: number): Point => [
    decimal6(a[0] + t * dx - n * dy),
    decimal6(a[1] + t * dy + n * dx),
  ];
  const outer = [point(-r, -r), point(length + r, -r), point(length + r, r), point(-r, r)];
  outer.push(outer[0]!);
  return { outer, holes: [] };
}
type Box = [number, number, number, number];
/** Outer-ring boxes of every water polygon, built once per candidate search. */
function polygonBoxes(water: Water[], budget: Budget): Map<Polygon, Box> {
  const boxes = new Map<Polygon, Box>();
  for (const w of water)
    for (const p of w.polygons) {
      budget.take(p.outer.length);
      const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const v of p.outer) {
        box[0] = Math.min(box[0], v[0]);
        box[1] = Math.min(box[1], v[1]);
        box[2] = Math.max(box[2], v[0]);
        box[3] = Math.max(box[3], v[1]);
      }
      boxes.set(p, box);
    }
  return boxes;
}
const apart = (a: Box, b: Box) => a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3];
function validate(
  candidate: CrossingCandidate,
  water: Water[],
  bounds: Bounds,
  s: MapSettings,
  budget: Budget,
  boxes?: Map<Polygon, Box>,
): void {
  if (
    (candidate.policy !== CROSSING_VERSION && candidate.policy !== LEGACY_CROSSING_VERSION) ||
    (candidate.kind !== 'bridge' && candidate.kind !== 'ford') ||
    (candidate.kind === 'ford') !== (candidate.depthM !== undefined)
  )
    fail('$.candidate', 'Unsupported crossing policy/kind');
  const [a, b] = candidate.endpoints,
    span = distance(a, b),
    width = candidate.widthM;
  if (
    ![
      ...a,
      ...b,
      span,
      width,
      candidate.spanM,
      candidate.minimumAbutmentM,
      candidate.depthM ?? 0,
    ].every(Number.isFinite) ||
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
  const expected = deckFor(a, b, width, candidate.policy);
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
      const box = boxes?.get(p),
        reach = radius + 1e-6;
      const diskContacts = (center: Point) => {
        // A disk whose box misses the polygon's box cannot contact it.
        if (
          box &&
          apart(box, [center[0] - reach, center[1] - reach, center[0] + reach, center[1] + reach])
        )
          return false;
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
        !(
          box &&
          apart(box, [
            Math.min(a[0], b[0]) - width,
            Math.min(a[1], b[1]) - width,
            Math.max(a[0], b[0]) + width,
            Math.max(a[1], b[1]) + width,
          ])
        ) &&
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
  ford?: { depthM: number },
): CrossingCandidate {
  const s = parseSettings(settings),
    [a, b] = endpoints;
  if (![...a, ...b].every(Number.isFinite) || distance(a, b) <= 0)
    throw new RangeError('Crossing needs distinct finite endpoints');
  if (ford && !(Number.isFinite(ford.depthM) && ford.depthM >= 0))
    throw new RangeError('Ford needs a finite non-negative depth');
  return {
    id,
    kind: ford ? 'ford' : 'bridge',
    waterId,
    endpoints,
    spanM: decimal6(distance(a, b)),
    widthM: s.roads.maxReservedWidthM,
    minimumAbutmentM: s.roads.minimumAbutmentM,
    deck: deckFor(a, b, s.roads.maxReservedWidthM),
    policy: CROSSING_VERSION,
    ...(ford ? { depthM: ford.depthM } : {}),
  };
}
/**
 * Searches transverse crossings at reach-segment midpoints. With `elevation`,
 * each abutment is moved outward (in 1 m steps, within the span limit) until
 * its ground stands `ABUTMENT_CLEARANCE_M` above the river surface, so a linear
 * deck between the abutments clears the water; without it the abutments sit
 * just beyond the dry disks, as before.
 */
export const ABUTMENT_CLEARANCE_M = 0.25;
/** Straight outward approach checked from each abutment, and its grade share of maxGrade. */
export const APPROACH_LENGTH_M = 25;
export const APPROACH_GRADE_SHARE = 0.9;
/** Candidate segments are at least this many reserved widths long... */
export const CANDIDATE_MIN_SEGMENT = 2;
/** ...and accepted candidates on one reach are at least this far apart along it. */
export const CANDIDATE_SPACING_M = 150;
export function findCrossingCandidates(
  water: Water[],
  bounds: Bounds,
  settings: MapSettings,
  limits: GeographyLimits = {},
  elevation?: Elevation,
): GenerationResult<CrossingCandidate[]> {
  return bounded(() => {
    const s = parseSettings(settings);
    checked(water, s);
    const heightAt = elevation ? createElevationQueries({ elevation, bounds }).heightAt : undefined;
    const budget = new Budget(
        limits.maxCrossingWork ?? s.limits.maxTopologyChecks,
        'crossing work',
      ),
      result: CrossingCandidate[] = [],
      output = new Budget(s.limits.maxVertices, 'crossing output vertices');
    let boxes: Map<Polygon, Box> | undefined;
    for (const river of water) {
      if (river.kind !== 'river') continue;
      const edges = river.polygons.flatMap((p) => polygonEdges(p));
      let along = 0,
        accepted = -Infinity;
      for (let i = 1; i < river.centreline.length; i++) {
        const a = river.centreline[i - 1]!,
          b = river.centreline[i]!,
          length = distance(a, b);
        along += length;
        // Short (bend) segments cannot carry two straight banks across the
        // reserved strip; successive candidates keep a minimum spacing.
        if (
          length < CANDIDATE_MIN_SEGMENT * s.roads.maxReservedWidthM ||
          along - length / 2 < accepted + CANDIDATE_SPACING_M
        )
          continue;
        budget.take(edges.length + 8);
        const middle = interpolate(a, b, 0.5),
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
        let t0 = intervals[0]![0] - radius / (2 * half),
          t1 = intervals[0]![1] + radius / (2 * half);
        if (t0 < 0 || t1 > 1) continue;
        if (heightAt && river.kind === 'river') {
          const surface = river.surfaceProfileM[0]! + ABUTMENT_CLEARANCE_M,
            step = 1 / (2 * half),
            approach = APPROACH_LENGTH_M / (2 * half),
            inside = (t: number) => {
              const pt = interpolate(p, q, t);
              return pt[0] >= 0 && pt[1] >= 0 && pt[0] <= bounds.maxX && pt[1] <= bounds.maxY;
            },
            // The abutment must stand clear of the water and see a road-grade
            // approach over the next APPROACH_LENGTH_M; planning still certifies it.
            unsuitable = (t: number, outwardT: number) =>
              heightAt(...interpolate(p, q, t)) <= surface ||
              !inside(outwardT) ||
              segmentGradeOnSurface(
                heightAt,
                interpolate(p, q, t),
                interpolate(p, q, outwardT),
                elevation!.spacingM,
              ).max >
                s.roads.maxGrade * APPROACH_GRADE_SHARE;
          budget.take(4 * s.roads.maxCrossingSpanM);
          while (t0 >= 0 && inside(t0) && unsuitable(t0, t0 - approach)) t0 -= step;
          while (t1 <= 1 && inside(t1) && unsuitable(t1, t1 + approach)) t1 += step;
          if (t0 < 0 || t1 > 1 || !inside(t0) || !inside(t1)) continue;
        }
        const from = interpolate(p, q, t0).map(decimal6) as Point,
          to = interpolate(p, q, t1).map(decimal6) as Point;
        const proposal = crossingCandidate(
          `crossing-candidate:${river.id}:${i.toString().padStart(6, '0')}`,
          river.id,
          [from, to],
          s,
        );
        try {
          validate(proposal, water, bounds, s, budget, (boxes ??= polygonBoxes(water, budget)));
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
        accepted = along - length / 2;
      }
    }
    if (heightAt)
      findFords(
        water,
        bounds,
        s,
        elevation!,
        heightAt,
        budget,
        output,
        result,
        () => (boxes ??= polygonBoxes(water, budget)),
      );
    return { ok: true, value: result, diagnostics: [] };
  });
}

/**
 * Ford sites (`shallow-riffle-v1`, D46) on reaches whose riffle depth is
 * wadeable: transverse lines along straight centreline segments, at least
 * `SHALLOW_WATER.spacingM` apart along a reach, whose two ends sit just beyond
 * the dry abutment disks on low banks (at most `maxBankM` above the water) with
 * a gentle ramp down to the water and a gentle outward approach. Fords keep
 * clear of every other candidate so decks never overlap.
 */
function findFords(
  water: Water[],
  bounds: Bounds,
  s: MapSettings,
  elevation: Elevation,
  heightAt: (x: number, y: number) => number,
  budget: Budget,
  output: Budget,
  result: CrossingCandidate[],
  boxes: () => Map<Polygon, Box>,
): void {
  const p = SHALLOW_WATER,
    topology = new MeteredTopology(budget),
    width = s.roads.maxReservedWidthM,
    radius = width / 2 + s.roads.minimumAbutmentM + 0.000002,
    half = s.roads.maxCrossingSpanM / 2,
    inside = (pt: Point) =>
      pt[0] >= 0 && pt[1] >= 0 && pt[0] <= bounds.maxX && pt[1] <= bounds.maxY,
    grade = (a: Point, b: Point) => segmentGradeOnSurface(heightAt, a, b, elevation.spacingM).max;
  for (const river of water) {
    if (river.kind !== 'river') continue;
    budget.take(water.length + river.centreline.length);
    const depthM = fordDepthM(river, water, topology);
    if (!isShallow(depthM)) continue;
    const surface = river.surfaceProfileM[0]!,
      edges = river.polygons.flatMap((poly) => polygonEdges(poly));
    let along = 0,
      accepted = -Infinity;
    for (let i = 1; i < river.centreline.length; i++) {
      const a = river.centreline[i - 1]!,
        b = river.centreline[i]!,
        length = distance(a, b),
        start = along;
      along += length;
      if (length < CANDIDATE_MIN_SEGMENT * width) continue;
      const count = Math.max(1, Math.floor(length / p.spacingM));
      for (let k = 0; k < count; k++) {
        const f = (k + 0.5) / count;
        if (start + f * length < accepted + p.spacingM) continue;
        budget.take(edges.length + 8);
        const middle = interpolate(a, b, f),
          normal: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
        const from: Point = [middle[0] - normal[0] * half, middle[1] - normal[1] * half],
          to: Point = [middle[0] + normal[0] * half, middle[1] + normal[1] * half];
        const cuts = segmentCuts(from, to, edges, topology, '$.ford.search');
        const intervals: [number, number][] = [];
        for (let j = 1; j < cuts.length; j++)
          if (
            river.polygons.some(
              (poly) =>
                polygonLocation(
                  interpolate(from, to, (cuts[j - 1]! + cuts[j]!) / 2),
                  poly,
                  topology,
                  '$.ford.search',
                ) === 'inside',
            )
          )
            intervals.push([cuts[j - 1]!, cuts[j]!]);
        if (intervals.length !== 1) continue;
        const [w0, w1] = intervals[0]!,
          t0 = w0 - radius / (2 * half),
          t1 = w1 + radius / (2 * half);
        if (t0 < 0 || t1 > 1) continue;
        const ends = [interpolate(from, to, t0), interpolate(from, to, t1)] as const,
          banks = [interpolate(from, to, w0), interpolate(from, to, w1)] as const,
          tangent: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        // A reach running along the map edge puts the transverse line, and so
        // an end, outside the map (#542). Such a ford could never certify (its
        // abutment disks must fit the bounds), and the ground there has no
        // height to probe, so skip it before any height query.
        if (!inside(ends[0]) || !inside(ends[1])) continue;
        // A ford road may leave the bank straight out or slant up the valley
        // side (eighth turns, no trigonometry); one of the three must be gentle.
        const gentle = (e: Point, sign: number) =>
          [0, -1, 1].some((turn) => {
            const ox = (sign * normal[0] + turn * tangent[0]) / (turn ? Math.SQRT2 : 1),
              oy = (sign * normal[1] + turn * tangent[1]) / (turn ? Math.SQRT2 : 1),
              out: Point = [e[0] + ox * APPROACH_LENGTH_M, e[1] + oy * APPROACH_LENGTH_M];
            return inside(out) && grade(e, out) <= s.roads.maxGrade * p.approachGradeShare;
          });
        budget.take(24 * Math.ceil(APPROACH_LENGTH_M + radius));
        if (
          ends.some((e) => heightAt(...e) - surface > p.maxBankM) ||
          ends.some((e, j) => grade(e, banks[j]!) > s.roads.maxGrade * p.rampGradeShare) ||
          !gentle(ends[0], -1) ||
          !gentle(ends[1], 1)
        )
          continue;
        const endpoints = ends.map((e) => e.map(decimal6) as Point) as [Point, Point];
        budget.take(result.length);
        if (
          result.some(
            (c) =>
              segmentDistance(endpoints[0], endpoints[1], c.endpoints[0], c.endpoints[1]) <=
              (width + c.widthM) / 2 + p.clearanceM,
          )
        )
          continue;
        const proposal = crossingCandidate(
          `ford-candidate:${river.id}:${i.toString().padStart(6, '0')}:${k.toString().padStart(2, '0')}`,
          river.id,
          endpoints,
          s,
          { depthM },
        );
        try {
          validate(proposal, water, bounds, s, budget, boxes());
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
        accepted = start + f * length;
      }
    }
  }
}
