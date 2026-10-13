// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { Dispatch, Mark } from '@kriegsspiel/protocol';
import {
  annexLine,
  deliveredBy,
  deliveryStatus,
  emptyDraft,
  estimateRideMs,
  formatEstimate,
  loadDraft,
  lostBy,
  orderOutcomes,
  orderWithOption,
  refusalText,
  saveDraft,
  splitOptions,
  withAnnex,
} from './orders.js';

const arrow = (id: string, madeAtGame = 0): Mark => ({
  id,
  kind: 'arrow',
  from: { x: 100, y: 200 },
  to: { x: 400.4, y: 600 },
  label: 'Main thrust',
  madeAtGame,
});

describe('delivery estimate', () => {
  const hq = { x: 0, y: 0 };
  it('is the straight line at the courier pace, fast sooner than safe', () => {
    const to = { x: 600, y: 800 }; // 1000 m
    expect(estimateRideMs(hq, to, 'fast')).toBe(Math.round((1000 / 600) * 60_000));
    expect(estimateRideMs(hq, to, 'safe')).toBe(Math.round((1000 / 300) * 60_000));
    expect(estimateRideMs(hq, to, 'fast')).toBeLessThan(estimateRideMs(hq, to, 'safe'));
  });
  it('words the estimate', () => {
    expect(formatEstimate(10 * 60_000)).toBe('about 10 min');
    expect(formatEstimate(130 * 60_000)).toBe('about 2 h 10 min');
    expect(formatEstimate(120 * 60_000)).toBe('about 2 h');
    expect(formatEstimate(0)).toBe('about 1 min');
  });
});

describe('annex', () => {
  it('attaches only the chosen arrows, in the order made', () => {
    const marks: Mark[] = [
      arrow('b', 20),
      arrow('a', 10),
      { id: 'p', kind: 'pin', at: { x: 1, y: 1 }, madeAtGame: 0 },
    ];
    expect(annexLine(arrow('a') as never)).toBe(
      'arrow "Main thrust" from (100 m, 200 m) to (400 m, 600 m)',
    );
    const text = withAnnex('Advance.', marks, ['b', 'a', 'p']);
    expect(text.startsWith('Advance.\n\nAnnex (marked map): ')).toBe(true);
    expect(text.indexOf('(100 m')).toBeLessThan(text.length);
    expect(text.match(/arrow/g)).toHaveLength(2);
    expect(withAnnex('Advance.', marks, [])).toBe('Advance.');
    expect(withAnnex('Advance.', marks, ['gone'])).toBe('Advance.');
  });
});

describe('draft autosave', () => {
  afterEach(() => localStorage.clear());
  it('round-trips a draft and forgets an empty one', () => {
    const d = { to: 'blue-1', text: 'Hold the bridge', courier: 'fast' as const, annex: ['a'] };
    saveDraft('g1', d);
    expect(loadDraft('g1')).toEqual(d);
    expect(loadDraft('g2')).toEqual(emptyDraft());
    saveDraft('g1', emptyDraft());
    expect(localStorage.length).toBe(0);
  });
  it('survives garbage in storage', () => {
    localStorage.setItem('kriegsspiel.orderDraft.g1', '{"text":5,"courier":"x"}');
    expect(loadDraft('g1')).toEqual(emptyDraft());
    localStorage.setItem('kriegsspiel.orderDraft.g1', 'not json');
    expect(loadDraft('g1')).toEqual(emptyDraft());
  });
});

describe('delivery status', () => {
  const p = { orderId: 'o', text: 't', sentAtGame: 1000, etaGame: 3000 };
  it('rides, then is due', () => {
    expect(deliveryStatus(p, 2000)).toMatchObject({ state: 'riding', fraction: 0.5 });
    expect(deliveryStatus(p, 3000)).toMatchObject({ state: 'due', fraction: 1 });
    expect(deliveryStatus({ ...p, etaGame: undefined }, 2000).state).toBe('unknown');
  });
});

