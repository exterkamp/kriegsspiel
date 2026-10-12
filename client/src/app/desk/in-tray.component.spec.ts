import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Dispatch } from '@kriegsspiel/protocol';
import { GameService } from '../game/game.service';
import { fakeGame } from './fake-game';
import { DeskStore } from './desk.store';
import { InTrayComponent } from './in-tray.component';

const disp = (id: string, extra: Partial<Dispatch> = {}): Dispatch => ({
  id,
  from: `Sender ${id}`,
  writtenAtGame: 60_000,
  receivedAtGame: 120_000,
  category: 'scouts',
  text: `text of ${id}`,
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
});

async function open(dispatches: Dispatch[]) {
  const { provide, useValue } = fakeGame({ dispatches });
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide, useValue }],
  });
  const fixture = TestBed.createComponent(InTrayComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = () => fixture.whenStable();
  return {
    el,
    fixture,
    game: TestBed.inject(GameService),
    desk: TestBed.inject(DeskStore),
    rows: () => el.querySelectorAll('.row'),
    pileBtn: (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.pile')].find((b) =>
        b.textContent!.trim().startsWith(label),
      )!,
    action: (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.actions button')].find(
        (b) => b.textContent === label,
      )!,
    click: async (e: Element | undefined) => {
      (e as HTMLElement).click();
      await settle();
    },
  };
}

