import { withMark } from '../table/marks.js';
import type {
  ClockState,
  Dispatch,
  Mark,
  PausePhase,
  PauseProposal,
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
  /** What the player wrote, without the addressee's name or annex added to `text`. */
  words?: string;
  /** Who it was addressed to, when sent from the orders desk. */
  toName?: string;
  courier?: 'fast' | 'safe';
  /** The staff's estimate of when it arrives, in game ms. */
  etaGame?: number;
}

/** What became of an order the player sent, when the client knows. */
export interface OrderOutcome {
  kind: 'refused';
  /** The player's own words, as sent. */
  text: string;
  toName?: string;
  sentAtGame: number;
  /** The staff's reply with the internal order id removed. */
  reason: string;
  /** The server's error code, such as `order_clarification`. */
  code?: string;
}

export interface Notice {
  code: string;
  message: string;
}

export interface GameOver {
  winner: Side | null;
  reason: Extract<ServerMessage, { kind: 'gameOver' }>['reason'];
  atGame: number;
  loserOut?: 'eliminated' | 'withdrawn';
}

/** What came in while the player was away, from the server's `catchUp`. */
export interface CatchUp {
  sinceGame: number;
  atGame: number;
  /** Ids of dispatches delivered since `sinceGame`. Stored for the in-tray to mark as new; nothing reads it yet. */
  dispatchIds: readonly string[];
}

export type LinkStatus = 'connecting' | 'open' | 'closed' | 'failed' | 'offline';

/** Where game time was at a local wall time; the clock display runs forward from here. */
export interface ClockAnchor {
  gameMs: number;
  localWallMs: number;
  rate: number;
  status: ClockState['status'];
}

/** The pause vote as last reported, with its countdown pinned to this client's wall clock. */
export interface PauseVote {
  phase: PausePhase;
  proposal?: PauseProposal & { closesAtWall: number };
}

/** The umpire's answer to a staff question. */
export interface StaffServerAnswer {
  text?: string;
  basedOnGame: number;
  officer: { name: string; traits: string[] };
}

/** What the server said about a staff question: charged (with the answer time), or refused. */
export type StaffCharge = { answerAtGame: number; askedAtGame: number; costMs: number } | 'refused';

export interface ClientState {
  link: LinkStatus;
  view?: SideView;
  /** Newest first by arrival, deduplicated by id. */
  dispatches: Dispatch[];
  /** Ids of dispatches the player has opened. Local to this client. */
  read: ReadonlySet<string>;
  clock?: ClockAnchor;
  staffAtWork: boolean;
  /** Absent until the server reports it; a game without voters never does. */
  pause?: PauseVote;
  pending: PendingOrder[];
  /** Orders the staff could not carry out, by order id; the order itself leaves `pending`. */
  outcomes: Record<string, OrderOutcome>;
  /** Staff questions by client question id, as the server charged them. */
  staffCharges: Record<string, StaffCharge>;
  /** The umpire's answers to staff questions by question id. Absent text: the client answers from its own view. */
  staffAnswers: Record<string, StaffServerAnswer>;
  /** Wall time of the last error that names no question (`game_closed`, `bad_message`), which may have eaten a staff question. */
  staffFaultAtWall?: number;
  /** Set once the server says the game has ended. */
  gameOver?: GameOver;
  /** The side's marks on the table, as the server last sent them plus this client's own edits. */
  marks: Mark[];
  /** Set when the server reports a return after an absence. */
  catchUp?: CatchUp;
  /** Newest last; the HUD shows the latest few. */
  notices: Notice[];
}

export const initialState: ClientState = {
  link: 'connecting',
  dispatches: [],
  read: new Set(),
  staffAtWork: false,
  pending: [],
  outcomes: {},
  staffCharges: {},
  staffAnswers: {},
  marks: [],
  notices: [],
};

const MAX_NOTICES = 20;

/**
 * How much wall time an update may be behind the client's extrapolation and still be treated as network
 * latency. A bigger lead is a real jump on the server (an LLM-barrier stall holds game time while the client
 * keeps running), so the server's time wins.
 */
export const MAX_HOLD_WALL_MS = 2000;

/**
 * A fresh anchor, unless the clock was running and had already passed it by a small margin (a view built a
 * moment before the old anchor's extrapolation): then game time holds its place instead of stepping back.
 */
function reanchor(
  old: ClockAnchor | undefined,
  gameMs: number,
  clock: ClockState,
  nowWall: number,
): ClockAnchor {
  const fresh = anchorOf(gameMs, clock, nowWall);
  if (old?.status !== 'running' || clock.status !== 'running') return fresh;
  const ahead = gameNowMs(old, nowWall);
  return ahead > gameMs && ahead - gameMs <= MAX_HOLD_WALL_MS * clock.rate
    ? { ...fresh, gameMs: ahead }
    : fresh;
}

function anchorOf(gameMs: number, clock: ClockState, localWallMs: number): ClockAnchor {
  return { gameMs, localWallMs, rate: clock.rate, status: clock.status };
}

/**
 * New dispatches go on top. One we already have is replaced when its text changed: the umpire's
 * narration of a report arrives after the template text was first delivered, under the same id.
 */
function withDispatches(have: Dispatch[], incoming: readonly Dispatch[]): Dispatch[] {
  const latest = new Map(incoming.map((d) => [d.id, d]));
  const ids = new Set(have.map((d) => d.id));
  const fresh = incoming.filter((d) => !ids.has(d.id));
  const revised = (d: Dispatch): Dispatch | undefined => {
    const next = latest.get(d.id);
    return next && next.text !== d.text ? next : undefined;
  };
  if (fresh.length === 0 && !have.some(revised)) return have;
  return [...fresh, ...have.map((d) => revised(d) ?? d)];
}

