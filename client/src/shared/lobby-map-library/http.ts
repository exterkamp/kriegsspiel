import { decodeLibraryMapSummary, decodeLibraryPage } from '@kriegsspiel/protocol';
import { verifyLibraryAsset, type LibraryAssetInput } from './asset-check';
import type { LibraryMapSummary, MapLibraryPort } from './contracts';

const assetType = 'application/vnd.kriegsspiel.map+json';
const assetLimit = 64 * 1024 * 1024;
const summaryLimit = 4096;
const pageLimit = 32768;
const duration = 30_000;
type Kind =
  | 'invalid'
  | 'sign-in'
  | 'reload'
  | 'missing'
  | 'conflict'
  | 'restart-list'
  | 'pending'
  | 'timeout'
  | 'unavailable';
const messages: Record<Kind, string> = {
  invalid: 'The map details could not be checked. Please try again.',
  'sign-in': 'Sign in to access your maps.',
  reload: 'Reload to access the map library.',
  missing: 'This map is unavailable. Please try again.',
  conflict: 'This save could not be confirmed. Keep this map and retry the same save.',
  'restart-list': 'The map list could not be loaded. Restart the list and try again.',
  pending: 'This map may already be saved. Retry Save map to recover the same map.',
  timeout: 'Loading the map took too long. Please try again.',
  unavailable: 'The map library is unavailable. Please try again.',
};
export class MapLibraryHttpError extends Error {
  constructor(
    readonly kind: Kind,
    readonly status?: number,
  ) {
    super(messages[kind]);
    this.name = 'MapLibraryHttpError';
  }
}
const abortError = () => new DOMException('The request was aborted.', 'AbortError');
const allowedHeaders = new Set([
  'x-map-kind',
  'x-map-id',
  'x-map-name',
  'x-map-identity',
  'x-map-width-m',
  'x-map-height-m',
  'x-map-created-at-ms',
]);
function httpError(status?: number, listing = false): MapLibraryHttpError {
  return new MapLibraryHttpError(
    status === 401 || status === 403
      ? 'sign-in'
      : status === 426
        ? 'reload'
        : status === 404
          ? 'missing'
          : status === 409
            ? 'conflict'
            : status === 400 && listing
              ? 'restart-list'
              : 'unavailable',
    status,
  );
}
function discard(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}
function headersChecked(headers: Headers): void {
  for (const key of headers.keys())
    if (key.startsWith('x-map-') && !allowedHeaders.has(key)) throw new Error('Unknown metadata');
}
function media(headers: Headers, expected: string): void {
  const type = headers.get('content-type')?.toLowerCase();
  if (
    !type ||
    !new RegExp(
      `^${expected.replaceAll('.', '\\.').replaceAll('+', '\\+')}\\s*(?:;\\s*charset=utf-8)?$`,
    ).test(type)
  )
    throw new Error('Invalid content type');
}
/** Count exact UTF-8 without allocating another asset-sized buffer or replacing broken surrogates. */
function byteLength(value: string, limit: number): number {
  if (value.length > limit) throw new Error('Too large');
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Invalid text');
      bytes += 4;
    } else if (n >= 0xdc00 && n <= 0xdfff) throw new Error('Invalid text');
    else bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
    if (bytes > limit) throw new Error('Too large');
  }
  return bytes;
}
function reference(ref: LibraryMapSummary['ref']): LibraryMapSummary['ref'] {
  return decodeLibraryMapSummary({
    ref,
    name: 'Map',
    widthM: 1,
    heightM: 1,
    assetIdentity: '0'.repeat(64),
    status: 'needs-scenario',
    ...(ref?.kind === 'owned' ? { createdAtMs: 0 } : {}),
  }).ref;
}
function headerSummary(headers: Headers): LibraryMapSummary {
  const encodedName = headers.get('x-map-name');
  if (!encodedName || encodedName.length > 1920 || !/^[\x20-\x7e]+$/.test(encodedName))
    throw new Error('Invalid name');
  const number = (key: string): number => {
    const text = headers.get(key);
    if (!text || text.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text))
      throw new Error('Invalid number');
    return Number(text);
  };
  const created = headers.get('x-map-created-at-ms');
  if (created !== null && (created.length > 16 || !/^(?:0|[1-9]\d*)$/.test(created)))
    throw new Error('Invalid timestamp');
  return decodeLibraryMapSummary({
    ref: { kind: headers.get('x-map-kind'), id: headers.get('x-map-id') },
    name: decodeURIComponent(encodedName),
    assetIdentity: headers.get('x-map-identity'),
    widthM: number('x-map-width-m'),
    heightM: number('x-map-height-m'),
    status: 'needs-scenario',
    ...(created !== null ? { createdAtMs: Number(created) } : {}),
  });
}

