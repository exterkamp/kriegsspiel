import type { Point } from '../contract.js';
import { distance, polygonLocation, validatePath, interpolate } from '../geometry.js';
import { preflightAsset } from '../resources.js';
import { HARD_LIMITS } from '../contract.js';
import { decimal6 } from '../terrain/precision.js';
import { parseSettings } from '../validation.js';
import { MapValidationError } from '../errors.js';
import { bounded, PlanningFailure, Work } from './budget.js';
import { Context } from './context.js';
import { validate } from './validation.js';
import type {
  LocalJoin,
  PlanningInput,
  ReconciliationResult,
  RegionalPlanningOutput,
} from './types.js';
/** Replaces direct external approaches; F supplies actual world-space joins. */
export function reconcileLocalJoins(
  input: PlanningInput,
  plan: RegionalPlanningOutput,
  joins: LocalJoin[],
  pass = 1,
  previousWork = 0,
): ReconciliationResult {
  let meter: Work | undefined;
  const result = bounded(() => {
    preflightAsset(input, HARD_LIMITS);
    const settings = parseSettings(input.settings),
      s = settings.settlements;
    if (!Number.isInteger(pass) || pass < 1)
      throw new RangeError('Reconciliation pass must be a positive integer');
    if (pass > s.maxReconciliationPasses)
      throw new PlanningFailure(
        'RECONCILIATION_PASS_LIMIT',
        'reconciliation passes',
        'Recorded reconciliation pass cap exceeded.',
      );
    if (pass > 1 && previousWork < 1)
      throw new RangeError(
        'Subsequent reconciliation passes require prior consumed work, including failed attempts',
      );
    const work = new Work(s.maxGlobalReconciliationWork, 'reconciliation work');
    meter = work;
    work.take(previousWork);
    const remaining = work.max - work.used;
    if (remaining < 1)
      throw new PlanningFailure(
        'PLANNING_RESOURCE_LIMIT',
        'reconciliation work',
        'No reconciliation work remains.',
      );
    const c = new Context(
      {
        ...input,
        limits: {
          ...input.limits,
          maxValidationWork: Math.min(input.limits?.maxValidationWork ?? 100_000_000, remaining),
        },
      },
      work,
    );
    preflightAsset({ plan, joins }, HARD_LIMITS, () => work.take());
    const next = structuredClone(plan),
      seen = new Set<string>();
    for (const join of joins) {
      work.take();
      if (seen.has(join.entranceId)) throw new RangeError('Duplicate actual entrance join');
      seen.add(join.entranceId);
      if (
        !join.endpoint.every(Number.isFinite) ||
        !Number.isFinite(join.bearingDeg) ||
        join.bearingDeg < 0 ||
        join.bearingDeg >= 360 ||
        !Number.isFinite(join.widthM) ||
        join.widthM <= 0
      )
        throw new RangeError('Finite actual join dimensions/bearing required');
      const site = next.sites.find((s) => s.id === join.siteId),
        entrance = site?.entrances.find((e) => e.id === join.entranceId);
      if (!site || !entrance)
        throw new PlanningFailure(
          'RECONCILIATION_ID',
          join.entranceId,
          'Actual join references a missing stable site/entrance ID.',
        );
      if (
        polygonLocation(join.endpoint, site.placementArea, c.meter) !== 'boundary' ||
        Math.abs(join.widthM - entrance.widthM) > c.settings.geometry.joinToleranceM
      )
        throw new PlanningFailure(
          'RECONCILIATION_CONTRACT',
          join.entranceId,
          'Actual endpoint must lie on the permissible boundary and preserve reserved width.',
        );
      const road = next.roads.find((r) => r.id === entrance.roadId)!,
        node = next.roadNodes.find((n) => n.id === entrance.nodeId)!;
      if (
        road.crossingIds.length ||
        next.roads.filter((r) => r.fromNodeId === node.id || r.toNodeId === node.id).length !== 1
      )
        throw new PlanningFailure(
          'RECONCILIATION_TOPOLOGY',
          entrance.id,
          'Only one terminal ground approach can be reconciled by the v1 direct-connector policy.',
        );
      const from = road.fromNodeId === node.id,
        other = from ? road.path.at(-1)! : road.path[0]!,
        angle = (join.bearingDeg * Math.PI) / 180;
      const separation = distance(join.endpoint, other);
      const length = Math.min(c.spacing, Math.max(join.widthM, separation / 2), separation * 0.96);
      if (length <= c.settings.geometry.joinToleranceM)
        throw new PlanningFailure(
          'RECONCILIATION_DISTANCE',
          entrance.id,
          'Actual local join is too close to its external attachment.',
        );
      const outward: Point = [
        decimal6(join.endpoint[0] + Math.sin(angle) * length),
        decimal6(join.endpoint[1] - Math.cos(angle) * length),
      ];
      const path =
        distance(outward, other) <= 1e-6
          ? [join.endpoint.map(decimal6) as Point, other]
          : [join.endpoint.map(decimal6) as Point, outward, other];
      if (
        polygonLocation(interpolate(path[0]!, outward, 0.5), site.placementArea, c.meter) !==
        'outside'
      )
        throw new PlanningFailure(
          'RECONCILIATION_OUTWARD',
          entrance.id,
          'Actual tangent must leave the permissible region outward.',
        );
      try {
        validatePath(path, '$.generatedApproach', c.meter);
      } catch (e) {
        if (e instanceof MapValidationError && e.issues.every((i) => i.code === 'INVALID_MAP'))
          throw new PlanningFailure(
            'RECONCILIATION_PATH',
            entrance.id,
            'Generated actual connector backtracks or intersects itself.',
          );
        throw e;
      }
      node.position = path[0]!;
      road.path = from ? path : path.reverse();
      entrance.endpoint = node.position;
      entrance.bearingDeg = join.bearingDeg;
    }
    validate(c, next);
    return {
      plan: next,
      joins: next.sites.flatMap((s) => s.entrances).filter((e) => seen.has(e.id)),
      passes: pass,
      work: work.used,
    };
  });
  return { ...result, work: meter?.used ?? previousWork, passes: pass };
}
