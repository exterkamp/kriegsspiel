import type { GameState, GameTime } from './types.js';

/**
 * True while `world` is in a turn the umpire resolves (D39): units are held where they stood at
 * the turn's start while the couriers ride, and movement, combat, rally, supply and the sight
 * scan do nothing until `umpire.turn` applies the outcome at the turn's end.
 */
export function heldTurn(world: GameState, time: GameTime): boolean {
  const t = world.turn;
  return t !== undefined && t.adjudicator === 'umpire' && time >= t.startMs && time <= t.endMs;
}

/**
 * When a paper written at `time` reaches headquarters, `delayMs` later. In a turn (D39) a paper
 * written before the turn's end is in that turn's reports: the player reads the whole turn at once
 * and writes the next turn's orders from it, so one still on the road at the end is handed in then
 * (#438). Real-time play, and a paper written at or after the turn's end, keep the full delay.
 */
export function reachesHqAt(world: GameState, time: GameTime, delayMs: number): GameTime {
  const t = world.turn;
  const at = time + delayMs;
  return t !== undefined && time < t.endMs ? Math.min(at, t.endMs) : at;
}
