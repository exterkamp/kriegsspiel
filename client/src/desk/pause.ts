import { pauseResultText, type ClientState } from '../net/state.js';
import type { PauseProposal } from '@kriegsspiel/protocol';

export { pauseResultText };

/** What the pause panel shows. Pure, so it needs no DOM. */
export type PausePanelView =
  /** The game has no pause voting, or the game is over. */
  | { kind: 'hidden' }
  /** Nothing is being voted on: offer to ask. */
  | { kind: 'idle'; action: 'pause' | 'resume' }
  /** A vote is open. `needsVote` is true until this player has cast theirs. */
  | {
      kind: 'vote';
      id: string;
      action: 'pause' | 'resume';
      headline: string;
      reason?: string;
      secondsLeft: number;
      tally: string;
      needsVote: boolean;
      myVote?: boolean;
      waitingOn: number;
    };

const sideName = (side: string | undefined): string =>
  side === undefined ? 'A player' : `${side[0]!.toUpperCase()}${side.slice(1)}`;

function headline(p: PauseProposal): string {
  const what = p.kind === 'pause' ? 'pause the game' : 'resume the game';
  return p.byYou ? `You asked to ${what}.` : `${sideName(p.bySide)} asks to ${what}.`;
}

export function pausePanel(state: ClientState, nowWall: number): PausePanelView {
  const pause = state.pause;
  if (!pause || state.gameOver) return { kind: 'hidden' };
  const p = pause.proposal;
  if (!p) {
    return { kind: 'idle', action: pause.phase === 'paused' ? 'resume' : 'pause' };
  }
  const waitingOn = Math.max(0, p.voters - p.yes - p.no);
  return {
    kind: 'vote',
    id: p.id,
    action: p.kind,
    headline: headline(p),
    ...(p.reason ? { reason: p.reason } : {}),
    secondsLeft: Math.max(0, Math.ceil((p.closesAtWall - nowWall) / 1000)),
    tally: `${p.yes} of ${p.voters} yes${p.no > 0 ? `, ${p.no} no` : ''}`,
    needsVote: p.myVote === undefined,
    ...(p.myVote === undefined ? {} : { myVote: p.myVote }),
    waitingOn,
  };
}

/** True while this player has a vote to cast, for the page title and the desk bar. */
export function voteWaiting(state: ClientState): boolean {
  const p = state.pause?.proposal;
  return p !== undefined && p.myVote === undefined && !state.gameOver;
}

/** The page title, marked while a vote waits for this player so a background tab shows it. */
export function pageTitle(base: string, state: ClientState): string {
  return voteWaiting(state) ? `(vote) ${base}` : base;
}
