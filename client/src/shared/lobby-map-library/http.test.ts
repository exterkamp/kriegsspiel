import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryMapSummary } from './contracts';
import { createHttpMapLibrary, MapLibraryHttpError } from './http';

const key = '7da01aae-638e-4700-9a8d-5f39646c78d1';
const id = '7da01aae-638e-4700-9a8d-5f39646c78d2';
const assetLimit = 64 * 1024 * 1024;
let item: LibraryMapSummary;
let canonicalJson: string;
let f: ReturnType<typeof vi.fn<typeof fetch>>;
const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function readHeaders(summary = item): Record<string, string> {
  return {
    'Content-Type': 'application/vnd.kriegsspiel.map+json',
    'X-Map-Kind': summary.ref.kind,
    'X-Map-Id': summary.ref.id,
    'X-Map-Name': encodeURIComponent(summary.name),
    'X-Map-Identity': summary.assetIdentity,
    'X-Map-Width-M': String(summary.widthM),
    'X-Map-Height-M': String(summary.heightM),
    ...(summary.createdAtMs === undefined
      ? {}
      : { 'X-Map-Created-At-Ms': String(summary.createdAtMs) }),
  };
}
function intent() {
  return { requestId: key, name: item.name, canonicalJson, assetIdentity: item.assetIdentity };
}
function stream(
  chunks: Uint8Array[],
  headers: HeadersInit = { 'Content-Type': 'application/json' },
  status = 200,
  keepOpen = false,
) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
      else if (!keepOpen) controller.close();
    },
    cancel,
  });
  const response = new Response(body, { status, headers });
  vi.spyOn(response, 'json').mockRejectedValue(new Error('Convenience reader forbidden'));
  vi.spyOn(response, 'text').mockRejectedValue(new Error('Convenience reader forbidden'));
  return { response, body, cancel };
}
const bytes = (value: string) => new TextEncoder().encode(value);
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  canonicalJson = canonicalizeAsset(asset);
  item = {
    ref: { kind: 'owned', id },
    name: 'Café 🌲 geography',
    widthM: 150,
    heightM: 150,
    assetIdentity: await assetIdentity(asset, 'asset'),
    status: 'needs-scenario',
    createdAtMs: 123,
  };
  f = vi.fn<typeof fetch>();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Fake in-process Fetch/Response streams only. Exact public reference bytes/hashes are real;