const sideName = (side: string | undefined): string =>
  side === undefined ? 'a player' : `${side[0]!.toUpperCase()}${side.slice(1)}`;

/** The line for the notices when a pause or resume vote is settled. */
export function pauseResultText(m: Extract<ServerMessage, { kind: 'pauseResult' }>): string {
  const what = m.proposalKind === 'resume' ? 'resume' : 'pause';
  switch (m.outcome) {
    case 'paused':
      return m.cause === 'forced'
        ? 'The game was paused by the host.'
        : 'The game is paused. Game time has stopped.';
    case 'resumed':
      if (m.cause === 'max-pause') return 'The pause reached its time limit. The game resumes.';
      return m.cause === 'forced'
        ? 'The game was resumed by the host.'
        : 'The game resumes. Game time is running.';
    case 'cancelled':
      if (m.cause === 'timeout') return `The vote to ${what} ran out of time and was cancelled.`;
      return `The vote to ${what} was cancelled: ${sideName(m.bySide)} voted no.`;
  }
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
        clock: reanchor(s.clock, m.view.atGame, m.view.clock, nowWall),
      };
    case 'dispatch':
      return { ...s, dispatches: withDispatches(s.dispatches, [m.dispatch]) };
    case 'clockState':
      // Sent when the clock changes, so its anchor is (about) now.
      return { ...s, clock: reanchor(s.clock, m.clock.gameMsAtAnchor, m.clock, nowWall) };
    case 'pauseState':
      return {
        ...s,
        pause: {
          phase: m.phase,
          ...(m.proposal
            ? { proposal: { ...m.proposal, closesAtWall: nowWall + m.proposal.msLeft } }
            : {}),
        },
      };
    case 'pauseResult': {
      const message = pauseResultText(m);
      const notices = [...s.notices, { code: 'pause_result', message }].slice(-MAX_NOTICES);
      return { ...s, notices };
    }
    case 'staffQueued':
      return {
        ...s,
        staffCharges: {
          ...s.staffCharges,
          [m.questionId]: {
            askedAtGame: m.askedAtGame,
            answerAtGame: m.answerAtGame,
            costMs: m.costMs,
          },
        },
      };
    case 'staffAnswer':
      return {
        ...s,
        staffAnswers: {
          ...s.staffAnswers,
          [m.questionId]: {
            ...(m.text === undefined ? {} : { text: m.text }),
            basedOnGame: m.basedOnGame,
            officer: m.officer,
          },
        },
      };
    case 'marks':
      return { ...s, marks: m.marks };
    case 'sentOrders': {
      // The server's record of what this side has sent: fills in orders a reload (or another device) lost (#343).
      const have = new Set(s.pending.map((p) => p.orderId));
      const fresh = m.orders.filter((o) => !have.has(o.id));
      return fresh.length === 0
        ? s
        : {
            ...s,
            pending: [
              ...fresh.map((o) => ({
                orderId: o.id,
                text: o.text,
                sentAtGame: o.sentAtGame,
                ...(o.toName ? { toName: o.toName } : {}),
                ...(o.courier ? { courier: o.courier } : {}),
              })),
              ...s.pending,
            ],
          };
    }
    case 'drafts':
    case 'draftState':
    case 'draftEntry':
    case 'draftReceipt':
      // The drafting desk is not built yet (a follow-up story); the server sends these to the side.
      return s;
    case 'staffAtWork':
      return { ...s, staffAtWork: m.working };
    case 'serverRestarted': {
      const mins = Math.round(m.downMs / 60_000);
      const away = mins >= 1 ? `at least ${mins} min` : 'a short while';
      const message = `The server was down for ${away}. The game came back paused; no game time passed. Confirm to resume.`;
      const notices = [...s.notices, { code: 'server_restart', message }].slice(-MAX_NOTICES);
      return { ...s, notices };
    }
    case 'catchUp': {
      const n = m.dispatchIds.length;
      const what =
        n === 0 ? 'no new dispatches' : n === 1 ? '1 new dispatch' : `${n} new dispatches`;
      const message = `Since you were last here (${formatGameTime(m.sinceGame)}): ${what}. It is now ${formatGameTime(m.atGame)}.`;
      const notices = [...s.notices, { code: 'catch_up', message }].slice(-MAX_NOTICES);
      return {
        ...s,
        catchUp: { sinceGame: m.sinceGame, atGame: m.atGame, dispatchIds: m.dispatchIds },
        notices,
      };
    }
    case 'gameOver':
      return {
        ...s,
        gameOver: {
          winner: m.winner,
          reason: m.reason,
          atGame: m.atGame,
          ...(m.loserOut ? { loserOut: m.loserOut } : {}),
        },
      };
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
      const refused = id === undefined ? undefined : s.pending.find((p) => p.orderId === id);
      const outcomes: Record<string, OrderOutcome> = refused
        ? {
            ...s.outcomes,
            [refused.orderId]: {
              kind: 'refused',
              text: refused.words ?? refused.text,
              ...(refused.toName ? { toName: refused.toName } : {}),
              sentAtGame: refused.sentAtGame,
              reason: m.message.slice(m.message.indexOf(': ') + 2),
              code: m.code,
            },
          }
        : s.outcomes;
      const notices = [...s.notices, { code: m.code, message: m.message }].slice(-MAX_NOTICES);
      const staffCharges =
        (m.code === 'staff_busy' || m.code === 'game_over') && id !== undefined
          ? { ...s.staffCharges, [id]: 'refused' as const }
          : s.staffCharges;
      const unnamed = id === undefined && (m.code === 'game_closed' || m.code === 'bad_message');
      return {
        ...s,
        pending: dropped,
        outcomes,
        staffCharges,
        notices,
        ...(unnamed ? { staffFaultAtWall: nowWall } : {}),
      };
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
