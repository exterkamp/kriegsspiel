import { HARD_LIMITS, type GenerationResult, type Point } from '../contract.js';
import { distance, interpolate, polygonEdges, polygonLocation, segmentCuts } from '../geometry.js';
import { validateCrossingCandidateMetered } from '../geography/crossings.js';
import { Budget } from '../geography/budget.js';
import { FORD_POLICY, SHALLOW_WATER, fordDepthM, isShallow } from '../geography/shallow.js';
import type { CrossingCandidate } from '../geography/types.js';
import { preflightAsset } from '../resources.js';
import { bounded, PlanningFailure } from './budget.js';
import { segmentGrade } from './certificates.js';
import { Context } from './context.js';
import type { FordProfile, PlanningInput } from './types.js';

/**
 * Certifies a ford (`shallow-riffle-v1`, D46) from public geometry: the same
 * dry-abutment, single-reach and straight-bank geometry as a bridge; a constant
 * standing-water reach whose modelled riffle depth is wadeable and equals the
 * recorded depth; both ends at most `maxBankM` above the water; and dry ramps
 * from each end down to the water no steeper than the road maximum.
 */
export function ford(c: Context, candidate: CrossingCandidate): FordProfile {
  preflightAsset({ candidate }, HARD_LIMITS, () => c.validation.take());
  if (candidate.kind !== 'ford' || candidate.depthM === undefined)
    throw new PlanningFailure('FORD_KIND', candidate.id, 'Ford certificate needs a ford.');
  class SharedMeter extends Budget {
    override take(n = 1): void {
      c.validation.take(n);
    }
  }
  const result = validateCrossingCandidateMetered(
    candidate,
    c.water,
    c.bounds,
    c.settings,
    new SharedMeter(c.validation.max, 'planning crossing validation'),
  );
  if (!result.ok)
    throw new PlanningFailure(
      'FORD_GEOMETRY',
      candidate.id,
      result.diagnostics.map((d) => d.code).join(', '),
    );
  const target = c.water.find((w) => w.id === candidate.waterId)!;
  if (
    target.kind !== 'river' ||
    target.surfacePolicy !== 'standing-water-v1' ||
    new Set(target.surfaceProfileM).size !== 1
  )
    throw new PlanningFailure(
      'FORD_SURFACE_UNSUPPORTED',
      candidate.id,
      'Fords are certified on constant standing-water river reaches only.',
    );
  c.validation.take(c.water.length + target.centreline.length);
  const depth = fordDepthM(target, c.water, c.meter);
  if (!isShallow(depth) || Math.abs(depth - candidate.depthM) > 1e-6)
    throw new PlanningFailure(
      'FORD_DEPTH',
      candidate.id,
      'Ford depth must be the reach riffle depth and no deeper than the wading limit.',
    );
  const [a, b] = candidate.endpoints,
    surface = target.surfaceProfileM[0]!,
    edges = target.polygons.flatMap((p) => polygonEdges(p));
  c.validation.take(edges.length + 2);
  const heights: [number, number] = [c.q.heightAt(...a), c.q.heightAt(...b)];
  if (heights.some((h) => h - surface > SHALLOW_WATER.maxBankM + 1e-9))
    throw new PlanningFailure(
      'FORD_BANK',
      candidate.id,
      'Ford ends must stand on a low bank close above the water.',
    );
  const cuts = segmentCuts(a, b, edges, c.meter, '$.ford');
  let first: number | undefined, last: number | undefined;
  for (let i = 1; i < cuts.length; i++) {
    const mid = interpolate(a, b, (cuts[i - 1]! + cuts[i]!) / 2);
    if (!target.polygons.some((p) => polygonLocation(mid, p, c.meter) === 'inside')) continue;
    first ??= cuts[i - 1]!;
    last = cuts[i]!;
  }
  if (first === undefined || last === undefined)
    throw new PlanningFailure('FORD_GEOMETRY', candidate.id, 'Ford does not enter its water.');
  const ramps: [Point, Point][] = [
    [a, interpolate(a, b, first)],
    [b, interpolate(a, b, last)],
  ];
  let maxGrade = 0;
  for (const [end, edge] of ramps)
    if (distance(end, edge) > 1e-9) maxGrade = Math.max(maxGrade, segmentGrade(c, end, edge));
  if (maxGrade > c.settings.roads.maxGrade + 1e-12)
    throw new PlanningFailure(
      'FORD_RAMP_GRADE',
      candidate.id,
      'Dry ground between a ford end and the water exceeds the road maximum grade.',
    );
  return {
    crossingId: candidate.id,
    policy: FORD_POLICY,
    depthM: depth,
    bankHeightsM: [heights[0] - surface, heights[1] - surface],
    maxGrade,
  };
}
export function certifyFord(
  input: PlanningInput,
  candidate: CrossingCandidate,
): GenerationResult<FordProfile> {
  return bounded(() => ford(new Context(input), candidate));
}
