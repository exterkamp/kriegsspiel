import { webcrypto } from 'node:crypto';
import * as maps from '@kriegsspiel/maps';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  verifyLibraryAsset,
  type AssetCheckRequest,
  type AssetCheckResponse,
  type LibraryAssetInput,
} from './asset-check';
import { verifyLibraryAssetMessage } from './asset-check.worker';

let asset: maps.MapAsset;
let value: LibraryAssetInput;
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  // Actual small supported generation and complete certification, following the
  // existing composition-contract oracle. No worker thread/server/browser exists.
  const settings = structuredClone(maps.DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 500;
  settings.terrain.reliefM = 0;
  settings.cover.woodFraction = settings.cover.fieldFraction = 0;
  settings.settlements.villageCount = settings.settlements.farmCount = 1;
  settings.settlements.villagePopulation = 12;
  settings.settlements.minSpacingM = 150;
  settings.roads.extraLinks = 0;
  const generated = maps.generateBattlefield({ seed: 17, settings, overrides: [] });
  if (!generated.ok) throw new Error('Supported generation premise failed');
  asset = generated.value;
  expect(maps.validateBattlefield(asset).ok).toBe(true);
  value = {
    canonicalJson: maps.canonicalizeAsset(asset),
    assetIdentity: await maps.assetIdentity(asset, 'asset'),
    widthM: 500,
    heightM: 500,
  };
}, 30000);
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
class FakeWorker extends EventTarget {
  readonly sent: AssetCheckRequest[] = [];
  readonly postMessage = vi.fn((message: unknown) => {
    this.sent.push(structuredClone(message) as AssetCheckRequest);
  });
  readonly terminate = vi.fn();
  readonly added = vi.spyOn(this as EventTarget, 'addEventListener');
  readonly removed = vi.spyOn(this as EventTarget, 'removeEventListener');
  emit(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  asWorker(): Worker {
    return this as unknown as Worker;
  }
}
function success(
  request: AssetCheckRequest,
  candidate = asset,
): Extract<AssetCheckResponse, { type: 'verified' }> {
  return {
    v: 1,
    type: 'verified',
    requestId: request.requestId,
    inputDigest: request.input.assetIdentity,
    byteLength: request.byteLength,
    widthM: request.input.widthM,
    heightM: request.input.heightM,
    asset: candidate,
  };
}
function request(input = value): AssetCheckRequest {
  return {
    v: 1,
    type: 'verify-library-asset',
    requestId: '7da01aae-638e-4700-9a8d-5f39646c78d1',
    byteLength: maps.utf8Bytes(input.canonicalJson),
    input: { ...input },
  };
}
function signal() {
  return new AbortController().signal;
}
function start(input = value, controller = new AbortController()) {
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker.asWorker());
  const result = verifyLibraryAsset(input, controller.signal, factory);
  return { worker, factory, result, controller };
}
function released(worker: FakeWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.removed.mock.calls.map((call) => call[0])).toEqual([
    'message',
    'error',
    'messageerror',
  ]);
}

