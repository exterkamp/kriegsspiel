import type { Coord, Dispatch, Mark } from '@kriegsspiel/protocol';
import { formatGameTime, orderIdOf, type PendingOrder } from '../net/state.js';

export type Courier = 'fast' | 'safe';

/**
 * The two couriers a commander can pick. The speeds are the engine's `COURIER_CHOICES` (as a multiple
 * of a 400 m/min ride); the blurbs say what the staff would tell a commander, in words and not odds.
 */
export const COURIERS: Record<Courier, { label: string; speed: number; blurb: string }> = {
  fast: {
    label: 'Fast rider',
    speed: 1.5,
    blurb:
      'Rides hard and arrives sooner, but is more likely to be lost, taken or to garble the order.',
  },
  safe: {
    label: 'Steady courier',
    speed: 0.75,
    blurb:
      'Keeps to the quiet way. Arrives later, but is less likely to be lost, taken or to garble the order.',
  },
};

/** Metres an ordinary courier rides in a minute over cost-1 ground (`COURIER_MS_PER_METRE` in the engine). */
const COURIER_M_PER_MIN = 400;

/**
 * The staff's estimate of how long a courier takes from HQ to the addressee: the straight line at the
 * courier's pace. It ignores the road, which only shortens the ride, and the ground, which can lengthen it.
 */
export function estimateRideMs(hq: Coord, to: Coord, courier: Courier): number {
  const metres = Math.hypot(to.x - hq.x, to.y - hq.y);
  return Math.round((metres / (COURIER_M_PER_MIN * COURIERS[courier].speed)) * 60_000);
}

/** `about 35 min` or `about 2 h 10 min`. */
export function formatEstimate(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}

const at = (c: Coord): string => `(${Math.round(c.x)} m, ${Math.round(c.y)} m)`;

/** The arrows on the table, in the order they were made; the only marks an order can carry as an annex. */
export const arrowMarks = (marks: readonly Mark[]): Extract<Mark, { kind: 'arrow' }>[] =>
  marks
    .filter((m): m is Extract<Mark, { kind: 'arrow' }> => m.kind === 'arrow')
    .sort((a, b) => a.madeAtGame - b.madeAtGame);

/** One line of the annex for an arrow, as written under the order. */
export function annexLine(m: Extract<Mark, { kind: 'arrow' }>): string {
  return `arrow${m.label ? ` "${m.label}"` : ''} from ${at(m.from)} to ${at(m.to)}`;
}

/** The order wording with the chosen arrows attached as a marked-map annex the umpire reads with it. */
export function withAnnex(text: string, marks: readonly Mark[], chosen: readonly string[]): string {
  const lines = arrowMarks(marks)
    .filter((m) => chosen.includes(m.id))
    .map(annexLine);
  return lines.length === 0 ? text : `${text}\n\nAnnex (marked map): ${lines.join('; ')}.`;
}

/** What the player has written but not yet signed. */
export interface OrderDraft {
  to: string;
  text: string;
  courier: Courier;
  /** Ids of the arrow marks chosen as the annex. */
  annex: string[];
}

export const emptyDraft = (): OrderDraft => ({ to: '', text: '', courier: 'safe', annex: [] });