// neither transport nor these tests claim generation/current complete certification evidence.
describe('library list and exact raw geography reads', () => {
  it('requests one explicit source-bound page with credentials and a bounded cursor, returning only detached allowlisted fields', async () => {
    const input = { schemaVersion: 1, items: [item], nextCursor: 'next_2.x-3' };
    f.mockResolvedValue(json(input));
    const port = createHttpMapLibrary(f);
    const caller = signal();
    const page = await port.list('owned', caller, 'page_1');
    expect(f).toHaveBeenCalledExactlyOnceWith('/map-library/maps?source=owned&cursor=page_1', {
      method: 'GET',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(page).toEqual({ items: [item], nextCursor: input.nextCursor });
    expect(page.items[0]).not.toBe(item);
    expect(Object.keys(page)).toEqual(['items', 'nextCursor']);
    expect(f.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  });

  it.each([
    'wrong source',
    'private row',
    'private envelope',
    'legacy envelope',
    'wrong schema',
    'missing owned timestamp',
    'duplicate ID',
    'empty continuation',
  ])('rejects %s through the accepted protocol decoder', async (invalid) => {
    let input: unknown = { schemaVersion: 1, items: [item] };
    if (invalid === 'wrong source')
      input = {
        schemaVersion: 1,
        items: [{ ...item, ref: { kind: 'included', id: 'reference' }, createdAtMs: undefined }],
      };
    if (invalid === 'private row')
      input = { schemaVersion: 1, items: [{ ...item, originalOwner: 'secret' }] };
    if (invalid === 'private envelope')
      input = { schemaVersion: 1, items: [item], ownerId: 'secret' };
    if (invalid === 'legacy envelope') input = { maps: [item] };
    if (invalid === 'wrong schema') input = { schemaVersion: 2, items: [item] };
    if (invalid === 'missing owned timestamp')
      input = { schemaVersion: 1, items: [{ ...item, createdAtMs: undefined }] };
    if (invalid === 'duplicate ID') input = { schemaVersion: 1, items: [item, item] };
    if (invalid === 'empty continuation')
      input = { schemaVersion: 1, items: [], nextCursor: 'next' };
    f.mockResolvedValue(json(input));
    await expect(createHttpMapLibrary(f).list('owned', signal())).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it.each([32768, 32769])(
    'counts the actual %i page bytes independently of Content-Length',
    async (length) => {
      const body = JSON.stringify({ schemaVersion: 1, items: [item] });
      const data = bytes(body + ' '.repeat(length - bytes(body).byteLength));
      const source = stream(
        [data.subarray(0, 999), data.subarray(999)],
        {
          'Content-Type': 'application/json',
          'Content-Length': '1',
        },
        200,
        length > 32768,
      );
      f.mockResolvedValue(source.response);
      const result = createHttpMapLibrary(f).list('owned', signal());
      if (length === 32768) expect(await result).toEqual({ items: [item] });
      else {
        await expect(result).rejects.toBeInstanceOf(MapLibraryHttpError);
        expect(source.cancel).toHaveBeenCalledOnce();
      }
      expect(source.body.locked).toBe(false);
      expect(source.response.json).not.toHaveBeenCalled();
      expect(source.response.text).not.toHaveBeenCalled();
    },
  );

  it('handles split multibyte UTF-8 and rejects malformed UTF-8/JSON without exposing payloads', async () => {
    const encoded = bytes(JSON.stringify({ schemaVersion: 1, items: [item] }));
    f.mockResolvedValueOnce(stream(Array.from(encoded, (n) => new Uint8Array([n]))).response);
    expect((await createHttpMapLibrary(f).list('owned', signal())).items[0]!.name).toBe(item.name);
    for (const data of [new Uint8Array([0xc3, 0x28]), bytes('{secret-owner:')]) {
      f.mockResolvedValueOnce(stream([data]).response);
      await expect(createHttpMapLibrary(f).list('owned', signal())).rejects.toThrow(
        'The map library is unavailable. Please try again.',
      );
    }
  });

  it.each(['owned', 'included'] as const)(
    'reads %s exact canonical bytes with independently bound headers and full identity',
    async (kind) => {
      if (kind === 'included') {
        item = {
          ref: { kind, id: 'reference-map' },
          name: item.name,
          widthM: item.widthM,
          heightM: item.heightM,
          assetIdentity: item.assetIdentity,
          status: item.status,
        };
      }
      const source = stream(
        [bytes(canonicalJson).subarray(0, 31), bytes(canonicalJson).subarray(31)],
        readHeaders(),
      );
      f.mockResolvedValue(source.response);
      const original = structuredClone(item);
      const result = await createHttpMapLibrary(f).read(item.ref, signal());
      expect(f.mock.calls[0]![0]).toBe(
        `/map-library/maps/${kind}/${encodeURIComponent(item.ref.id)}`,
      );
      expect(result).toEqual({ item: original, canonicalJson });
      expect(result.item).not.toBe(item);
      expect(Object.keys(result)).toEqual(['item', 'canonicalJson']);
      expect(source.body.locked).toBe(false);
    },
  );

  it.each([
    'foreign id',
    'foreign source',
    'private header',
    'non-ASCII name',
    'long name',
    'bad encoding',
    'missing identity',
    'invalid width',
    'trailing width',
    'timestamp',
    'content type',
    'included timestamp',
  ])('rejects invalid read %s and cancels the unread body', async (invalid) => {
    const headers = readHeaders();
    if (invalid === 'foreign id') headers['X-Map-Id'] = key;
    if (invalid === 'foreign source') headers['X-Map-Kind'] = 'included';
    if (invalid === 'private header') headers['X-Map-Owner'] = 'secret';
    if (invalid === 'non-ASCII name') headers['X-Map-Name'] = 'é';
    if (invalid === 'long name') headers['X-Map-Name'] = 'a'.repeat(1921);
    if (invalid === 'bad encoding') headers['X-Map-Name'] = '%E0%A4';
    if (invalid === 'missing identity') delete headers['X-Map-Identity'];
    if (invalid === 'invalid width') headers['X-Map-Width-M'] = 'Infinity';
    if (invalid === 'trailing width') headers['X-Map-Width-M'] = '150private';
    if (invalid === 'timestamp') headers['X-Map-Created-At-Ms'] = '9007199254740992';
    if (invalid === 'content type') headers['Content-Type'] = 'application/json';
    if (invalid === 'included timestamp') {
      headers['X-Map-Kind'] = 'included';
      headers['X-Map-Id'] = 'reference';
    }
    const source = stream([bytes(canonicalJson)], headers);
    f.mockResolvedValue(source.response);
    const ref =
      invalid === 'included timestamp' ? { kind: 'included' as const, id: 'reference' } : item.ref;
    await expect(createHttpMapLibrary(f).read(ref, signal())).rejects.toBeInstanceOf(
      MapLibraryHttpError,
    );
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.body.locked).toBe(false);
  });

  it.each(['whitespace', 'BOM', 'geometry hash', 'dimensions', 'asset mutation'])(
    'rejects read %s disagreement without normalizing bytes',
    async (invalid) => {
      let body = canonicalJson;
      const headers = readHeaders();
      if (invalid === 'whitespace') body += ' ';
      if (invalid === 'BOM') body = '\uFEFF' + body;
      if (invalid === 'geometry hash')
        headers['X-Map-Identity'] = await assetIdentity(createReferenceAsset(), 'geometry');
      if (invalid === 'dimensions') headers['X-Map-Height-M'] = '160';
      if (invalid === 'asset mutation') {
        const asset = createReferenceAsset();
        asset.name = 'Different asset';
        body = canonicalizeAsset(asset);
      }
      f.mockResolvedValue(stream([bytes(body)], headers).response);
      await expect(createHttpMapLibrary(f).read(item.ref, signal())).rejects.toMatchObject({
        kind: 'unavailable',
      });
    },
  );

  it('enforces the actual 64MiB read ceiling on a chunked body without trusting Content-Length', async () => {
    const source = stream(
      [new Uint8Array(assetLimit), new Uint8Array([1])],
      {
        ...readHeaders(),
        'Content-Length': '1',
      },
      200,
      true,
    );
    f.mockResolvedValue(source.response);
    await expect(createHttpMapLibrary(f).read(item.ref, signal())).rejects.toBeInstanceOf(
      MapLibraryHttpError,
    );
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.body.locked).toBe(false);
  });

  it('admits exactly 64MiB of bytes, then rejects the invalid asset rather than claiming it was truncated', async () => {
    const source = stream([new Uint8Array(assetLimit)], readHeaders());
    f.mockResolvedValue(source.response);
    await expect(createHttpMapLibrary(f).read(item.ref, signal())).rejects.toBeInstanceOf(
      MapLibraryHttpError,
    );
    expect(source.cancel).not.toHaveBeenCalled();
    expect(source.body.locked).toBe(false);
  }, 15000);
});

describe('exact keyed saves and ambiguity reconciliation', () => {
  it('sends exact raw bytes and encoded separate name/hash with the caller key, never generates a key or retries PUT', async () => {
    f.mockResolvedValue(json(item, 201));
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const value = intent();
    const result = await createHttpMapLibrary(f).save(value, signal());
    expect(result).toEqual(item);
    expect(uuid).not.toHaveBeenCalled();
    expect(f).toHaveBeenCalledExactlyOnceWith(`/map-library/saves/${key}`, {
      method: 'PUT',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      body: canonicalJson,
      headers: {
        'Content-Type': 'application/vnd.kriegsspiel.map+json',
        'X-Map-Name': encodeURIComponent(item.name),
        'X-Map-Identity': item.assetIdentity,
      },
    });
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string).name).toBe('Reference valley');
  });

  it.each([
    'network',
    '5xx',
    'truncated',
    'malformed 2xx',
    'foreign private fields',
    'pending 202',
  ])(
    'reconciles %s once with same-key GET and returns only an exact owned summary',
    async (lost) => {
      if (lost === 'network') f.mockRejectedValueOnce(new Error('secret network info'));
      if (lost === '5xx') f.mockResolvedValueOnce(json({ secret: 'payload' }, 503));
      if (lost === 'truncated')
        f.mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('truncated'));
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
      if (lost === 'malformed 2xx')
        f.mockResolvedValueOnce(
          new Response('{', { headers: { 'Content-Type': 'application/json' } }),
        );
      if (lost === 'foreign private fields')
        f.mockResolvedValueOnce(json({ ...item, ownerId: 'secret' }));
      if (lost === 'pending 202') f.mockResolvedValueOnce(json(item, 202));
      f.mockResolvedValueOnce(json(item));
      expect(await createHttpMapLibrary(f).save(intent(), signal())).toEqual(item);
      expect(f.mock.calls.map((call) => [call[0], call[1]!.method])).toEqual([
        [`/map-library/saves/${key}`, 'PUT'],
        [`/map-library/saves/${key}`, 'GET'],
      ]);
    },
  );

  it.each([404, 409, 401, 403, 503])(
    'keeps a lost PUT unresolved after receipt %i, without allocating or retrying',
    async (status) => {
      f.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(
        json({ message: 'private error' }, status),
      );
      await expect(createHttpMapLibrary(f).save(intent(), signal())).rejects.toMatchObject({
        kind: 'pending',
      });
      expect(f).toHaveBeenCalledTimes(2);
    },
  );

  it('never reconciles a conflicting409 into success, even when its body is malformed or oversized', async () => {
    for (const body of ['{', 'x'.repeat(4097)]) {
      f.mockReset()
        .mockResolvedValueOnce(new Response(body, { status: 409 }))
        .mockResolvedValueOnce(json(item));
      await expect(createHttpMapLibrary(f).save(intent(), signal())).rejects.toMatchObject({
        kind: 'conflict',
      });
      expect(f).toHaveBeenCalledOnce();
    }
  });

  it.each(['foreign source', 'foreign name', 'foreign identity'])(
    'rejects %s rather than recovering another valid intent',
    async (invalid) => {
      const wrong = { ...item };
      if (invalid === 'foreign source')
        Object.assign(wrong, {
          ref: { kind: 'included', id: 'reference' },
          createdAtMs: undefined,
        });
      if (invalid === 'foreign name') Object.assign(wrong, { name: 'Other map' });
      if (invalid === 'foreign identity') Object.assign(wrong, { assetIdentity: 'f'.repeat(64) });
      f.mockResolvedValueOnce(json(wrong)).mockResolvedValueOnce(json(item));
      await expect(createHttpMapLibrary(f).save(intent(), signal())).rejects.toMatchObject({
        kind: 'conflict',
      });
      expect(f).toHaveBeenCalledOnce();
    },
  );

  it('keeps the same caller bytes/name/hash/key after failure, caller mutation, and an explicit caller retry', async () => {
    const delayed = deferred<Response>();
    const value = intent();
    const original = { ...value };
    f.mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(json({ message: 'not found' }, 404))
      .mockResolvedValueOnce(json(item));
    const port = createHttpMapLibrary(f);
    const operation = port.save(value, signal());
    value.requestId = id;
    value.name = 'Changed';
    value.canonicalJson = '{}';
    value.assetIdentity = 'f'.repeat(64);
    delayed.resolve(json({}, 503));
    await expect(operation).rejects.toMatchObject({ kind: 'pending' });
    expect(await port.save(original, signal())).toEqual(item);
    expect(f.mock.calls.map((call) => call[0])).toEqual([
      `/map-library/saves/${key}`,
      `/map-library/saves/${key}`,
      `/map-library/saves/${key}`,
    ]);
    expect(f.mock.calls[0]![1]!.body).toBe(f.mock.calls[2]![1]!.body);
  });

  it.each([4096, 4097])('bounds save and receipt summary bodies at %i bytes', async (length) => {
    const raw = JSON.stringify(item);
    const data = bytes(raw + ' '.repeat(length - bytes(raw).byteLength));
    const first = stream([data], undefined, 200, length > 4096);
    const second = stream([data], undefined, 200, length > 4096);
    f.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const result = createHttpMapLibrary(f).save(intent(), signal());
    if (length === 4096) {
      expect(await result).toEqual(item);
      expect(f).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({ kind: 'pending' });
      expect(f).toHaveBeenCalledTimes(2);
      expect(first.cancel).toHaveBeenCalledOnce();
      expect(second.cancel).toHaveBeenCalledOnce();
    }
  });

  it('rejects foreign/private receipt metadata without returning hidden state', async () => {
    f.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(
      json({ ...item, owner: 'secret' }),
    );
    await expect(createHttpMapLibrary(f).save(intent(), signal())).rejects.toThrow(
      'This map may already be saved. Retry Save map to recover the same map.',
    );
  });
});

