import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
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

const SCENARIOS: Record<string, () => GameState> = {
  [holdTheBridge.id]: () => loadScenario(holdTheBridge),
};

/** Load a scenario by id, for replay. */
export function loadScenarioById(id: string): GameState {
  const load = SCENARIOS[id];
  if (!load) throw new Error(`unknown scenario: ${id}`);
  return load();
}
