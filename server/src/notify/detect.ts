/**
 * Spot what is new for each side between two looks at a game. Reads only the visibility filter
 * (`viewFor`) and public clock/vote state, so an event can only name what the side already knows.
 */
import { viewFor, type SideId } from '@kriegsspiel/engine';
import type { GameActor } from '../game/index.js';
import type { NotifyEvent } from './policy.js';

/** What was seen at the last look. */
export interface Seen {
  reports: Map<SideId, Set<string>>;
  status: string;
  pauseProposal: string | undefined;
  ratioProposal: string | undefined;
  over: boolean;
}

export interface Detected {
  side: SideId;
  event: NotifyEvent;
}

const KIND: Record<string, NotifyEvent> = { contact: 'contact', unitLost: 'unitLost' };

function look(game: GameActor): Seen {
  const { state } = game;
  const reports = new Map<SideId, Set<string>>();
  for (const side of state.world.sides) {
    const view = viewFor(state.world, side.id, state.time);
    reports.set(
      side.id,
      new Set([...view.reports.map((r) => r.id), ...view.documents.map((d) => d.id)]),
    );
  }
  return {
    reports,
    status: game.gameClock.snapshot().status,
    pauseProposal: game.pauseState?.proposal?.id,
    ratioProposal: game.ratioState?.proposal?.id,
    over: Boolean(state.world.outcome),
  };
}

/** The first look at a game sets the baseline and reports nothing: old papers are not news. */
export function baseline(game: GameActor): Seen {
  return look(game);
}

export function detect(prev: Seen, game: GameActor): { events: Detected[]; seen: Seen } {
  const { state } = game;
  const events: Detected[] = [];
  const seen = look(game);
  for (const side of state.world.sides) {
    const had = prev.reports.get(side.id) ?? new Set<string>();
    const view = viewFor(state.world, side.id, state.time);
    for (const r of view.reports) {
      if (!had.has(r.id)) events.push({ side: side.id, event: KIND[r.kind] ?? 'dispatch' });
    }
    for (const d of view.documents) {
      if (!had.has(d.id)) events.push({ side: side.id, event: 'dispatch' });
    }
  }
  const sides = state.world.sides.map((s) => s.id);
  const proposal = game.pauseState?.proposal;
  if (proposal && proposal.id !== prev.pauseProposal) {
    for (const side of sides) {
      if (side !== proposal.by && !(side in proposal.votes))
        events.push({ side, event: 'pauseProposed' });
    }
  }
  const ratio = game.ratioState?.proposal;
  if (ratio && ratio.id !== prev.ratioProposal) {
    for (const side of sides) {
      if (side !== ratio.by && !(side in ratio.votes)) events.push({ side, event: 'decision' });
    }
  }
  if (prev.status === 'running' && seen.status === 'paused') {
    for (const side of sides) events.push({ side, event: 'paused' });
  } else if (prev.status === 'paused' && seen.status === 'running') {
    for (const side of sides) events.push({ side, event: 'resumed' });
  }
  if (seen.over && !prev.over) for (const side of sides) events.push({ side, event: 'gameOver' });
  return { events, seen };
}
