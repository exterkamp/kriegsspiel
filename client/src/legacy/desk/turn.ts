/** Turn mode on the desk (D39, story 11.10): pure rules for the clock line, the send panel and the diary. */
import type { TurnOrder } from '@kriegsspiel/protocol';
import { formatGameTime, type ClientState, type TurnInfo } from '../net/state.js';
import type { JournalEntry } from './journal.js';

/** Where the side stands in the open turn. */
export type TurnPhase = 'writing' | 'sent' | 'resolving' | 'over';

/** `08:20`: the time of day of a game instant, without the day. */
export const timeOfDay = (ms: number): string => formatGameTime(ms).replace(/^Day \d+ /, '');

/** `Turn 3: 08:20 to 08:40`. */
export const turnLine = (t: Pick<TurnInfo, 'turn' | 'startsAt' | 'endsAt'>): string =>
  `Turn ${t.turn}: ${timeOfDay(t.startsAt)} to ${timeOfDay(t.endsAt)}`;

export function turnPhase(state: Pick<ClientState, 'turn' | 'gameOver' | 'view'>): TurnPhase {
  const t = state.turn;
  if (state.gameOver || !t) return 'over';
  if (t.resolving) return 'resolving';
  const side = state.view?.side;
  return side !== undefined && t.sent.includes(side) ? 'sent' : 'writing';
}

const titleCase = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

export interface SideSent {
  side: string;
  name: string;
  you: boolean;
  sent: boolean;
}

/**
 * Who has sent orders for the turn. `sides` is every side in the game when the client knows them; the
 * side's own is always listed first, then the others, and any side named in `sent` is listed even if
 * `sides` did not name it.
 */
export function sidesSent(
  turn: Pick<TurnInfo, 'sent'>,
  own: string | undefined,
  sides: readonly string[] = [],
): SideSent[] {
  const all = [...new Set([...(own === undefined ? [] : [own]), ...sides, ...turn.sent])];
  return all.map((side) => ({
    side,
    name: titleCase(side),
    you: side === own,
    sent: turn.sent.includes(side),
  }));
}

/** `Orders due in 2 h 10 min`, or undefined when the turn waits for every side. */
export function deadlineText(deadline: number | undefined, nowWall: number): string | undefined {
  if (deadline === undefined) return undefined;
  const left = deadline - nowWall;
  if (left <= 0) return 'Orders are due now; the turn closes at once.';
  const min = Math.ceil(left / 60_000);
  if (min < 60) return `Orders due in ${min} min.`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Orders due in ${h} h${min % 60 ? ` ${min % 60} min` : ''}.`;
  // Whole days left, rounded down: a deadline must never seem further off than it is.
  return `Orders due in ${Math.floor(h / 24)} days.`;
}

/** One line of the held list: `To 1st Battalion, by steady courier`. */
export function heldLine(o: TurnOrder, names: ReadonlyMap<string, string>): string {
  const to = names.get(o.to) ?? o.to;
  return `To ${to}, by ${o.courier === 'fast' ? 'fast rider' : 'steady courier'}`;
}

/**
 * A diary line for a turn as it opens, which also closes the turn before it: the diary reads newest
 * first, so what stands below the line happened in the earlier turn. Stable id, so it is recorded once.
 */
export const turnEntry = (t: Pick<TurnInfo, 'turn' | 'startsAt' | 'endsAt'>): JournalEntry => ({
  id: `turn:${t.turn}`,
  kind: 'turn',
  at: t.startsAt,
  text: `${t.turn > 1 ? `Turn ${t.turn - 1} decided. ` : ''}${turnLine(t)} opens.`,
});

/**
 * The banner on a turn after the umpire has ruled the battle (D13): the rest is the pursuit, and the
 * player need not write orders for it (#438), which is said only while the turn is being written.
 * Undefined before a ruling.
 */
export function pursuitText(
  t: Pick<TurnInfo, 'pursuitUntil'> | undefined,
  writing = true,
): string | undefined {
  if (t?.pursuitUntil === undefined) return undefined;
  const text = `The battle is decided; this turn is the pursuit. The game closes by ${timeOfDay(t.pursuitUntil)} at the latest.`;
  return writing ? `${text} You may send this turn with no orders.` : text;
}

/** What the desk says while the turn is being decided. */
export const RESOLVING_TEXT = 'The umpire is considering the turn.';

/**
 * The note shown when a turn has been decided and the next opened: how many papers came with it.
 * `fresh` is the number of dispatches received since the previous turn opened.
 */
export function resolvedText(turn: number, fresh: number): string {
  const what = fresh === 0 ? 'no new papers' : fresh === 1 ? '1 new paper' : `${fresh} new papers`;
  return `Turn ${turn} has been decided: ${what} in the in-tray.`;
}