/** A bounded, abortable phase covers fetch, body and verification, including late results. */
async function phase<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  caller: AbortSignal,
  limit: number,
  inspect: (response: Response) => void,
  consume: (
    response: Response,
    text: string,
    check: () => void,
    signal: AbortSignal,
  ) => Promise<T> | T,
  listing = false,
): Promise<T> {
  if (caller.aborted) throw abortError();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null = null;
  let consumed = false;
  let cancelled = false;
  let status: number | undefined;
  const deadline = Date.now() + duration;
  const cancel = () => {
    if (reader && !consumed && !cancelled) {
      cancelled = true;
      void reader.cancel().catch(() => {});
    }
  };
  let rejectAbort!: (value: unknown) => void;
  const aborted = new Promise<never>((_yes, no) => {
    rejectAbort = no;
  });
  void aborted.catch(() => {});
  const onAbort = () => {
    cancel();
    rejectAbort(controller.signal.reason);
  };
  const onCaller = () => controller.abort(abortError());
  controller.signal.addEventListener('abort', onAbort, { once: true });
  caller.addEventListener('abort', onCaller, { once: true });
  const expire = () => controller.abort(new MapLibraryHttpError('timeout', status));
  const timer = setTimeout(expire, duration);
  const check = () => {
    if (!controller.signal.aborted && Date.now() >= deadline) expire();
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const read = async (): Promise<T> => {
    const response = await fetcher(url, {
      ...init,
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    status = response.status;
    if (controller.signal.aborted) {
      discard(response.body);
      throw controller.signal.reason;
    }
    body = response.body;
    headersChecked(response.headers);
    if (response.ok) inspect(response);
    if (!body) throw httpError(status, listing);
    reader = body.getReader();
    const budget = response.ok ? limit : summaryLimit;
    let buffer = new Uint8Array(Math.min(budget, 65536));
    let length = 0;
    let chunks = 0;
    let empty = 0;
    for (;;) {
      const chunk = await reader.read();
      check();
      if (chunk.done) {
        consumed = true;
        break;
      }
      if (
        ++chunks > 1_000_000 ||
        !(chunk.value instanceof Uint8Array) ||
        chunk.value.byteLength > budget - length ||
        (chunk.value.byteLength === 0 && ++empty > 128)
      )
        throw httpError(status, listing);
      const needed = length + chunk.value.byteLength;
      if (needed > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(budget, Math.max(needed, buffer.byteLength * 2)));
        grown.set(buffer.subarray(0, length));
        buffer = grown;
      }
      buffer.set(chunk.value, length);
      length = needed;
    }
    // Preserve BOM characters so canonical asset byte equality cannot normalize them away.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, length),
    );
    check();
    if (!response.ok) throw httpError(status, listing);
    const result = await consume(response, text, check, controller.signal);
    check();
    return result;
  };
  try {
    const result = await Promise.race([read(), aborted]);
    check();
    return result;
  } catch (error) {
    if (caller.aborted) throw abortError();
    if (error instanceof MapLibraryHttpError) throw error;
    throw httpError(status, listing);
  } finally {
    clearTimeout(timer);
    caller.removeEventListener('abort', onCaller);
    controller.signal.removeEventListener('abort', onAbort);
    cancel();
    if (!reader && body) discard(body);
    reader?.releaseLock();
  }
}
function jsonHeaders(response: Response): void {
  media(response.headers, 'application/json');
}
function savedSummary(
  value: unknown,
  intent: { name: string; assetIdentity: string },
): LibraryMapSummary {
  const item = decodeLibraryMapSummary(value);
  if (
    item.ref.kind !== 'owned' ||
    item.name !== intent.name ||
    item.assetIdentity !== intent.assetIdentity
  )
    throw new MapLibraryHttpError('conflict');
  return item;
}

export type LibraryAssetVerifier = (
  value: LibraryAssetInput,
  signal: AbortSignal,
) => ReturnType<typeof verifyLibraryAsset>;

/** Same-origin transport. Read verification defaults to a fresh trusted module worker.
 * The optional verifier is a trusted embedding/test seam, not an untrusted validation bypass.
 * No session creation, generated keys, automatic PUT retry or capability.
 */
export function createHttpMapLibrary(
  fetcher: typeof fetch = fetch,
  verifier: LibraryAssetVerifier = verifyLibraryAsset,
): MapLibraryPort {
  return {
    async list(source, signal, cursor) {
      if (signal.aborted) throw abortError();
      if (
        (source !== 'included' && source !== 'owned') ||
        (cursor !== undefined &&
          (typeof cursor !== 'string' || !/^[A-Za-z0-9_.-]{1,512}$/.test(cursor)))
      )
        throw new MapLibraryHttpError('invalid');
      const query = `source=${source}${cursor !== undefined ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      return phase(
        fetcher,
        `/map-library/maps?${query}`,
        { method: 'GET' },
        signal,
        pageLimit,
        jsonHeaders,
        (response, text) => {
          if (response.status !== 200) throw new Error('Invalid page status');
          const page = decodeLibraryPage(JSON.parse(text), source);
          return {
            items: page.items,
            ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
          };
        },
        true,
      );
    },
    async read(ref, signal) {
      if (signal.aborted) throw abortError();
      let wanted: LibraryMapSummary['ref'];
      try {
        wanted = reference(ref);
      } catch {
        throw new MapLibraryHttpError('invalid');
      }
      let item: LibraryMapSummary;
      return phase(
        fetcher,
        `/map-library/maps/${wanted.kind}/${encodeURIComponent(wanted.id)}`,
        { method: 'GET' },
        signal,
        assetLimit,
        (response) => {
          if (response.status !== 200) throw new Error('Invalid read status');
          media(response.headers, assetType);
          item = headerSummary(response.headers);
          if (item.ref.kind !== wanted.kind || item.ref.id !== wanted.id)
            throw new Error('Foreign reference');
        },
        async (_response, canonicalJson, check, phaseSignal) => {
          check();
          await verifier(
            {
              canonicalJson,
              assetIdentity: item.assetIdentity,
              widthM: item.widthM,
              heightM: item.heightM,
            },
            phaseSignal,
          );
          check();
          return { item, canonicalJson };
        },
      );
    },
    async save(value, signal) {
      if (signal.aborted) throw abortError();
      let intent: { requestId: string; name: string; canonicalJson: string; assetIdentity: string };
      try {
        if (!value || Object.keys(value).length !== 4) throw new Error('Invalid intent');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key of ['requestId', 'name', 'canonicalJson', 'assetIdentity'])
          if (
            !descriptors[key] ||
            !('value' in descriptors[key]!) ||
            typeof descriptors[key]!.value !== 'string'
          )
            throw new Error('Invalid intent');
        intent = {
          requestId: descriptors['requestId']!.value as string,
          name: descriptors['name']!.value as string,
          canonicalJson: descriptors['canonicalJson']!.value as string,
          assetIdentity: descriptors['assetIdentity']!.value as string,
        };
        decodeLibraryMapSummary({
          ref: { kind: 'owned', id: intent.requestId },
          name: intent.name,
          assetIdentity: intent.assetIdentity,
          widthM: 1,
          heightM: 1,
          status: 'needs-scenario',
          createdAtMs: 0,
        });
        if (!byteLength(intent.canonicalJson, assetLimit)) throw new Error('Empty map');
      } catch {
        throw new MapLibraryHttpError('invalid');
      }
      if (signal.aborted) throw abortError();
      const url = `/map-library/saves/${encodeURIComponent(intent.requestId)}`;
      try {
        return await phase(
          fetcher,
          url,
          {
            method: 'PUT',
            headers: {
              'Content-Type': assetType,
              'X-Map-Name': encodeURIComponent(intent.name),
              'X-Map-Identity': intent.assetIdentity,
            },
            body: intent.canonicalJson,
          },
          signal,
          summaryLimit,
          jsonHeaders,
          (response, text) => {
            if (response.status !== 200 && response.status !== 201)
              throw new Error('Unresolved save');
            return savedSummary(JSON.parse(text), intent);
          },
        );
      } catch (error) {
        if (signal.aborted) throw abortError();
        // A conflict is never reconciled into a different successful intent.
        if (
          error instanceof MapLibraryHttpError &&
          (error.kind === 'conflict' ||
            (error.status !== undefined && error.status >= 400 && error.status < 500))
        )
          throw error;
      }
      try {
        return await phase(
          fetcher,
          url,
          { method: 'GET' },
          signal,
          summaryLimit,
          jsonHeaders,
          (response, text) => {
            if (response.status !== 200) throw new Error('Unresolved receipt');
            return savedSummary(JSON.parse(text), intent);
          },
        );
      } catch {
        if (signal.aborted) throw abortError();
        throw new MapLibraryHttpError('pending');
      }
    },
  };
}
