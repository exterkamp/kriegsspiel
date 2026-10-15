import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteAuthStore } from '../auth/store.js';
import { LibraryStore, LibraryCursors, LIBRARY_QUOTAS, type LibraryQuotas } from './store.js';
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function open(quotas: LibraryQuotas = LIBRARY_QUOTAS) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const auth = new SqliteAuthStore(database, {
    adoptGuest: (from, to) => library.adoptGuest(from, to),
    deleteUser: (id) => library.deleteUser(id),
  });
  const library = new LibraryStore(
    database,
    auth,
    () => 123,
    randomUUID,
    new LibraryCursors(),
    quotas,
  );
  return { database, auth, library };
}
const asset = (canonicalJson = '{"checked":true}') => ({
  canonicalJson,
  identity: 'a'.repeat(64),
  widthM: 5000,
  heightM: 5000,
});
describe('owned unpaired geography SQLite storage', () => {
  it('rejects an explicitly empty cursor rather than silently restarting', () => {
    const { auth, library } = open();
    const owner = auth.createGuest(0).id;
    expect(() => library.list(owner, '')).toThrow('restart_map_list');
  });
  it('saves one immutable operation and verifies exact accepted retry before current quota', () => {
    const { auth, library } = open({ ...LIBRARY_QUOTAS, guestMaps: 1 });
    const owner = auth.createGuest(0).id;
    const key = randomUUID();
    const bytes = asset();
    const saved = library.save(owner, key, 'My map', bytes);
    expect(saved.status).toBe('needs-scenario');
    expect(library.save(owner, key, 'My map', bytes)).toEqual(saved);
    expect(library.accepted(owner, key, 'My map', bytes.canonicalJson, bytes.identity)).toEqual(
      saved,
    );
    expect(() => library.save(owner, randomUUID(), 'Other', bytes)).toThrow('map_library_full');
    expect(() =>
      library.accepted(owner, key, 'Renamed', bytes.canonicalJson, bytes.identity),
    ).toThrow('map_request_conflict');
    expect(() =>
      library.accepted(owner, key, 'My map', bytes.canonicalJson + ' ', bytes.identity),
    ).toThrow('map_request_conflict');
    expect(library.read(owner, saved.ref.id)).toEqual({
      item: saved,
      canonicalJson: bytes.canonicalJson,
    });
  });
  it('counts exact UTF8 canonical bytes and checks the current principal at final commit', () => {
    const { auth, library } = open({ ...LIBRARY_QUOTAS, guestBytes: 4 });
    const owner = auth.createGuest(0).id;
    library.save(owner, randomUUID(), 'One', asset('éé'));
    expect(() => library.save(owner, randomUUID(), 'Two', asset('a'))).toThrow('map_library_full');
    auth.deleteUser(owner);
    expect(() => library.save(owner, randomUUID(), 'late', asset('a'))).toThrow('owner_changed');
  });
  it('paginates every retained adopted map even above normal account save quota', () => {
    const { auth, library } = open();
    const guest = auth.createGuest(0).id;
    const owner = auth.upsertUser('owner@example.test', 0).id;
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++)
      ids.add(library.save(owner, randomUUID(), `Owned ${i}`, asset()).ref.id);
    for (let i = 0; i < 20; i++)
      ids.add(library.save(guest, randomUUID(), `Guest ${i}`, asset()).ref.id);
    auth.adoptGuest(guest, owner);
    expect(() => library.save(owner, randomUUID(), 'Over quota', asset())).toThrow(
      'map_library_full',
    );
    const found: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = library.list(owner, cursor);
      expect(page.items.length).toBeLessThanOrEqual(20);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(32768);
      found.push(...page.items.map((item) => item.ref.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 8);
    expect(pages).toBe(6);
    expect(new Set(found)).toEqual(ids);
    expect(found).toHaveLength(120);
  });
  it('binds cursors to owner/source/epoch and rejects tampering without silently restarting', () => {
    const { auth, library, database } = open();
    const owner = auth.upsertUser('pages@example.test', 0).id;
    const other = auth.createGuest(0).id;
    for (let i = 0; i < 21; i++) library.save(owner, randomUUID(), `Map ${i}`, asset());
    const token = library.list(owner).nextCursor!;
    expect(token.length).toBeLessThanOrEqual(512);
    expect(() => library.list(other, token)).toThrow('restart_map_list');
    expect(() => library.cursors.decode(owner, 'included', token)).toThrow('restart_map_list');
    expect(() =>
      library.list(owner, token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')),
    ).toThrow('restart_map_list');
    const restarted = new LibraryStore(database, auth);
    expect(() => restarted.list(owner, token)).toThrow('restart_map_list');
    expect(restarted.list(owner).items).toHaveLength(20);
  });
  it('preserves both adopted operation-key collisions and reveals neither to another owner', () => {
    const { auth, library } = open();
    const guest = auth.createGuest(0).id;
    const owner = auth.upsertUser('collision@example.test', 0).id;
    const other = auth.createGuest(0).id;
    const key = randomUUID();
    const first = library.save(guest, key, 'Guest', asset());
    const second = library.save(owner, key, 'Owner', asset());
    auth.adoptGuest(guest, owner);
    expect(() => library.operation(owner, key)).toThrow('map_request_ambiguous');
    expect(library.list(owner).items).toHaveLength(2);
    expect(library.operation(other, key)).toBeUndefined();
    expect(library.read(other, first.ref.id)).toBeUndefined();
    expect(library.read(owner, second.ref.id)).toBeDefined();
  });
  it('deletes private bytes and metadata atomically while retaining inaccessible tombstones', () => {
    const { auth, library, database } = open();
    const guest = auth.createGuest(0).id;
    const key = randomUUID();
    const saved = library.save(guest, key, 'Private name', asset());
    auth.deleteUser(guest);
    expect(library.operation(guest, key)).toBeUndefined();
    expect(library.read(guest, saved.ref.id)).toBeUndefined();
    expect(database.prepare('SELECT COUNT(*) AS n FROM library_assets').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT state,name,identity FROM library_operations').get()).toEqual({
      state: 'tombstone',
      name: null,
      identity: null,
    });
  });
  it('rolls back users, seats and all library ownership if adoption fails', () => {
    const { auth, library, database } = open();
    const guest = auth.createGuest(0).id;
    const target = auth.upsertUser('rollback@example.test', 0).id;
    const key = randomUUID();
    const saved = library.save(guest, key, 'Kept', asset());
    auth.claimSeat('game', 'blue', guest);
    database.exec(
      "CREATE TRIGGER fail_library_owner BEFORE UPDATE OF owner ON library_operations BEGIN SELECT RAISE(ABORT,'ownership unavailable'); END;",
    );
    expect(() => auth.adoptGuest(guest, target)).toThrow('ownership unavailable');
    expect(auth.getUser(guest)).toBeDefined();
    expect(auth.seatOf('game', guest)).toBe('blue');
    expect(library.operation(guest, key)).toEqual(saved);
    expect(library.list(target).items).toHaveLength(0);
  });
  it('retains one accepted operation after a lost commit acknowledgement', () => {
    const { auth, library, database } = open();
    const owner = auth.createGuest(0).id;
    const key = randomUUID();
    const exec = database.exec.bind(database);
    let fail = true;
    const spy = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      exec(sql);
      if (sql === 'COMMIT' && fail) {
        fail = false;
        throw new Error('ack lost');
      }
    });
    expect(() => library.save(owner, key, 'Same', asset())).toThrow('ack lost');
    spy.mockRestore();
    const found = library.operation(owner, key)!;
    expect(library.save(owner, key, 'Same', asset())).toEqual(found);
    expect(library.list(owner).items).toHaveLength(1);
  });
  it('rejects authoritative reads after failed commit and rollback', () => {
    const { auth, library, database } = open();
    const owner = auth.createGuest(0).id;
    const key = randomUUID();
    const exec = database.exec.bind(database);
    const spy = vi.spyOn(database, 'exec').mockImplementation((sql) => {
      if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error('storage down');
      exec(sql);
    });
    try {
      expect(() => library.save(owner, key, 'Tentative', asset())).toThrow(AggregateError);
      expect(database.isTransaction).toBe(true);
      expect(() => library.operation(owner, key)).toThrow('map_library_recovery_required');
      expect(() => library.list(owner)).toThrow('map_library_recovery_required');
      expect(() =>
        library.accepted(owner, key, 'Tentative', asset().canonicalJson, asset().identity),
      ).toThrow('map_library_recovery_required');
    } finally {
      spy.mockRestore();
      exec('ROLLBACK');
    }
  });
});
