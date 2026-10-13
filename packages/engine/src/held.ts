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
