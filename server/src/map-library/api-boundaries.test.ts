import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import { MapLibraryService } from './service.js';
import { hashToken } from '../auth/store.js';
let core: SqliteCreationStore;
let library: MapLibraryService;
let app: App;
let folder: string;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function user() {
  const owner = core.auth.createGuest(Date.now()).id;
  const token = randomUUID();
  core.auth.putSession(hashToken(token), owner, Date.now() + 60000);
  return { owner, cookie: `ks_session=${token}` };
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'ks-map-boundaries-'));
  core = new SqliteCreationStore(join(folder, 'state.sqlite'));
  library = await MapLibraryService.open(core, new URL('../../../data/maps/', import.meta.url));
  app = await buildApp({
    parser: new StubOrderParser(),
    creations: core,
    mapLibrary: library,
    limits: { sweepEveryMs: 0 },
  });
}, 60000);
afterAll(async () => {
  await app?.server.close();
  core?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
describe('exact raw bytes and departed response lifetimes', () => {
  it('rejects an actual BOM-prefixed valid canonical upload with no accepted operation', async () => {
    const u = user();
    const item = library.list(u.owner, 'included').items[0]!;
    const json = await readFile(new URL(`../../../data/maps/${item.ref.id}.json`, import.meta.url));
    const key = randomUUID();
    const result = await app.server.inject({
      method: 'PUT',
      url: `/map-library/saves/${key}`,
      headers: {
        cookie: u.cookie,
        'content-type': 'application/vnd.kriegsspiel.map+json',
        'x-map-name': 'Exact',
        'x-map-identity': item.assetIdentity,
      },
      payload: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]),
    });
    expect(result.statusCode).toBe(400);
    expect(library.store.operation(u.owner, key)).toBeUndefined();
    expect(library.store.list(u.owner).items).toEqual([]);
  }, 30000);
  for (const method of ['GET', 'PUT'] as const)
    it(`cancels a completed ${method} whose response closes, awaiting tracked exit exactly once`, async () => {
      const u = user();
      const entered = deferred();
      const exit = deferred();
      const unblock = deferred();
      let signal: AbortSignal | undefined;
      let cleanupLease: (() => Promise<void>) | undefined;
      const spy =
        method === 'GET'
          ? vi
              .spyOn(library, 'read')
              .mockImplementation(async (_owner, _kind, _id, lease, abort) => {
                signal = abort;
                cleanupLease = () => lease.release();
                lease.track(exit.promise);
                entered.resolve();
                await unblock.promise;
                return undefined;
              })
          : vi
              .spyOn(library, 'save')
              .mockImplementation(async (_owner, _key, _name, _json, _identity, lease, abort) => {
                signal = abort;
                cleanupLease = () => lease.release();
                lease.track(exit.promise);
                entered.resolve();
                await unblock.promise;
                throw new Error('Retired save');
              });
      if (!app.server.server.listening) await app.server.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.server.address();
      if (!address || typeof address === 'string') throw new Error('No test listener');
      const url =
        method === 'GET'
          ? `/map-library/maps/owned/${randomUUID()}`
          : `/map-library/saves/${randomUUID()}`;
      const req = request(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: {
          cookie: u.cookie,
          ...(method === 'PUT'
            ? {
                'content-type': 'application/vnd.kriegsspiel.map+json',
                'x-map-name': 'Pending',
                'x-map-identity': 'a'.repeat(64),
              }
            : {}),
        },
      });
      req.on('error', () => {});
      req.end(method === 'PUT' ? '{}' : undefined);
      try {
        await entered.promise;
        expect(signal?.aborted).toBe(false);
        expect(library.admission.active).toBe(1);
        req.destroy();
        await expect.poll(() => signal?.aborted, { timeout: 1000 }).toBe(true);
        expect(library.admission.active).toBe(1);
        exit.resolve();
        await expect.poll(() => library.admission.active, { timeout: 1000 }).toBe(0);
        expect(library.store.list(u.owner).items).toEqual([]);
      } finally {
        req.destroy();
        exit.resolve();
        unblock.resolve();
        await cleanupLease?.();
        spy.mockRestore();
      }
    }, 10000);
});
