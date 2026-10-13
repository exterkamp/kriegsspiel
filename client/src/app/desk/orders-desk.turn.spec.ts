import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TurnOrder } from '@kriegsspiel/protocol';
import { fixtureView } from '@legacy/table/fixture';
import type { TurnInfo } from '@legacy/net/state';
import { ORDER_SENDER, TURN_ACTIONS, type TurnActions } from '../game/ports';
import { fakeGame } from './fake-game';
import { DeskStore } from './desk.store';
import { OrdersDeskComponent } from './orders-desk.component';

const unit = fixtureView.ownUnits[0]!;
const MIN = 60_000;

const turn = (over: Partial<TurnInfo> = {}): TurnInfo => ({
  turn: 2,
  startsAt: 20 * MIN,
  endsAt: 40 * MIN,
  sent: [],
  resolving: false,
  held: [],
  ...over,
});

/** The orders desk in a turn-mode game (D39, 11.10), with the turn's server actions faked. */
async function open(t: TurnInfo = turn(), hold: TurnActions['hold'] = () => true) {
  const g = fakeGame({ view: { ...fixtureView, hq: { x: 0, y: 0 } }, turnMode: true, turn: t });
  g.fake.sides.set(['blue', 'red']);
  const actions = {
    hold: vi.fn<TurnActions['hold']>(hold),
    withdraw: vi.fn<TurnActions['withdraw']>(() => true),
    send: vi.fn<TurnActions['send']>(() => true),
    newId: vi.fn(() => 't-new'),
  };
  const sender = { send: vi.fn(() => undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: g.provide, useValue: g.fake },
      { provide: ORDER_SENDER, useValue: sender },
      { provide: TURN_ACTIONS, useValue: actions },
    ],
  });
  const fixture = TestBed.createComponent(OrdersDeskComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  const button = (label: string): HTMLButtonElement =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!;
  return {
    el,
    q,
    button,
    actions,
    sender,
    game: g.fake,
    desk: TestBed.inject(DeskStore),
    settle: () => fixture.whenStable(),
    fill: async (words = 'Advance to the ford.') => {
      const sel = q<HTMLSelectElement>('#order-to');
      sel.value = unit.id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const ta = q<HTMLTextAreaElement>('#desk-order-text');
      ta.value = words;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    },
  };
}

const held: TurnOrder = { orderId: 't-1', to: unit.id, text: 'Hold the bridge.', courier: 'fast' };

describe('OrdersDeskComponent in a turn-mode game', () => {
  it('shows the turn, who has sent, and holds an order instead of sending it', async () => {
    const t = await open(turn({ sent: ['red'] }));
    expect(t.q('#turn-orders-h').textContent).toContain('Turn 2: 00:20 to 00:40');
    const sides = t.q('[aria-label="Who has sent orders"]').textContent!;
    expect(sides).toMatch(/Blue \(you\): writing orders/);
    expect(sides).toMatch(/Red: sent/);
    expect(t.q('#order-sign').textContent!.trim()).toBe('Hold for this turn');
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.actions.hold).toHaveBeenCalledWith({
      orderId: 't-new',
      to: unit.id,
      text: 'Advance to the ford.',
      courier: 'safe',
    });
    // Nothing goes as a real-time order, and the words are cleared for the next one.
    expect(t.sender.send).not.toHaveBeenCalled();
    expect(t.desk.orderDraft().text).toBe('');
    expect(t.el.querySelector('.confirmation')!.textContent).toContain(
      `Held for this turn: to ${unit.name}`,
    );
  });

  it('asks for an addressee and words before holding', async () => {
    const t = await open();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('#order-err-to').textContent).toContain('Address the order');
    expect(t.actions.hold).not.toHaveBeenCalled();
  });

  it('lists held orders, and edits one in place under its own id', async () => {
    const t = await open(turn({ held: [held] }));
    const list = t.q('[data-testid="turn-held"]').textContent!;
    expect(list).toContain(`To ${unit.name}, by fast rider`);
    expect(list).toContain('Hold the bridge.');
    t.button('Edit').click();
    await t.settle();
    expect(t.desk.orderDraft()).toMatchObject({
      to: unit.id,
      text: 'Hold the bridge.',
      courier: 'fast',
    });
    expect(t.q('#order-sign').textContent!.trim()).toBe('Hold the changed order');
    await t.fill('Hold the bridge at all costs.');
    t.q('#order-sign').click();
    await t.settle();
    expect(t.actions.hold).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 't-1', text: 'Hold the bridge at all costs.' }),
    );
    expect(t.actions.newId).not.toHaveBeenCalled();
    expect(t.desk.editingTurnOrder()).toBeUndefined();
  });

  it('withdraws a held order', async () => {
    const t = await open(turn({ held: [held] }));
    t.button('Withdraw').click();
    expect(t.actions.withdraw).toHaveBeenCalledWith('t-1');
  });

  it('asks once before sending the turn, and warns of words not held', async () => {
    const t = await open(turn({ held: [held] }));
    await t.fill('Something not yet held');
    t.q('#turn-send').click();
    await t.settle();
    expect(t.actions.send).not.toHaveBeenCalled();
    const ask = t.q('[aria-labelledby="turn-confirm-q"]').textContent!;
    expect(ask).toContain('Send this order for the turn? This is final for your side.');
    expect(ask).toContain('have not been held and will not go');
    t.button('Not yet').click();
    await t.settle();
    expect(t.el.querySelector('#turn-send-confirm')).toBeNull();
    t.q('#turn-send').click();
    await t.settle();
    t.q('#turn-send-confirm').click();
    expect(t.actions.send).toHaveBeenCalledTimes(1);
  });

  it('lets a side send no orders, saying what that means', async () => {
    const t = await open();
    expect(t.q('[data-testid="turn-none"]').textContent).toContain(
      'keeps its units on their last orders',
    );
    t.q('#turn-send').click();
    await t.settle();
    expect(t.q('#turn-confirm-q').textContent).toContain('Send no orders for the turn?');
  });

  it('closes the order box once the side has sent, and waits for the others', async () => {
    const t = await open(turn({ held: [held], sent: ['blue'] }));
    expect(t.q('[data-testid="turn-sent"]').textContent).toContain('Waiting for Red.');
    expect(t.el.querySelector('#turn-send')).toBeNull();
    expect(t.button('Edit')).toBeUndefined();
    expect(t.q<HTMLButtonElement>('#order-sign').disabled).toBe(true);
    expect(t.q<HTMLTextAreaElement>('#desk-order-text').disabled).toBe(true);
  });

  it('says the umpire is at work while the turn is decided', async () => {
    const t = await open(turn({ sent: ['blue', 'red'], resolving: true }));
    expect(t.q('[data-testid="turn-orders"]').textContent).toContain(
      'The umpire is considering the turn.',
    );
    expect(t.q<HTMLButtonElement>('#order-sign').disabled).toBe(true);
  });

  it('tells the player when the link is down', async () => {
    const t = await open(turn(), () => false);
    await t.fill();
    t.q('#order-sign').click();
    await t.settle();
    expect(t.q('#order-err-send').textContent).toContain('Not connected');
    expect(t.desk.orderDraft().text).toBe('Advance to the ford.');
  });
});
