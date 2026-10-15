import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteAuthStore } from '../auth/store.js';
import { SqliteLobbyStore, type LobbyGame } from './store.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const record = (creator: string): LobbyGame => ({
  id: 'g',
  scenario: 'hold-the-bridge',
  rate: 1,
  sessionType: 'team_vs_team',
  creator,
  status: 'lobby',
  ready: [],
  createdAtMs: 0,
});

describe('borrowed SQLite account/lobby transaction boundary', () => {
  it('rolls seat and lobby reservations back together after an allocation failure', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const auth = new SqliteAuthStore(db);
      const lobby = new SqliteLobbyStore(db);
      const user = auth.createGuest(0);
      db.exec('BEGIN IMMEDIATE');
      expect(auth.claimSeat('g', 'blue', user.id)).toBe(true);
      lobby.put(record(user.id));
      expect(auth.seatOf('g', user.id)).toBe('blue');
      expect(lobby.get('g')).toBeDefined();
      db.exec('ROLLBACK');
      expect(auth.seatOf('g', user.id)).toBeUndefined();
      expect(lobby.get('g')).toBeUndefined();
      expect(auth.getUser(user.id)).toEqual(user);
    } finally {
      db.close();
    }
  });

  it('commits both stores durably and leaves the borrowed connection with its owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ks-shared-session-db-'));
    dirs.push(dir);
    const path = join(dir, 'game.sqlite');
    const db = new DatabaseSync(path);
    let userId: string;
    try {
      const auth = new SqliteAuthStore(db);
      const lobby = new SqliteLobbyStore(db);
      userId = auth.createGuest(0).id;
      db.exec('BEGIN IMMEDIATE');
      expect(auth.claimSeat('g', 'blue', userId)).toBe(true);
      lobby.put(record(userId));
      db.exec('COMMIT');
      auth.close();
      lobby.close();
      expect(db.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
      expect(db.prepare('SELECT creator FROM lobby_games WHERE id = ?').get('g')).toEqual({
        creator: userId,
      });
    } finally {
      db.close();
    }
    const reopenedAuth = new SqliteAuthStore(path);
    const reopenedLobby = new SqliteLobbyStore(path);
    try {
      expect(reopenedAuth.seatOf('g', userId)).toBe('blue');
      expect(reopenedLobby.get('g')).toEqual(record(userId));
    } finally {
      reopenedAuth.close();
      reopenedLobby.close();
    }
  });

  it('keeps path constructors owning their own connection', () => {
    const auth = new SqliteAuthStore(':memory:');
    const user = auth.createGuest(0);
    auth.close();
    expect(() => auth.getUser(user.id)).toThrow(/closed|not open/i);
    const lobby = new SqliteLobbyStore(':memory:');
    lobby.put(record('owner'));
    lobby.close();
    expect(() => lobby.get('g')).toThrow(/closed|not open/i);
  });
});
