import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerPlacement,
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
  registerPlacement(r);
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

/** What the new-game screen shows about a scenario. */
export interface ScenarioInfo {
  id: string;
  name: string;
  briefing: string;
  /** Rough game time to a result, in minutes. */
  lengthMinutes: number;
  sides: Array<{ id: string; name: string; controller: 'human' | 'scripted' }>;
  defaults: { side: string; rate: number };
}

const BRIEFINGS: Record<string, { briefing: string; lengthMinutes: number }> = {
  [holdTheBridge.id]: {
    briefing:
      'Blue holds a river crossing on the high road against a Red advance from the north. ' +
      'Blue wins by keeping the bridge for three hours; Red wins by taking it.',
    lengthMinutes: 240,
  },
};

/** The scenarios a game can be made from, with what a player needs to choose one. */
export function scenarioList(): ScenarioInfo[] {
  return [holdTheBridge].map((raw) => {
    const sides = raw.sides.map((s) => ({
      id: s.id,
      name: s.name,
      controller: s.controller as 'human' | 'scripted',
    }));
    const meta = BRIEFINGS[raw.id] ?? { briefing: '', lengthMinutes: 0 };
    return {
      id: raw.id,
      name: raw.name,
      ...meta,
      sides,
      defaults: { side: (sides.find((s) => s.controller === 'human') ?? sides[0]!).id, rate: 12 },
    };
  });
}
