/**
 * Post-game umpire's window (docs/gameplay.md, After the game). Rebuilds a finished game from its
 * input log and returns what a live game never sends: every unit's true position, the dice and
 * the umpire's rulings, beside what each side believed at that time.
 *
 * This is the one place master state is shaped for a game client, so `app.ts` calls it only after
 * the game has ended. It reads the log through `replayLog`, so it makes no model call.
 */
import { viewFor, type GameState, type SideId } from '@kriegsspiel/engine';
import type { Belief, TrueUnit, WindowAt, WindowTimeline } from '@kriegsspiel/protocol';
import { replayAt, replayTimeline, type ReplayInput } from '../admin/replayView.js';

/** The timeline of a game, or undefined while its replay has no outcome yet. */
export function windowTimeline(input: ReplayInput, untilMs?: number): WindowTimeline | undefined {
  const tl = replayTimeline(input, untilMs);
  if (!tl.outcome) return undefined;
  return {
    endMs: tl.endMs,
    outcome: { winner: tl.outcome.winner, reason: tl.outcome.reason, time: tl.outcome.time },
    marks: tl.marks,
  };
}

/** The game at `gameMs`: truth, each side's belief, the events so far and the umpire's rulings. */
export function windowAt(input: ReplayInput, gameMs: number): WindowAt {
  const r = replayAt(input, gameMs);
  const world: GameState = r.engine.world;
  const units: TrueUnit[] = [];
  const beliefs: Record<string, Belief> = {};
  for (const side of world.sides) {
    const view = viewFor(world, side.id as SideId, r.gameMs);
    for (const u of view.ownUnits) {
      units.push({
        id: u.id,
        side: side.id as SideId,
        name: u.name,
        position: u.position,
        facing: u.facing,
        formation: u.formation,
        footprint: u.footprint,
        ...(u.shape ? { shape: u.shape } : {}),
        strength: u.strength,
        morale: u.morale,
        ammo: u.ammo,
      });
    }
    const wire = r.views[side.id]!;
    beliefs[side.id] = {
      visibleEnemies: wire.visibleEnemies,
      lastKnownContacts: wire.lastKnownContacts,
    };
  }
  return {
    gameMs: r.gameMs,
    units,
    beliefs,
    events: r.events.map((e) => ({ time: e.time, type: e.type, payload: e.payload })),
    rulings: world.rulings
      .filter((x) => x.time <= r.gameMs)
      .map((x) => ({
        id: x.id,
        time: x.time,
        unitId: x.proposal.unitId,
        rationale: x.rationale,
        narrative: x.narrative,
      })),
  };
}
