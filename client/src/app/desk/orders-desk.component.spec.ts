import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mark } from '@kriegsspiel/protocol';
import { fixtureView } from '@legacy/table/fixture';
import { emptyDraft } from '@legacy/desk/orders';
import { ORDER_SENDER, type OrderSender } from '../game/ports';
import { fakeGame } from './fake-game';
import { DeskStore } from './desk.store';
import { OrdersDeskComponent } from './orders-desk.component';

const arrow = (id: string): Mark => ({
  id,
  kind: 'arrow',
  from: { x: 100, y: 200 },
  to: { x: 400.4, y: 600 },
  label: 'Main thrust',
  madeAtGame: 0,
});

const unit = fixtureView.ownUnits[0]!;

async function open(send: OrderSender['send'] = () => undefined, extra = {}) {
  const g = fakeGame({
    view: { ...fixtureView, hq: { x: 0, y: 0 } },
    marks: [arrow('a1')],
    ...extra,
  });
  const sender = vi.fn<OrderSender['send']>(send);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: g.provide, useValue: g.fake },
      { provide: ORDER_SENDER, useValue: { send: sender } },
    ],
  });
  const fixture = TestBed.createComponent(OrdersDeskComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  return {
    el,
    q,
    fixture,
    sender,
    game: g.fake,
    desk: TestBed.inject(DeskStore),
    settle: () => fixture.whenStable(),
    fill: async () => {
      const sel = q<HTMLSelectElement>('#order-to');
      sel.value = unit.id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const ta = q<HTMLTextAreaElement>('#desk-order-text');
      ta.value = 'Advance to the ford.';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('OrdersDeskComponent', () => {
  it('shows each courier with a staff estimate once an addressee is chosen', async () => {
    const t = await open();
    expect(t.el.textContent).toContain('choose a commander for an estimate');
    await t.fill();
    const text = t.q('.couriers').textContent!;
    expect(text).toContain('Fast rider');
    expect(text).toMatch(/Fast rider\s*about \d+/);
    expect(text).toMatch(/Steady courier\s*about \d+/);
  });

  it('signs, sends the courier and annex, stamps it and clears the form', async () => {
    const t = await open();
    await t.fill();
    t.q<HTMLInputElement>('input[type=radio][value=fast]').click();
    t.q<HTMLInputElement>('.annex input[type=checkbox]').click();
    await t.settle();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.sender).toHaveBeenCalledOnce();
    const o = t.sender.mock.calls[0]![0];
    expect(o.courier).toBe('fast');
    expect(o.toName).toBe(unit.name);
    expect(o.text).toContain('Advance to the ford.');
    expect(o.text).toContain('Annex (marked map): arrow "Main thrust"');
    expect(o.eta).toBeGreaterThan(0);
    expect(t.q('.stamp').textContent).toBe('SENT');
    expect(t.desk.orderDraft()).toEqual({ ...emptyDraft(), courier: 'fast', to: unit.id });
    expect(t.q<HTMLSelectElement>('#order-to').value).toBe(unit.id);
  });

  it('takes the SENT stamp away after 1.4 s', async () => {
    const t = await open();
    await t.fill();
    // The zoneless scheduler runs on timers, so with fake ones the spec flushes by hand.
    vi.useFakeTimers();
    t.q('#order-sign').click();
    TestBed.tick();
    expect(t.el.querySelector('.stamp')).not.toBeNull();
    vi.advanceTimersByTime(1399);
    TestBed.tick();
    expect(t.el.querySelector('.stamp')).not.toBeNull();
    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(t.el.querySelector('.stamp')).toBeNull();
  });

  it('clears the SENT stamp timer when it is closed', async () => {
    const t = await open();
    await t.fill();
    vi.useFakeTimers();
    t.q('#order-sign').click();
    TestBed.tick();
    expect(t.el.querySelector('.stamp')).not.toBeNull();
    const pending = vi.getTimerCount();
    t.fixture.destroy();
    expect(vi.getTimerCount()).toBe(pending - 1);
  });

  it('signs with ctrl+enter in the order box', async () => {
    const t = await open();
    await t.fill();
    t.q('#desk-order-text').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    await t.settle();
    expect(t.sender).toHaveBeenCalledOnce();
  });

  it('keeps the draft and shows the error when the order cannot go', async () => {
    const t = await open(() => 'Not connected.');
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('#order-err-send').textContent?.trim()).toBe('Not connected.');
    expect(t.desk.orderDraft().text).toBe('Advance to the ford.');
    expect(t.el.querySelector('.stamp')).toBeNull();
  });

  it('keeps the draft and sends nothing when the annex pushes the text past the limit', async () => {
    const t = await open();
    await t.fill();
    const long = 'x'.repeat(1990);
    t.desk.orderDraft.update((d) => ({ ...d, text: long }));
    t.q<HTMLInputElement>('.annex input[type=checkbox]').click();
    await t.settle();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.sender).not.toHaveBeenCalled();
    expect(t.q('#order-err-text').textContent).toContain('2000');
    expect(t.desk.orderDraft().text).toBe(long);
    expect(t.el.querySelector('.stamp')).toBeNull();
  });

  it('labels the desk textarea even with the HUD panel’s own order box in the page', async () => {
    const hud = document.createElement('textarea');
    hud.id = 'order-text';
    document.body.prepend(hud);
    const t = await open();
    document.body.append(t.el);
    const label = t.q<HTMLLabelElement>('label[for="desk-order-text"]');
    expect(label.control).toBe(t.q('#desk-order-text'));
    expect(document.querySelectorAll('[id="order-text"]')).toHaveLength(1);
    hud.remove();
    t.el.remove();
  });

  it('asks for an addressee and wording before signing', async () => {
    const t = await open();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('#order-err-to').textContent).toContain('Address');
    expect(t.q('#order-to').getAttribute('aria-describedby')).toBe('order-err-to');
    expect(t.q('#order-to').getAttribute('aria-invalid')).toBe('true');
    expect(t.q('#order-err-to').getAttribute('role')).toBe('alert');
    expect(t.sender).not.toHaveBeenCalled();
    // Choosing an addressee settles that error; the wording is asked for next.
    t.q<HTMLSelectElement>('#order-to').value = unit.id;
    t.q('#order-to').dispatchEvent(new Event('change', { bubbles: true }));
    await t.settle();
    expect(t.q('#order-err-to').textContent?.trim()).toBe('');
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('#order-err-text').textContent).toContain('Write the order');
    expect(t.q('#desk-order-text').getAttribute('aria-describedby')).toBe('order-err-text');
  });

  it('shows the staff’s word about an order it could not carry out', async () => {
    const t = await open(undefined, {
      notices: [{ code: 'order_rejected', message: 'o1: no such unit' }],
    });
    expect(t.q('.notices').textContent).toContain('no such unit');
  });

  const refusal = (words: string, code = 'order_rejected', reason = 'No such place.') => ({
    notices: [{ code, message: `o1: ${reason}` }],
    outcomes: {
      o1: { kind: 'refused' as const, text: words, sentAtGame: 0, reason, code },
    },
  });

  it('confirms an accepted order with its courier and expected arrival, until the next action', async () => {
    const t = await open();
    await t.fill();
    expect(t.el.querySelector('.confirmation')).toBeNull();
    t.q('#order-sign').click();
    await t.settle();
    const text = t.q('.confirmation').textContent!;
    expect(text).toMatch(/^Sent to .+ by steady courier; expected to arrive Day 1 \d\d:\d\d$/);
    // The journal's pending entry names the same addressee and courier.
    expect(text).toContain(unit.name);
    t.desk.orderDraft.update((d) => ({ ...d, text: 'Next' }));
    t.q<HTMLTextAreaElement>('#desk-order-text').dispatchEvent(new Event('input'));
    t.q<HTMLTextAreaElement>('#desk-order-text').value = 'Next order';
    t.q<HTMLTextAreaElement>('#desk-order-text').dispatchEvent(new Event('input'));
    await t.settle();
    expect(t.el.querySelector('.confirmation')).toBeNull();
  });

  it('offers the first part of an order as a button that sends exactly that part', async () => {
    const t = await open();
    await t.fill();
    t.desk.orderDraft.update((d) => ({
      ...d,
      text: 'Screen the wood, then fall back to the mill.',
    }));
    t.q('#order-sign').click();
    await t.settle();
    t.game.set(
      refusal(
        'Screen the wood, then fall back to the mill.',
        'order_clarification',
        'I know of no place called "mill", sir. Shall I send just the first part? (Cavalry screen the wood)',
      ),
    );
    await t.settle();
    const buttons = [...t.el.querySelectorAll<HTMLButtonElement>('.options button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Cavalry screen the wood']);
    buttons[0]!.click();
    await t.settle();
    expect(t.sender).toHaveBeenCalledTimes(2);
    expect(t.sender.mock.calls[1]![0].words).toBe('Cavalry screen the wood');
  });

  it('takes the stamp back and puts the words back when the order is refused', async () => {
    const t = await open();
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('.stamp')).not.toBeNull();
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').value).toBe('');
    t.game.set(refusal('Advance to the ford.'));
    await t.settle();
    expect(t.el.querySelector('.stamp')).toBeNull();
    expect(t.q('.sr').textContent?.trim()).toBe('');
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').value).toBe('Advance to the ford.');
    expect(t.q('.notices').textContent).toContain('"Advance to the ford."');
  });

  it('does not overwrite words the player has started on again', async () => {
    const t = await open();
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    t.desk.orderDraft.update((d) => ({ ...d, text: 'Something else' }));
    t.game.set(refusal('Advance to the ford.'));
    await t.settle();
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').value).toBe('Something else');
  });

  it('shows only the latest word from the staff, with the hint once', async () => {
    const t = await open(undefined, {
      notices: [
        { code: 'order_rejected', message: 'o1: first refusal' },
        { code: 'order_rejected', message: 'o2: second refusal' },
      ],
    });
    const text = t.q('.notices').textContent!;
    expect(text).toContain('second refusal');
    expect(text).not.toContain('first refusal');
  });

  it('offers a clarification’s options as buttons and resends with the choice filled in', async () => {
    const t = await open();
    await t.fill();
    t.desk.orderDraft.update((d) => ({ ...d, text: 'Hold the wood.' }));
    t.q('#order-sign').click();
    await t.settle();
    t.game.set(
      refusal(
        'Hold the wood.',
        'order_clarification',
        'Which wood, sir? (Northern wood, Southern wood)',
      ),
    );
    await t.settle();
    const buttons = [...t.el.querySelectorAll<HTMLButtonElement>('.options button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Northern wood', 'Southern wood']);
    buttons[1]!.click();
    await t.settle();
    expect(t.sender).toHaveBeenCalledTimes(2);
    expect(t.sender.mock.calls[1]![0].words).toBe('Hold the Southern wood.');
  });

  it('does not sign over a draft the player has started when an option is chosen', async () => {
    const t = await open();
    await t.fill();
    t.desk.orderDraft.update((d) => ({ ...d, text: 'Hold the wood.' }));
    t.q('#order-sign').click();
    await t.settle();
    t.desk.orderDraft.update((d) => ({ ...d, text: 'Something else' }));
    t.game.set(
      refusal(
        'Hold the wood.',
        'order_clarification',
        'Which wood, sir? (Northern wood, Southern wood)',
      ),
    );
    await t.settle();
    t.el.querySelectorAll<HTMLButtonElement>('.options button')[1]!.click();
    await t.settle();
    expect(t.sender).toHaveBeenCalledTimes(1);
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').value).toBe('Hold the Southern wood.');
  });

  it('hides an old refusal once the player signs another order', async () => {
    const t = await open(undefined, refusal('Advance to the ford.'));
    expect(t.el.querySelector('.notices')).not.toBeNull();
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.el.querySelector('.notices')).toBeNull();
  });

  it('disables the form once the game is over and signs nothing', async () => {
    const t = await open(undefined, { gameOver: { winner: 'blue', reason: 'x', atGame: 1 } });
    expect(t.q<HTMLButtonElement>('#order-sign').disabled).toBe(true);
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').disabled).toBe(true);
  });

  it('drops an annex arrow that has since gone from the table', async () => {
    const t = await open();
    await t.fill();
    t.desk.orderDraft.update((d) => ({ ...d, annex: ['a1', 'gone'] }));
    t.game.set({ marks: [] });
    await t.settle();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.sender.mock.calls[0]![0].text).not.toContain('Annex');
  });
});
