import type { GenerationResult, Point } from '../contract.js';
import { distance, segmentCuts, interpolate, polygonLocation, polygonEdges } from '../geometry.js';
import { validateCrossingCandidateMetered } from '../geography/crossings.js';
import { Budget } from '../geography/budget.js';
import type { CrossingCandidate } from '../geography/types.js';
import { bounded, PlanningFailure } from './budget.js';
import { preflightAsset } from '../resources.js';
import { HARD_LIMITS } from '../contract.js';
import { Context } from './context.js';
import { DECK_POLICY, type DeckProfile, type PlanningInput } from './types.js';
export function bridge(
  c: Context,
  candidate: CrossingCandidate,
  profile?: DeckProfile,
): DeckProfile {
  preflightAsset(profile === undefined ? { candidate } : { candidate, profile }, HARD_LIMITS, () =>
    c.validation.take(),
  );
  const [a, b] = candidate.endpoints,
    span = distance(a, b);
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
      'BRIDGE_GEOMETRY',
      candidate.id,
      result.diagnostics.map((d) => d.code).join(', '),
    );
  c.validation.take(2);
  const actual: [number, number] = [c.q.heightAt(...a), c.q.heightAt(...b)],
    heights = profile?.endpointHeightsM ?? actual;
  if (profile && (profile.policy !== DECK_POLICY || profile.crossingId !== candidate.id))
    throw new PlanningFailure(
      'BRIDGE_DECK_POLICY',
      candidate.id,
      'Unsupported deck identity/policy.',
    );
  if (
    !Array.isArray(heights) ||
    heights.length !== 2 ||
    !heights.every(Number.isFinite) ||
    Math.abs(heights[0] - actual[0]) > 1e-7 ||
    Math.abs(heights[1] - actual[1]) > 1e-7
  )
    throw new PlanningFailure(
      'BRIDGE_ABUTMENT_HEIGHT',
      candidate.id,
      'Deck endpoint heights must meet authoritative dry ground continuously.',
    );
  const grade = Math.abs(heights[1] - heights[0]) / span;
  if (grade > c.settings.roads.maxGrade + 1e-12)
    throw new PlanningFailure(
      'BRIDGE_DECK_GRADE',
      candidate.id,
      'Linear deck grade exceeds the recorded road maximum.',
    );
  const target = c.water.find((w) => w.id === candidate.waterId)!;
  if (
    target.kind !== 'river' ||
    target.surfacePolicy !== 'standing-water-v1' ||
    new Set(target.surfaceProfileM).size !== 1
  )
    throw new PlanningFailure(
      'BRIDGE_SURFACE_UNSUPPORTED',
      candidate.id,
      'Planning v1 certifies constant standing-water river profiles only.',
    );
  const edges = target.polygons.flatMap((p) => polygonEdges(p));
  c.validation.take(edges.length);
  const cuts = segmentCuts(a, b, edges, c.meter, '$.bridge');
  const surface = target.surfaceProfileM[0]!;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1]!,
      hi = cuts[i]!,
      mid = interpolate(a, b, (lo + hi) / 2);
    if (!target.polygons.some((p) => polygonLocation(mid, p, c.meter) === 'inside')) continue;
    // Both interval endpoints bound a linear deck; the surface is constant over
    // the full transverse reach already certified by D, not centreline ground.
    if (
      Math.min(
        heights[0] + lo * (heights[1] - heights[0]),
        heights[0] + hi * (heights[1] - heights[0]),
      ) <=
      surface + 1e-7
    )
      throw new PlanningFailure(
        'BRIDGE_DECK_SUBMERGED',
        candidate.id,
        'Linear deck must lie strictly above the water surface across the entire wet span.',
      );
  }
  return {
    crossingId: candidate.id,
    policy: DECK_POLICY,
    endpointHeightsM: heights,
    maxGrade: grade,
  };
}
export function certifyBridge(
  input: PlanningInput,
  candidate: CrossingCandidate,
  profile?: DeckProfile,
): GenerationResult<DeckProfile> {
  return bounded(() => bridge(new Context(input), candidate, profile));
}
export function outward(a: Point, b: Point, length: number): Point {
  const d = distance(a, b);
  return [a[0] + ((a[0] - b[0]) / d) * length, a[1] + ((a[1] - b[1]) / d) * length];
}
