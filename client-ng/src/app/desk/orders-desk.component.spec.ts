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
