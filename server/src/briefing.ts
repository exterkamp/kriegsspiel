/**
 * The briefing a player gets on taking over a role mid-game (D6e, docs/gameplay.md "Joining
 * mid-game"). Built only from the journal of the seat itself: orders it signed, drafts and comments
 * its holders wrote, dissents it filed, questions it put to the staff. All of it was the seat's own
 * work or on its side's desk, so the briefing never widens what the seat may know. Pure.
 */
import type {
  Briefing,
  BriefingItem,
  Dissent,
  DraftSnapshot,
  StaffExchange,
} from '@kriegsspiel/protocol';
import type { SignedOrder } from './journal.js';

export const MAX_BRIEFING_ITEMS = 200;
const TEXT_MAX = 600;

const clip = (s: string): string => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

export interface BriefingInput {
  /** `seatKey` of the seat taken over. */
  seat: string;
  /** Game time now, when the briefing is written. */
  atGame: number;
  /** The side's signed orders. */
  orders: readonly SignedOrder[];
  dissents: readonly Dissent[];
  /** The side's conference history (each exchange names the seat that asked). */
  staff: readonly StaffExchange[];
  drafts: readonly DraftSnapshot[];
  /** Account ids of those who held this seat before: they wrote the drafts and comments. */
  previousHolders: readonly string[];
}

export function buildBriefing(input: BriefingInput): Briefing {
  const timed: BriefingItem[] = [];
  const orderText = new Map(input.orders.map((o) => [o.orderId, o.text]));
  for (const o of input.orders) {
    if (o.signer === input.seat) {
      timed.push({ kind: 'order', atGame: o.atGame, text: clip(`Signed: ${o.text}`) });
    }
  }
  for (const d of input.dissents) {
    if (d.seat !== input.seat) continue;
    const against = orderText.get(d.orderId);
    timed.push({
      kind: 'dissent',
      atGame: d.atGame,
      text: clip(against ? `Dissented from "${against}": ${d.body}` : `Dissented: ${d.body}`),
    });
  }
  for (const x of input.staff) {
    if (x.askedBy !== input.seat) continue;
    timed.push({
      kind: 'question',
      atGame: x.askedAtGame,
      text: clip(
        x.text === undefined
          ? `Asked the ${x.role}: ${x.question}`
          : `Asked the ${x.role}: ${x.question} Answer: ${x.text}`,
      ),
    });
  }
  timed.sort((a, b) => (a.atGame ?? 0) - (b.atGame ?? 0));
  // Drafts and comments carry wall time, not game time: they follow the timed items.
  const written: BriefingItem[] = [];
  const mine = new Set(input.previousHolders);
  for (const draft of input.drafts) {
    if (mine.has(draft.createdBy) && draft.mergedInto === undefined) {
      written.push({
        kind: 'draft',
        text: clip(`Draft "${draft.title || draft.id}": ${draft.text}`),
      });
    }
    for (const c of draft.comments) {
      if (mine.has(c.author)) {
        written.push({
          kind: 'comment',
          text: clip(`Comment on "${draft.title || draft.id}": ${c.body}`),
        });
      }
    }
  }
  return {
    seat: input.seat,
    atGame: input.atGame,
    items: [...timed, ...written].slice(-MAX_BRIEFING_ITEMS),
  };
}
