import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Dispatch } from '@kriegsspiel/protocol';
import { fixtureView } from '@legacy/table/fixture';
import type { TurnInfo } from '@legacy/net/state';
import { DeskComponent } from '../desk.component';
import { DeskStore } from '../desk.store';
import { fakeGame } from '../fake-game';

const MIN = 60_000;
const turn = (over: Partial<TurnInfo> = {}): TurnInfo => ({
  turn: 1,
  startsAt: 0,
  endsAt: 20 * MIN,
  sent: [],
  resolving: false,
  held: [],
  ...over,
});
const paper = (id: string, at: number): Dispatch =>
  ({
    id,
    from: 'Major Kurz',
    text: 'We hold.',
    category: 'subordinates',
    writtenAtGame: at,
    receivedAtGame: at,
  }) as Dispatch;

/** The desk of a turn-mode game (D39, 11.10): the turn panel stands where the pause panel would. */
async function mount(t: TurnInfo | null = turn()) {
  const g = fakeGame({ view: fixtureView, ...(t ? { turnMode: true as const, turn: t } : {}) });
  g.fake.sides.set(['blue', 'red']);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  const desk = TestBed.inject(DeskStore);
  const f = TestBed.createComponent(DeskComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const panel = () => el.querySelector<HTMLElement>('[data-testid="turn-panel"]');
  return { g, desk, el, panel, tick: () => f.whenStable() };
}

describe('TurnPanelComponent', () => {
  it('replaces the pause panel in a turn-mode game, and only there', async () => {
    const turns = await mount();
    expect(turns.panel()).not.toBeNull();
    expect(turns.el.querySelector('.pause')).toBeNull();
    expect(turns.el.querySelector('#clock')!.textContent).toContain('Turn 1: 00:00 to 00:20');
    expect(turns.el.querySelector('[data-testid="clock-rate"]')).toBeNull();
    TestBed.resetTestingModule();
    const realtime = await mount(null);
    expect(realtime.panel()).toBeNull();
  });

  it('shows who has sent and opens the orders desk to send', async () => {
    const t = await mount(
      turn({ sent: ['red'], held: [{ orderId: 'a', to: 'b1', text: 'Hold' }] }),
    );
    expect(t.panel()!.textContent).toMatch(/Blue \(you\): writing/);
    expect(t.panel()!.textContent).toMatch(/Red: sent/);
    const go = t.el.querySelector<HTMLButtonElement>('#turn-open-orders')!;
    expect(go.textContent!.trim()).toBe('Send orders (1 held)');
    go.click();
    await t.tick();
    expect(t.desk.activeView()).toBe('orders');
    expect(t.el.querySelector('#turn-send')).not.toBeNull();
  });

  it('shows the umpire at work while the turn is decided', async () => {
    const t = await mount(turn({ sent: ['blue', 'red'], resolving: true }));
    expect(t.el.querySelector('[data-testid="turn-resolving"]')!.textContent).toContain(
      'The umpire is considering the turn.',
    );
    expect(t.el.querySelector('#turn-open-orders')).toBeNull();
  });

  it('says when a turn has been decided, counts its papers and opens the in-tray', async () => {
    const t = await mount(turn({ sent: ['blue', 'red'], resolving: true }));
    expect(t.el.querySelector('[data-testid="turn-decided"]')).toBeNull();
    t.g.fake.set({
      turn: turn({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN }),
      dispatches: [paper('d1', 12 * MIN), paper('d2', 20 * MIN), paper('old', 0)],
    });
    await t.tick();
    const note = t.el.querySelector('[data-testid="turn-decided"]')!;
    expect(note.textContent).toContain('Turn 1 has been decided: 2 new papers in the in-tray.');
    [...note.querySelectorAll('button')].find((b) => b.textContent!.includes('Read'))!.click();
    await t.tick();
    expect(t.desk.activeView()).toBe('inTray');
    expect(t.el.querySelector('[data-testid="turn-decided"]')).toBeNull();
  });

  it('says the battle is decided and the turn is the pursuit, once the umpire has ruled (#438)', async () => {
    const before = await mount();
    expect(before.el.querySelector('[data-testid="turn-pursuit"]')).toBeNull();
    TestBed.resetTestingModule();
    const after = await mount(
      turn({ turn: 3, startsAt: 40 * MIN, endsAt: 60 * MIN, pursuitUntil: 51 * MIN }),
    );
    const note = after.el.querySelector('[data-testid="turn-pursuit"]');
    expect(note?.textContent).toContain('The battle is decided; this turn is the pursuit');
    expect(note?.textContent).toContain('00:51');
    expect(note?.textContent).toContain('no orders');
  });

  it('is gone once the game is over', async () => {
    const t = await mount();
    t.g.fake.set({ gameOver: { winner: 'blue', reason: 'eliminated', atGame: 0 } });
    await t.tick();
    expect(t.panel()).toBeNull();
  });
});