describe('InTrayComponent', () => {
  it('opens on the first pile with something unread, not the empty Urgent pile', async () => {
    const t = await open([disp('s1', { category: 'staff' })]);
    expect(t.pileBtn('Staff').getAttribute('aria-pressed')).toBe('true');
    expect(t.pileBtn('Urgent').getAttribute('aria-pressed')).toBe('false');
    expect(t.rows()).toHaveLength(1);
  });

  it('opens on Urgent when nothing is unread', async () => {
    const t = await open([]);
    expect(t.pileBtn('Urgent').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows piles with unread counts and lists the open pile', async () => {
    const t = await open([disp('a', { category: 'urgent' }), disp('b'), disp('c')]);
    expect(t.pileBtn('Urgent').textContent).toContain('1');
    expect(t.pileBtn('Scouts').querySelector('.unread-dot')!.textContent).toContain('2');
    expect(t.rows()).toHaveLength(1);
    await t.click(t.pileBtn('Scouts'));
    expect(t.rows()).toHaveLength(2);
  });

  it('says so when a pile is empty, and prompts to select when nothing is open', async () => {
    const t = await open([]);
    expect(t.el.querySelector('.list .empty')!.textContent).toBe('Nothing here.');
    expect(t.el.querySelector('.viewer .empty')!.textContent).toContain('Select a dispatch');
  });

  it('lists the opening situation report from the chief of staff in the staff pile (#267)', async () => {
    const t = await open([
      disp('situation', {
        category: 'staff',
        from: 'Chief of staff',
        text: 'Situation at the start of the game.',
        location: { x: 1, y: 2 },
      }),
    ]);
    expect(t.pileBtn('Staff').textContent).toContain('1');
    await t.click(t.pileBtn('Staff'));
    await t.click(t.rows()[0]);
    expect(t.el.querySelector('.viewer')!.textContent).toContain('Situation at the start');
  });

  it('shows the order acknowledgement from a subordinate (#267)', async () => {
    const t = await open([
      disp('ack', { category: 'subordinates', from: 'Guards', text: 'Order received.' }),
    ]);
    await t.click(t.pileBtn('Subordinates'));
    expect(t.rows()).toHaveLength(1);
    expect(t.rows()[0]!.textContent).toContain('Guards');
  });

  it('opens a dispatch with sender, times and text, and marks it read', async () => {
    const t = await open([disp('a', { category: 'urgent', from: 'Major Keller' })]);
    await t.click(t.rows()[0]);
    const v = t.el.querySelector('.viewer')!.textContent!;
    expect(v).toContain('Major Keller');
    expect(v).toContain('Day 1 00:01');
    expect(v).toContain('Day 1 00:02');
    expect(v).toContain('text of a');
    expect(t.game.state().read.has('a')).toBe(true);
    expect(t.el.querySelector('.unread-dot')).toBeNull();
    expect(t.desk.viewedDispatch()?.id).toBe('a');
  });

  it('never shows reliability or confidence', async () => {
    const t = await open([disp('a', { category: 'urgent', confidence: 'low' })]);
    await t.click(t.rows()[0]);
    expect(t.el.textContent!.toLowerCase()).not.toMatch(/reliab|confiden/);
  });

  it('shows the attached sketch and pans the table to its place', async () => {
    const t = await open([
      disp('a', { category: 'urgent', location: { x: 5, y: 6 }, sizeEstimate: '2 companies' }),
    ]);
    await t.click(t.rows()[0]);
    expect(t.el.querySelector('.sketch')!.textContent).toContain('2 companies');
    t.desk.activeView.set('inTray');
    await t.click(t.el.querySelector('.sketch button')!);
    expect(t.desk.showOnTable()).toEqual({ x: 5, y: 6 });
    expect(t.desk.activeView()).toBe('table');
  });

  it('escapes dispatch text', async () => {
    const t = await open([disp('a', { category: 'urgent', text: '<img src=x onerror=alert(1)>' })]);
    await t.click(t.rows()[0]);
    expect(t.el.querySelector('.viewer img')).toBeNull();
  });

  it('files a dispatch to the drawer and returns it', async () => {
    const t = await open([disp('a', { category: 'urgent' })]);
    await t.click(t.rows()[0]);
    await t.click(t.action('File'));
    expect(t.rows()).toHaveLength(0);
    await t.click(t.pileBtn('Filed'));
    expect(t.rows()).toHaveLength(1);
    await t.click(t.rows()[0]);
    await t.click(t.action('Return to pile'));
    expect(t.rows()).toHaveLength(0);
    await t.click(t.pileBtn('Urgent'));
    expect(t.rows()).toHaveLength(1);
  });

  it('discards a dispatch for good', async () => {
    const t = await open([disp('a', { category: 'urgent' })]);
    await t.click(t.rows()[0]);
    await t.click(t.action('Discard'));
    expect(t.rows()).toHaveLength(0);
    await t.click(t.pileBtn('Filed'));
    expect(t.rows()).toHaveLength(0);
  });

  it('keeps read, filed and discarded state across a reload', async () => {
    const t = await open([
      disp('a', { category: 'urgent' }),
      disp('b', { category: 'urgent' }),
      disp('c', { category: 'urgent' }),
    ]);
    const stop = t.desk.persistTray('game-1');
    await t.click(t.rows()[0]);
    await t.click(t.action('File'));
    await t.click(t.action('Discard'));
    stop();
    // A later visit: a fresh store and service load the saved marks.
    TestBed.resetTestingModule();
    const { provide, useValue } = fakeGame({ dispatches: [] });
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide, useValue }],
    });
    const desk = TestBed.inject(DeskStore);
    desk.persistTray('game-1')();
    expect([...TestBed.inject(GameService).state().read].sort()).toEqual(['a', 'b', 'c']);
    expect([...desk.trayFiled()]).toEqual(['a']);
    expect([...desk.trayDiscarded()]).toEqual(['b']);
  });

  it('marks the next paper read when filing or discarding moves the viewer on', async () => {
    const t = await open([
      disp('a', { category: 'urgent', receivedAtGame: 3000 }),
      disp('b', { category: 'urgent', receivedAtGame: 2000 }),
      disp('c', { category: 'urgent', receivedAtGame: 1000 }),
    ]);
    await t.click(t.rows()[0]);
    await t.click(t.action('File'));
    expect(t.el.querySelector('.viewer h3')).not.toBeNull();
    expect([...t.game.state().read].sort()).toEqual(['a', 'b']);
    await t.click(t.action('Discard'));
    expect([...t.game.state().read].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps keyboard focus on the viewer after a paper goes', async () => {
    const t = await open([disp('a', { category: 'urgent' })]);
    document.body.append(t.el);
    await t.click(t.rows()[0]);
    await t.click(t.action('Discard'));
    expect(document.activeElement).toBe(t.el.querySelector('.viewer'));
    t.el.remove();
  });

  it('renders 200 dispatches in one pile', async () => {
    const t = await open(
      Array.from({ length: 200 }, (_, i) => disp(`d${i}`, { receivedAtGame: i * 1000 })),
    );
    await t.click(t.pileBtn('Scouts'));
    await t.click(t.rows()[0]);
    expect(t.rows()).toHaveLength(200);
  });
});
