/**
 * Post-game umpire's window (docs/gameplay.md, After the game). Rebuilds a finished game from its
 * input log and returns what a live game never sends: every unit's true position, the dice and
 * the umpire's rulings, beside what each side believed at that time.
 *
 * This is the one place master state is shaped for a game client, so `app.ts` calls it only after
 * the game has ended. It reads the log through `replayLog`, so it makes no model call.
 */
import { viewFor, type GameState, type SideId, type TurnRuling } from '@kriegsspiel/engine';
import type {
  Belief,
  TrueUnit,
  WindowAt,
  WindowTimeline,
  WindowTurn,
  WindowTurnUnit,
} from '@kriegsspiel/protocol';
import { replayAt, replayTimeline, type ReplayInput } from '../admin/replayView.js';
import { replayTurns, type ReplayedTurn } from '../admin/turnView.js';
import type { UmpireTurnOutput } from '../game/umpireTurn.js';

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

/** The timeline the window opens on: a turn-mode game's also lists its turns (another replay). */
export function withTurns(input: ReplayInput, timeline: WindowTimeline): WindowTimeline {
  return input.header.settings?.mode === 'turns'
    ? { ...timeline, turns: windowTurns(input) }
    : timeline;
}

/**
 * Each turn's outcome (11.11): who decided it, the umpire's account, losses, corrections, dice and
 * journal. Master state: served only behind the window's game-over gate.
 */
export function windowTurns(input: ReplayInput): WindowTurn[] {
  return replayTurns(input).map(windowTurn);
}

function windowTurn(r: ReplayedTurn): WindowTurn {
  const { turn: t, before, after } = r;
  const out = t.output as Partial<UmpireTurnOutput> | undefined;
  const umpire = t.adjudicator === 'umpire' && !r.entry.error ? out : undefined;
  const losses: Record<string, number> = {};
  for (const side of after.world.sides) losses[side.id] = 0;
  const units: WindowTurnUnit[] = [];
  for (const u of after.world.units) {
    const was = before.world.units.find((x) => x.id === u.id);
    if (!was || was.status === 'destroyed') continue;
    const lost = Math.max(0, Math.round(was.strength - u.strength));
    losses[u.side] = (losses[u.side] ?? 0) + lost;
    if (lost > 0 || was.status !== u.status) {
      units.push({ id: u.id, side: u.side, name: u.name, lost, from: was.status, to: u.status });
    }
  }
  const corrections = after.world.rulings.filter(
    (x): x is TurnRuling => 'kind' in x && x.kind === 'turn' && x.turn === t.n,
  ).length;
  const journal = after.world.journal;
  const summary = umpire?.proposal?.summary;
  return {
    n: t.n,
    startMs: t.startMs,
    endMs: after.time,
    adjudicator: t.adjudicator,
    fellBack: t.fallback !== undefined,
    ...(typeof summary === 'string' && summary ? { summary } : {}),
    losses,
    units,
    corrections,
    rolls: (umpire?.context?.rolls ?? []).map(({ why, chance, success }) => ({
      why,
      chance,
      success,
    })),
    ...(journal
      ? {
          journal: {
            notes: journal.notes.map(({ turn, note }) => ({ turn, note })),
            precedents: journal.precedents.map(({ turn, ruling }) => ({ turn, ruling })),
          },
        }
      : {}),
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
  const named = namedIn(world);
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
        ...('proposal' in x
          ? { unitId: x.proposal.unitId }
          : 'unitId' in x && x.unitId
            ? { unitId: x.unitId }
            : {}),
        rationale: named(x.rationale),
        narrative: 'kind' in x && x.kind === 'turn' ? turnNarrative(named, x) : named(x.narrative),
      })),
  };
}

/** What a corrected outcome field reads as in the window (#538). */
const FIELD_WORDS: Record<string, string> = {
  outcome: 'outcome',
  departure: 'departure from the projection',
  position: 'position',
  strength: 'losses',
  status: 'state',
  morale: 'morale',
  fatigue: 'fatigue',
  ammo: 'ammunition',
  orders: 'orders',
  observation: 'sighting',
};

/**
 * A turn ruling as a player reads it (#538): the unit by its name, not its id, and the field in
 * words. The ruling itself keeps the id and field; only the window's wording changes.
 */
function turnNarrative(named: (text: string) => string, r: TurnRuling): string {
  const what = FIELD_WORDS[r.field] ?? r.field;
  return `The umpire's turn ${r.turn} was corrected for ${named(r.unitId)} (${what}): ${named(r.reason)}.`;
}

/**
 * Text with every unit id in it replaced by the unit's name, longest id first so "red-10" is not
 * read as "red-1" (#538). An id is matched only as a whole token.
 */
export function namedIn(world: GameState): (text: string) => string {
  const units = [...world.units].sort((a, b) => b.id.length - a.id.length);
  if (units.length === 0) return (text) => text;
  const names = new Map(units.map((u) => [u.id, u.name]));
  const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<![\\w-])(${units.map((u) => escape(u.id)).join('|')})(?![\\w-])`,
    'g',
  );
  return (text) => text.replace(pattern, (id) => names.get(id) ?? id);
}
