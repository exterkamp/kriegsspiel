import { assetIdentity, canonicalizeAsset, importAsset, parseAsset } from '@kriegsspiel/maps';
import type { LibraryAssetVerifier } from './asset-verifier';

/** Test-only replacement for the previous UI checks on public reference fixtures.
 * Performs real parsing/exact canonical/full-hash/NW/dimension/candidate checks;
 * it does not claim current complete certification. Production never imports it.
 */
export const checkLibraryAssetForTest: LibraryAssetVerifier = async (value, signal) => {
  const current = () => {
    if (signal.aborted) throw new DOMException('Map check aborted', 'AbortError');
  };
  current();
  const asset = importAsset(value.canonicalJson);
  if (
    canonicalizeAsset(asset) !== value.canonicalJson ||
    asset.bounds.minX !== 0 ||
    asset.bounds.minY !== 0 ||
    asset.bounds.maxX !== value.widthM ||
    asset.bounds.maxY !== value.heightM ||
    asset.settings.widthM !== value.widthM ||
    asset.settings.heightM !== value.heightM ||
    (await assetIdentity(asset, 'asset')) !== value.assetIdentity
  )
    throw new Error('Map bytes, identity or dimensions mismatch');
  current();
  const candidate = value.candidate === undefined ? undefined : parseAsset(value.candidate);
  if (candidate && canonicalizeAsset(candidate) !== value.canonicalJson)
    throw new Error('Candidate does not match exact map bytes');
  current();
  // Reproduce the former UI parseAsset(candidate) result, including fixture array
  // order. Exact candidate canonical equality is still mandatory above.
  return candidate ?? asset;
};
