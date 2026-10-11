import { HARD_LIMITS, OverrideSchema, type MapOverride, type Point } from './contract.js';
import { fail } from './errors.js';
import { preflightAsset } from './resources.js';

/** Stable recipe slots; neither seed, anchor nor name participates in identity. */
export function placeId(kind: 'village' | 'farm', ordinal: number): string {
  if (
    !['village', 'farm'].includes(kind) ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= (kind === 'village' ? 32 : 64)
  )
    throw new RangeError('Invalid stable place slot');
  return `site:${kind}:${String(ordinal).padStart(4, '0')}`;
}
export function resolveOverrides(overrides: MapOverride[], siteIds: Iterable<string>) {
  if (!Array.isArray(overrides) || overrides.length > 256)
    fail('$.overrides', 'Expected at most 256 ordered overrides', 'RESOURCE_LIMIT');
  preflightAsset(overrides, { ...HARD_LIMITS });
  const known = new Set(siteIds),
    names = new Map<string, string>(),
    anchors = new Map<string, Point>();
  const exclusions: Extract<MapOverride, { kind: 'exclude-sites' }>[] = [];
  const exclusionIds = new Set<string>();
  for (const [i, raw] of overrides.entries()) {
    const result = OverrideSchema.safeParse(raw);
    if (!result.success) fail(`$.overrides[${i}]`, 'Invalid override');
    const o = result.data;
    if (o.kind === 'exclude-sites') {
      if (exclusionIds.has(o.id)) fail(`$.overrides[${i}].id`, 'Duplicate exclusion ID');
      exclusionIds.add(o.id);
      exclusions.push(o);
    } else {
      if (!known.has(o.siteId)) fail(`$.overrides[${i}].siteId`, 'Unknown stable place ID');
      if (o.kind === 'rename') names.set(o.siteId, o.name);
      else anchors.set(o.siteId, o.anchor);
    }
  }
  return { names, anchors, exclusions };
}
export function deriveSeed(rootSeed: number, stage: string, featureId = ''): number {
  if (
    !Number.isSafeInteger(rootSeed) ||
    rootSeed < 0 ||
    !/^[A-Za-z0-9:_+.-]{1,128}$/.test(stage) ||
    !/^[A-Za-z0-9:_+.-]{0,128}$/.test(featureId)
  )
    throw new RangeError('Invalid stage-stream seed key');
  const key = `fnv1a-stage-v1|${rootSeed}|${stage.length}:${stage}|${featureId.length}:${featureId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return hash || 1;
}
