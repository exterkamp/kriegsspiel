import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../api/app.js';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import { MapLibraryService } from './service.js';
import { hashToken } from '../auth/store.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { LIBRARY_ASSET_BYTES } from './validation.js';
const TYPE = 'application/vnd.kriegsspiel.map+json';
let app: App;
let core: SqliteCreationStore;
let library: MapLibraryService;
let directory: string;
let json: string;
let identity: string;
function user() {
  const owner = core.auth.createGuest(Date.now()).id;
  const token = randomUUID();
  core.auth.putSession(hashToken(token), owner, Date.now() + 86400000);
  return { owner, headers: { cookie: `ks_session=${token}` } };
}
function upload(
  headers: Record<string, string>,
  key = randomUUID(),
  body = json,
  name = 'Saved map',
) {
  return {
    method: 'PUT' as const,
    url: `/map-library/saves/${key}`,
    headers: {
      ...headers,
      'content-type': TYPE,
      'x-map-name': encodeURIComponent(name),
      'x-map-identity': identity,
    },
    payload: body,
  };
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ks-library-api-'));
  core = new SqliteCreationStore(join(directory, 'state.sqlite'));
  library = await MapLibraryService.open(core, new URL('../../../data/maps/', import.meta.url));
  app = await buildApp({
    parser: new StubOrderParser(),
    creations: core,
    mapLibrary: library,
    limits: { sweepEveryMs: 0 },
  });
  const u = user();
  const first = library.list(u.owner, 'included').items[0]!;
  const read = await app.server.inject({
    url: `/map-library/maps/included/${first.ref.id}`,
    headers: u.headers,
  });
  expect(read.statusCode).toBe(200);
  json = read.body;
  identity = first.assetIdentity;
}, 60000);
afterAll(async () => {
  if (app) await app.server.close();
  core?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('owned map library HTTP', { timeout: 30000 }, () => {
  it('advertises only initialized durable storage and uses public metadata', async () => {
    const catalog = (await app.server.inject('/scenarios')).json();
    expect(catalog.mapLibrary).toEqual({ schemaVersion: 1, available: true });
    expect(JSON.stringify(catalog)).not.toMatch(/canonicalJson|original_owner/);
    const plain = await buildApp({ parser: new StubOrderParser(), limits: { sweepEveryMs: 0 } });
    try {
      expect((await plain.server.inject('/scenarios')).json().mapLibrary).toBeUndefined();
      expect((await plain.server.inject('/map-library/maps?source=owned')).statusCode).toBe(404);
    } finally {
      await plain.server.close();
    }
  });
  it('authenticates and rejects busy ingress before buffering or validation', async () => {
    const u = user();
    const lease = library.admission.acquire(u.owner);
    const save = vi.spyOn(library, 'save');
    try {
      expect((await app.server.inject(upload({}, randomUUID(), '{'))).statusCode).toBe(401);
      expect((await app.server.inject(upload(u.headers, randomUUID(), '{'))).statusCode).toBe(429);
      expect(save).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
      await lease.release();
    }
    expect(library.admission.active).toBe(0);
  });
  it('saves one exact immutable operation, reads exact bytes and rejects foreign access', async () => {
    const a = user();
    const b = user();
    const key = randomUUID();
    const saved = await app.server.inject(upload(a.headers, key));
    expect(saved.statusCode).toBe(200);
    const summary = saved.json();
    expect(summary).toMatchObject({
      ref: { kind: 'owned' },
      name: 'Saved map',
      assetIdentity: identity,
      status: 'needs-scenario',
    });
    expect((await app.server.inject(upload(a.headers, key))).json()).toEqual(summary);
    const altered = await app.server.inject(upload(a.headers, key, json, 'Different'));
    expect(altered.statusCode).toBe(409);
    const read = await app.server.inject({
      url: `/map-library/maps/owned/${summary.ref.id}`,
      headers: a.headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).toBe(json);
    expect(read.headers['x-map-identity']).toBe(identity);
    expect(read.headers['x-map-name']).toBe(encodeURIComponent('Saved map'));
    expect(
      (
        await app.server.inject({
          url: `/map-library/maps/owned/${summary.ref.id}`,
          headers: b.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.server.inject({ url: `/map-library/saves/${key}`, headers: b.headers }))
        .statusCode,
    ).toBe(404);
    const page = (
      await app.server.inject({ url: '/map-library/maps?source=owned', headers: a.headers })
    ).json();
    expect(page.items).toEqual([summary]);
    expect(
      (await app.server.inject({ url: `/map-library/saves/${key}`, headers: a.headers })).json(),
    ).toEqual(summary);
  });
  it('rejects noncanonical input, invalid UTF8, identity and metadata without an operation', async () => {
    const u = user();
    for (const options of [
      upload(u.headers, randomUUID(), json + ' '),
      upload(u.headers, randomUUID(), Buffer.from([0xff]) as unknown as string),
      {
        ...upload(u.headers),
        headers: { ...upload(u.headers).headers, 'x-map-identity': 'a'.repeat(64) },
      },
      {
        ...upload(u.headers),
        headers: { ...upload(u.headers).headers, 'x-map-private': 'secret' },
      },
      {
        ...upload(u.headers),
        headers: { ...upload(u.headers).headers, 'content-encoding': 'gzip' },
      },
    ]) {
      const response = await app.server.inject(options);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(library.store.list(u.owner).items).toHaveLength(0);
    expect(library.admission.active).toBe(0);
  });
  it('rejects encoded oversize before parser and keeps ordinary body limits', async () => {
    const u = user();
    const request = upload(u.headers);
    const response = await app.server.inject({
      ...request,
      headers: { ...request.headers, 'content-length': String(LIBRARY_ASSET_BYTES + 1) },
    });
    expect(response.statusCode).toBe(413);
    expect(
      (
        await app.server.inject({
          method: 'POST',
          url: '/games',
          headers: { ...u.headers, 'content-type': 'application/json' },
          payload: ' '.repeat(17 * 1024) + '{}',
        })
      ).statusCode,
    ).toBe(413);
    expect(library.store.list(u.owner).items).toHaveLength(0);
  });
  it('recovers the same accepted map after lost commit acknowledgment', async () => {
    const u = user();
    const key = randomUUID();
    const exec = core.database.exec.bind(core.database);
    let fail = true;
    const spy = vi.spyOn(core.database, 'exec').mockImplementation((sql) => {
      exec(sql);
      if (sql === 'COMMIT' && fail) {
        fail = false;
        throw new Error('lost acknowledgement');
      }
    });
    try {
      const result = await app.server.inject(upload(u.headers, key));
      expect(result.statusCode).toBe(503);
    } finally {
      spy.mockRestore();
    }
    const receipt = await app.server.inject({
      url: `/map-library/saves/${key}`,
      headers: u.headers,
    });
    expect(receipt.statusCode).toBe(200);
    expect((await app.server.inject(upload(u.headers, key))).json()).toEqual(receipt.json());
    expect(library.store.list(u.owner).items).toHaveLength(1);
  });
  it('does not return a private read after account deletion during certification', async () => {
    const u = user();
    const first = library.list(u.owner, 'included').items[0]!;
    const pending = app.server.inject({
      url: `/map-library/maps/included/${first.ref.id}`,
      headers: u.headers,
    });
    const original = library.read.bind(library);
    const spy = vi.spyOn(library, 'read').mockImplementation(async (...args) => {
      const result = await original(...args);
      core.auth.deleteUser(u.owner);
      return result;
    });
    try {
      const response = await pending;
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain('bounds');
    } finally {
      spy.mockRestore();
    }
    expect(library.admission.active).toBe(0);
  });
  it('does not commit a save after logout while certification is pending', async () => {
    const u = user();
    const save = library.save.bind(library);
    const spy = vi.spyOn(library, 'save').mockImplementation(async (...args) => {
      const check = args[7]!;
      let checks = 0;
      args[7] = () => {
        if (++checks === 2)
          core.auth.deleteSession(hashToken(u.headers.cookie.slice('ks_session='.length)));
        check();
      };
      return save(...args);
    });
    try {
      const response = await app.server.inject(upload(u.headers));
      expect(response.statusCode).toBe(401);
      expect(library.store.list(u.owner).items).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    expect(library.admission.active).toBe(0);
  });
});
