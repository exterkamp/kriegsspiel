import type { Unit } from './types.js';

/** How hard a unit is marching. A forced march is faster and wears the men out faster. */
export const PACES = ['march', 'forced'] as const;
export type Pace = (typeof PACES)[number];

/** Multiplier on march speed at a forced pace. */
export const FORCED_PACE_FACTOR = 1.5;

/** Fatigue (0 fresh .. 100 spent) gained per game minute on the march, by pace. */
export const FATIGUE_PER_MARCH_MINUTE: Record<Pace, number> = { march: 0.3, forced: 1.2 };
/** Fatigue gained by every unit in a fire or melee exchange, per combat tick. */
export const FATIGUE_PER_FIGHT_TICK = 3;
/** Fatigue shed per game minute standing still out of reach of the enemy. */
export const FATIGUE_RECOVERY_PER_MINUTE = 0.4;
/** Fatigue up to this much does not slow the march: troops are only worn down beyond it. */
export const FATIGUE_FREE = 20;
/** A fully spent unit (fatigue 100) marches this much slower. Speed falls linearly past `FATIGUE_FREE`. */
export const FATIGUE_SPEED_LOSS = 0.4;
/** From this fatigue a unit is exhausted: its morale wears down and its officers report it. */
export const EXHAUSTED_FATIGUE = 70;
/** Morale lost per supply tick by an exhausted or out-of-ammunition unit, never below its break point. */
export const STRAIN_MORALE_DRAIN = 1;

/** Multiplier on march speed from pace and fatigue; 1 for a fresh unit at a plain march. */
export function speedFactor(u: Partial<Pick<Unit, 'pace' | 'fatigue'>>): number {
  const pace = u.pace === 'forced' ? FORCED_PACE_FACTOR : 1;
  return (
    pace *
    (1 - (FATIGUE_SPEED_LOSS * Math.max(0, (u.fatigue ?? 0) - FATIGUE_FREE)) / (100 - FATIGUE_FREE))
  );
}
