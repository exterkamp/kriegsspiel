import {
  AssetSchema,
  BoundsSchema,
  HARD_LIMITS,
  utf8Bytes,
  type MapAsset,
} from '@kriegsspiel/maps';
import { checkJson } from '../../legacy/map-authoring/generation/protocol';

export interface LibraryAssetInput {
  canonicalJson: string;
  assetIdentity: string;
  widthM: number;
  heightM: number;
  /** Optional certified-port asset that must canonicalize to these same bytes in the worker. */
  candidate?: MapAsset;
}
export interface AssetCheckRequest {
  v: 1;
  type: 'verify-library-asset';
  requestId: string;
  byteLength: number;
  input: LibraryAssetInput;
}
export type AssetCheckResponse =
  | {
      v: 1;
      type: 'verified';
      requestId: string;
      inputDigest: string;
      byteLength: number;
      widthM: number;
      heightM: number;
      asset: MapAsset;
    }
  | { v: 1; type: 'failed'; requestId: string | null; code: 'MAP_UNAVAILABLE' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const brokenUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const abortError = () => new DOMException('The map check was aborted.', 'AbortError');
export class LibraryAssetCheckError extends Error {
  constructor(readonly kind: 'invalid' | 'unavailable' | 'timeout') {
    super(
      kind === 'timeout'
        ? 'Checking this map took too long. Please try again.'
        : 'This map could not be checked. Please try again.',
    );
    this.name = 'LibraryAssetCheckError';
  }
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw new Error('Invalid fields');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('Invalid field');
    result[key] = descriptor.value;
  }
  return result;
}
function snapshot(value: unknown): { input: LibraryAssetInput; byteLength: number } {
  const hasCandidate = !!value && typeof value === 'object' && Object.hasOwn(value, 'candidate');
  const data = fields(value, [
    'canonicalJson',
    'assetIdentity',
    'widthM',
    'heightM',
    ...(hasCandidate ? ['candidate'] : []),
  ]);
  if (
    typeof data['canonicalJson'] !== 'string' ||
    !data['canonicalJson'].length ||
    data['canonicalJson'].length > HARD_LIMITS.maxBytes ||
    brokenUnicode.test(data['canonicalJson']) ||
    typeof data['assetIdentity'] !== 'string' ||
    !hash.test(data['assetIdentity'])
  )
    throw new Error('Invalid input');
  const bounds = BoundsSchema.parse({
    minX: 0,
    minY: 0,
    maxX: data['widthM'],
    maxY: data['heightM'],
  });
  const byteLength = utf8Bytes(data['canonicalJson']);
  if (byteLength > HARD_LIMITS.maxBytes) throw new Error('Too large');
  const input: LibraryAssetInput = {
    canonicalJson: data['canonicalJson'],
    assetIdentity: data['assetIdentity'],
    widthM: bounds.maxX,
    heightM: bounds.maxY,
  };
  if (hasCandidate) input.candidate = detachedShape(data['candidate'], input);
  return { input, byteLength };
}

/** Trusted same-origin worker boundary: JSON/structural checks and a detached schema clone ONLY.
 * checkJson bounds raw bytes/depth/nodes. AssetSchema has no topology/certification refinements.
 * Do not replace this with parseAsset/canonicalizeAsset/hash: those repeat the worker's heavy work.
 */
function detachedShape(value: unknown, input: LibraryAssetInput): MapAsset {
  checkJson(value);
  const raw = value as {
    layers?: Record<string, unknown>;
    overrides?: unknown[];
    elevation?: { samples?: unknown[] };
    drainage?: Record<string, unknown>;
  };
  if (!raw?.layers || typeof raw.layers !== 'object') throw new Error('Invalid layers');
  let features = 0;
  for (const layer of Object.values(raw.layers)) {
    if (!Array.isArray(layer) || layer.length > HARD_LIMITS.maxFeatures)
      throw new Error('Invalid layer');
    features += layer.length;
  }
  // Reuse the current aggregate feature/entrance/override budget without geometry tests.
  const sites = raw.layers['sites'];
  if (Array.isArray(sites))
    for (const site of sites) {
      const entrances: unknown =
        site && typeof site === 'object' ? (site as { entrances?: unknown }).entrances : undefined;
      if (Array.isArray(entrances)) features += entrances.length;
    }
  if (Array.isArray(raw.overrides))
    features += raw.overrides.filter(
      (value) => value && typeof value === 'object' && Object.hasOwn(value, 'id'),
    ).length;
  if (features > HARD_LIMITS.maxFeatures) throw new Error('Too many features');
  let samples = 0;
  for (const array of [
    raw.elevation?.samples,
    raw.drainage?.['filledSamples'],
    raw.drainage?.['downstream'],
    raw.drainage?.['accumulation'],
  ]) {
    if (!Array.isArray(array)) continue;
    if (array.length > HARD_LIMITS.maxSamples) throw new Error('Too many samples');
    samples += array.length;
  }
  if (samples > HARD_LIMITS.maxSampleValues) throw new Error('Too many sample values');
  const asset = AssetSchema.parse(value);
  if (
    asset.bounds.maxX !== input.widthM ||
    asset.bounds.maxY !== input.heightM ||
    asset.settings.widthM !== input.widthM ||
    asset.settings.heightM !== input.heightM
  )
    throw new Error('Wrong dimensions');
  return asset;
}

