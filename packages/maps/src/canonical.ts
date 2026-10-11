import { PRECISION_POLICY, type MapAsset } from './contract.js';
import { parseAsset } from './import.js';

function ordered(value: unknown, path: string): unknown {
  if (typeof value === 'number')
    return Object.is(value, -0) ? 0 : Number.isInteger(value) ? value : Number(value.toFixed(6));
  if (Array.isArray(value)) {
    const array = value.map((v, i) => ordered(v, `${path}[${i}]`));
    if (/^\$\.layers\.[A-Za-z]+$|\.entrances$/.test(path))
      array.sort((a, b) => {
        const x = (a as { id: string }).id,
          y = (b as { id: string }).id;
        return x < y ? -1 : x > y ? 1 : 0;
      });
    else if (/\.(routeIds|roadIds|crossingIds|outlets)$/.test(path))
      array.sort((a, b) =>
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a) < String(b)
            ? -1
            : String(a) > String(b)
              ? 1
              : 0,
      );
    return array;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered((value as Record<string, unknown>)[key], `${path}.${key}`)]),
    );
  return value;
}
function normalized(asset: MapAsset): MapAsset {
  const parsed = parseAsset(asset);
  // Quantization must not silently collapse a ring, seam, span or reference.
  return parseAsset(ordered(parsed, '$'));
}
export function canonicalizeAsset(asset: MapAsset): string {
  return JSON.stringify(ordered(normalized(asset), '$'));
}
export function canonicalGeometry(asset: MapAsset): string {
  const a = normalized(asset);
  const layers = structuredClone(a.layers);
  for (const site of layers.sites) {
    delete (site as Partial<typeof site>).name;
    delete (site as Partial<typeof site>).population;
  }
  for (const b of layers.buildings) {
    delete (b as Partial<typeof b>).capacity;
    delete (b as Partial<typeof b>).residents;
  }
  for (const landmark of layers.landmarks) delete (landmark as Partial<typeof landmark>).name;
  return JSON.stringify(
    ordered(
      {
        schema: a.schema,
        schemaVersion: a.schemaVersion,
        precisionPolicy: PRECISION_POLICY,
        coordinates: a.coordinates,
        bounds: a.bounds,
        elevation: a.elevation,
        drainage: a.drainage,
        layers,
      },
      '$',
    ),
  );
}
export function canonicalRecipe(asset: MapAsset): string {
  const a = normalized(asset);
  return JSON.stringify(
    ordered(
      {
        schemaVersion: a.schemaVersion,
        precisionPolicy: a.precisionPolicy,
        coordinates: a.coordinates,
        provenance: a.provenance,
        settings: a.settings,
        overrides: a.overrides.filter((o) => o.kind !== 'rename'),
      },
      '$',
    ),
  );
}
export async function assetIdentity(
  asset: MapAsset,
  kind: 'asset' | 'geometry' | 'recipe' = 'geometry',
): Promise<string> {
  const text =
    kind === 'geometry'
      ? canonicalGeometry(asset)
      : kind === 'recipe'
        ? canonicalRecipe(asset)
        : kind === 'asset'
          ? canonicalizeAsset(asset)
          : (() => {
              throw new TypeError('Unknown identity kind');
            })();
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
