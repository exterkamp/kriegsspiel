import { HARD_LIMITS, utf8Bytes, type MapAsset } from '@kriegsspiel/maps';
import { verifyLibraryAsset } from './asset-check';
import type { LibraryAssetVerifier } from './http';
const cancelled = () => new DOMException('Map preparation cancelled', 'AbortError');
/** Full identity is SHA256 of exact canonical UTF8 bytes. Candidate agreement/certification stay in the worker. */
export async function verifyPreparedLibraryAsset(
  candidate: MapAsset,
  canonicalJson: string,
  signal: AbortSignal,
  verifier: LibraryAssetVerifier = verifyLibraryAsset,
): Promise<{ asset: MapAsset; assetIdentity: string }> {
  if (signal.aborted) throw cancelled();
  if (
    typeof canonicalJson !== 'string' ||
    !canonicalJson.length ||
    canonicalJson.length > HARD_LIMITS.maxBytes ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(canonicalJson) ||
    utf8Bytes(canonicalJson) > HARD_LIMITS.maxBytes
  )
    throw new Error('Map export exceeds its valid byte boundary');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson));
  if (signal.aborted) throw cancelled();
  const assetIdentity = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const asset = await verifier(
    {
      canonicalJson,
      assetIdentity,
      widthM: candidate.bounds.maxX,
      heightM: candidate.bounds.maxY,
      candidate,
    },
    signal,
  );
  if (signal.aborted) throw cancelled();
  return { asset, assetIdentity };
}
