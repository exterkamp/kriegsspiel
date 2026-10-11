import { AssetSchema, SCHEMA_VERSION, type ImportLimits, type MapAsset } from './contract.js';
import { fail, MapValidationError } from './errors.js';
import { limitsFrom, preflightAsset, utf8Bytes } from './resources.js';
export { utf8Bytes, type ResourceUsage } from './resources.js';
import { validateAssetTopology, validateSettings } from './validation.js';

export function parseAsset(input: unknown, options: Partial<ImportLimits> = {}): MapAsset {
  const limits = limitsFrom(options);
  const usage = preflightAsset(input, limits);
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    fail('$', 'Expected map object');
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== SCHEMA_VERSION)
    fail(
      '$.schemaVersion',
      `Unsupported version; expected ${SCHEMA_VERSION}`,
      'UNSUPPORTED_VERSION',
    );
  // Apply lower recipe budgets before Zod clones arrays or topology runs.
  const declared = (raw.settings as { limits?: Record<string, unknown> } | undefined)?.limits;
  for (const key of ['maxSamples', 'maxFeatures', 'maxVertices'] as const) {
    const requested = declared?.[key];
    const observed =
      usage[key === 'maxSamples' ? 'samples' : key === 'maxFeatures' ? 'features' : 'vertices'];
    if (typeof requested === 'number' && requested > 0 && observed > requested)
      fail(
        `$.settings.limits.${key}`,
        `Observed ${observed} exceeds recipe cap ${requested}`,
        'RESOURCE_LIMIT',
      );
  }
  const parsed = AssetSchema.safeParse(input);
  if (!parsed.success)
    throw new MapValidationError(
      parsed.error.issues.slice(0, 32).map((i) => ({
        code: i.code,
        path:
          '$' + i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join(''),
        message: i.message,
      })),
    );
  validateSettings(parsed.data.settings);
  validateAssetTopology(
    parsed.data,
    Math.min(limits.maxTopologyChecks, parsed.data.settings.limits.maxTopologyChecks),
  );
  return parsed.data;
}
export function importAsset(text: string, options: Partial<ImportLimits> = {}): MapAsset {
  const limits = limitsFrom(options);
  if (typeof text !== 'string') throw new TypeError('Map import requires JSON text');
  if (text.length > limits.maxBytes || utf8Bytes(text) > limits.maxBytes)
    fail('$', `Import exceeds ${limits.maxBytes} bytes`, 'RESOURCE_LIMIT');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('$', 'Malformed JSON', 'INVALID_JSON');
  }
  return parseAsset(value, options);
}
