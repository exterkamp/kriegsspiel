import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  startGame,
  startVisibility,
  type EngineState,
  type GameState,
} from '@kriegsspiel/engine';

/** An event registry with every handler the engine has. */
export function createRegistry(): EventRegistry<GameState> {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/**
 * The state a new game starts in: the scenario's state with the first scheduled events queued
 * (the visibility scans and the combat chain). `GameHost` applies it to a new game and replay
 * applies it before the first input, so a log replays to the world it was played in.
 */
export function startingState(state: EngineState<GameState>): EngineState<GameState> {
  return startGame(startVisibility(state));
}

const SCENARIOS: Record<string, () => GameState> = {
  [holdTheBridge.id]: () => loadScenario(holdTheBridge),
};

/** Load a scenario by id, for replay. */
export function loadScenarioById(id: string): GameState {
  const load = SCENARIOS[id];
  if (!load) throw new Error(`unknown scenario: ${id}`);
  return load();
}
