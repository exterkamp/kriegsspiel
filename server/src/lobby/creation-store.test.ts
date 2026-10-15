import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBattlefieldRegistry } from '../game/native-battlefield-registry.js';
import { SqliteCreationStore, type PinnedCreationLobby } from './creation-store.js';
const registry = new NativeBattlefieldRegistry();
const stores: SqliteCreationStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      /* Explicitly closed by restart tests. */
    }
  }
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const open = (path = ':memory:') => {
  const value = new SqliteCreationStore(path, () => 123);
  stores.push(value);
  return value;
};
const plan = () => ({
  defaultPin: registry.resolve('hold-the-bridge'),
  selectedPin: registry.resolve('hold-the-bridge'),
  aiAvailable: true,
});
const counts = (store: SqliteCreationStore) =>
  ['creation_receipts', 'lobby_games', 'auth_seats'].map((table) =>
    Number((store.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n),
  );

describe('receipt/seat/lobby SQLite unit of work', () => {
  it('reserves one exact private pin, seat and lobby without activating a game actor', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const receipt = store.reserve(owner, { requestId: randomUUID() }, plan);
    expect(receipt.state).toBe('reserved');
    expect(receipt.createdAtMs).toBe(123);
    expect(store.auth.seatOf(receipt.gameId, owner)).toBe('blue');
    const record = store.lobby.get(receipt.gameId) as PinnedCreationLobby;
    expect(record).toMatchObject({ status: 'lobby', creationFormat: 1, creator: owner });
    expect(record.battlefieldPin).toEqual(receipt.pin);
    expect(record.creationReceiptId).toBe(receipt.receiptId);
    expect(counts(store)).toEqual([1, 1, 1]);
    expect(store.durable).toBe(false);
  });

  it('returns one game across identical retries before latest catalog/default/limit callbacks', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const request = { requestId: randomUUID() };
    const original = store.reserve(owner, request, plan);
    const unavailable = vi.fn(() => {
      throw new Error('latest catalog unavailable');
    });
    const limit = vi.fn(() => {
      throw new Error('too_many_games');
    });
    const retry = store.reserve(owner, request, unavailable, limit);
    expect(retry).toEqual(original);
    expect(unavailable).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expect(counts(store)).toEqual([1, 1, 1]);
    retry.pin.initialWorld.units[0]!.morale = 0;
    expect(store.lookup(owner, request.requestId)!.pin.initialWorld.units[0]!.morale).toBe(80);
  });

  it('rejects a changed intent while owner-scoping another account with the same UUID', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const other = store.auth.createGuest(0).id;
    const requestId = randomUUID();
    const original = store.reserve(owner, { requestId }, plan);
    expect(() => store.reserve(owner, { requestId, rate: 4 }, plan)).toThrow('request_conflict');
    expect(store.lookup(other, requestId)).toBeUndefined();
    const independent = store.reserve(other, { requestId }, plan);
    expect(independent.gameId).not.toBe(original.gameId);
    expect(store.lookup(owner, requestId)!.gameId).toBe(original.gameId);
    expect(counts(store)).toEqual([2, 2, 2]);
  });

  it('rolls all reservation effects back if receipt persistence fails after seat/lobby writes', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const requestId = randomUUID();
    store.database.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON creation_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;",
    );
    expect(() => store.reserve(owner, { requestId }, plan)).toThrow(/injected receipt failure/);
    expect(counts(store)).toEqual([0, 0, 0]);
    expect(store.auth.getUser(owner)).toBeDefined();
    expect(store.database.isTransaction).toBe(false);
    store.database.exec('DROP TRIGGER fail_receipt');
    expect(store.reserve(owner, { requestId }, plan).state).toBe('reserved');
    expect(counts(store)).toEqual([1, 1, 1]);
  });

  it('does not leave receipts, seats or records after validation/limit rejection', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    expect(() => store.reserve(owner, { requestId: randomUUID(), side: 'red' }, plan)).toThrow(
      'bad_side',
    );
    expect(() =>
      store.reserve(owner, { requestId: randomUUID() }, plan, () => {
        throw new Error('too_many_games');
      }),
    ).toThrow('too_many_games');
    expect(() => store.reserve('missing-user', { requestId: randomUUID() }, plan)).toThrow(
      'not_signed_in',
    );
    expect(counts(store)).toEqual([0, 0, 0]);
  });

  it('retains lobby creation and hot-seat semantics without a seat or automatic start', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const receipt = store.reserve(
      owner,
      { requestId: randomUUID(), lobby: true, sessionType: 'hot_seat', side: 'red' },
      plan,
    );
    expect(receipt.state).toBe('lobby');
    expect(receipt.intent.side).toBe('blue');
    expect(store.auth.seatsOf(receipt.gameId)).toEqual([]);
    expect(counts(store)).toEqual([1, 1, 0]);
  });

  it('rejects UUID allocation collisions before overwriting an unrelated room', () => {
    const receiptId = randomUUID();
    const gameId = randomUUID();
    const sequence = [receiptId, gameId];
    const store = new SqliteCreationStore(
      ':memory:',
      () => 123,
      () => sequence.shift()!,
    );
    stores.push(store);
    const owner = store.auth.createGuest(0).id;
    const previous = {
      id: gameId,
      scenario: 'unrelated',
      rate: 12,
      sessionType: 'hot_seat' as const,
      creator: owner,
      status: 'lobby' as const,
      ready: [],
      createdAtMs: 0,
    };
    store.lobby.put(previous);
    expect(() =>
      store.reserve(owner, { requestId: randomUUID(), sessionType: 'hot_seat' }, plan),
    ).toThrow('game_id_conflict');
    expect(store.lobby.get(gameId)).toEqual(previous);
    expect(counts(store)).toEqual([0, 1, 0]);
  });

  it('reconciles a committed receipt even when the commit acknowledgement throws', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const requestId = randomUUID();
    const exec = store.database.exec.bind(store.database);
    const spy = vi.spyOn(store.database, 'exec').mockImplementation((sql) => {
      exec(sql);
      if (sql === 'COMMIT') throw new Error('commit acknowledgement lost');
    });
    expect(() => store.reserve(owner, { requestId }, plan)).toThrow('commit acknowledgement lost');
    spy.mockRestore();
    expect(store.database.isTransaction).toBe(false);
    expect(counts(store)).toEqual([1, 1, 1]);
    const accepted = store.lookup(owner, requestId)!;
    expect(
      store.reserve(owner, { requestId }, () => {
        throw new Error('must not resolve again');
      }).gameId,
    ).toBe(accepted.gameId);
    expect(counts(store)).toEqual([1, 1, 1]);
  });

  it('fails closed on corrupt receipt data without reallocating the request', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const requestId = randomUUID();
    const receipt = store.reserve(owner, { requestId }, plan);
    store.database
      .prepare('UPDATE creation_receipts SET body = ? WHERE receipt_id = ?')
      .run('{}', receipt.receiptId);
    const changed = vi.fn(plan);
    expect(() => store.reserve(owner, { requestId }, changed)).toThrow('corrupt_creation_receipt');
    expect(changed).not.toHaveBeenCalled();
    expect(counts(store)).toEqual([1, 1, 1]);
  });

  it('preserves exact identity and retry behavior across process-style close/reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ks-creation-receipt-'));
    directories.push(dir);
    const path = join(dir, 'game.sqlite');
    const first = open(path);
    const owner = first.auth.createGuest(0).id;
    const requestId = randomUUID();
    const receipt = first.reserve(owner, { requestId, mode: 'turns', turnMinutes: 30 }, plan);
    first.close();
    const second = open(path);
    expect(second.durable).toBe(true);
    expect(second.lookup(owner, requestId)).toEqual(receipt);
    expect(
      second.reserve(owner, { requestId, mode: 'turns', turnMinutes: 30 }, () => {
        throw new Error('catalog removed');
      }),
    ).toEqual(receipt);
    expect(counts(second)).toEqual([1, 1, 1]);
  });

  it('supports another connection seeing one accepted request and preserves borrowed ownership', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ks-creation-shared-'));
    directories.push(dir);
    const path = join(dir, 'game.sqlite');
    const first = open(path);
    const owner = first.auth.createGuest(0).id;
    const requestId = randomUUID();
    const receipt = first.reserve(owner, { requestId }, plan);
    const database = new DatabaseSync(path);
    const borrowed = new SqliteCreationStore(database);
    try {
      expect(
        borrowed.reserve(owner, { requestId }, () => {
          throw new Error('already accepted');
        }).gameId,
      ).toBe(receipt.gameId);
      borrowed.close();
      expect(database.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    } finally {
      database.close();
    }
  });
});

