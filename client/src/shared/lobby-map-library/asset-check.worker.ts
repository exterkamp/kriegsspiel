import {
  BoundsSchema,
  HARD_LIMITS,
  assetIdentity,
  canonicalizeAsset,
  importAsset,
  parseAsset,
  utf8Bytes,
  validateBattlefield,
} from '@kriegsspiel/maps';
import type { AssetCheckResponse, LibraryAssetInput } from './asset-check';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable = (requestId: string | null): AssetCheckResponse => ({
  v: 1,
  type: 'failed',
  requestId,
  code: 'MAP_UNAVAILABLE',
});
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw new Error('Invalid fields');
  return Object.fromEntries(
    keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('Invalid field');
      return [key, descriptor.value];
    }),
  );
}
/** Pure message handler for tests; actual import/full-identity/current certification stay here. */
export async function verifyLibraryAssetMessage(value: unknown): Promise<AssetCheckResponse> {
  let requestId: string | null = null;
  try {
    const request = fields(value, ['v', 'type', 'requestId', 'byteLength', 'input']);
    if (typeof request['requestId'] !== 'string' || !uuid.test(request['requestId']))
      return unavailable(null);
    requestId = request['requestId'];
    if (request['v'] !== 1 || request['type'] !== 'verify-library-asset')
      throw new Error('Invalid envelope');
    const raw = request['input'];
    const hasCandidate = !!raw && typeof raw === 'object' && Object.hasOwn(raw, 'candidate');
    const data = fields(raw, [
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
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        data['canonicalJson'],
      ) ||
      typeof data['assetIdentity'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data['assetIdentity'])
    )
      throw new Error('Invalid input');
    const bounds = BoundsSchema.parse({
      minX: 0,
      minY: 0,
      maxX: data['widthM'],
      maxY: data['heightM'],
    });
    const input: LibraryAssetInput = {
      canonicalJson: data['canonicalJson'],
      assetIdentity: data['assetIdentity'],
      widthM: bounds.maxX,
      heightM: bounds.maxY,
    };
    const byteLength = utf8Bytes(input.canonicalJson);
    if (byteLength > HARD_LIMITS.maxBytes || byteLength !== request['byteLength'])
      throw new Error('Invalid size');
    const asset = importAsset(input.canonicalJson);
    if (hasCandidate && canonicalizeAsset(parseAsset(data['candidate'])) !== input.canonicalJson)
      throw new Error('Candidate does not match certified bytes');
    if (
      asset.bounds.minX !== 0 ||
      asset.bounds.minY !== 0 ||
      asset.bounds.maxX !== input.widthM ||
      asset.bounds.maxY !== input.heightM ||
      canonicalizeAsset(asset) !== input.canonicalJson
    )
      throw new Error('Invalid bytes or dimensions');
    const inputDigest = await assetIdentity(asset, 'asset');
    if (inputDigest !== input.assetIdentity || !validateBattlefield(asset).ok)
      throw new Error('Invalid identity or certification');
    return {
      v: 1,
      type: 'verified',
      requestId,
      inputDigest,
      byteLength,
      widthM: input.widthM,
      heightM: input.heightM,
      asset,
    };
  } catch {
    return unavailable(requestId);
  }
}

// Unlike Window, a module worker exposes importScripts (calling it is unnecessary).
// Structural scope typing keeps this entry testable without changing shared tsconfigs.
const scope = globalThis as unknown as {
  importScripts?: unknown;
  postMessage?: (value: AssetCheckResponse) => void;
  onmessage?: (event: MessageEvent<unknown>) => void;
};
if (typeof scope.importScripts === 'function' && typeof scope.postMessage === 'function') {
  let started = false;
  scope.onmessage = (event) => {
    if (started) {
      scope.postMessage!(unavailable(null));
      return;
    }
    started = true;
    void verifyLibraryAssetMessage(event.data)
      .then((value) => scope.postMessage!(value))
      .catch(() => scope.postMessage!(unavailable(null)));
  };
}
