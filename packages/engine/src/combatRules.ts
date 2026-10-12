import { MS_PER_MINUTE } from './types.js';

/**
 * The combat numbers, as plain data checked by `parseCombatData` (like `unitTypes.ts`). Each
 * group names where it comes from. docs/rules.md ("Combat v2") says which are traced to the
 * tables in `src/data` and which are our own placeholders; only the cover halving and the
 * flank bonus on artillery fire have a counterpart in `fire.json` (`modifiers`).
 */
export interface CombatData {
  fire: {
    /** Share of point-blank effect left at the edge of range; falls linearly. Placeholder. */
    longRangeFactor: number;
    /** Casualty multiplier for a blow at arm's length against fire. Placeholder. */
    meleeFactor: number;
    /** Casualty multipliers for blows from the target's side or back. Placeholders. */
    flankFactor: number;
    rearFactor: number;
    /** Casualty multiplier against a routed unit, which cannot form to answer. Placeholder. */
    routFactor: number;
  };
  morale: {
    /** Morale lost per percent of strength lost in one tick (before aspect). Placeholder. */
    lossPerPercent: number;
    /** Morale multipliers for losses taken from the flank or the rear. Placeholders. */
    flankShock: number;
    rearShock: number;
    /** A morale check is taken by a unit that lost at least this percent of its strength in a tick. */
    checkLossPercent: number;
    /** On a failed check the unit loses this much more morale. */
    checkFailLoss: number;
    /** The unit that came off worse in a melee tick (more lost than dealt) loses this much morale. */
    meleeLoserLoss: number;
  };
  rally: {
    /** A broken unit may try to rally this long after it broke, and then every `retryMs`. */
    firstTryMs: number;
    retryMs: number;
    /** It cannot rally with an enemy this close (metres), or once it is below this strength share. */
    enemyClearM: number;
    minStrengthShare: number;
    /** A d6 at or above this rallies the unit. */
    dieAtLeast: number;
    /** Morale of a rallied unit; it is shaken, not restored. */
    moraleAfter: number;
    /** Tries stop this long after the unit broke. */
    giveUpMs: number;
  };
}

export const COMBAT_DATA: CombatData = {
  fire: { longRangeFactor: 0.25, meleeFactor: 2, flankFactor: 1.5, rearFactor: 2, routFactor: 3 },
  morale: {
    lossPerPercent: 2,
    flankShock: 1.25,
    rearShock: 1.5,
    checkLossPercent: 4,
    checkFailLoss: 4,
    meleeLoserLoss: 4,
  },
  rally: {
    firstTryMs: 6 * MS_PER_MINUTE,
    retryMs: 2 * MS_PER_MINUTE,
    enemyClearM: 500,
    minStrengthShare: 0.3,
    dieAtLeast: 4,
    moraleAfter: 40,
    giveUpMs: 40 * MS_PER_MINUTE,
  },
};

export class CombatDataError extends Error {
  constructor(message: string) {
    super(`combat data: ${message}`);
    this.name = 'CombatDataError';
  }
}

function group(raw: unknown, name: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CombatDataError(`${name} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function num<T extends object>(
  g: Record<string, unknown>,
  name: string,
  keys: Array<keyof T & string>,
  max = Infinity,
): T {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = g[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max) {
      throw new CombatDataError(`${name}.${k} must be a positive number`);
    }
    out[k] = v;
  }
  return out as T;
}

/** Check raw combat data (e.g. parsed JSON) and return it typed, or throw `CombatDataError`. */
export function parseCombatData(raw: unknown): CombatData {
  const o = group(raw, 'data');
  const fire = num<CombatData['fire']>(group(o.fire, 'fire'), 'fire', [
    'longRangeFactor',
    'meleeFactor',
    'flankFactor',
    'rearFactor',
    'routFactor',
  ]);
  if (fire.longRangeFactor > 1) throw new CombatDataError('fire.longRangeFactor must be at most 1');
  const morale = num<CombatData['morale']>(group(o.morale, 'morale'), 'morale', [
    'lossPerPercent',
    'flankShock',
    'rearShock',
    'checkLossPercent',
    'checkFailLoss',
    'meleeLoserLoss',
  ]);
  const rally = num<CombatData['rally']>(group(o.rally, 'rally'), 'rally', [
    'firstTryMs',
    'retryMs',
    'enemyClearM',
    'minStrengthShare',
    'dieAtLeast',
    'moraleAfter',
    'giveUpMs',
  ]);
  if (rally.minStrengthShare > 1) throw new CombatDataError('rally.minStrengthShare at most 1');
  if (rally.dieAtLeast > 6) throw new CombatDataError('rally.dieAtLeast must be at most 6');
  if (rally.moraleAfter > 100) throw new CombatDataError('rally.moraleAfter must be at most 100');
  if (!Number.isInteger(rally.firstTryMs) || !Number.isInteger(rally.retryMs)) {
    throw new CombatDataError('rally times must be whole ms');
  }
  return { fire, morale, rally };
}

const DATA = parseCombatData(COMBAT_DATA);
export const FIRE_RULES = DATA.fire;
export const MORALE_RULES = DATA.morale;
export const RALLY_RULES = DATA.rally;
