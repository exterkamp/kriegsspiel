import { describe, expect, it } from 'vitest';
import type { Dissent, DraftSnapshot, StaffExchange } from '@kriegsspiel/protocol';
import { buildBriefing } from './briefing.js';
import type { SignedOrder } from './journal.js';

const order = (o: Partial<SignedOrder> & Pick<SignedOrder, 'orderId'>): SignedOrder => ({
  side: 'blue',
  text: 'march',
  atGame: 0,
  toUnit: 'blue-1',
  ...o,
});
const dissent = (d: Partial<Dissent> & Pick<Dissent, 'id' | 'orderId'>): Dissent => ({
  seat: 'chiefOfStaff',
  body: 'no',
  atGame: 0,
  ...d,
});
const draft = (d: Partial<DraftSnapshot>): DraftSnapshot => ({
  id: 'd',
  title: 'T',
  createdBy: 'u1',
  rev: 0,
  text: 'text',
  authors: [],
  comments: [],
  receipts: {},
  history: [],
  ...d,
});
const exchange = (x: object) =>
  ({
    role: 'chiefOfStaff',
    answerAtGame: 0,
    officer: { name: 'X', traits: [] },
    ...x,
  }) as unknown as StaffExchange;

describe('buildBriefing', () => {
  it("lists only the seat's own work, by game time, with drafts and comments after", () => {
    const b = buildBriefing({
      seat: 'chiefOfStaff',
      atGame: 9000,
      orders: [
        order({ orderId: 'a', text: 'hold', atGame: 100, signer: 'commander' }),
        order({ orderId: 'b', text: 'advance', atGame: 200, signer: 'subordinate:blue-2' }),
      ],
      dissents: [
        dissent({ id: '1', orderId: 'a', atGame: 150, body: 'bad idea' }),
        dissent({ id: '2', orderId: 'a', seat: 'intelligence', body: 'not mine' }),
      ],
      staff: [
        exchange({
          questionId: 'q',
          question: 'status?',
          askedAtGame: 50,
          askedBy: 'chiefOfStaff',
          text: 'fine',
        }),
        exchange({
          questionId: 'q2',
          question: 'secret',
          askedAtGame: 55,
          askedBy: 'quartermaster',
        }),
      ],
      drafts: [
        draft({ id: 'x', title: 'Mine', createdBy: 'old' }),
        draft({ id: 'y', title: 'Theirs', createdBy: 'other' }),
        draft({
          id: 'z',
          title: 'Shared',
          createdBy: 'other',
          comments: [
            {
              id: 'c',
              author: 'old',
              at: 1,
              from: 0,
              to: 0,
              body: 'check the ford',
              resolved: false,
            },
          ],
        }),
      ],
      previousHolders: ['old'],
    });
    expect(b.items.map((i) => i.kind)).toEqual(['question', 'dissent', 'draft', 'comment']);
    const text = b.items.map((i) => i.text).join('\n');
    expect(text).toContain('Dissented from "hold": bad idea');
    expect(text).toContain('Answer: fine');
    for (const leaked of ['not mine', 'secret', 'Theirs', 'advance']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('is empty for a seat that did nothing', () => {
    const b = buildBriefing({
      seat: 'quartermaster',
      atGame: 1,
      orders: [],
      dissents: [],
      staff: [],
      drafts: [],
      previousHolders: [],
    });
    expect(b.items).toEqual([]);
  });

  it("includes the orders a subordinate signed from their formations' seat", () => {
    const b = buildBriefing({
      seat: 'subordinate:blue-2',
      atGame: 5,
      orders: [order({ orderId: 'b', text: 'advance', atGame: 3, signer: 'subordinate:blue-2' })],
      dissents: [],
      staff: [],
      drafts: [],
      previousHolders: [],
    });
    expect(b.items).toEqual([{ kind: 'order', atGame: 3, text: 'Signed: advance' }]);
  });
});
