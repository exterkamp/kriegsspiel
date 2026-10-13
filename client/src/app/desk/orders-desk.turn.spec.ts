import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TurnOrder } from '@kriegsspiel/protocol';
import { fixtureView } from '@legacy/table/fixture';
import type { ClientState, TurnInfo } from '@legacy/net/state';
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
async function open(
  t: TurnInfo = turn(),
  hold: TurnActions['hold'] = () => true,
  more: Partial<ClientState> = {},
) {
  const g = fakeGame({
    view: { ...fixtureView, hq: { x: 0, y: 0 } },
    turnMode: true,
    turn: t,
    ...more,
  });
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

  it('puts the send question away when the turn moves on, so one press cannot send the next turn', async () => {
    const t = await open(turn({ held: [held] }));
    t.q('#turn-send').click();
    await t.settle();
    expect(t.el.querySelector('#turn-send-confirm')).not.toBeNull();
    // The deadline closes turn 2 without this side, and turn 3 opens.
    t.game.set({ turn: turn({ turn: 3, startsAt: 40 * MIN, endsAt: 60 * MIN }) });
    await t.settle();
    expect(t.el.querySelector('#turn-send-confirm')).toBeNull();
    expect(t.el.querySelector('#turn-send')).not.toBeNull();
    expect(t.actions.send).not.toHaveBeenCalled();
  });

  it('puts the send question away once the side has sent', async () => {
    const t = await open(turn({ held: [held] }));
    t.q('#turn-send').click();
    await t.settle();
    t.game.set({ turn: turn({ held: [held], sent: ['blue'] }) });
    await t.settle();
    t.game.set({ turn: turn({ turn: 3, held: [] }) });
    await t.settle();
    expect(t.el.querySelector('#turn-send-confirm')).toBeNull();
  });

  it('lets go of the order being edited when its turn closes, so the next hold is a new order', async () => {
    const t = await open(turn({ held: [held] }));
    t.button('Edit').click();
    await t.settle();
    expect(t.desk.editingTurnOrder()).toBe('t-1');
    // The commander sends from another seat; then turn 3 opens.
    t.game.set({ turn: turn({ held: [held], sent: ['blue'] }) });
    await t.settle();
    expect(t.desk.editingTurnOrder()).toBeUndefined();
    t.game.set({ turn: turn({ turn: 3 }) });
    await t.settle();
    // The words stay for the player to hold again, as a new order.
    expect(t.desk.orderDraft().text).toBe('Hold the bridge.');
    expect(t.q('#order-sign').textContent!.trim()).toBe('Hold for this turn');
    t.q('#order-sign').click();
    await t.settle();
    expect(t.actions.hold).toHaveBeenCalledWith(expect.objectContaining({ orderId: 't-new' }));
  });

  it('lets go of the order being edited when the next turn opens while still writing', async () => {
    const t = await open(turn({ held: [held] }));
    t.button('Edit').click();
    await t.settle();
    t.game.set({ turn: turn({ turn: 3 }) });
    await t.settle();
    expect(t.desk.editingTurnOrder()).toBeUndefined();
  });

  it('keeps editing through turn states that leave the turn open', async () => {
    const t = await open(turn({ held: [held] }));
    t.button('Edit').click();
    await t.settle();
    t.game.set({ turn: turn({ held: [held], sent: ['red'] }) });
    await t.settle();
    expect(t.desk.editingTurnOrder()).toBe('t-1');
  });

  it('gives the words back when the server refuses a hold', async () => {
    const t = await open();
    await t.fill('Precious words');
    t.q('#order-sign').click();
    await t.settle();
    expect(t.desk.orderDraft().text).toBe('');
    t.game.set({
      notices: [
        { code: 'turn_refused', message: 't-new: a side may hold at most 40 orders for a turn' },
      ],
    });
    await t.settle();
    expect(t.desk.orderDraft()).toMatchObject({ to: unit.id, text: 'Precious words' });
    expect(t.el.querySelector('.confirmation')?.textContent ?? '').not.toContain('Held');
    expect(t.el.textContent).toContain('a side may hold at most 40 orders');
  });

  it('gives a refused change back still as a change to the held order', async () => {
    const t = await open(turn({ held: [held] }));
    t.button('Edit').click();
    await t.settle();
    await t.fill('Hold the bridge at all costs.');
    t.q('#order-sign').click();
    await t.settle();
    t.game.set({
      notices: [{ code: 'rate_limited', message: 't-1: too many turn commands; wait a moment' }],
    });
    await t.settle();
    expect(t.desk.orderDraft().text).toBe('Hold the bridge at all costs.');
    expect(t.desk.editingTurnOrder()).toBe('t-1');
  });

  it('does not put a refused hold over words the player has begun again', async () => {
    const t = await open();
    await t.fill('First');
    t.q('#order-sign').click();
    await t.settle();
    await t.fill('Second');
    t.game.set({ notices: [{ code: 'turn_refused', message: 't-new: the turn has closed' }] });
    await t.settle();
    expect(t.desk.orderDraft().text).toBe('Second');
  });

  it('forgets a hold once the turn lists it, so a later refusal of that id gives nothing back', async () => {
    const t = await open();
    await t.fill('Advance to the ford.');
    t.q('#order-sign').click();
    await t.settle();
    t.game.set({
      turn: turn({
        held: [{ orderId: 't-new', to: unit.id, text: 'Advance to the ford.', courier: 'safe' }],
      }),
    });
    await t.settle();
    t.game.set({ notices: [{ code: 'turn_refused', message: 't-new: no such held order' }] });
    await t.settle();
    expect(t.desk.orderDraft().text).toBe('');
  });

  it('ignores a refusal of some other order', async () => {
    const t = await open();
    await t.fill('Mine');
    t.q('#order-sign').click();
    await t.settle();
    t.game.set({ notices: [{ code: 'turn_refused', message: 't-9: not yours' }] });
    await t.settle();
    expect(t.desk.orderDraft().text).toBe('');
  });
});

