import {
  advanceTo,
  type EmittedEvent,
  type EngineState,
  type EventRegistry,
  type GameState,
} from '@kriegsspiel/engine';

/**
 * `advanceTo`, except that a finished game does not run on: nothing happens once the world has an
 * outcome, and an advance that crosses the outcome stops at its game time. The live actor and
 * replay both advance through this, so the final time does not depend on how the advance was
 * chunked (rate, fast-forward, a late tick).
 */
export function advanceUntilOver(
  state: EngineState<GameState>,
  t: number,
  registry: EventRegistry<GameState>,
): { state: EngineState<GameState>; emitted: EmittedEvent[] } {
  if (state.world.outcome) return { state, emitted: [] };
  const res = advanceTo(state, t, registry);
  const outcome = res.state.world.outcome;
  // Advancing is pure, so re-running to the outcome time gives the state as it stood then.
  return outcome && outcome.time < t ? advanceTo(state, outcome.time, registry) : res;
}
