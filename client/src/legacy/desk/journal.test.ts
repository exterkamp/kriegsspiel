// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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

const e = (id: string, kind: JournalEntry['kind'], at: number, text: string): JournalEntry => ({
  id,
  kind,
  at,
  text,
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
