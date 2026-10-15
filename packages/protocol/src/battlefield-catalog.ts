import { z } from 'zod';

/** Initial native catalog budgets. These do not authorize canonical-map conversion. */
export const BATTLEFIELD_LIMITS = {
  idChars: 128,
  nameChars: 160,
  maxExtentM: 20_000,
  features: 128,
  pointsPerGeometry: 1024,
  pointsPerMap: 4096,
  pairings: 16,
  descriptorBytes: 64 * 1024,
  scenariosBytes: 256 * 1024,
  pinBytes: 1024 * 1024,
  depth: 32,
  values: 65_536,
} as const;

/** Iterative resource gate before recursive schemas, cloning, or digest work. */
export function assertBattlefieldBudget(value: unknown, maxBytes: number): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let values = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++values > BATTLEFIELD_LIMITS.values || item.depth > BATTLEFIELD_LIMITS.depth)
      throw new Error('Battlefield exceeds structural limits');
    const v = item.value;
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('Battlefield contains a nonfinite number');
    } else if (typeof v === 'string') {
      if (v.length > maxBytes) throw new Error('Battlefield exceeds byte limit');
    } else if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('Battlefield must contain detached JSON values');
      seen.add(v);
      const entries = Array.isArray(v) ? v : Object.values(v);
      if (entries.length > BATTLEFIELD_LIMITS.values - values - stack.length)
        throw new Error('Battlefield exceeds structural limits');
      for (const entry of entries) stack.push({ value: entry, depth: item.depth + 1 });
    } else throw new Error('Battlefield must contain JSON values');
  }
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error('Battlefield exceeds byte limit');
}

const id = z
  .string()
  .min(1)
  .max(BATTLEFIELD_LIMITS.idChars)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/);
const name = z
  .string()
  .min(1)
  .max(BATTLEFIELD_LIMITS.nameChars)
  .refine((value) => value.trim().length > 0);
const millimetres = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.000001;
const length = z
  .number()
  .finite()
  .positive()
  .max(BATTLEFIELD_LIMITS.maxExtentM)
  .refine(millimetres);
const coordinate = z
  .number()
  .finite()
  .min(0)
  .max(BATTLEFIELD_LIMITS.maxExtentM)
  .refine(millimetres);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const points = z.array(point).max(BATTLEFIELD_LIMITS.pointsPerGeometry);
const geometry = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('polygon'), points: points.min(3) }).strict(),
  z.object({ shape: z.literal('polyline'), points: points.min(2), widthM: length }).strict(),
  z.object({ shape: z.literal('point'), at: point, radiusM: length }).strict(),
]);
const feature = z
  .object({
    id,
    name: name.optional(),
    kind: z.enum([
      'field',
      'wood',
      'marsh',
      'water',
      'road',
      'river',
      'stream',
      'bridge',
      'ford',
      'building',
    ]),
    layer: z.number().int().min(-1024).max(1024),
    geometry,
  })
  .strict();
const terrainIdentity = z.string().regex(/^engine-terrain-v1:sha256:[a-f0-9]{64}$/);
const scenarioRevision = z.string().regex(/^engine-scenario-v1:sha256:[a-f0-9]{64}$/);
const pairingRevision = z.string().regex(/^engine-pairing-v1:sha256:[a-f0-9]{64}$/);

export const NativeBattlefieldMapSchema = z
  .object({
    id,
    name,
    source: z.enum(['scenario-default', 'included', 'owned']),
    terrainIdentity,
    widthM: length.min(1),
    heightM: length.min(1),
    preview: z.array(feature).max(BATTLEFIELD_LIMITS.features),
  })
  .strict()
  .superRefine((map, ctx) => {
    const ids = new Set<string>();
    let count = 0;
    const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
    for (const f of map.preview) {
      if (ids.has(f.id)) problem('Duplicate battlefield feature ID');
      ids.add(f.id);
      const g = f.geometry;
      const locations = g.shape === 'point' ? [g.at] : g.points;
      count += locations.length;
      if (locations.some((p) => p.x > map.widthM || p.y > map.heightM))
        problem('Battlefield geometry lies outside extent');
      const span = g.shape === 'point' ? g.radiusM : g.shape === 'polyline' ? g.widthM : 0;
      if (span > Math.max(map.widthM, map.heightM))
        problem('Battlefield width or radius exceeds extent');
    }
    if (count > BATTLEFIELD_LIMITS.pointsPerMap) problem('Battlefield exceeds total point budget');
  });

export const ApprovedBattlefieldPairingSchema = z
  .object({
    id,
    revision: pairingRevision,
    scenarioId: id,
    resolvedScenarioId: id,
    scenarioRevision,
    terrainIdentity,
    assemblyVersion: z.literal('engine-native-v1'),
  })
  .strict();

export const ApprovedBattlefieldSchema = z
  .object({
    map: NativeBattlefieldMapSchema,
    pairing: ApprovedBattlefieldPairingSchema,
    isDefault: z.boolean(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.map.terrainIdentity !== entry.pairing.terrainIdentity)
      ctx.addIssue({ code: 'custom', message: 'Battlefield terrain identity mismatch' });
    if (entry.map.id !== entry.pairing.id)
      ctx.addIssue({ code: 'custom', message: 'Battlefield map/pairing ID mismatch' });
    if ((entry.map.source === 'scenario-default') !== entry.isDefault)
      ctx.addIssue({ code: 'custom', message: 'Battlefield default designation mismatch' });
  });

export const BattlefieldCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: id,
    entries: z.array(ApprovedBattlefieldSchema).min(1).max(BATTLEFIELD_LIMITS.pairings),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    for (const entry of catalog.entries) {
      if (entry.pairing.scenarioId !== catalog.scenarioId)
        ctx.addIssue({ code: 'custom', message: 'Foreign scenario battlefield' });
      if (ids.has(entry.pairing.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate battlefield pairing ID' });
      ids.add(entry.pairing.id);
    }
    if (catalog.entries.filter((entry) => entry.isDefault).length !== 1)
      ctx.addIssue({ code: 'custom', message: 'Exactly one default battlefield is required' });
  });

export type NativeBattlefieldMap = z.infer<typeof NativeBattlefieldMapSchema>;
export type ApprovedBattlefieldPairing = z.infer<typeof ApprovedBattlefieldPairingSchema>;
export type ApprovedBattlefield = z.infer<typeof ApprovedBattlefieldSchema>;
export type BattlefieldCatalog = z.infer<typeof BattlefieldCatalogSchema>;

/** Validates public transport only. Approval/availability still require server registry resolution. */
export function decodeApprovedBattlefield(
  value: unknown,
  parentScenarioId: string,
): ApprovedBattlefield {
  assertBattlefieldBudget(value, BATTLEFIELD_LIMITS.descriptorBytes);
  const entry = ApprovedBattlefieldSchema.parse(value);
  if (entry.pairing.scenarioId !== parentScenarioId)
    throw new Error('Foreign scenario battlefield');
  return entry;
}

export function decodeBattlefieldCatalog(
  value: unknown,
  parentScenarioId: string,
): BattlefieldCatalog {
  assertBattlefieldBudget(value, BATTLEFIELD_LIMITS.scenariosBytes);
  const catalog = BattlefieldCatalogSchema.parse(value);
  if (catalog.scenarioId !== parentScenarioId)
    throw new Error('Foreign scenario battlefield catalog');
  for (const entry of catalog.entries)
    assertBattlefieldBudget(entry, BATTLEFIELD_LIMITS.descriptorBytes);
  return catalog;
}
