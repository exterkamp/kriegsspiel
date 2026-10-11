import {
  parseAsset,
  MapValidationError,
  type MapAsset,
  type ValidationIssue,
} from '@kriegsspiel/maps';

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type PreviewAsset = DeepReadonly<MapAsset>;
export type AssetLoadResult =
  { ok: true; asset: PreviewAsset } | { ok: false; issues: ValidationIssue[] };

/** Detached contract-valid snapshot. This makes no composition-certification claim. */
export function loadPreviewAsset(input: unknown): AssetLoadResult {
  try {
    return { ok: true, asset: freeze(parseAsset(input)) };
  } catch (error) {
    if (error instanceof MapValidationError) return { ok: false, issues: error.issues };
    throw error;
  }
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
