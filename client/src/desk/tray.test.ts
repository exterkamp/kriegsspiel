// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import type { Dispatch } from '@kriegsspiel/protocol';
import Desk from './Desk.svelte';
import {
  activeView,
  gameState,
  persistTray,
  showOnTable,
  trayDiscarded,
  trayFiled,
} from './store.js';
import { emptyMarks, loadMarks, saveMarks, sortTray } from './tray.js';
import { initialState } from '../net/state.js';

const disp = (id: string, extra: Partial<Dispatch> = {}): Dispatch => ({
  id,
  from: `Sender ${id}`,
  writtenAtGame: 60_000,
  receivedAtGame: 120_000,
  category: 'scouts',
  text: `text of ${id}`,
  ...extra,
});

describe('sortTray', () => {
  it('puts dispatches in their piles, newest arrival first, and counts unread', () => {
    const ds = [
      disp('a', { category: 'urgent', receivedAtGame: 10 }),
      disp('b', { category: 'urgent', receivedAtGame: 30 }),
      disp('c', { category: 'rumour', receivedAtGame: 20 }),
    ];
    const t = sortTray(ds, { ...emptyMarks(), read: new Set(['b']) });
    expect(t.piles.map((p) => p.id)).toEqual([
      'urgent',
      'scouts',
      'subordinates',
      'staff',
      'intelligence',
      'rumour',
    ]);
    expect(t.piles[0]!.items.map((d) => d.id)).toEqual(['b', 'a']);
    expect(t.piles[0]!.unread).toBe(1);
    expect(t.unread).toBe(2);
  });
  it('moves filed papers to the drawer and drops discarded ones', () => {
    const ds = [disp('a'), disp('b'), disp('c')];
    const t = sortTray(ds, { ...emptyMarks(), filed: new Set(['a']), discarded: new Set(['b']) });
    expect(t.piles[1]!.items.map((d) => d.id)).toEqual(['c']);
    expect(t.filed.map((d) => d.id)).toEqual(['a']);
  });
  it('sorts 200 dispatches quickly', () => {
    const ds = Array.from({ length: 200 }, (_, i) =>
      disp(`d${i}`, { receivedAtGame: (i * 7919) % 1000 }),
    );
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) sortTray(ds, emptyMarks());
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});

describe('persistence', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it('round-trips marks per game key', () => {
    const s = mem();
    saveMarks('g1', { read: new Set(['a']), filed: new Set(['b']), discarded: new Set(['c']) }, s);
    expect([...loadMarks('g1', s).read]).toEqual(['a']);
    expect([...loadMarks('g1', s).filed]).toEqual(['b']);
    expect([...loadMarks('g1', s).discarded]).toEqual(['c']);
    expect(loadMarks('g2', s).read.size).toBe(0);
  });
  it('ignores damaged or missing storage', () => {
    const s = mem();
    s.setItem('kriegsspiel.tray.g', '{not json');
    expect(loadMarks('g', s).read.size).toBe(0);
    expect(loadMarks('g', undefined).read.size).toBe(0);
    expect(() => saveMarks('g', emptyMarks(), undefined)).not.toThrow();
  });
});