/** Unused until reviewed integration: one fresh module worker per verification lifetime. */
export async function verifyLibraryAsset(
  value: LibraryAssetInput,
  signal: AbortSignal,
  workerFactory: () => Worker = () =>
    new Worker(new URL('./asset-check.worker.ts', import.meta.url), { type: 'module' }),
): Promise<MapAsset> {
  if (signal.aborted) throw abortError();
  let captured: ReturnType<typeof snapshot>;
  let requestId: string;
  try {
    captured = snapshot(value);
    requestId = crypto.randomUUID();
    if (!uuid.test(requestId)) throw new Error('Invalid correlation');
  } catch {
    throw new LibraryAssetCheckError('invalid');
  }
  if (signal.aborted) throw abortError();
  const { input, byteLength } = captured;
  const result = await new Promise<MapAsset>((resolve, reject) => {
    let worker: Worker | undefined;
    let done = false;
    const attached: Array<['message' | 'error' | 'messageerror', EventListener]> = [];
    const deadline = Date.now() + 30_000;
    const terminate = (resource: Worker) => {
      try {
        resource.terminate();
      } catch {
        /* Attempt ownership release exactly once. */
      }
    };
    const finish = (error?: unknown, asset?: MapAsset) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const owned = worker;
      worker = undefined;
      if (owned) {
        for (const [type, listener] of attached) {
          try {
            owned.removeEventListener(type, listener);
          } catch {
            /* Continue cleanup. */
          }
        }
        terminate(owned);
      }
      if (signal.aborted) reject(abortError());
      else if (error || !asset) reject(error ?? new LibraryAssetCheckError('unavailable'));
      else resolve(asset);
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new LibraryAssetCheckError('timeout')), 30_000);
    const alive = () => !done && !signal.aborted;
    const message: EventListener = (event) => {
      if (!alive()) return;
      try {
        if (Date.now() >= deadline) {
          finish(new LibraryAssetCheckError('timeout'));
          return;
        }
        const data: unknown = (event as MessageEvent<unknown>).data;
        const type =
          data && typeof data === 'object'
            ? (Object.getOwnPropertyDescriptor(data, 'type')?.value as unknown)
            : undefined;
        if (type === 'failed') {
          const failed = fields(data, ['v', 'type', 'requestId', 'code']);
          if (
            failed['v'] !== 1 ||
            failed['requestId'] !== requestId ||
            failed['code'] !== 'MAP_UNAVAILABLE'
          )
            throw new Error('Invalid failure');
          finish(new LibraryAssetCheckError('unavailable'));
          return;
        }
        const reply = fields(data, [
          'v',
          'type',
          'requestId',
          'inputDigest',
          'byteLength',
          'widthM',
          'heightM',
          'asset',
        ]);
        if (
          reply['v'] !== 1 ||
          reply['type'] !== 'verified' ||
          reply['requestId'] !== requestId ||
          reply['inputDigest'] !== input.assetIdentity ||
          reply['byteLength'] !== byteLength ||
          reply['widthM'] !== input.widthM ||
          reply['heightM'] !== input.heightM
        )
          throw new Error('Invalid response binding');
        const asset = detachedShape(reply['asset'], input);
        if (Date.now() >= deadline) finish(new LibraryAssetCheckError('timeout'));
        else finish(undefined, asset);
      } catch {
        finish(new LibraryAssetCheckError('unavailable'));
      }
    };
    const failed: EventListener = (event) => {
      event.preventDefault();
      finish(new LibraryAssetCheckError('unavailable'));
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const created = workerFactory();
      // Factory code may synchronously abort/reenter before handing back its resource.
      if (!alive()) {
        terminate(created);
        return;
      }
      worker = created;
      if (Date.now() >= deadline) {
        finish(new LibraryAssetCheckError('timeout'));
        return;
      }
      for (const [type, listener] of [
        ['message', message],
        ['error', failed],
        ['messageerror', failed],
      ] as const) {
        if (!alive()) return;
        attached.push([type, listener]);
        created.addEventListener(type, listener);
      }
      if (alive())
        created.postMessage({
          v: 1,
          type: 'verify-library-asset',
          requestId,
          byteLength,
          input: { ...input },
        } satisfies AssetCheckRequest);
    } catch {
      finish(new LibraryAssetCheckError('unavailable'));
    }
  });
  if (signal.aborted) throw abortError();
  return result;
}