const draftKey = (game: string): string => `kriegsspiel.orderDraft.${game}`;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadDraft(game: string): OrderDraft {
  try {
    const raw = safeStorage()?.getItem(draftKey(game));
    if (!raw) return emptyDraft();
    const o = JSON.parse(raw) as Partial<OrderDraft>;
    return {
      to: typeof o.to === 'string' ? o.to : '',
      text: typeof o.text === 'string' ? o.text : '',
      courier: o.courier === 'fast' ? 'fast' : 'safe',
      annex: Array.isArray(o.annex)
        ? o.annex.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(game: string, d: OrderDraft): void {
  try {
    const s = safeStorage();
    if (!s) return;
    if (d.text === '' && d.to === '' && d.annex.length === 0 && d.courier === 'safe')
      s.removeItem(draftKey(game));
    else s.setItem(draftKey(game), JSON.stringify(d));
  } catch {
    // A full or blocked store only costs the autosave.
  }
}

export interface Delivery {
  state: 'riding' | 'due' | 'unknown';
  /** 0..1 of the estimated ride that has passed. */
  fraction: number;
  label: string;
}

/** Where a sent order stands, from the staff's estimate. The server reports the real delivery as a dispatch. */
export function deliveryStatus(p: PendingOrder, nowGame: number): Delivery {
  if (p.etaGame === undefined)
    return {
      state: 'unknown',
      fraction: 0,
      label: `Sent ${formatGameTime(p.sentAtGame)}; awaiting word`,
    };
  const span = Math.max(1, p.etaGame - p.sentAtGame);
  const fraction = Math.min(1, Math.max(0, (nowGame - p.sentAtGame) / span));
  if (nowGame >= p.etaGame)
    return {
      state: 'due',
      fraction: 1,
      label: `Should have arrived by ${formatGameTime(p.etaGame)}; awaiting word`,
    };
  return {
    state: 'riding',
    fraction,
    label: `Courier riding, expected ${formatGameTime(p.etaGame)}`,
  };
}

/** Two orders the staff understands, shown with every refusal or request for clarification. */
export const ORDER_EXAMPLES: readonly string[] = [
  '1st Battalion march to the bridge',
  'Hold the wood',
];

/**
 * A clarification reads "<question> (<option>, <option>)". Splits it into the question and its options;
 * a comma inside brackets, as in "the wood at (1, 2) m", does not separate two options.
 */
export function splitOptions(reason: string): { question: string; options: string[] } {
  const m = /^(.*?)\s*\((.*)\)\s*$/s.exec(reason.trim());
  if (!m) return { question: reason.trim(), options: [] };
  const options: string[] = [];
  let open = 0;
  for (const part of (m[2] as string).split(', ')) {
    if (open > 0) options[options.length - 1] += `, ${part}`;
    else options.push(part);
    open += (part.match(/\(/g)?.length ?? 0) - (part.match(/\)/g)?.length ?? 0);
  }
  return { question: m[1] as string, options: options.map((o) => o.trim()).filter(Boolean) };
}

/**
 * The player's words with the chosen option filled in. "Which wood, sir?" swaps the wood named in the
 * order for the option; any other question puts the option in front (a unit) or after (a place).
 */
export function orderWithOption(words: string, question: string, option: string): string {
  // "Shall I send just the first part?" offers the part itself, a whole order. The wording is the
  // test umpire's, from server/src/umpire/providers/testParse.ts; orders.test.ts pins it.
  if (/^\s*i know of no place/i.test(question)) return option;
  const noun = /^\s*which\s+([a-z]+)/i.exec(question)?.[1];
  if (noun && !/^(one|unit)$/i.test(noun)) {
    const re = new RegExp(`(?:\\bthe\\s+)?\\b${noun}s?\\b(?![\\s\\S]*\\b${noun}s?\\b)`, 'i');
    if (re.test(words)) return words.replace(re, /^the\s/i.test(option) ? option : `the ${option}`);
  }
  if (/\b(one|unit)\b/i.test(question)) return `${option}, ${words}`;
  return `${words.replace(/[.\s]+$/, '')}, ${option}`;
}

/**
 * What the desk tells the player when the staff could not carry out an order: their own words, the
 * staff's reason without the internal order id, and a hint with two example orders.
 */
export function refusalText(o: { text: string; reason: string; code?: string }): string {
  const clarify = o.code === 'order_clarification';
  const bare = (clarify ? splitOptions(o.reason).question : o.reason)
    .replace(/^\s*o-[\w-]+:\s*/, '')
    .trim();
  const reason = /[.?!)]$/.test(bare) ? bare : `${bare}.`;
  const examples = ORDER_EXAMPLES.map((e) => `"${e}"`).join(' or ');
  const lead = clarify
    ? `The staff need more to act on your order "${o.text.trim()}". ${reason}`
    : `Your order "${o.text.trim()}" could not be carried out. ${reason}`;
  // A rate limit or a repeat is not about wording, so the hint would only mislead (#343).
  if (o.code === 'rate_limited' || o.code === 'duplicate_text') return lead;
  return `${lead} The staff understand orders such as ${examples}.`;
}

/** A notice for the desk: a refusal shows the player's own words and a hint; others lose any order id prefix. */
export function noticeText(
  n: { message: string },
  outcomes: Readonly<Record<string, { text: string; reason: string; code?: string }>>,
): string {
  const id = orderIdOf(n.message);
  const o = id === undefined ? undefined : outcomes[id];
  return o ? refusalText(o) : n.message.replace(/^o-[\w-]+:\s*/, '');
}

/** The first paper of `kind` about the order's addressee written after the order was sent. */
function firstAbout(
  p: PendingOrder,
  dispatches: readonly Dispatch[],
  kind: NonNullable<Dispatch['kind']>,
): Dispatch | undefined {
  if (!p.toName) return undefined;
  return [...dispatches]
    .sort((a, b) => a.writtenAtGame - b.writtenAtGame)
    .find((d) => d.kind === kind && d.from === p.toName && d.writtenAtGame >= p.sentAtGame);
}

/**
 * Word that an order arrived: the addressee's first acknowledgement written after it was sent (written, not received:
 * one already riding when the order went out is for an earlier order). Any other report from the unit says nothing of
 * the order: its courier may still be lost (#438).
 */
export function deliveredBy(
  p: PendingOrder,
  dispatches: readonly Dispatch[],
): Dispatch | undefined {
  return firstAbout(p, dispatches, 'orderDelivered');
}

/** Word that an order was lost: the staff giving up its courier, when no acknowledgement came first. */
export function lostBy(p: PendingOrder, dispatches: readonly Dispatch[]): Dispatch | undefined {
  const lost = firstAbout(p, dispatches, 'courierLost');
  const ack = deliveredBy(p, dispatches);
  return lost && (!ack || ack.writtenAtGame > lost.writtenAtGame) ? lost : undefined;
}

/** What the desk says once an order is signed: to whom, by which courier and, if known, when it should arrive. */
export function sentLine(toName: string, courier: Courier, etaGame: number | undefined): string {
  const how = courier === 'fast' ? 'fast rider' : 'steady courier';
  const when = etaGame === undefined ? '' : `; expected to arrive ${formatGameTime(etaGame)}`;
  return `Sent to ${toName} by ${how}${when}`;
}
