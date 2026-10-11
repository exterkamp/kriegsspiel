import { withMark } from '../table/marks.js';
import type {
  ClockState,
  Dispatch,
  Mark,
  ServerMessage,
  Side,
  SideView,
} from '@kriegsspiel/protocol';

/** An order this client sent that the server has not rejected. The server reports no delivery estimate yet. */
export interface PendingOrder {
  orderId: string;
  text: string;
  /** Game time when it was sent, as best the client knows. */
  sentAtGame: number;
}

export interface Notice {
  code: string;
  message: string;
}

export interface GameOver {
  winner: Side | null;
  reason: Extract<ServerMessage, { kind: 'gameOver' }>['reason'];
  atGame: number;
}

export type LinkStatus = 'connecting' | 'open' | 'closed' | 'offline';

/** Where game time was at a local wall time; the clock display runs forward from here. */
export interface ClockAnchor {
  gameMs: number;
  localWallMs: number;
  rate: number;
  status: ClockState['status'];
}

export interface ClientState {
  link: LinkStatus;
  view?: SideView;
  /** Newest first by arrival, deduplicated by id. */
  dispatches: Dispatch[];
  /** Ids of dispatches the player has opened. Local to this client. */
  read: ReadonlySet<string>;
  clock?: ClockAnchor;
  staffAtWork: boolean;
  pending: PendingOrder[];
  /** Set once the server says the game has ended. */
  gameOver?: GameOver;
  /** The side's marks on the table, as the server last sent them plus this client's own edits. */
  marks: Mark[];
  /** Newest last; the HUD shows the latest few. */
  notices: Notice[];
}

export const initialState: ClientState = {
  link: 'connecting',
  dispatches: [],
  read: new Set(),
  staffAtWork: false,
  pending: [],
  marks: [],
  notices: [],
};

const MAX_NOTICES = 20;

function anchorOf(gameMs: number, clock: ClockState, localWallMs: number): ClockAnchor {
  return { gameMs, localWallMs, rate: clock.rate, status: clock.status };
}

function withDispatches(have: Dispatch[], incoming: readonly Dispatch[]): Dispatch[] {
  const ids = new Set(have.map((d) => d.id));
  const fresh = incoming.filter((d) => !ids.has(d.id));
  return fresh.length === 0 ? have : [...fresh, ...have];
}

/** The order id a rejection or clarification refers to; the server prefixes its message with `<orderId>: `. */
export function orderIdOf(message: string): string | undefined {
  const i = message.indexOf(': ');
  return i > 0 ? message.slice(0, i) : undefined;
}

/**
 * Pure reducer from server messages to client state. `nowWall` is the local wall clock at receipt.
 * Only fog-filtered data from the wire is ever stored.
 */
export function applyServerMessage(s: ClientState, m: ServerMessage, nowWall: number): ClientState {
  switch (m.kind) {
    case 'viewUpdate':
      return {
        ...s,
        view: m.view,
        dispatches: withDispatches(s.dispatches, m.view.dispatches),
        clock: anchorOf(m.view.atGame, m.view.clock, nowWall),
      };
    case 'dispatch':
      return { ...s, dispatches: withDispatches(s.dispatches, [m.dispatch]) };
    case 'clockState':
      // Sent when the clock changes, so its anchor is (about) now.
      return { ...s, clock: anchorOf(m.clock.gameMsAtAnchor, m.clock, nowWall) };
    case 'marks':
      return { ...s, marks: m.marks };
    case 'staffAtWork':
      return { ...s, staffAtWork: m.working };
    case 'serverRestarted': {
      const mins = Math.round(m.downMs / 60_000);
      const away = mins >= 1 ? `at least ${mins} min` : 'a short while';
      const message = `The server was down for ${away}. The game came back paused; no game time passed. Confirm to resume.`;
      const notices = [...s.notices, { code: 'server_restart', message }].slice(-MAX_NOTICES);
      return { ...s, notices };
    }
    case 'gameOver':
      return { ...s, gameOver: { winner: m.winner, reason: m.reason, atGame: m.atGame } };
    case 'notification': {
      // What would reach an away player by push or email, shown to one who has the game open.
      const notices = [
        ...s.notices,
        { code: `notify_${m.event}`, message: `${m.title}. ${m.text}` },
      ].slice(-MAX_NOTICES);
      return { ...s, notices };
    }
    case 'error': {
      const id = orderIdOf(m.message);
      const dropped = id === undefined ? s.pending : s.pending.filter((p) => p.orderId !== id);
      const notices = [...s.notices, { code: m.code, message: m.message }].slice(-MAX_NOTICES);
      return { ...s, pending: dropped, notices };
    }
  }
}

export function withLink(s: ClientState, link: LinkStatus): ClientState {
  return { ...s, link };
}

export function withPendingOrder(s: ClientState, order: PendingOrder): ClientState {
  return { ...s, pending: [...s.pending, order] };
}

export function withRead(s: ClientState, id: string): ClientState {
  return s.read.has(id) ? s : { ...s, read: new Set([...s.read, id]) };
}

/** Game time now, in ms: the anchor plus local elapsed time at the clock's rate while running. */
export function gameNowMs(clock: ClockAnchor, nowWall: number): number {
  if (clock.status !== 'running') return clock.gameMs;
  return clock.gameMs + Math.max(0, nowWall - clock.localWallMs) * clock.rate;
}

/** `Day 1 14:05` from game ms since scenario start. */
export function formatGameTime(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const day = Math.floor(totalMin / 1440) + 1;
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}:1`;
}

/** Local edit: put a mark in place (or add it) before the server echoes the list. */
export function withMarkPut(s: ClientState, mark: Mark): ClientState {
  return { ...s, marks: withMark(s.marks, mark) };
}

export function withMarkDeleted(s: ClientState, markId: string): ClientState {
  return { ...s, marks: s.marks.filter((m) => m.id !== markId) };
}