describe('bounded inputs, errors and lifetime cleanup', () => {
  it.each([
    'source',
    'cursor',
    'ref',
    'key',
    'name',
    'hash',
    'empty asset',
    'broken Unicode',
    'extra intent',
  ])('rejects invalid %s before any fetch', async (invalid) => {
    const port = createHttpMapLibrary(f);
    const value = intent();
    let operation: Promise<unknown>;
    if (invalid === 'source') operation = port.list('private' as 'owned', signal());
    else if (invalid === 'cursor') operation = port.list('owned', signal(), 'x'.repeat(513));
    else if (invalid === 'ref')
      operation = port.read({ kind: 'owned', id: '../private' }, signal());
    else {
      if (invalid === 'key') value.requestId = 'not-a-uuid';
      if (invalid === 'name') value.name = '\ud800';
      if (invalid === 'hash') value.assetIdentity = 'A'.repeat(64);
      if (invalid === 'empty asset') value.canonicalJson = '';
      if (invalid === 'broken Unicode') value.canonicalJson = '\ud800';
      if (invalid === 'extra intent') Object.assign(value, { owner: 'secret' });
      operation = port.save(value, signal());
    }
    await expect(operation).rejects.toMatchObject({ kind: 'invalid' });
    expect(f).not.toHaveBeenCalled();
  });

  it('preflights actual UTF-8 upload bytes, allowing exactly64MiB and rejecting a multibyte excess', async () => {
    const value = intent();
    value.canonicalJson = ' '.repeat(assetLimit);
    f.mockResolvedValueOnce(json(item));
    // Transport admission only; the fake server response does not claim this is a valid asset.
    await expect(createHttpMapLibrary(f).save(value, signal())).resolves.toEqual(item);
    expect((f.mock.calls[0]![1]!.body as string).length).toBe(assetLimit);
    value.canonicalJson = 'é'.repeat(assetLimit / 2 + 1);
    f.mockClear();
    await expect(createHttpMapLibrary(f).save(value, signal())).rejects.toMatchObject({
      kind: 'invalid',
    });
    expect(f).not.toHaveBeenCalled();
  }, 15000);

  it.each([
    [401, 'sign-in'],
    [403, 'sign-in'],
    [426, 'reload'],
    [404, 'missing'],
    [400, 'restart-list'],
    [429, 'unavailable'],
  ])('maps HTTP%s to safe %s copy with bounded errors', async (status, kind) => {
    const source = stream(
      [bytes('private-server-payload'.repeat(300))],
      {},
      status as number,
      true,
    );
    f.mockResolvedValue(source.response);
    await expect(createHttpMapLibrary(f).list('owned', signal())).rejects.toMatchObject({ kind });
    expect(source.cancel).toHaveBeenCalledOnce();
  });

  it('stops finite empty-chunk and bad-chunk streams instead of starving cancellation', async () => {
    for (const mode of ['empty', 'bad']) {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(
            mode === 'empty' ? new Uint8Array() : ('bad' as unknown as Uint8Array),
          );
        },
        cancel,
      });
      f.mockResolvedValueOnce(
        new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      );
      await expect(createHttpMapLibrary(f).list('owned', signal())).rejects.toBeInstanceOf(
        MapLibraryHttpError,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    }
  });

  it.each(['list', 'read', 'save'] as const)(
    'rejects pre-aborted %s without issuing a request',
    async (method) => {
      const controller = new AbortController();
      controller.abort();
      const port = createHttpMapLibrary(f);
      const operation =
        method === 'list'
          ? port.list('owned', controller.signal)
          : method === 'read'
            ? port.read(item.ref, controller.signal)
            : port.save(intent(), controller.signal);
      await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
      expect(f).not.toHaveBeenCalled();
    },
  );

  it('aborts a pending body promptly even if cancellation never acknowledges, removes listeners and releases its lock', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    f.mockResolvedValueOnce(
      new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    );
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const operation = createHttpMapLibrary(f).list('owned', controller.signal);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(f.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it('cancels a late fetch body after abort, without accepting a stale save or requesting a receipt', async () => {
    const pending = deferred<Response>();
    f.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const operation = createHttpMapLibrary(f).save(intent(), controller.signal);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    const source = stream([bytes(JSON.stringify(item))]);
    pending.resolve(source.response);
    await vi.waitFor(() => expect(source.cancel).toHaveBeenCalledOnce());
    expect(f).toHaveBeenCalledOnce();
  });

  it.each(['fetch', 'body'])(
    'times out noncooperating %s at30s and settles timers/reader cleanup',
    async (waiting) => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      let body: ReadableStream<Uint8Array> | undefined;
      if (waiting === 'fetch') f.mockReturnValueOnce(new Promise<Response>(() => {}));
      else {
        body = new ReadableStream<Uint8Array>({ cancel });
        f.mockResolvedValueOnce(
          new Response(body, { headers: { 'Content-Type': 'application/json' } }),
        );
      }
      const operation = createHttpMapLibrary(f).list('owned', signal());
      const rejection = expect(operation).rejects.toMatchObject({ kind: 'timeout' });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(vi.getTimerCount()).toBe(0);
      expect(f.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      if (body) {
        expect(cancel).toHaveBeenCalledOnce();
        expect(body.locked).toBe(false);
      }
    },
  );

  it('bounds PUT and same-key receipt as separate30s phases without a second PUT', async () => {
    vi.useFakeTimers();
    f.mockImplementation(() => new Promise<Response>(() => {}));
    const operation = createHttpMapLibrary(f).save(intent(), signal());
    const rejection = expect(operation).rejects.toMatchObject({ kind: 'pending' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.mock.calls.map((call) => call[1]!.method)).toEqual(['PUT', 'GET']);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reconcile a conflicting409 whose body times out, even when a success could follow', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    f.mockResolvedValueOnce(new Response(body, { status: 409 })).mockResolvedValueOnce(json(item));
    const operation = createHttpMapLibrary(f).save(intent(), signal());
    const rejection = expect(operation).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(f).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an EOF/late caller abort rather than returning a parsed successful result', async () => {
    const controller = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (++pulls === 1)
          stream.enqueue(bytes(JSON.stringify({ schemaVersion: 1, items: [item] })));
        else {
          stream.close();
          controller.abort();
        }
      },
    });
    f.mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await expect(createHttpMapLibrary(f).list('owned', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(body.locked).toBe(false);
  });
  it('rejects a late full-hash result after read abort, even when the bytes and identity match', async () => {
    const pending = deferred<ArrayBuffer>();
    const digest = vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(pending.promise);
    f.mockResolvedValueOnce(stream([bytes(canonicalJson)], readHeaders()).response);
    const controller = new AbortController();
    const operation = createHttpMapLibrary(f).read(item.ref, controller.signal);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
    pending.resolve(
      Uint8Array.from(item.assetIdentity.match(/../g)!, (part) => parseInt(part, 16)).buffer,
    );
    await pending.promise;
    expect(f).toHaveBeenCalledOnce();
  });

  it('cancels a late receipt response after the owner aborts reconciliation', async () => {
    const pending = deferred<Response>();
    f.mockRejectedValueOnce(new Error('lost PUT')).mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const operation = createHttpMapLibrary(f).save(intent(), controller.signal);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    controller.abort();
    await rejection;
    const source = stream([bytes(JSON.stringify(item))]);
    pending.resolve(source.response);
    await vi.waitFor(() => expect(source.cancel).toHaveBeenCalledOnce());
    expect(f.mock.calls.map((call) => call[1]!.method)).toEqual(['PUT', 'GET']);
  });
});
