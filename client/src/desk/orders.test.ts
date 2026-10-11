// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import type { Mark } from '@kriegsspiel/protocol';
import Desk from './Desk.svelte';
import {
  activeView,
  gameState,
  orderDraft,
  orderSender,
  persistDraft,
  persistJournal,
  journal,
  type OrderSender,
} from './store.js';
import {
  annexLine,
  deliveryStatus,
  emptyDraft,
  estimateRideMs,
  formatEstimate,
  loadDraft,
  noticeText,
  ORDER_EXAMPLES,
  deliveredBy,
  refusalText,
  saveDraft,
  withAnnex,
} from './orders.js';
import { fixtureView } from '../table/fixture.js';
import { applyServerMessage, initialState, withPendingOrder } from '../net/state.js';
import { MarksBar, startsCollapsed } from '../hud/marksBar.js';

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
  it('saves as the store changes and loads on start', () => {
    const stop = persistDraft('g3');
    orderDraft.update((d) => ({ ...d, text: 'Withdraw' }));
    stop();
    orderDraft.set(emptyDraft());
    persistDraft('g3')();
    expect(get(orderDraft).text).toBe('Withdraw');
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

describe('Orders desk', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    activeView.set('table');
    gameState.set(initialState);
    orderDraft.set(emptyDraft());
    orderSender.set(undefined);
    vi.useRealTimers();
  });
  const unit = fixtureView.ownUnits[0]!;
  const open = (): void => {
    gameState.set({
      ...initialState,
      view: { ...fixtureView, hq: { x: 0, y: 0 } },
      marks: [arrow('a1')],
    });
    activeView.set('orders');
    cmp = mount(Desk, { target: document.body });
    flushSync();
  };
  const q = <T extends HTMLElement>(s: string): T => document.querySelector<T>(s)!;
  const fill = (): void => {
    const sel = q<HTMLSelectElement>('#order-to');
    sel.value = unit.id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const ta = q<HTMLTextAreaElement>('#desk-order-text');
    ta.value = 'Advance to the ford.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  it('shows each courier with a staff estimate once an addressee is chosen', () => {
    open();
    expect(document.body.textContent).toContain('choose a commander for an estimate');
    fill();
    const text = document.querySelector('.couriers')!.textContent!;
    expect(text).toContain('Fast rider');
    expect(text).toMatch(/Fast rider\s*about \d+/);
    expect(text).toMatch(/Steady courier\s*about \d+/);
  });

  it('signs, sends the courier and annex, stamps it and clears the form', () => {
    open();
    const send = vi.fn<OrderSender['send']>(() => undefined);
    orderSender.set({ send });
    fill();
    q<HTMLInputElement>('input[type=radio][value=fast]').click();
    q<HTMLInputElement>('.annex input[type=checkbox]').click();
    flushSync();
    q('#order-sign').click();
    flushSync();
    expect(send).toHaveBeenCalledOnce();
    const o = send.mock.calls[0]![0];
    expect(o.courier).toBe('fast');
    expect(o.toName).toBe(unit.name);
    expect(o.text).toContain('Advance to the ford.');
    expect(o.text).toContain('Annex (marked map): arrow "Main thrust"');
    expect(o.eta).toBeGreaterThan(0);
    expect(document.querySelector('.stamp')?.textContent).toBe('SENT');
    expect(get(orderDraft)).toEqual({ ...emptyDraft(), courier: 'fast', to: unit.id });
    expect(q<HTMLSelectElement>('#order-to').value).toBe(unit.id);
  });

  it('keeps the draft and shows the error when the order cannot go', () => {
    open();
    orderSender.set({ send: () => 'Not connected.' });
    fill();
    q('#order-sign').click();
    flushSync();
    expect(q('#order-err-send').textContent?.trim()).toBe('Not connected.');
    expect(get(orderDraft).text).toBe('Advance to the ford.');
    expect(document.querySelector('.stamp')).toBeNull();
  });

  it('keeps the draft and sends nothing when the annex pushes the text past the limit', () => {
    open();
    const send = vi.fn(() => undefined);
    orderSender.set({ send });
    fill();
    const long = 'x'.repeat(1990);
    orderDraft.update((d) => ({ ...d, text: long }));
    q<HTMLInputElement>('.annex input[type=checkbox]').click();
    flushSync();
    q('#order-sign').click();
    flushSync();
    expect(send).not.toHaveBeenCalled();
    expect(q('#order-err-text').textContent).toContain('2000');
    expect(get(orderDraft).text).toBe(long);
    expect(document.querySelector('.stamp')).toBeNull();
  });

  it('labels the desk textarea even with the HUD panel’s own order box in the page', () => {
    const hud = document.createElement('textarea');
    hud.id = 'order-text';
    document.body.prepend(hud);
    open();
    const label = q<HTMLLabelElement>('label[for="desk-order-text"]');
    expect(label.control).toBe(q('#desk-order-text'));
    expect(document.querySelectorAll('[id="order-text"]')).toHaveLength(1);
  });

  it('asks for an addressee and wording before signing', () => {
    open();
    const send = vi.fn(() => undefined);
    orderSender.set({ send });
    q('#order-sign').click();
    flushSync();
    expect(q('#order-err-to').textContent).toContain('Address');
    expect(q('#order-to').getAttribute('aria-describedby')).toBe('order-err-to');
    expect(q('#order-to').getAttribute('aria-invalid')).toBe('true');
    expect(q('#order-err-to').getAttribute('role')).toBe('alert');
    expect(send).not.toHaveBeenCalled();
  });

  it('lists a sent order in the journal with its delivery progress', () => {
    gameState.set({
      ...initialState,
      pending: [
        {
          orderId: 'o1',
          text: 'Advance',
          sentAtGame: 0,
          toName: 'Guards',
          courier: 'safe',
          etaGame: 600_000,
        },
      ],
    });
    const stop = persistJournal('orders-test');
    activeView.set('journal');
    cmp = mount(Desk, { target: document.body });
    flushSync();
    stop();
    const li = q('#view-journal li');
    expect(li.textContent).toContain('Order sent to Guards by steady courier: Advance');
    expect(li.textContent).toContain('Courier riding, expected Day 1 00:10');
    expect(li.querySelector('progress')).not.toBeNull();
  });
});

