import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  importAsset,
  canonicalizeAsset,
  assetIdentity,
  generateBattlefield,
  supportsReplay,
  type MapAsset,
} from '@kriegsspiel/maps';
import { LibraryAdmission } from './admission.js';
import {
  LIBRARY_ASSET_BYTES,
  validateLibraryAsset,
  type LibraryWorkerFactory,
} from './validation.js';
afterEach(() => vi.useRealTimers());
class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => {
    this.emit('exit', 1);
    return 1;
  });
}
function injected(worker: FakeWorker): LibraryWorkerFactory {
  return vi.fn(() => worker as unknown as Worker);
}
describe('library admission and worker retirement', () => {
  it('reserves only two global operations and one per owner, with no queue', async () => {
    const pool = new LibraryAdmission();
    const a = pool.acquire('a');
    expect(() => pool.acquire('a')).toThrow('map_library_busy');
    const b = pool.acquire('b');
    expect(() => pool.acquire('c')).toThrow('map_library_busy');
    let retire!: () => void;
    a.track(new Promise<void>((resolve) => (retire = resolve)));
    const releasing = a.release();
    expect(a.release()).toBe(releasing);
    expect(pool.active).toBe(2);
    expect(() => pool.acquire('c')).toThrow();
    retire();
    await releasing;
    const c = pool.acquire('c');
    await Promise.all([b.release(), c.release()]);
    expect(pool.active).toBe(0);
  });
  it('does not allocate a worker for an aborted or oversized request', async () => {
    const pool = new LibraryAdmission();
    const lease = pool.acquire('a');
    const worker = new FakeWorker();
    const factory = injected(worker);
    const abort = new AbortController();
    abort.abort();
    await expect(validateLibraryAsset('{}', lease, abort.signal, factory)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(factory).not.toHaveBeenCalled();
    await lease.release();
  });
  it('rejects character and multibyte byte overflow before allocating any worker', async () => {
    const pool = new LibraryAdmission();
    const lease = pool.acquire('large');
    const factory = injected(new FakeWorker());
    try {
      await expect(
        validateLibraryAsset(
          'a'.repeat(LIBRARY_ASSET_BYTES + 1),
          lease,
          new AbortController().signal,
          factory,
        ),
      ).rejects.toThrow('map_too_large');
      await expect(
        validateLibraryAsset(
          'é'.repeat(LIBRARY_ASSET_BYTES / 2 + 1),
          lease,
          new AbortController().signal,
          factory,
        ),
      ).rejects.toThrow('map_too_large');
      expect(factory).not.toHaveBeenCalled();
    } finally {
      await lease.release();
    }
    expect(pool.active).toBe(0);
  });
  it('holds its slot until successful worker exit, then returns only checked metadata and original bytes', async () => {
    const pool = new LibraryAdmission();
    const lease = pool.acquire('a');
    const worker = new FakeWorker();
    let exit!: () => void;
    worker.terminate.mockImplementation(
      () =>
        new Promise((resolve) => {
          exit = () => {
            worker.emit('exit', 0);
            resolve(0);
          };
        }),
    );
    const result = validateLibraryAsset(
      '{}',
      lease,
      new AbortController().signal,
      injected(worker),
    );
    worker.emit('message', {
      ok: true,
      value: { identity: 'a'.repeat(64), widthM: 5000, heightM: 3000 },
    });
    await Promise.resolve();
    expect(pool.active).toBe(1);
    const release = lease.release();
    expect(pool.active).toBe(1);
    exit();
    expect(await result).toEqual({
      canonicalJson: '{}',
      identity: 'a'.repeat(64),
      widthM: 5000,
      heightM: 3000,
    });
    await release;
    expect(pool.active).toBe(0);
  });
  it.each(['abort', 'timeout', 'invalid', 'exit', 'error'])(
    'retires worker and lease after %s',
    async (kind) => {
      vi.useFakeTimers();
      const pool = new LibraryAdmission();
      const lease = pool.acquire('a');
      const worker = new FakeWorker();
      const abort = new AbortController();
      const result = validateLibraryAsset('{}', lease, abort.signal, injected(worker));
      const rejected = expect(result).rejects.toThrow();
      if (kind === 'abort') abort.abort();
      if (kind === 'timeout') await vi.advanceTimersByTimeAsync(30000);
      if (kind === 'invalid')
        worker.emit('message', { ok: true, value: { identity: 'bad', widthM: 0, heightM: 3000 } });
      if (kind === 'exit') worker.emit('exit', 1);
      if (kind === 'error') worker.emit('error', new Error('private diagnostic must not escape'));
      await rejected;
      await lease.release();
      expect(pool.active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
describe('actual current complete map certification worker', () => {
  it('certifies exact included canonical bytes and refuses a noncanonical representation', async () => {
    const raw = readFileSync(
      new URL('../../../data/maps/countryside-rectangle.json', import.meta.url),
      'utf8',
    );
    const json = canonicalizeAsset(importAsset(raw));
    const pool = new LibraryAdmission();
    const lease = pool.acquire('a');
    try {
      const result = await validateLibraryAsset(json, lease, new AbortController().signal);
      expect(result).toMatchObject({
        canonicalJson: json,
        widthM: 5000,
        heightM: 3000,
        identity: await assetIdentity(importAsset(json), 'asset'),
      });
      expect(result.identity).not.toBe(await assetIdentity(importAsset(json), 'geometry'));
    } finally {
      await lease.release();
    }
    const next = pool.acquire('a');
    try {
      await expect(
        validateLibraryAsset(' ' + json, next, new AbortController().signal),
      ).rejects.toThrow('map_validation_failed');
      const obsolete = importAsset(json);
      obsolete.provenance.generator.version = 'unsupported-lobby-map-test';
      const canonicalInvalid = canonicalizeAsset(obsolete);
      expect(canonicalizeAsset(importAsset(canonicalInvalid))).toBe(canonicalInvalid);
      await expect(
        validateLibraryAsset(canonicalInvalid, next, new AbortController().signal),
      ).rejects.toThrow('map_validation_failed');
    } finally {
      await next.release();
    }
  }, 30000);
  it('certifies maps from the current generator and every legacy generator identity', async () => {
    // The library uses the maps package's complete validator, so it accepts what main still
    // certifies: the current generator and its LEGACY_GENERATORS (D44 to D49 saved maps).
    const fixtures = ['d44', 'd45', 'd46', 'd48'].map((name) =>
      readFileSync(
        new URL(`../../../packages/maps/tests/fixtures/${name}-saved-map.json`, import.meta.url),
        'utf8',
      ),
    );
    const legacy = fixtures.map((raw) => importAsset(raw));
    expect(legacy.every((asset) => !supportsReplay(asset))).toBe(true);
    const generated = generateBattlefield({
      seed: legacy[3]!.provenance.seed,
      settings: legacy[3]!.settings,
      overrides: legacy[3]!.overrides,
    });
    if (!generated.ok) throw new Error('current generator failed');
    const current: MapAsset = generated.value;
    expect(supportsReplay(current)).toBe(true);
    const pool = new LibraryAdmission();
    for (const asset of [current, ...legacy]) {
      const json = canonicalizeAsset(asset);
      const lease = pool.acquire('owner');
      try {
        const result = await validateLibraryAsset(json, lease, new AbortController().signal);
        expect(result).toMatchObject({ canonicalJson: json, widthM: 600, heightM: 600 });
      } finally {
        await lease.release();
      }
    }
  }, 120000);
});
