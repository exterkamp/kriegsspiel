import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteGameStore } from '../game/index.js';
import { backupDb, restoreDb } from './backup.js';

describe('backup and restore', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'ks-backup-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('restores the games present when the backup was taken', async () => {
    const dbPath = join(dir, 'data', 'games.db');
    const live = new SqliteGameStore(dbPath);
    await live.saveLogHeader({ gameId: 'g1', scenarioId: 's', seed: 7 });
    const backup = backupDb(dbPath, join(dir, 'backups'));

    await live.saveLogHeader({ gameId: 'g2', scenarioId: 's', seed: 8 });
    live.close();
    restoreDb(backup, dbPath);

    const restored = new SqliteGameStore(dbPath);
    expect(await restored.logHeader('g1')).toEqual({ gameId: 'g1', scenarioId: 's', seed: 7 });
    expect(await restored.logHeader('g2')).toBeUndefined();
    restored.close();
  });

  it('keeps only the newest backups', () => {
    const dbPath = join(dir, 'games.db');
    new SqliteGameStore(dbPath).close();
    for (let i = 0; i < 4; i++)
      backupDb(dbPath, join(dir, 'b'), 2, new Date(Date.UTC(2026, 0, 1 + i)));
    expect(readdirSync(join(dir, 'b'))).toEqual([
      'kriegsspiel-20260103T000000Z.db',
      'kriegsspiel-20260104T000000Z.db',
    ]);
  });

  it('refuses to restore from a missing backup', () => {
    expect(() => restoreDb(join(dir, 'missing.db'), join(dir, 'x.db'))).toThrow();
  });
});
