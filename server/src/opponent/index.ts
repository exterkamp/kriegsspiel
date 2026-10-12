import { featureAnchor, polygonCentroid, type GameState, type SideId } from '@kriegsspiel/engine';
import type { OrderParser } from '../orders/index.js';
import { hiddenTerms } from '../umpire/leakGuard.js';
import type { UmpireClient } from '../umpire/umpireClient.js';
import {
  LlmCommander,
  type CommanderNote,
  type Difficulty,
  type Personality,
} from './llmCommander.js';
import { ScriptedOpponent, type SideAgent } from './scriptedOpponent.js';

export * from './scriptedOpponent.js';
export * from './llmCommander.js';

/**
 * A scripted agent for every side the scenario marks `scripted`. Built once at game start from
 * public scenario facts (the objective, the side's own HQ); it reads no master state after that.
 */
export function scriptedAgents(world: GameState): SideAgent[] {
  const objective = polygonCentroid(world.victory.objective);
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

export interface LlmAgentOptions {
  /** The model client for this game: wrap the shared one in a `GameUmpireClient` to cap its spend. */
  client: UmpireClient;
  parser: OrderParser;
  difficulty?: Difficulty;
  personality?: Personality;
  onNote?: (side: string, note: CommanderNote) => void;
}

/**
 * An LLM commander for every side the scenario marks `scripted`, each backed by the scripted
 * opponent for the decisions the model cannot make. Built from the same public facts.
 */
export function llmAgents(world: GameState, opts: LlmAgentOptions): SideAgent[] {
  const places = world.map.features.map((f) => ({
    id: f.id,
    kind: f.kind,
    ...(f.name === undefined ? {} : { name: f.name }),
    anchor: featureAnchor(f.geometry),
  }));
  const objective = polygonCentroid(world.victory.objective);
  return scriptedAgents(world).map(
    (fallback) =>
      new LlmCommander({
        side: fallback.side,
        client: opts.client,
        parser: opts.parser,
        objective: { x: Math.round(objective.x / 1000), y: Math.round(objective.y / 1000) },
        places,
        fallback,
        hidden: (view) => {
          const seen = new Set([
            ...view.visibleEnemies.map((e) => e.id),
            ...view.lastKnownContacts.map((c) => c.id),
          ]);
          return [
            ...hiddenTerms(world, fallback.side as SideId),
            ...world.units
              .filter((u) => u.side !== fallback.side && !seen.has(u.id))
              .map((u) => u.id),
          ];
        },
        difficulty: opts.difficulty,
        personality: opts.personality,
        onNote: (note) => opts.onNote?.(fallback.side, note),
      }),
  );
}
