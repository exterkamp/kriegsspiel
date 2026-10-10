import type { GameState } from '@kriegsspiel/engine';
import { ScriptedOpponent, type SideAgent } from './scriptedOpponent.js';

export * from './scriptedOpponent.js';

/**
 * A scripted agent for every side the scenario marks `scripted`. Built once at game start from
 * public scenario facts (the objective, the side's own HQ); it reads no master state after that.
 */
export function scriptedAgents(world: GameState): SideAgent[] {
  const { objective } = world.victory;
  return world.sides
    .filter((s) => s.controller === 'scripted')
    .map(
      (s) =>
        new ScriptedOpponent({
          side: s.id,
          seed: world.seed,
          objective: { x: objective.x / 1000, y: objective.y / 1000 },
          fallbackTo: { x: s.hq.x / 1000, y: s.hq.y / 1000 },
        }),
    );
}
