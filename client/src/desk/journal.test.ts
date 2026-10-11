// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import type { Dispatch } from '@kriegsspiel/protocol';
import Desk from './Desk.svelte';
import { activeView, addNote, gameState, journal, persistJournal } from './store.js';
import {
  addEntries,
  chronological,
  clockEntry,
  exportText,
  filterEntries,
  loadJournal,
  noteEntry,
  saveJournal,
  type JournalEntry,
} from './journal.js';
import { initialState } from '../net/state.js';

const e = (id: string, kind: JournalEntry['kind'], at: number, text: string): JournalEntry => ({
  id,
  kind,
  at,
  text,
});
const disp = (id: string, at: number): Dispatch => ({
  id,
  from: 'Scout',
  writtenAtGame: at,
  receivedAtGame: at,
  category: 'scouts',
  text: `saw ${id}`,
});

describe('journal logic', () => {
  it('never records the same entry twice', () => {
    const a = [e('a', 'note', 1, 'x')];
    expect(addEntries(a, [e('a', 'note', 1, 'x')])).toBe(a);
    expect(addEntries(a, [e('b', 'note', 2, 'y')])).toHaveLength(2);
  });
  it('orders newest first', () => {
    const out = chronological([
      e('a', 'note', 1, ''),
      e('b', 'note', 3, ''),
      e('c', 'note', 2, ''),
    ]);
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('filters by text and by kind', () => {
    const all = [
      e('a', 'order', 0, 'Advance on the bridge'),
      e('b', 'dispatch', 0, 'Scout: bridge held'),
      e('c', 'note', 0, 'remember the ford'),
    ];
    expect(filterEntries(all, { query: 'BRIDGE', kinds: new Set() }).map((x) => x.id)).toEqual([
      'a',
      'b',
    ]);
    expect(filterEntries(all, { query: 'bridge', kinds: new Set(['order']) })).toHaveLength(1);
    expect(filterEntries(all, { query: '', kinds: new Set(['note']) })[0]!.id).toBe('c');
  });
  it('records pauses and resumes but not the first sight of the clock', () => {
    expect(clockEntry(undefined, 'paused', 0)).toBeUndefined();
    expect(clockEntry('running', 'running', 0)).toBeUndefined();
    expect(clockEntry('running', 'paused', 60_000)?.text).toBe('Game paused.');
    expect(clockEntry('paused', 'running', 60_000)?.text).toBe('Game resumed.');
  });
  it('exports plain text, oldest first', () => {
    const t = exportText([
      e('b', 'dispatch', 120_000, 'Scout: hi'),
      e('a', 'order', 0, 'Order sent: go'),
    ]);
    expect(t).toContain('[Day 1 00:00] ORDER: Order sent: go\n\n[Day 1 00:02] DISPATCH: Scout: hi');
    expect(t.indexOf('ORDER')).toBeLessThan(t.indexOf('DISPATCH'));
  });
  it('survives damaged or missing storage', () => {
    expect(loadJournal('nope')).toEqual([]);
    localStorage.setItem('kriegsspiel.journal.bad', '{not json');
    expect(loadJournal('bad')).toEqual([]);
    localStorage.setItem(
      'kriegsspiel.journal.junk',
      JSON.stringify([1, { id: 'x' }, noteEntry('k', 5, 'ok')]),
    );
    expect(loadJournal('junk')).toHaveLength(1);
  });
  it('round-trips through storage', () => {
    saveJournal('g', [noteEntry('1', 5, 'hello')]);
    expect(loadJournal('g')).toEqual([noteEntry('1', 5, 'hello')]);
  });
});

describe('journal persistence', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    localStorage.clear();
    journal.set([]);
    gameState.set(initialState);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    gameState.set(initialState);
    journal.set([]);
  });

  it('keeps orders, dispatches, pauses and notes across a reload', () => {
    stop = persistJournal('g1');
    const clock = { gameMs: 0, localWallMs: 0, rate: 1, status: 'running' as const };
    gameState.set({ ...initialState, clock });
    gameState.update((s) => ({
      ...s,
      pending: [{ orderId: 'o1', text: 'Advance', sentAtGame: 10_000, toName: 'Guards' }],
      dispatches: [disp('d1', 20_000)],
      clock: { ...clock, gameMs: 30_000, status: 'paused' },
    }));
    addNote('Hold the ford', 0);
    stop();

    // A fresh page: the live state is empty, the diary comes back from storage.
    journal.set([]);
    gameState.set(initialState);
    stop = persistJournal('g1');
    const texts = get(journal).map((x) => x.text);
    expect(texts).toContain('Order sent to Guards: Advance');
    expect(texts).toContain('Scout: saw d1');
    expect(texts).toContain('Game paused.');
    expect(texts).toContain('Hold the ford');
  });

  it('drops an order the server rejected', () => {
    stop = persistJournal('g2');
    gameState.update((s) => ({
      ...s,
      pending: [{ orderId: 'o1', text: 'Advance', sentAtGame: 0 }],
    }));
    expect(get(journal)).toHaveLength(1);
    gameState.update((s) => ({ ...s, pending: [] }));
    expect(get(journal)).toHaveLength(0);
  });

  it('ignores blank notes', () => {
    addNote('   ');
    expect(get(journal)).toHaveLength(0);
  });
});

describe('Journal view', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  const q = <T extends Element = HTMLElement>(s: string): T => document.querySelector<T>(s)!;
  beforeEach(() => {
    journal.set([
      e('order:o1', 'order', 0, 'Order sent: Advance'),
      e('dispatch:d1', 'dispatch', 60_000, 'Scout: bridge held'),
    ]);
    activeView.set('journal');
    cmp = mount(Desk, { target: document.body });
    flushSync();
  });
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    activeView.set('table');
    journal.set([]);
  });

  it('searches', () => {
    expect(document.querySelectorAll('#view-journal li')).toHaveLength(2);
    const s = q<HTMLInputElement>('#journal-search');
    s.value = 'bridge';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(document.querySelectorAll('#view-journal li')).toHaveLength(1);
  });

  it('filters by kind', () => {
    const orders = [...document.querySelectorAll<HTMLButtonElement>('.tools button')].find(
      (b) => b.textContent?.trim() === 'Orders',
    )!;
    orders.click();
    flushSync();
    expect(document.querySelectorAll('#view-journal li')).toHaveLength(1);
    expect(q('#view-journal li').dataset.kind).toBe('order');
    orders.click();
    flushSync();
    expect(document.querySelectorAll('#view-journal li')).toHaveLength(2);
    expect(orders.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a note', () => {
    const ta = q<HTMLTextAreaElement>('#journal-note');
    ta.value = 'Check the ford';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    q<HTMLButtonElement>('#journal-add').click();
    flushSync();
    expect(q('#view-journal').textContent).toContain('Check the ford');
    expect(ta.value).toBe('');
  });

  it('exports as a text download', () => {
    let blob: Blob | undefined;
    URL.createObjectURL = ((b: Blob) => ((blob = b), 'blob:x')) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => undefined;
    const click = HTMLAnchorElement.prototype.click;
    let name = '';
    HTMLAnchorElement.prototype.click = function () {
      name = this.download;
    };
    q<HTMLButtonElement>('#journal-export').click();
    HTMLAnchorElement.prototype.click = click;
    expect(name).toBe('war-diary.txt');
    expect(blob?.type).toContain('text/plain');
  });
});
