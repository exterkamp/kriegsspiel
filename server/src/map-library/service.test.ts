import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import { MapLibraryService } from './service.js';
import { LibraryStore } from './store.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ks-library-service-'));
  const path = join(dir, 'owned.sqlite');
  const core = new SqliteCreationStore(path);
  cleanups.push(async () => {
    core.close();
    await rm(dir, { recursive: true, force: true });
  });
  const service = await MapLibraryService.open(
    core,
    new URL('../../../data/maps/', import.meta.url),
  );
  return { core, service, path };
}
describe('durable map library composition', { timeout: 60000 }, () => {
  it('requires durable storage and certifies included maps before startup', async () => {
    const core = new SqliteCreationStore(':memory:');
    await expect(
      MapLibraryService.open(core, new URL('../../../data/maps/', import.meta.url)),
    ).rejects.toThrow('durable');
    core.close();
    const { core: durable, service } = await setup();
    expect(service.list(durable.auth.createGuest(0).id, 'included').items).toHaveLength(3);
  });
  it('retains exact identity across reopen, adoption and deletion', async () => {
    const { core, service, path } = await setup();
    const guest = core.auth.createGuest(0).id;
    const target = core.auth.upsertUser('owner@example.test', 0).id;
    const lease = service.admission.acquire(guest);
    const key = randomUUID();
    const included = service.list(guest, 'included').items[0]!;
    let json = '';
    let saved;
    try {
      const read = await service.read(
        guest,
        'included',
        included.ref.id,
        lease,
        new AbortController().signal,
      );
      json = read!.canonicalJson;
      saved = await service.save(
        guest,
        key,
        'My map',
        json,
        included.assetIdentity,
        lease,
        new AbortController().signal,
      );
    } finally {
      await lease.release();
    }
    core.auth.adoptGuest(guest, target);
    expect(core.auth.getUser(guest)).toBeUndefined();
    expect(service.store.read(target, saved.ref.id)?.canonicalJson).toBe(json);
    const reopened = new SqliteCreationStore(path);
    try {
      const library = new LibraryStore(reopened.database, reopened.auth);
      reopened.registerOwnershipParticipant(library);
      expect(library.operation(target, key)).toEqual(saved);
      expect(library.read(target, saved.ref.id)?.canonicalJson).toBe(json);
      reopened.auth.deleteUser(target);
      expect(library.read(target, saved.ref.id)).toBeUndefined();
      expect(reopened.database.prepare('SELECT COUNT(*) AS n FROM library_assets').get()).toEqual({
        n: 0,
      });
    } finally {
      reopened.close();
    }
  });
  it('rolls back auth, seats, lobby and library when a participant fails', async () => {
    const { core, service } = await setup();
    const guest = core.auth.createGuest(0).id;
    const target = core.auth.upsertUser('rollback@example.test', 0).id;
    const saved = service.store.save(guest, randomUUID(), 'Owned', {
      canonicalJson: '{}',
      identity: 'a'.repeat(64),
      widthM: 5000,
      heightM: 5000,
    });
    core.auth.claimSeat('waiting', 'blue', guest);
    core.lobby.put({
      id: 'waiting',
      scenario: 'bridge',
      rate: 1,
      sessionType: 'team_vs_team',
      creator: guest,
      status: 'lobby',
      ready: [],
      createdAtMs: 0,
    });
    core.registerOwnershipParticipant({
      adoptGuest() {
        throw new Error('participant down');
      },
    });
    expect(() => core.auth.adoptGuest(guest, target)).toThrow('participant down');
    expect(core.auth.getUser(guest)).toBeDefined();
    expect(core.auth.seatOf('waiting', guest)).toBe('blue');
    expect(core.lobby.get('waiting')?.creator).toBe(guest);
    expect(service.store.read(guest, saved.ref.id)).toBeDefined();
    expect(service.store.list(target).items).toEqual([]);
  });
  it('rejects deleted owner after certification without writing an asset', async () => {
    const { core, service } = await setup();
    const guest = core.auth.createGuest(0).id;
    const lease = service.admission.acquire(guest);
    try {
      const item = service.list(guest, 'included').items[0]!;
      const record = await service.read(
        guest,
        'included',
        item.ref.id,
        lease,
        new AbortController().signal,
      );
      const pending = service.save(
        guest,
        randomUUID(),
        'Late',
        record!.canonicalJson,
        item.assetIdentity,
        lease,
        new AbortController().signal,
      );
      core.auth.deleteUser(guest);
      await expect(pending).rejects.toThrow('owner_changed');
      expect(core.database.prepare('SELECT COUNT(*) AS n FROM library_assets').get()).toEqual({
        n: 0,
      });
    } finally {
      await lease.release();
    }
  });
  it('rejects duplicate and transaction-time participant registration', async () => {
    const { core } = await setup();
    const participant = {};
    core.registerOwnershipParticipant(participant);
    expect(() => core.registerOwnershipParticipant(participant)).toThrow('already registered');
    core.database.exec('BEGIN');
    try {
      expect(() => core.registerOwnershipParticipant({})).toThrow('recovery');
    } finally {
      core.database.exec('ROLLBACK');
    }
  });
});
