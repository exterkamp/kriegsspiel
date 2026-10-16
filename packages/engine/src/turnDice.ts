/**
 * The umpire's dice (D39 "Dice only when asked", story 11.7). In an umpire turn the umpire may
 * ask for a few rolls and state the odds of each; the engine screens the requests and rolls them.
 * The umpire never rolls, and its dice never touch the world's RNG: they are drawn from a stream
 * of their own, seeded from the world's RNG state at the turn's start and the turn number, so the
 * courier pass, the projection and a fallback turn draw exactly what they would with no rolls,
 * and replay can draw the same rolls again from the state at `T0` with no model.
 */
import { Rng, seedRng, type RngState } from './rng.js';
import type { TurnRoll, TurnRollRequest } from './turn.js';

/** The most rolls the umpire may have in one turn (#403). */
export const TURN_ROLLS_PER_TURN = 3;
/** The odds a roll may be given, inclusive: a surer or longer chance is the umpire's to decide. */
export const TURN_ROLL_CHANCE = { min: 0.05, max: 0.95 } as const;

/** The umpire's dice for turn `n`: `seedRng(r0 ^ n)`, `r0` the world's RNG state at `T0`. */
export function turnDice(rngAtStart: RngState, n: number): Rng {
  return new Rng(seedRng(rngAtStart ^ n));
}

export interface ScreenedRolls {
  /** The requests to roll, as asked (in the order listed). */
  accepted: TurnRollRequest[];
  /** One line per refused request, for the umpire's next call. */
  problems: string[];
}

/**
 * Which of the umpire's roll requests the engine will roll. A request is refused, with a stated
 * problem, if its id repeats an earlier one, its chance is outside `TURN_ROLL_CHANCE`, or
 * `TURN_ROLLS_PER_TURN` requests have already been accepted (so a fourth valid one is refused).
 */
export function screenRollRequests(requests: readonly TurnRollRequest[]): ScreenedRolls {
  const accepted: TurnRollRequest[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const { min, max } = TURN_ROLL_CHANCE;
  for (const r of requests) {
    const refuse = (why: string) =>
      problems.push(`rolls: ${r.id}: ${why}; decide it without a roll`);
    if (seen.has(r.id)) {
      refuse('the id is used by an earlier roll');
      continue;
    }
    seen.add(r.id);
    if (!Number.isFinite(r.chance) || r.chance < min || r.chance > max) {
      refuse(`its chance ${r.chance} is outside ${min}..${max}`);
      continue;
    }
    if (accepted.length >= TURN_ROLLS_PER_TURN) {
      refuse(`at most ${TURN_ROLLS_PER_TURN} rolls a turn`);
      continue;
    }
    accepted.push({ id: r.id, why: r.why, chance: r.chance });
  }
  return { accepted, problems };
}

/**
 * Roll `requests` for turn `n` on the umpire's dice, in id order, one draw each: a roll succeeds
 * when `rng.next() < chance`. Pure: the same state, turn and requests give the same rolls, which
 * is how replay checks the logged ones.
 */
export function rollTurnDice(
  rngAtStart: RngState,
  n: number,
  requests: readonly TurnRollRequest[],
): TurnRoll[] {
  const rng = turnDice(rngAtStart, n);
  return [...requests]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => {
      const roll = rng.next();
      return { id: r.id, why: r.why, chance: r.chance, roll, success: roll < r.chance };
    });
}