describe('clarification options', () => {
  it('splits the question from its options, keeping brackets together', () => {
    expect(splitOptions('Which wood, sir? (Northern wood, Southern wood)')).toEqual({
      question: 'Which wood, sir?',
      options: ['Northern wood', 'Southern wood'],
    });
    expect(
      splitOptions('Which wood? (the wood at (1, 2) m, the wood at (3, 4) m)').options,
    ).toEqual(['the wood at (1, 2) m', 'the wood at (3, 4) m']);
    expect(splitOptions('Where, sir?')).toEqual({ question: 'Where, sir?', options: [] });
  });

  it('fills the choice into the order', () => {
    expect(orderWithOption('Hold the wood.', 'Which wood, sir?', 'Northern wood')).toBe(
      'Hold the Northern wood.',
    );
    expect(orderWithOption('Hold the wood.', 'Which wood, sir?', 'the Northern wood')).toBe(
      'Hold the Northern wood.',
    );
    expect(
      orderWithOption(
        'March to the bridge.',
        'Which unit is this order for, sir?',
        '1st Battalion',
      ),
    ).toBe('1st Battalion, March to the bridge.');
  });

  it('sends the offered first part as the whole order', () => {
    expect(
      orderWithOption(
        'Hold the wood then march to Nowhere.',
        'I know of no place called "Nowhere", sir. Shall I send just the first part?',
        'Hold the wood.',
      ),
    ).toBe('Hold the wood.');
  });

  it('adds no example-orders hint to a rate limit or a repeat (#343)', () => {
    for (const code of ['rate_limited', 'duplicate_text']) {
      const t = refusalText({ text: 'Hold.', reason: 'too many orders; wait a moment', code });
      expect(t).toContain('too many orders; wait a moment.');
      expect(t).not.toContain('The staff understand');
    }
    expect(
      refusalText({ text: 'Hold.', reason: 'no such unit', code: 'order_rejected' }),
    ).toContain('The staff understand');
  });

  it('leaves the options out of the refusal text', () => {
    const t = refusalText({
      text: 'Hold the wood.',
      reason: 'Which wood, sir? (Northern wood, Southern wood)',
      code: 'order_clarification',
    });
    expect(t).toContain('Which wood, sir?');
    expect(t).not.toContain('Southern');
  });
});

describe('word of an order (#438)', () => {
  const order = {
    orderId: 't-1',
    text: 'March to the bridge',
    sentAtGame: 20 * 60_000,
    toName: '1st Battalion',
  };
  const paper = (
    id: string,
    kind: Dispatch['kind'],
    writtenMin: number,
    from = '1st Battalion',
  ): Dispatch => ({
    id,
    from,
    kind,
    writtenAtGame: writtenMin * 60_000,
    receivedAtGame: (writtenMin + 3) * 60_000,
    category: 'subordinates',
    text: '',
  });

  it('takes only the addressee acknowledging its orders as proof that the order arrived', () => {
    const engaged = paper('r1', 'engaged', 21);
    const ack = paper('r2', 'orderDelivered', 22);
    expect(deliveredBy(order, [engaged])).toBeUndefined();
    expect(deliveredBy(order, [engaged, ack])).toBe(ack);
    // An acknowledgement written before the order went out is for an earlier one.
    expect(deliveredBy(order, [paper('r0', 'orderDelivered', 19)])).toBeUndefined();
    expect(
      deliveredBy(order, [paper('r3', 'orderDelivered', 22, '2nd Battalion')]),
    ).toBeUndefined();
  });

  it('reads the staff giving its courier up as the order lost, unless it arrived first', () => {
    const lost = paper('r4', 'courierLost', 37);
    expect(lostBy(order, [paper('r1', 'engaged', 21), lost])).toBe(lost);
    expect(lostBy(order, [paper('r2', 'orderDelivered', 22), lost])).toBeUndefined();
    expect(lostBy(order, [paper('r5', 'courierLost', 15)])).toBeUndefined();
  });

  describe('two orders to one unit in flight: each paper names its order', () => {
    const a = { ...order, orderId: 'o-a', sentAtGame: 10 * 60_000 };
    const b = { ...order, orderId: 'o-b', sentAtGame: 25 * 60_000 };
    const about = (d: Dispatch, orderId: string): Dispatch => ({ ...d, orderId });

    it("resending after silence: A's courier lost, B acknowledged before A is given up", () => {
      const ackB = about(paper('r1', 'orderDelivered', 30), 'o-b');
      const lostA = about(paper('r2', 'courierLost', 35), 'o-a');
      for (const papers of [[ackB], [ackB, lostA], [lostA, ackB]]) {
        expect(deliveredBy(a, papers)).toBeUndefined();
        expect(deliveredBy(b, papers)).toBe(ackB);
        expect(lostBy(b, papers)).toBeUndefined();
      }
      expect(lostBy(a, [ackB, lostA])).toBe(lostA);
      const outcomes = orderOutcomes([a, b], [lostA, ackB]);
      expect(outcomes.get('o-a')).toEqual({ lost: lostA });
      expect(outcomes.get('o-b')).toEqual({ arrived: ackB });
    });

    it("one order per turn: A's lost paper written after B was sent does not lose B", () => {
      const lostA = about(paper('r1', 'courierLost', 35), 'o-a');
      const ackB = about(paper('r2', 'orderDelivered', 40), 'o-b');
      expect(lostBy(b, [lostA])).toBeUndefined();
      expect(lostBy(a, [lostA])).toBe(lostA);
      const outcomes = orderOutcomes([a, b], [ackB, lostA]);
      expect(outcomes.get('o-a')).toEqual({ lost: lostA });
      expect(outcomes.get('o-b')).toEqual({ arrived: ackB });
    });
  });
});
