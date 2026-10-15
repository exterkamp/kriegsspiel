import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../api/app.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { SqliteCreationStore } from '../lobby/creation-store.js';
import { MapLibraryService } from './service.js';
import { hashToken } from '../auth/store.js';
describe('actual bounded map upload wire lifetime', () => {
  it('releases admission after a partial chunked request is disconnected without accepting an operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ks-library-wire-'));
    const core = new SqliteCreationStore(join(dir, 'db.sqlite'));
    const library = await MapLibraryService.open(
      core,
      new URL('../../../data/maps/', import.meta.url),
    );
    const app = await buildApp({
      parser: new StubOrderParser(),
      creations: core,
      mapLibrary: library,
      limits: { sweepEveryMs: 0 },
    });
    const guest = core.auth.createGuest(Date.now()).id;
    const token = randomUUID();
    core.auth.putSession(hashToken(token), guest, Date.now() + 60000);
    const key = randomUUID();
    let upload: ReturnType<typeof request> | undefined;
    try {
      const address = await app.server.listen({ port: 0, host: '127.0.0.1' });
      upload = request(address + `/map-library/saves/${key}`, {
        method: 'PUT',
        headers: {
          cookie: `ks_session=${token}`,
          'content-type': 'application/vnd.kriegsspiel.map+json',
          'x-map-name': 'Wire%20map',
          'x-map-identity': 'a'.repeat(64),
          'transfer-encoding': 'chunked',
        },
      });
      upload.on('error', () => {});
      upload.write('{"unfinished":');
      await expect.poll(() => library.admission.active, { timeout: 2000 }).toBe(1);
      const busy = await app.server.inject({
        method: 'PUT',
        url: `/map-library/saves/${randomUUID()}`,
        headers: {
          cookie: `ks_session=${token}`,
          'content-type': 'application/vnd.kriegsspiel.map+json',
          'x-map-name': 'Other',
          'x-map-identity': 'a'.repeat(64),
        },
        payload: '{}',
      });
      expect(busy.statusCode).toBe(429);
      upload.destroy();
      await expect.poll(() => library.admission.active, { timeout: 2000 }).toBe(0);
      expect(library.store.operation(guest, key)).toBeUndefined();
      expect(library.store.list(guest).items).toEqual([]);
    } finally {
      upload?.destroy();
      await app.server.close();
      core.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
