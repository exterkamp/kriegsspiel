// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Dispatch } from '@kriegsspiel/protocol';
import { byTurn, emptyMarks, loadMarks, saveMarks, sortTray } from './tray.js';

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
  it('sorts 200 dispatches newest arrival first without dropping or duplicating any', () => {
    const ds = Array.from({ length: 200 }, (_, i) =>
      disp(`d${i}`, { receivedAtGame: (i * 7919) % 1000 }),
    );
    const t = sortTray(ds, emptyMarks());
    const items = t.piles.flatMap((p) => p.items);
    expect(items).toHaveLength(200);
    expect(new Set(items.map((d) => d.id)).size).toBe(200);
    const times = items.map((d) => d.receivedAtGame);
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(t.unread).toBe(200);
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

describe('papers by turn (#439)', () => {
  const MIN = 60_000;
  const TURN = 20 * MIN;
  const at = (id: string, written: number, received: number, extra: Partial<Dispatch> = {}) =>
    disp(id, { writtenAtGame: written * MIN, receivedAtGame: received * MIN, ...extra });

  it('groups under the turn, newest turn first, each in written order with its summary first', () => {
    const groups = byTurn(
      [
        at('late', 18, 20),
        at('early', 3, 20),
        at('open', 0, 0),
        at('turn-summary-1', 20, 20, { from: 'Chief of staff' }),
        at('t2', 25, 40),
      ],
      TURN,
    );
    expect(groups.map((g) => [g.turn, g.rows.map((r) => r.d.id)])).toEqual([
      [2, ['t2']],
      [1, ['turn-summary-1', 'open', 'early', 'late']],
    ]);
  });

  it('puts an umpire turn’s papers (all handed in at its end) in that turn, the ruling and notice last', () => {
    const groups = byTurn(
      [
        at('a-notice', 20, 20, { kind: 'notice' }),
        at('b-turn', 20, 20, { kind: 'turn' }),
        at('c-battle', 20, 20, { kind: 'battle' }),
        at('turn-summary-1', 20, 20),
      ],
      TURN,
    );
    expect(groups.map((g) => [g.turn, g.rows.map((r) => r.d.id)])).toEqual([
      [1, ['turn-summary-1', 'b-turn', 'a-notice', 'c-battle']],
    ]);
  });

  it('merges repeated sightings into one row that opens on the newest', () => {
    const seen = {
      kind: 'contact' as const,
      sizeEstimate: 'about a battalion',
      place: 'near the bridge',
    };
    const groups = byTurn(
      [
        at('c1', 5, 20, seen),
        at('x', 8, 20),
        at('c2', 12, 20, seen),
        at('c3', 18, 20, seen),
        at('c4', 25, 40, seen),
      ],
      TURN,
    );
    const [two, one] = groups;
    expect(one!.rows.map((r) => [r.d.id, r.papers.map((d) => d.id)])).toEqual([
      ['c3', ['c1', 'c2', 'c3']],
      ['x', ['x']],
    ]);
    // The next turn's sighting of the same battalion is that turn's news.
    expect(two!.rows.map((r) => r.d.id)).toEqual(['c4']);
  });
});
