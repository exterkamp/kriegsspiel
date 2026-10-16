/** Turn mode on the desk (D39, story 11.10): pure rules for the clock line, the send panel and the diary. */
import type { Role, TurnOrder } from '@kriegsspiel/protocol';
import { formatGameTime, type ClientState, type TurnInfo } from '../net/state.js';
import type { JournalEntry } from './journal.js';

/** Where the side stands in the open turn. */
export type TurnPhase = 'writing' | 'sent' | 'resolving' | 'over';

/** `08:20`: the time of day of a game instant, without the day. */
export const timeOfDay = (ms: number): string => formatGameTime(ms).replace(/^Day \d+ /, '');

/**
 * About how many turns the battle lasts: its time limit in turns, the last one short when they do not divide
 * (D39). Undefined when either length is unknown. "About", since a victory may end the game sooner.
 */
export function turnsInBattle(
  battleMinutes: number | undefined,
  turnMinutes: number | undefined,
): number | undefined {
  if (!battleMinutes || !turnMinutes || battleMinutes <= 0 || turnMinutes <= 0) return undefined;
  return Math.ceil(battleMinutes / turnMinutes);
}

/**
 * `Turn 3: 08:20 to 08:40`, or with the battle's length in turns `Turn 2 of about 3: 00:20 to 00:40`; the
 * last turn by the time limit is `Turn 3 of 3` (#439).
 */
export function turnLine(
  t: Pick<TurnInfo, 'turn' | 'startsAt' | 'endsAt'>,
  total?: number,
): string {
  const of = total === undefined ? '' : t.turn >= total ? ` of ${t.turn}` : ` of about ${total}`;
  return `Turn ${t.turn}${of}: ${timeOfDay(t.startsAt)} to ${timeOfDay(t.endsAt)}`;
}

/**
 * What a turn is, for a first-time player (#439): its length against the battle's, and that each side sends
 * once per turn and the umpire then decides.
 */
export function howTurnsWork(turnMinutes: number, battleMinutes?: number): string {
  const total = turnsInBattle(battleMinutes, turnMinutes);
  const battle =
    total === undefined
      ? ''
      : ` The battle lasts about ${battleMinutes} minutes, so about ${total} ${total === 1 ? 'turn' : 'turns'}; it ends sooner if a side wins.`;
  return (
    `Each turn is ${turnMinutes} minutes of the battle. Write your orders and hold them, then send them once ` +
    `for your whole side. When every side has sent, the umpire decides what happened in those ` +
    `${turnMinutes} minutes, the pieces move, and the turn's papers come into the in-tray.${battle}`
  );
}

/**
 * The note on the last turn (#439): one cut short by the battle's time limit says how long it is and why; the
 * last full turn says it is the last. Undefined for any other turn.
 */
export function lastTurnText(
  t: Pick<TurnInfo, 'turn' | 'startsAt' | 'endsAt'>,
  turnMinutes: number | undefined,
  battleMinutes: number | undefined,
): string | undefined {
  if (!turnMinutes) return undefined;
  const mins = Math.round((t.endsAt - t.startsAt) / 60_000);
  const end = timeOfDay(t.endsAt);
  if (mins < turnMinutes) {
    return `This is the last turn, and it is ${mins} minutes, not ${turnMinutes}: the battle's time limit is at ${end}.`;
  }
  const total = turnsInBattle(battleMinutes, turnMinutes);
  return total !== undefined && t.turn >= total
    ? `This is the last turn: the battle's time limit is at ${end}.`
    : undefined;
}

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

/**
 * What a seat may do with the turn's orders, as the hub allows it (D39, #428): a commander or subordinate holds
 * and sends; the chief of staff and quartermaster hold for the commander to send; the intelligence officer does
 * neither. Shared-HQ play has no role, and everyone there may send.
 */
export type TurnRights = 'send' | 'hold' | 'none';

export function turnRights(role: Role | undefined): TurnRights {
  if (role === undefined || role === 'commander' || role === 'subordinate') return 'send';
  return role === 'intelligence' ? 'none' : 'hold';
}

/** Said in place of the Send button to a seat that cannot send. */
export function turnSenderText(rights: TurnRights): string | undefined {
  if (rights === 'hold') {
    return "Your commander sends the turn's orders. Orders you hold here go with them.";
  }
  if (rights === 'none') {
    return "The intelligence officer writes no orders. Your commander holds and sends the turn's orders.";
  }
  return undefined;
}

/** The turn panel's way to the orders desk: it offers to send only to a seat that can (#428). */
export function ordersButtonText(held: number, rights: TurnRights): string {
  if (held === 0) return rights === 'none' ? 'See the orders' : 'Write orders';
  return rights === 'send' ? `Send orders (${held} held)` : `Orders (${held} held)`;
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
