import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerJudgment,
  registerMovement,
  registerOrders,
  registerPlacement,
  registerTurn,
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
  registerTurn(r);
  registerJudgment(r);
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

const BRIEFINGS: Record<string, string> = {
  [holdTheBridge.id]:
    'Blue holds a river crossing on the high road against a Red advance from the north. ',
};

/** "50 minutes", "3 hours" or "1 hour 30 minutes". */
function spanText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return [h > 0 ? part(h, 'hour') : '', m > 0 ? part(m, 'minute') : ''].filter(Boolean).join(' ');
}

/** The scenarios a game can be made from, with what a player needs to choose one. */
export function scenarioList(): ScenarioInfo[] {
  return [holdTheBridge].map((raw) => {
    const sides = raw.sides.map((s) => ({
      id: s.id,
      name: s.name,
      controller: s.controller as 'human' | 'scripted',
    }));
    // The length and the win condition are read from the scenario, so they cannot go stale.
    const holdMinutes = raw.victory.holdMinutes;
    const name = (id: string) => raw.sides.find((s) => s.id === id)?.name ?? id;
    const briefing =
      (BRIEFINGS[raw.id] ?? '') +
      `${name(raw.victory.defender)} wins by keeping the objective for ${spanText(holdMinutes)}; ` +
      `${name(raw.victory.attacker)} wins by taking it, or by breaking the defence.`;
    return {
      id: raw.id,
      name: raw.name,
      briefing,
      lengthMinutes: holdMinutes,
      sides,
      defaults: { side: (sides.find((s) => s.controller === 'human') ?? sides[0]!).id, rate: 12 },
    };
  });
}
