import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryLobbyStore, SqliteLobbyStore, type LobbyGame, type LobbyStore } from './store.js';

const game = (id: string, creator: string, createdAtMs: number): LobbyGame => ({
  id,
  scenario: 'hold-the-bridge',
  rate: 4,
  sessionType: 'team_vs_team',
  creator,
  status: 'lobby',
  ready: [],
  createdAtMs,
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const makers: Array<[string, () => LobbyStore]> = [
  ['memory', () => new MemoryLobbyStore()],
  [
    'sqlite',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'lobby-'));
      dirs.push(dir);
      return new SqliteLobbyStore(join(dir, 'db.sqlite'));
    },
  ],
];

describe.each(makers)('%s lobby store', (_name, make) => {
  it('stores games, newest first per creator', () => {
    const s = make();
    s.put(game('a', 'u1', 1));
    s.put(game('b', 'u1', 2));
    s.put(game('c', 'u2', 3));
    expect(s.byCreator('u1').map((g) => g.id)).toEqual(['b', 'a']);
    expect(s.many(['a', 'c', 'missing']).map((g) => g.id)).toEqual(['c', 'a']);
    expect(s.get('missing')).toBeUndefined();
    s.put({ ...game('a', 'u1', 1), status: 'started', ready: ['u2'] });
    expect(s.get('a')).toMatchObject({ status: 'started', ready: ['u2'] });
    s.close();
  });

  it('forgets a deleted account: its unstarted games go, its ready marks go', () => {
    const s = make();
    s.put(game('open', 'u1', 1));
    s.put({ ...game('live', 'u1', 2), status: 'started' });
    s.put({ ...game('other', 'u2', 3), ready: ['u1', 'u3'] });
    s.forgetUser('u1');
    expect(s.get('open')).toBeUndefined();
    expect(s.get('live')).toBeDefined();
    expect(s.get('other')!.ready).toEqual(['u3']);
    s.close();
  });
});
