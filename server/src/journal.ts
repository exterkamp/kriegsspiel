/**
 * Reading the side's journal: the orders a side signed, from the input log (D6e). Pure; the log is
 * the one record of what was signed, so this is what dissent, the critique and a joiner's briefing
 * all read.
 */
import { seatKey } from './api/sideView.js';
import type { InputLogEntry } from './game/store.js';

/** An order that was signed and understood, with the seat that signed it. */
export interface SignedOrder {
  orderId: string;
  side: string;
  text: string;
  atGame: number;
  /** `seatKey` of the signer; absent in shared-HQ play, where no one holds a seat. */
  signer?: string;
  toUnit: string;
}

/**
 * The orders `side` signed that were parsed into intents, oldest first. A refused or clarified order
 * was never issued, and an AI commander's order is not a player's, so neither is listed.
 */
export function signedOrders(entries: readonly InputLogEntry[], side: string): SignedOrder[] {
  const out: SignedOrder[] = [];
  for (const e of entries) {
    const c = e.command;
    if (c.kind !== 'order' || c.side !== side || e.agent || e.error) continue;
    if (e.parse?.kind !== 'intents') continue;
    out.push({
      orderId: c.orderId ?? `log-${e.seq}`,
      side,
      text: c.text,
      atGame: e.gameMs,
      ...(c.signer ? { signer: seatKey(c.signer) } : {}),
      toUnit: e.parse.unitId,
    });
  }
  return out;
}