describe('refusals and outcomes', () => {
  it('shows the player’s own words, no order id and two examples', () => {
    const s = applyServerMessage(
      withPendingOrder(initialState, {
        orderId: 'o-9',
        text: 'Fall Back to the Ford',
        sentAtGame: 5,
      }),
      {
        v: 1,
        kind: 'error',
        code: 'order_rejected',
        message: 'o-9: I could not find a place.',
      } as never,
      0,
    );
    expect(s.pending).toEqual([]);
    const text = noticeText(s.notices[0]!, s.outcomes);
    expect(text).toContain('"Fall Back to the Ford"');
    expect(text).toContain('I could not find a place.');
    expect(text).not.toMatch(/o-9/);
    for (const e of ORDER_EXAMPLES) expect(text).toContain(e);
  });

  it('writes the refusal and the addressee’s reply into the journal', () => {
    const sent = { orderId: 'o1', text: 'Advance', sentAtGame: 0, toName: 'Guards' };
    gameState.set({
      ...initialState,
      pending: [sent],
      dispatches: [
        {
          id: 'd1',
          from: 'Guards',
          writtenAtGame: 100,
          receivedAtGame: 200,
          category: 'subordinates',
          text: 'In position.',
        },
      ],
      outcomes: {
        o2: { kind: 'refused', text: 'Dance', sentAtGame: 0, reason: 'No such action.' },
      },
    });
    const stop = persistJournal('outcome-test');
    const entries = get(journal);
    stop();
    gameState.set(initialState);
    expect(entries.find((e) => e.id === 'outcome:o1')?.text).toContain('Order to Guards arrived');
    expect(entries.find((e) => e.id === 'outcome:o2')?.text).toContain('"Dance"');
  });

  it('only counts a reply from the addressee written after the order', () => {
    const p = { orderId: 'o', text: 't', sentAtGame: 100, toName: 'Guards' };
    const d = (from: string, written: number, received = written) => ({
      id: from + written,
      from,
      writtenAtGame: written,
      receivedAtGame: received,
      category: 'staff' as const,
      text: '',
    });
    expect(deliveredBy(p, [d('Guards', 50), d('Hussars', 200)])).toBeUndefined();
    expect(deliveredBy(p, [d('Guards', 300), d('Guards', 150)])?.writtenAtGame).toBe(150);
    // Written before the order was signed, received after: says nothing about delivery.
    expect(deliveredBy(p, [d('Guards', 100 - 50, 200)])).toBeUndefined();
    // Written after, received later still.
    expect(deliveredBy(p, [d('Guards', 120, 200)])?.receivedAtGame).toBe(200);
  });

  it('ends a refusal reason with a full stop and phrases a clarification as a need', () => {
    expect(refusalText({ text: 'x', reason: 'Which bridge? (A, B)' })).toContain(
      '(A, B) The staff',
    );
    expect(refusalText({ text: 'x', reason: 'No such action' })).toContain(
      'No such action. The staff',
    );
    const c = refusalText({ text: 'x', reason: 'Which bridge?', code: 'order_clarification' });
    expect(c).toContain('need more');
    expect(c).not.toContain('could not be carried out');
  });
});

describe('marks toolbar', () => {
  it('starts collapsed on narrow screens and toggles', () => {
    expect(startsCollapsed(1100)).toBe(true);
    expect(startsCollapsed(1600)).toBe(false);
    document.body.innerHTML = '';
    const bar = new MarksBar(
      document.body,
      { onTool() {}, onDelete() {}, onPlotReport() {}, onOverlays() {} },
      true,
    );
    const toggle = document.querySelector<HTMLButtonElement>('#marks-toggle')!;
    expect(document.querySelector<HTMLElement>('#marks-body')!.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(bar.collapsed).toBe(false);
    expect(document.querySelector<HTMLElement>('#marks-body')!.hidden).toBe(false);
    document.body.innerHTML = '';
  });
});

describe('page head', () => {
  it('declares an icon so the browser does not request a missing favicon', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
    expect(html).toMatch(/<link rel="icon"/);
  });
});

describe('Orders desk notices', () => {
  it('shows the staff’s word about an order it could not carry out', () => {
    gameState.set({
      ...initialState,
      notices: [{ code: 'order_rejected', message: 'o1: no such unit' }],
    });
    activeView.set('orders');
    const cmp = mount(Desk, { target: document.body });
    flushSync();
    expect(document.querySelector('#view-orders .notices')?.textContent).toContain('no such unit');
    unmount(cmp);
    document.body.innerHTML = '';
    activeView.set('table');
    gameState.set(initialState);
  });
});
