import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { NativeBattlefieldRegistry } from './native-battlefield-registry.js';
import { snapshotBinding, assertSnapshotHeader } from './snapshot-binding.js';
import { SqliteGameStore } from './sqlite.js';
import type { GameSnapshot, InputLogHeader } from './store.js';
const pin = new NativeBattlefieldRegistry().resolve('hold-the-bridge');
const header: InputLogHeader = {
  gameId: 'bound',
  scenarioId: pin.initialWorld.scenarioId,
  seed: pin.initialWorld.seed,
  battlefieldFormat: 1,
  battlefieldPin: pin,
};
const snapshot: GameSnapshot = {
  seq: 0,
  engine: '{}',
  clock: { gameMsAtAnchor: 0, wallMsAtAnchor: 0, rate: 1, status: 'paused', mode: 'manual' },
  battlefield: snapshotBinding(header),
};
describe('native snapshot binding storage', () => {
  it('binds full header settings and allocation, preserving explicit historical absence', () => {
    expect(() => assertSnapshotHeader(snapshot, header, 'bound')).not.toThrow();
    expect(() => assertSnapshotHeader(snapshot, undefined, 'bound')).toThrow();
    expect(() =>
      assertSnapshotHeader(
        snapshot,
        { ...header, settings: { dial: 'free', persona: 'dry' } },
        'bound',
      ),
    ).toThrow();
    expect(() =>
      assertSnapshotHeader({ ...snapshot, battlefield: undefined }, header, 'bound'),
    ).toThrow();
    const old = { seq: 0, engine: '{}', clock: snapshot.clock };
    expect(() =>
      assertSnapshotHeader(
        old,
        { gameId: 'bound', scenarioId: 'hold-the-bridge', seed: 1815 },
        'bound',
      ),
    ).not.toThrow();
    expect(() => assertSnapshotHeader(old, header, 'bound')).toThrow();
  });
  it('retains the marker over durable reopen and rejects corrupt or oversized marker columns', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ks-snapshot-binding-'));
    const path = join(folder, 'game.sqlite');
    let store = new SqliteGameStore(path);
    try {
      await store.saveLogHeader(header);
      await store.saveSnapshot('bound', snapshot);
      store.close();
      store = new SqliteGameStore(path);
      expect(await store.loadSnapshot('bound')).toEqual(snapshot);
      const database = new DatabaseSync(path);
      try {
        for (const value of [
          '',
          '{}',
          'null',
          JSON.stringify({ ...snapshot.battlefield, format: 2 }),
          'x'.repeat(1025),
        ]) {
          database
            .prepare('UPDATE snapshots SET battlefield = ? WHERE game_id = ?')
            .run(value, 'bound');
          await expect(store.loadSnapshot('bound')).rejects.toThrow();
        }
      } finally {
        database.close();
      }
    } finally {
      store.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