describe('unused worker verification lifetime', () => {
  it('uses an opaque bound request, returns a detached structural MapAsset and does not rerun import/hash/topology/certification on main', async () => {
    const heavy = [
      vi.spyOn(maps, 'importAsset'),
      vi.spyOn(maps, 'parseAsset'),
      vi.spyOn(maps, 'canonicalizeAsset'),
      vi.spyOn(maps, 'assetIdentity'),
      vi.spyOn(maps, 'validateBattlefield'),
    ];
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const { worker, result } = start(value, caller);
    expect(worker.sent).toHaveLength(1);
    const sent = worker.sent[0]!;
    expect(sent).toEqual({
      v: 1,
      type: 'verify-library-asset',
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      byteLength: maps.utf8Bytes(value.canonicalJson),
      input: value,
    });
    const reply = success(sent, structuredClone(asset));
    worker.emit(reply);
    const checked = await result;
    expect(checked).toEqual(asset);
    expect(checked).not.toBe(reply.asset);
    if (reply.type !== 'verified') throw new Error('Bad premise');
    reply.asset.layers.sites[0]!.name = 'Changed by fake worker after delivery';
    expect(checked.layers.sites[0]!.name).toBe(asset.layers.sites[0]!.name);
    for (const spy of heavy) expect(spy).not.toHaveBeenCalled();
    released(worker);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('uses the default module Worker URL without allocating a real worker in this test', async () => {
    const instances: FakeWorker[] = [];
    let argumentsReceived!: unknown[];
    class Stub extends FakeWorker {
      constructor(...args: unknown[]) {
        super();
        instances.push(this);
        argumentsReceived = args;
      }
    }
    vi.stubGlobal('Worker', Stub);
    const result = verifyLibraryAsset(value, signal());
    expect(argumentsReceived[0]).toBeInstanceOf(URL);
    expect(String(argumentsReceived[0])).toMatch(/\/asset-check\.worker\.ts$/);
    expect(argumentsReceived[1]).toEqual({ type: 'module' });
    const created = instances[0]!;
    created.emit(success(created.sent[0]!));
    await expect(result).resolves.toEqual(asset);
    released(created);
  });

  it.each(['hash', 'width', 'height', 'empty', 'UTF8', 'fields', 'accessor', 'prototype'])(
    'rejects invalid %s before factory allocation',
    async (invalid) => {
      const bad = { ...value };
      const getter = vi.fn(() => value.canonicalJson);
      if (invalid === 'hash') bad.assetIdentity = 'A'.repeat(64);
      if (invalid === 'width') bad.widthM = Infinity;
      if (invalid === 'height') bad.heightM = 15001;
      if (invalid === 'empty') bad.canonicalJson = '';
      if (invalid === 'UTF8') bad.canonicalJson = '\ud800';
      if (invalid === 'fields') Object.assign(bad, { private: true });
      if (invalid === 'accessor') Object.defineProperty(bad, 'canonicalJson', { get: getter });
      if (invalid === 'prototype') Object.setPrototypeOf(bad, { private: true });
      const factory = vi.fn();
      await expect(verifyLibraryAsset(bad, signal(), factory)).rejects.toMatchObject({
        kind: 'invalid',
      });
      expect(factory).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('checks exact64MiB UTF8 input admission before worker and rejects a multibyte overflow', async () => {
    const controller = new AbortController();
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {});
    const factory = vi.fn(() => worker.asWorker());
    const result = verifyLibraryAsset(
      { ...value, canonicalJson: ' '.repeat(maps.HARD_LIMITS.maxBytes) },
      controller.signal,
      factory,
    );
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(factory).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0]![0]).toMatchObject({
      byteLength: maps.HARD_LIMITS.maxBytes,
    });
    controller.abort();
    await rejection;
    released(worker);
    const oversized = { ...value, canonicalJson: 'é'.repeat(maps.HARD_LIMITS.maxBytes / 2 + 1) };
    factory.mockClear();
    await expect(verifyLibraryAsset(oversized, signal(), factory)).rejects.toMatchObject({
      kind: 'invalid',
    });
    expect(factory).not.toHaveBeenCalled();
  }, 15000);

  it('allocates nothing when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn();
    await expect(verifyLibraryAsset(value, controller.signal, factory)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('snapshots input scalars independently from caller and outbound message aliases', async () => {
    const mutable = { ...value };
    const { worker, result } = start(mutable);
    const sent = structuredClone(worker.sent[0]!);
    mutable.canonicalJson = '{}';
    mutable.assetIdentity = 'f'.repeat(64);
    mutable.widthM = 4;
    worker.sent[0]!.input.assetIdentity = 'e'.repeat(64);
    worker.emit(success(sent));
    await expect(result).resolves.toEqual(asset);
    released(worker);
  });

  it.each([
    'ID',
    'digest',
    'bytes',
    'width',
    'height',
    'type',
    'version',
    'extra',
    'failure',
    'getter',
  ])('rejects malformed %s envelopes and terminates once', async (invalid) => {
    const { worker, result } = start();
    const reply = success(worker.sent[0]!) as unknown as Record<string, unknown>;
    if (invalid === 'ID') reply['requestId'] = '7da01aae-638e-4700-9a8d-5f39646c78d2';
    if (invalid === 'digest') reply['inputDigest'] = '0'.repeat(64);
    if (invalid === 'bytes') reply['byteLength'] = Number(reply['byteLength']) + 1;
    if (invalid === 'width') reply['widthM'] = 100;
    if (invalid === 'height') reply['heightM'] = 100;
    if (invalid === 'type') reply['type'] = 'ready';
    if (invalid === 'version') reply['v'] = 2;
    if (invalid === 'extra') reply['private'] = 'secret';
    if (invalid === 'failure') Object.assign(reply, { type: 'failed', code: 'raw private reason' });
    if (invalid === 'getter')
      Object.defineProperty(reply, 'inputDigest', {
        get: () => {
          throw new Error('private');
        },
      });
    worker.emit(reply);
    await expect(result).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'This map could not be checked. Please try again.',
    });
    released(worker);
  });

  it.each(['private shape', 'NW origin', 'dimensions', 'cyclic', 'features', 'samples', 'ring'])(
    'rejects unbounded or malformed %s asset output without topology work',
    async (invalid) => {
      const { worker, result } = start();
      const candidate = structuredClone(asset);
      if (invalid === 'private shape') Object.assign(candidate, { master: 'private' });
      if (invalid === 'NW origin') Object.assign(candidate.bounds, { minX: 1 });
      if (invalid === 'dimensions') candidate.bounds.maxY = 499;
      if (invalid === 'cyclic') Object.assign(candidate, { self: candidate });
      if (invalid === 'features')
        Object.assign(candidate.layers, {
          cover: Array(30000).fill({}),
          roadNodes: Array(30000).fill({}),
        });
      if (invalid === 'samples')
        candidate.elevation.samples = Array(maps.HARD_LIMITS.maxSamples + 1).fill(0);
      if (invalid === 'ring')
        candidate.layers.cover.push({
          id: 'test:cover',
          kind: 'wood',
          polygons: [
            { outer: Array(maps.HARD_LIMITS.maxRingVertices + 1).fill([1, 1]), holes: [] },
          ],
        });
      worker.emit(success(worker.sent[0]!, candidate));
      await expect(result).rejects.toMatchObject({ kind: 'unavailable' });
      released(worker);
    },
  );

  it('settles a fixed worker failure without exposing private diagnostics', async () => {
    const { worker, result } = start();
    worker.emit({
      v: 1,
      type: 'failed',
      requestId: worker.sent[0]!.requestId,
      code: 'MAP_UNAVAILABLE',
    });
    await expect(result).rejects.toThrow('This map could not be checked. Please try again.');
    released(worker);
  });

  it.each(['error', 'messageerror'])(
    'cleans listeners for the %s channel without forwarding raw errors',
    async (type) => {
      const { worker, result } = start();
      const event = new Event(type, { cancelable: true });
      worker.dispatchEvent(event);
      await expect(result).rejects.toMatchObject({ kind: 'unavailable' });
      expect(event.defaultPrevented).toBe(true);
      released(worker);
    },
  );

  it('aborts promptly, terminates once, and ignores a retained late listener', async () => {
    const { worker, result, controller } = start();
    const listener = worker.added.mock.calls.find(
      (call) => call[0] === 'message',
    )![1] as EventListener;
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    listener(new MessageEvent('message', { data: success(worker.sent[0]!) }));
    released(worker);
  });

  it('retires a worker returned after synchronous factory abort without posting or attaching listeners', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const controller = new AbortController();
    await expect(
      verifyLibraryAsset(value, controller.signal, () => {
        controller.abort();
        return worker.asWorker();
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.added).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a reentrant new owner alive while the original factory aborts', async () => {
    const old = new FakeWorker();
    const next = new FakeWorker();
    const controller = new AbortController();
    let current!: Promise<maps.MapAsset>;
    const original = verifyLibraryAsset(value, controller.signal, () => {
      current = verifyLibraryAsset(value, signal(), () => next.asWorker());
      controller.abort();
      return old.asWorker();
    });
    await expect(original).rejects.toMatchObject({ name: 'AbortError' });
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(next.terminate).not.toHaveBeenCalled();
    next.emit(success(next.sent[0]!));
    await expect(current).resolves.toEqual(asset);
    released(next);
    expect(old.postMessage).not.toHaveBeenCalled();
  });

  it('enforces30s independently of caller and clears listeners/timers, including late delivery', async () => {
    vi.useFakeTimers();
    const { worker, result } = start();
    const listener = worker.added.mock.calls[0]![1] as EventListener;
    const rejection = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(29999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    released(worker);
    expect(vi.getTimerCount()).toBe(0);
    listener(new MessageEvent('message', { data: success(worker.sent[0]!) }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['factory', 'post', 'listener'])(
    'cleans partially acquired ownership when %s throws',
    async (phase) => {
      vi.useFakeTimers();
      const worker = new FakeWorker();
      if (phase === 'post')
        worker.postMessage.mockImplementationOnce(() => {
          throw new Error('private');
        });
      if (phase === 'listener')
        worker.added.mockImplementationOnce(() => {
          throw new Error('private');
        });
      const result = verifyLibraryAsset(value, signal(), () => {
        if (phase === 'factory') throw new Error('private');
        return worker.asWorker();
      });
      await expect(result).rejects.toThrow('This map could not be checked. Please try again.');
      expect(worker.terminate).toHaveBeenCalledTimes(phase === 'factory' ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects a success if terminate synchronously aborts the caller during final handoff', async () => {
    const { worker, result, controller } = start();
    worker.terminate.mockImplementationOnce(() => controller.abort());
    worker.emit(success(worker.sent[0]!));
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    released(worker);
  });
});

describe('pure actual worker message verification', () => {
  it('returns actual detached supported geography with matching full input digest and correlation after complete certification', async () => {
    const input = request();
    const promise = verifyLibraryAssetMessage(input);
    input.input.assetIdentity = 'f'.repeat(64);
    const result = await promise;
    expect(result).toEqual({
      v: 1,
      type: 'verified',
      requestId: input.requestId,
      inputDigest: value.assetIdentity,
      byteLength: maps.utf8Bytes(value.canonicalJson),
      widthM: 500,
      heightM: 500,
      asset,
    });
    if (result.type !== 'verified') throw new Error('Bad successful premise');
    expect(result.asset).not.toBe(asset);
    expect(maps.validateBattlefield(result.asset).ok).toBe(true);
  });

  it.each([
    'geometry identity',
    'whitespace',
    'BOM',
    'width',
    'height',
    'bytes',
    'JSON',
    'private envelope',
    'invalid ID',
  ])('returns only fixed failure for %s', async (invalid) => {
    const input: AssetCheckRequest & { private?: string } = request();
    if (invalid === 'geometry identity')
      input.input.assetIdentity = await maps.assetIdentity(asset, 'geometry');
    if (invalid === 'whitespace') {
      input.input.canonicalJson += ' ';
      input.byteLength++;
    }
    if (invalid === 'BOM') {
      input.input.canonicalJson = '\uFEFF' + input.input.canonicalJson;
      input.byteLength += 3;
    }
    if (invalid === 'width') input.input.widthM = 499;
    if (invalid === 'height') input.input.heightM = 499;
    if (invalid === 'bytes') input.byteLength++;
    if (invalid === 'JSON') {
      input.input.canonicalJson = '{secret:';
      input.byteLength = 8;
    }
    if (invalid === 'private envelope') input.private = 'secret';
    if (invalid === 'invalid ID') input.requestId = 'secret-invalid-id';
    const result = await verifyLibraryAssetMessage(input);
    expect(result).toEqual({
      v: 1,
      type: 'failed',
      requestId:
        invalid === 'invalid ID' || invalid === 'private envelope' ? null : input.requestId,
      code: 'MAP_UNAVAILABLE',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects an exact canonical/full-hash asset that passes import but fails current complete certification', async () => {
    const invalid = structuredClone(asset);
    invalid.layers.buildings.find((building) => building.kind === 'residential')!.kind =
      'agricultural';
    const canonicalJson = maps.canonicalizeAsset(invalid);
    const loaded = maps.importAsset(canonicalJson);
    expect(maps.validateBattlefield(loaded).ok).toBe(false);
    const input = request({
      canonicalJson,
      assetIdentity: await maps.assetIdentity(loaded, 'asset'),
      widthM: 500,
      heightM: 500,
    });
    expect(await verifyLibraryAssetMessage(input)).toEqual({
      v: 1,
      type: 'failed',
      requestId: input.requestId,
      code: 'MAP_UNAVAILABLE',
    });
  });

  it('rejects schema-only reference geography as unsupported rather than substituting a playable map', async () => {
    const reference = maps.createReferenceAsset();
    const canonicalJson = maps.canonicalizeAsset(reference);
    expect(maps.validateBattlefield(reference).ok).toBe(false);
    const input = request({
      canonicalJson,
      assetIdentity: await maps.assetIdentity(reference, 'asset'),
      widthM: 150,
      heightM: 150,
    });
    expect(await verifyLibraryAssetMessage(input)).toEqual({
      v: 1,
      type: 'failed',
      requestId: input.requestId,
      code: 'MAP_UNAVAILABLE',
    });
  });
  it('installs the module-worker message entry, posts only checked protocol output and refuses a second verification', async () => {
    vi.resetModules();
    const post = vi.fn();
    vi.stubGlobal('importScripts', vi.fn());
    vi.stubGlobal('postMessage', post);
    vi.stubGlobal('onmessage', undefined);
    await import('./asset-check.worker');
    const handler = (globalThis as unknown as { onmessage: (event: MessageEvent<unknown>) => void })
      .onmessage;
    expect(handler).toBeTypeOf('function');
    handler(new MessageEvent('message', { data: request() }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]![0]).toMatchObject({
      type: 'verified',
      requestId: request().requestId,
      inputDigest: value.assetIdentity,
    });
    handler(new MessageEvent('message', { data: request() }));
    expect(post.mock.calls[1]![0]).toEqual({
      v: 1,
      type: 'failed',
      requestId: null,
      code: 'MAP_UNAVAILABLE',
    });
  });
});

describe('optional prepared asset agreement', () => {
  it('detaches a bounded candidate before handing it to the worker', async () => {
    const worker = new FakeWorker();
    const candidate = structuredClone(asset);
    const pending = verifyLibraryAsset({ ...value, candidate }, new AbortController().signal, () =>
      worker.asWorker(),
    );
    const request = worker.sent[0]!;
    expect(request.input.candidate).toEqual(candidate);
    expect(request.input.candidate).not.toBe(candidate);
    candidate.name = 'Changed after dispatch';
    expect(request.input.candidate!.name).toBe(asset.name);
    worker.emit(success(request));
    await expect(pending).resolves.toEqual(asset);
  });
  it('accepts matching actual current-certified candidate bytes in the pure worker', async () => {
    const response = await verifyLibraryAssetMessage({
      v: 1,
      type: 'verify-library-asset',
      requestId: crypto.randomUUID(),
      byteLength: maps.utf8Bytes(value.canonicalJson),
      input: { ...value, candidate: structuredClone(asset) },
    });
    expect(response.type).toBe('verified');
    if (response.type === 'verified') expect(response.inputDigest).toBe(value.assetIdentity);
  });
  it('rejects a structurally valid candidate with different canonical content', async () => {
    const candidate = structuredClone(asset);
    candidate.name = 'Different prepared map';
    expect(await maps.assetIdentity(candidate, 'geometry')).toBe(
      await maps.assetIdentity(asset, 'geometry'),
    );
    expect(await maps.assetIdentity(candidate, 'asset')).not.toBe(value.assetIdentity);
    const response = await verifyLibraryAssetMessage({
      v: 1,
      type: 'verify-library-asset',
      requestId: crypto.randomUUID(),
      byteLength: maps.utf8Bytes(value.canonicalJson),
      input: { ...value, candidate },
    });
    expect(response.type).toBe('failed');
  });
  it('rejects an accessor candidate without allocating or executing a getter', async () => {
    const factory = vi.fn(() => new FakeWorker().asWorker());
    const getter = vi.fn(() => asset);
    const input = { ...value };
    Object.defineProperty(input, 'candidate', { get: getter, enumerable: true });
    await expect(
      verifyLibraryAsset(input, new AbortController().signal, factory),
    ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
});