describe('the turn desk for a first-time player (#439)', () => {
  it('counts the turns and says why the last one is short', async () => {
    const t = await open(turn({ turn: 3, startsAt: 40 * MIN, endsAt: 50 * MIN }), undefined, {
      turnMinutes: 20,
      battleMinutes: 50,
    });
    expect(t.q('#turn-orders-h').textContent).toContain('Turn 3 of 3: 00:40 to 00:50');
    expect(t.q('[data-testid=turn-orders-last]').textContent).toContain('it is 10 minutes, not 20');
  });

  it('shows each own unit: what it was told, where it is, what it does, men and morale', async () => {
    const t = await open(turn({ held: [held] }));
    const strip = t.q('[data-testid=turn-units]');
    const first = strip.querySelector(`[data-unit="${unit.id}"]`)!;
    expect(first.querySelector('b')!.textContent).toBe(unit.name);
    const dts = [...first.querySelectorAll('dt')].map((x) => x.textContent!.trim());
    const dds = [...first.querySelectorAll('dd')].map((x) =>
      x.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(dts).toEqual(['Told', 'Where', 'Doing', 'Strength']);
    expect(dds[0]).toBe('Hold the bridge. (Held for this turn)');
    expect(dds[3]).toMatch(/^(about \d+ men|not reported), /);
    expect(strip.querySelectorAll('li')).toHaveLength(fixtureView.ownUnits.length);
  });

  it('lists the orders sent in earlier turns with where each stands', async () => {
    const t = await open(turn(), undefined, {
      pending: [
        { orderId: 't-0', text: 'March to the bridge.', sentAtGame: 0, toName: unit.name },
        { orderId: 't-9', text: 'Scout the wood.', sentAtGame: 0, toName: 'Someone' },
      ],
      dispatches: [
        {
          id: 'ack',
          from: unit.name,
          kind: 'orderDelivered',
          orderId: 't-0',
          writtenAtGame: 4 * MIN,
          receivedAtGame: 20 * MIN,
          category: 'subordinates',
          text: 'Sir, we have your orders.',
        },
      ],
    });
    const earlier = t.q('[data-testid=turn-earlier]');
    expect(earlier.querySelector('summary')!.textContent).toContain('Sent in earlier turns (2)');
    // Newest first.
    const items = [...earlier.querySelectorAll('li')].map((li) =>
      [...li.children].map((c) => c.textContent!.trim()),
    );
    expect(items).toEqual([
      ['To Someone, sent at 00:00', 'Scout the wood.', 'With the courier; no word yet'],
      [`To ${unit.name}, sent at 00:00`, 'March to the bridge.', 'Delivered at 00:04'],
    ]);
  });
});
