import { InjectionToken } from '@angular/core';
import { verifyLibraryAsset } from '../../../shared/lobby-map-library/asset-check';
import type { LibraryAssetVerifier } from '../../../shared/lobby-map-library/http';

export type { LibraryAssetVerifier } from '../../../shared/lobby-map-library/http';

/** Production always verifies with the trusted same-origin module worker.
 * Overrides are trusted embedding/test code, never unchecked port data.
 */
export const MAP_LIBRARY_ASSET_VERIFIER = new InjectionToken<LibraryAssetVerifier>(
  'library asset verifier',
  { providedIn: 'root', factory: () => verifyLibraryAsset },
);
