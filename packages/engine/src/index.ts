/** Pure, deterministic engine. Never reads the wall clock. */
export const ENGINE_NAME = 'kriegsspiel-engine';

/** Advance a game time (in game seconds) by a delta. Placeholder for the real clock. */
export function advance(gameTime: number, delta: number): number {
  return gameTime + delta;
}
