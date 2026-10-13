import { describe, expect, it } from 'vitest';
import { dissentNotes } from './critique.js';
import { signedOrders } from './journal.js';
import type { InputLogEntry } from './game/store.js';

const log = (e: object): InputLogEntry => ({ wallMs: 0, ...e }) as unknown as InputLogEntry;

const entries: InputLogEntry[] = [
  log({
    seq: 1,
    gameMs: 100,
    command: {
      kind: 'order',
      side: 'blue',
      text: 'hold the bridge',
      orderId: 'o1',
      signer: { role: 'commander' },
    },
    parse: { kind: 'intents', unitId: 'blue-1', intents: [] },
  }),
  log({
    seq: 2,
    gameMs: 150,
    command: { kind: 'order', side: 'blue', text: 'refused', orderId: 'o2' },
    parse: { kind: 'rejection', reason: 'no' },
  }),
  log({
    seq: 3,
    gameMs: 200,
    command: {
      kind: 'dissent',
      side: 'blue',
      by: 'chiefOfStaff',
      dissent: {
        id: 'd1',
        orderId: 'o1',
        seat: 'chiefOfStaff',
        body: 'withdraw instead',
        atGame: 200,
      },
    },
  }),
  log({
    seq: 4,
    gameMs: 300,
    command: {
      kind: 'dissent',
      side: 'blue',
      by: 'intelligence',
      dissent: {
        id: 'd2',
        orderId: 'o1',
        seat: 'intelligence',
        body: 'they have guns',
        atGame: 300,
      },
    },
  }),
];

describe('signedOrders', () => {
  it("lists only orders that were understood, with the signer's seat", () => {
    expect(signedOrders(entries, 'blue')).toEqual([
      {
        orderId: 'o1',
        side: 'blue',
        text: 'hold the bridge',
        atGame: 100,
        signer: 'commander',
        toUnit: 'blue-1',
      },
    ]);
    expect(signedOrders(entries, 'red')).toEqual([]);
  });
});

describe('dissentNotes', () => {
  it('groups dissents under the order they were against, in order', () => {
    const notes = dissentNotes(entries);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      side: 'blue',
      orderId: 'o1',
      orderText: 'hold the bridge',
      signedAtGame: 100,
      signedBy: 'commander',
    });
    expect(notes[0]!.dissents.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('is empty when no one dissented', () => {
    expect(dissentNotes(entries.slice(0, 2))).toEqual([]);
  });
});
