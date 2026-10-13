/**
 * Dissent for the post-game critique (D6e). The critique itself is later work (M4b); this is the
 * part it reads: each signed order that a teammate dissented from, with the dissents in order.
 * Pure over the input log, so it needs no model call and works for any finished game.
 */
import type { Dissent } from '@kriegsspiel/protocol';
import type { InputLogEntry } from './game/store.js';
import { signedOrders, type SignedOrder } from './journal.js';

export interface DissentNote {
  side: string;
  orderId: string;
  /** The order's wording, or absent if the log no longer holds it as a signed order. */
  orderText?: string;
  signedAtGame?: number;
  signedBy?: string;
  dissents: Dissent[];
}

/** Dissents grouped by the order they were against, orders by first dissent. */
export function dissentNotes(entries: readonly InputLogEntry[]): DissentNote[] {
  const notes = new Map<string, DissentNote>();
  const sides = new Set(
    entries.flatMap((e) => (e.command.kind === 'dissent' ? [e.command.side] : [])),
  );
  const orders = new Map<string, SignedOrder>();
  for (const side of sides) {
    for (const o of signedOrders(entries, side)) orders.set(`${side}|${o.orderId}`, o);
  }
  for (const e of entries) {
    const c = e.command;
    if (c.kind !== 'dissent') continue;
    const key = `${c.side}|${c.dissent.orderId}`;
    let note = notes.get(key);
    if (!note) {
      const o = orders.get(key);
      note = {
        side: c.side,
        orderId: c.dissent.orderId,
        ...(o
          ? {
              orderText: o.text,
              signedAtGame: o.atGame,
              ...(o.signer ? { signedBy: o.signer } : {}),
            }
          : {}),
        dissents: [],
      };
      notes.set(key, note);
    }
    note.dissents.push(c.dissent);
  }
  return [...notes.values()];
}
