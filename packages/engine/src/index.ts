/** Pure, deterministic engine. Never reads the wall clock. */
export const ENGINE_NAME = 'kriegsspiel-engine';

/** Advance a game time (in game milliseconds) by a delta. Placeholder for the real clock. */
export function advance(gameTime: number, delta: number): number {
  return gameTime + delta;
}

export * from './types.js';
export { loadScenario, ScenarioError } from './scenario.js';
export { holdTheBridge } from './scenarios/holdTheBridge.js';