describe('In-tray view', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    localStorage.clear();
    activeView.set('table');
    gameState.set(initialState);
    trayFiled.set(new Set());
    trayDiscarded.set(new Set());
    showOnTable.set(undefined);
  });
  const open = (ds: Dispatch[]): void => {
    gameState.set({ ...initialState, dispatches: ds });
    cmp = mount(Desk, { target: document.body });
    activeView.set('inTray');
    flushSync();
  };
  const click = (el: Element | null | undefined): void => {
    (el as HTMLElement).click();
    flushSync();
  };
  const pileBtn = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.pile')].find((b) =>
      b.textContent!.trim().startsWith(label),
    );
  const rows = () => document.querySelectorAll('.row');

  it('shows piles with unread counts and lists the open pile', () => {
    open([disp('a', { category: 'urgent' }), disp('b'), disp('c')]);
    expect(pileBtn('Urgent')!.textContent).toContain('1');
    expect(pileBtn('Scouts')!.querySelector('.unread-dot')!.textContent).toContain('2');
    expect(rows()).toHaveLength(1);
    click(pileBtn('Scouts'));
    expect(rows()).toHaveLength(2);
  });
  it('opens a dispatch with sender, times and text, and marks it read', () => {
    open([disp('a', { category: 'urgent', from: 'Major Keller' })]);
    expect(document.querySelector('nav .badge')!.textContent).toBe('1');
    click(rows()[0]);
    const v = document.querySelector('.viewer')!.textContent!;
    expect(v).toContain('Major Keller');
    expect(v).toContain('Day 1 00:01');
    expect(v).toContain('Day 1 00:02');
    expect(v).toContain('text of a');
    expect(document.querySelector('nav .badge')).toBeNull();
    expect(get(gameState).read.has('a')).toBe(true);
  });
  it('never shows reliability or confidence', () => {
    open([disp('a', { category: 'urgent', confidence: 'low' })]);
    click(rows()[0]);
    expect(document.body.textContent!.toLowerCase()).not.toMatch(/reliab|confiden/);
  });
  it('shows the attached sketch and pans the table to its place', () => {
    open([
      disp('a', { category: 'urgent', location: { x: 5, y: 6 }, sizeEstimate: '2 companies' }),
    ]);
    click(rows()[0]);
    expect(document.querySelector('.sketch')!.textContent).toContain('2 companies');
    click(document.querySelector('.sketch button'));
    expect(get(showOnTable)).toEqual({ x: 5, y: 6 });
    expect(get(activeView)).toBe('table');
  });
  it('escapes dispatch text', () => {
    open([disp('a', { category: 'urgent', text: '<img src=x onerror=alert(1)>' })]);
    click(rows()[0]);
    expect(document.querySelector('.viewer img')).toBeNull();
  });
  it('files a dispatch to the drawer and returns it', () => {
    open([disp('a', { category: 'urgent' })]);
    click(rows()[0]);
    click([...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'File'));
    expect(rows()).toHaveLength(0);
    click(pileBtn('Filed'));
    expect(rows()).toHaveLength(1);
    click(rows()[0]);
    click(document.querySelector('.actions button'));
    expect(rows()).toHaveLength(0);
    click(pileBtn('Urgent'));
    expect(rows()).toHaveLength(1);
  });
  it('discards a dispatch for good', () => {
    open([disp('a', { category: 'urgent' })]);
    click(rows()[0]);
    click(
      [...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'Discard'),
    );
    expect(rows()).toHaveLength(0);
    click(pileBtn('Filed'));
    expect(rows()).toHaveLength(0);
  });
  it('keeps read, filed and discarded state across a reload', () => {
    const stop = persistTray('game-1');
    open([
      disp('a', { category: 'urgent' }),
      disp('b', { category: 'urgent' }),
      disp('c', { category: 'urgent' }),
    ]);
    click(rows()[0]);
    const first = get(gameState).dispatches.length;
    expect(first).toBe(3);
    click([...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'File'));
    click(
      [...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'Discard'),
    );
    stop();
    unmount(cmp!);
    cmp = undefined;
    gameState.set(initialState);
    trayFiled.set(new Set());
    trayDiscarded.set(new Set());
    persistTray('game-1')();
    expect([...get(gameState).read].sort()).toEqual(['a', 'b', 'c']);
    expect([...get(trayFiled)]).toEqual(['a']);
    expect([...get(trayDiscarded)]).toEqual(['b']);
  });
  it('marks the next paper read when filing or discarding moves the viewer on', () => {
    open([
      disp('a', { category: 'urgent', receivedAtGame: 3000 }),
      disp('b', { category: 'urgent', receivedAtGame: 2000 }),
      disp('c', { category: 'urgent', receivedAtGame: 1000 }),
    ]);
    click(rows()[0]);
    click([...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'File'));
    expect(document.querySelector('.viewer h3')).not.toBeNull();
    expect([...get(gameState).read].sort()).toEqual(['a', 'b']);
    click(
      [...document.querySelectorAll('.actions button')].find((b) => b.textContent === 'Discard'),
    );
    expect([...get(gameState).read].sort()).toEqual(['a', 'b', 'c']);
  });
  it('renders 200 dispatches without lag', () => {
    const ds = Array.from({ length: 200 }, (_, i) => disp(`d${i}`, { receivedAtGame: i * 1000 }));
    const t0 = performance.now();
    open(ds);
    click(pileBtn('Scouts'));
    click(rows()[0]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(rows()).toHaveLength(200);
  });
});