describe('atomic receipt ownership and activation', () => {
  it('adopts guest receipts, seats and lobby ownership together without changing accepted allocation', () => {
    const store = open();
    const guest = store.auth.createGuest(0).id;
    const target = store.auth.upsertUser('owner@example.test', 1).id;
    const key = randomUUID();
    const receipt = store.reserve(guest, { requestId: key }, plan);
    expect(store.auth.adoptGuest(guest, target)).toContain(receipt.gameId);
    expect(store.auth.getUser(guest)).toBeUndefined();
    expect(store.auth.seatOf(receipt.gameId, target)).toBe('blue');
    expect(store.lobby.get(receipt.gameId)!.creator).toBe(target);
    const adopted = store.lookup(target, key)!;
    expect(adopted).toEqual({ ...receipt, ownerId: target });
    expect(store.lookup(guest, key)).toBeUndefined();
    expect(
      store.reserve(target, { requestId: key }, () => {
        throw new Error('must use retained intent');
      }),
    ).toEqual(adopted);
  });
  it('preserves both allocations on target request-key collision and returns only owned game IDs', () => {
    const store = open();
    const guest = store.auth.createGuest(0).id;
    const target = store.auth.upsertUser('collision@example.test', 1).id;
    const key = randomUUID();
    const first = store.reserve(guest, { requestId: key }, plan);
    const second = store.reserve(target, { requestId: key }, plan);
    store.auth.adoptGuest(guest, target);
    try {
      store.lookup(target, key);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'request_ambiguous',
        gameIds: expect.arrayContaining([first.gameId, second.gameId]),
      });
    }
    expect(() => store.reserve(target, { requestId: key }, plan)).toThrow('request_ambiguous');
    expect(counts(store)).toEqual([2, 2, 2]);
    const stranger = store.auth.createGuest(0).id;
    expect(store.lookup(stranger, key)).toBeUndefined();
  });
  it('rolls back guest seats, user, lobby and receipts if an adoption participant fails', () => {
    const store = open();
    const guest = store.auth.createGuest(0).id;
    const target = store.auth.upsertUser('rollback@example.test', 1).id;
    const key = randomUUID();
    const receipt = store.reserve(guest, { requestId: key }, plan);
    store.database.exec(
      "CREATE TRIGGER fail_transfer BEFORE UPDATE OF owner_id ON creation_receipts BEGIN SELECT RAISE(ABORT, 'transfer failed'); END;",
    );
    expect(() => store.auth.adoptGuest(guest, target)).toThrow('transfer failed');
    expect(store.auth.getUser(guest)?.guest).toBe(true);
    expect(store.auth.seatOf(receipt.gameId, guest)).toBe('blue');
    expect(store.auth.seatOf(receipt.gameId, target)).toBeUndefined();
    expect(store.lobby.get(receipt.gameId)!.creator).toBe(guest);
    expect(store.lookup(guest, key)).toEqual(receipt);
    expect(store.database.isTransaction).toBe(false);
  });
  it('tombstones removed account receipts atomically and prevents readable ownership', () => {
    const store = open();
    const guest = store.auth.createGuest(0).id;
    const key = randomUUID();
    const receipt = store.reserve(guest, { requestId: key }, plan);
    store.auth.deleteUser(guest);
    expect(store.lookup(guest, key)).toBeUndefined();
    expect(store.lobby.get(receipt.gameId)).toBeUndefined();
    expect(store.forGame(receipt.gameId)).toMatchObject({
      state: 'tombstone',
      ownerId: `removed:${receipt.receiptId}`,
    });
    expect(() => store.activationResult(receipt.gameId, true)).toThrow('request_removed');
    expect(counts(store)).toEqual([1, 0, 0]);
  });
  it('keeps a recoverable receipt after activation error and commits started state with the lobby', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const key = randomUUID();
    const receipt = store.reserve(owner, { requestId: key }, plan);
    expect(store.activationResult(receipt.gameId, false)).toMatchObject({
      state: 'reserved',
      activationError: 'activation_failed',
    });
    const started = store.activationResult(receipt.gameId, true);
    expect(started.state).toBe('started');
    expect(started).not.toHaveProperty('activationError');
    expect(store.lobby.get(receipt.gameId)!.status).toBe('started');
    expect(store.activationResult(receipt.gameId, false)).toEqual(started);
    expect(store.reserve(owner, { requestId: key }, plan).gameId).toBe(receipt.gameId);
  });
  it('rolls account deletion and all participant changes back on a failed tombstone', () => {
    const store = open();
    const guest = store.auth.createGuest(0).id;
    const key = randomUUID();
    const receipt = store.reserve(guest, { requestId: key }, plan);
    store.database.exec(
      "CREATE TRIGGER fail_tombstone BEFORE UPDATE OF state ON creation_receipts BEGIN SELECT RAISE(ABORT, 'delete failed'); END;",
    );
    expect(() => store.auth.deleteUser(guest)).toThrow('delete failed');
    expect(store.auth.getUser(guest)).toBeDefined();
    expect(store.lookup(guest, key)).toEqual(receipt);
    expect(store.lobby.get(receipt.gameId)).toBeDefined();
    expect(store.auth.seatOf(receipt.gameId, guest)).toBe('blue');
  });
});

describe('poisoned allocation recovery', () => {
  it('never serves tentative receipt identity after both commit and rollback fail', () => {
    const store = open();
    const owner = store.auth.createGuest(0).id;
    const key = randomUUID();
    const exec = store.database.exec.bind(store.database);
    const fault = vi.spyOn(store.database, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT') throw new Error('commit failed before execution');
      if (sql === 'ROLLBACK') throw new Error('rollback failed before execution');
      return exec(sql);
    });
    try {
      expect(() => store.reserve(owner, { requestId: key }, plan)).toThrow(AggregateError);
      expect(store.database.isTransaction).toBe(true);
      const allocated = store.lobby.byCreator(owner)[0]!.id;
      expect(() => store.forGame(allocated)).toThrow('creation_recovery_required');
      expect(() => store.lookup(owner, key)).toThrow('creation_recovery_required');
      expect(() => store.reserve(owner, { requestId: key }, plan)).toThrow(
        'creation_recovery_required',
      );
      expect(() => store.activationResult(allocated, true)).toThrow('creation_recovery_required');
    } finally {
      fault.mockRestore();
      exec('ROLLBACK');
    }
  });
});
