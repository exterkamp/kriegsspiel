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

async function open(dispatches: Dispatch[], turns = false) {
  const { provide, useValue } = fakeGame({
    dispatches,
    ...(turns ? { turnMode: true as const, turnMinutes: 20 } : {}),
  });
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
  it('shows the staff-overloaded notice only when the server sends it', async () => {
    const t = await open([disp('a')]);
    expect(t.el.querySelector('.overloaded')).toBeNull();
    t.game.mergeRead([]);
    (t.game as unknown as { set: (p: object) => void }).set({
      view: { staffOverloaded: 'The staff are overwhelmed, sir.' },
    });
    await t.fixture.whenStable();
    expect(t.el.querySelector('.overloaded')?.textContent).toContain('overwhelmed');
  });

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

describe('InTrayComponent in a turn-mode game (#439)', () => {
  const MIN = 60_000;
  const seen = {
    kind: 'contact' as const,
    sizeEstimate: 'about a battalion',
    place: 'near the bridge',
  };
  const papers = [
    disp('open', {
      from: 'Chief of staff',
      writtenAtGame: 0,
      receivedAtGame: 0,
      category: 'staff',
    }),
    disp('c1', {
      ...seen,
      from: '1st Battalion',
      writtenAtGame: 5 * MIN,
      receivedAtGame: 20 * MIN,
    }),
    disp('c2', {
      ...seen,
      from: '1st Battalion',
      writtenAtGame: 12 * MIN,
      receivedAtGame: 20 * MIN,
    }),
    disp('e', {
      from: '2nd Battalion',
      kind: 'engaged',
      category: 'subordinates',
      writtenAtGame: 8 * MIN,
      receivedAtGame: 20 * MIN,
    }),
    disp('t2', { from: '2nd Battalion', writtenAtGame: 25 * MIN, receivedAtGame: 40 * MIN }),
  ];

  it('opens on All, with the papers under their turns in written order and clock times', async () => {
    const t = await open(papers, true);
    expect(t.pileBtn('All').getAttribute('aria-pressed')).toBe('true');
    const headings = [...t.el.querySelectorAll('h3.turn')].map((h) => h.textContent!.trim());
    expect(headings).toEqual(['Turn 2: 00:20 to 00:40', 'Turn 1: 00:00 to 00:20']);
    const rows = [...t.rows()].map((r) => [
      r.querySelector('b')!.textContent!.trim(),
      r.querySelector('small')!.textContent!.trim(),
    ]);
    expect(rows).toEqual([
      ['● 2nd Battalion', 'written 00:25'],
      ['● Chief of staff', 'written 00:00'],
      ['● 1st Battalion', 'seen 2 times, 00:05 to 00:12'],
      ['● 2nd Battalion', 'written 00:08'],
    ]);
  });

  it('opens a merged sighting on its newest paper, lists the earlier ones, and reads them all', async () => {
    const t = await open(papers, true);
    await t.click(t.rows()[2]);
    expect(t.el.querySelector('.viewer .text')!.textContent).toBe('text of c2');
    expect(t.el.querySelector('.also')!.textContent).toContain('00:05, 1st Battalion');
    expect([...t.game.state().read].sort()).toEqual(['c1', 'c2']);
    await t.click(t.action('File'));
    expect([...t.desk.trayFiled()].sort()).toEqual(['c1', 'c2']);
  });

  it('keeps the piles of a real-time game as they were', async () => {
    const t = await open(papers);
    expect(t.el.querySelector('h3.turn')).toBeNull();
    expect(
      [...t.el.querySelectorAll('.pile')].map((b) => b.textContent!.trim().split(' ')[0]),
    ).not.toContain('All');
  });
});
