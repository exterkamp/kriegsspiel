import { distance, mm } from './geometry.js';
import type { Point, Unit, UnitKind } from './types.js';

export const COMBAT_CHECK_EVENT = 'combat.check';
export const COMBAT_TICK_EVENT = 'combat.tick';
export const ATTACK_INTENT_EVENT = 'intent.attack';
export const VICTORY_DEADLINE_EVENT = 'victory.deadline';

/**
 * How far each kind can hurt an enemy, in metres. Placeholder numbers: infantry
 * fire at 200 m, cavalry only in a charge, guns much further. Real tables
 * arrive with Epic #2.
 */
export const RANGE_M: Record<UnitKind, number> = {
  infantry: 200,
  cavalry: 100,
  artillery: 400,
};

/** A unit holds the objective when its centre is within this many metres of it. */
export const OBJECTIVE_RADIUS_M = 30;

/** Distance in mm between two points. */
export function distanceMm(a: Point, b: Point): number {
  return distance(a, b);
}

/** True if `shooter` can hit `target` from where they stand. */
export function canReach(shooter: Unit, target: Unit): boolean {
  return distance(shooter.center, target.center) <= mm(RANGE_M[shooter.kind]);
}

/** True if the unit stands on the objective. */
export function onObjective(unit: Unit, objective: Point): boolean {
  return distance(unit.center, objective) <= mm(OBJECTIVE_RADIUS_M);
}
