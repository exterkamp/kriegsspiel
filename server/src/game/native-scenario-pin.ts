import { createHash } from 'node:crypto';
import { loadScenario, type GameState } from '@kriegsspiel/engine';
import {
  ApprovedBattlefieldSchema,
  BATTLEFIELD_LIMITS,
  assertBattlefieldBudget,
  decodeApprovedBattlefield,
  isIntegerMillimetres,
  type ApprovedBattlefield,
} from '@kriegsspiel/protocol';
import { z } from 'zod';
import { describeDefaultBattlefield } from './battlefield.js';

export const NATIVE_ASSEMBLY_VERSION = 'engine-native-v1' as const;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/);
const text = z.string().min(1).max(160);
const finite = z.number().finite();
const length = finite.positive().max(20_000).refine(isIntegerMillimetres);
const coord = finite.min(0).max(20_000).refine(isIntegerMillimetres);
const point = z.object({ x: coord, y: coord }).strict();
const vertex = z.tuple([coord, coord]);
const vertices = z.array(vertex).min(2).max(1024);
const featureBase = {
  id,
  name: text.optional(),
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
  layer: z.number().int().min(-1024).max(1024).optional(),
  moveCost: finite.min(0.01).max(10_000).optional(),
  cover: finite.min(0).max(1).optional(),
  concealment: finite.min(0).max(1).optional(),
  height: z.enum(['low', 'flat', 'rise', 'high']).optional(),
  passable: z.boolean().optional(),
  roadClass: z.enum(['highway', 'road', 'track']).optional(),
  capacity: length.optional(),
  risk: finite.min(0).max(1).optional(),
};
const feature = z.union([
  z.object({ ...featureBase, polygon: vertices.min(3) }).strict(),
  z.object({ ...featureBase, polyline: vertices, width: length }).strict(),
  z.object({ ...featureBase, at: point, radius: length }).strict(),
]);

/** Deliberate bounded subset of native authored inputs; unsupported fields fail, never disappear. */
const RawNativeScenario = z
  .object({
    id,
    name: text.optional(),
    seed: z.number().int().min(0).max(0xffff_ffff),
    map: z
      .object({ width: length.min(1), height: length.min(1), features: z.array(feature).max(128) })
      .strict(),
    sides: z
      .array(
        z
          .object({
            id: z.enum(['blue', 'red']),
            name: text,
            controller: z.enum(['human', 'scripted']),
            hq: point,
            depots: z.array(point).max(16).optional(),
          })
          .strict(),
      )
      .length(2),
    units: z
      .array(
        z
          .object({
            id,
            side: z.enum(['blue', 'red']),
            name: text,
            type: id.optional(),
            kind: z.enum(['infantry', 'cavalry', 'artillery']).optional(),
            at: point,
            facingDeg: finite.min(-360).max(360),
            formation: z.enum(['line', 'column', 'square', 'skirmish', 'loose']).optional(),
            strength: z.number().int().min(1).max(1_000_000),
            morale: z.number().int().min(0).max(100),
            commander: text.optional(),
            trait: z.string().min(1).max(1024).optional(),
            personality: z.array(id).max(16).optional(),
            frontage: length.optional(),
            depth: length.optional(),
            shape: z
              .array(
                z.tuple([
                  finite.min(-20_000).max(20_000).refine(isIntegerMillimetres),
                  finite.min(-20_000).max(20_000).refine(isIntegerMillimetres),
                ]),
              )
              .min(1)
              .max(64)
              .optional(),
          })
          .strict(),
      )
      .min(2)
      .max(128),
    victory: z
      .object({
        objective: vertices.min(3),
        defender: z.enum(['blue', 'red']),
        attacker: z.enum(['blue', 'red']),
        holdMinutes: z.number().int().min(1).max(10_080),
        takeMinutes: z.number().int().min(0).max(10_080).optional(),
      })
      .strict(),
  })
  .strict();

type RawScenario = z.infer<typeof RawNativeScenario>;
export interface NativeScenarioPinV1 {
  readonly schemaVersion: 1;
  readonly assemblyVersion: typeof NATIVE_ASSEMBLY_VERSION;
  readonly publicScenarioId: string;
  readonly battlefield: ApprovedBattlefield;
  readonly rawScenario: RawScenario;
  readonly initialWorld: GameState;
  readonly pinIdentity: string;
}

/** Recursive key sorting only; no array sorting, coercion, rounding or omitted fields. */
export function nativeCanonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const fields = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(fields)
        .sort()
        .map((key) => [key, fields[key]]),
    );
  });
}
const digest = (domain: string, value: unknown) =>
  `${domain}:sha256:${createHash('sha256').update(nativeCanonicalJson(value)).digest('hex')}`;

function parsedRaw(value: unknown): RawScenario {
  assertBattlefieldBudget(value, BATTLEFIELD_LIMITS.pinBytes);
  const raw = RawNativeScenario.parse(value);
  let points = 0;
  for (const f of raw.map.features)
    points += 'at' in f ? 1 : 'polygon' in f ? f.polygon.length : f.polyline.length;
  if (points > BATTLEFIELD_LIMITS.pointsPerMap)
    throw new Error('Native terrain exceeds point budget');
  const placements =
    raw.units.reduce((sum, unit) => sum + (unit.shape?.length ?? 1) + 4, 0) +
    raw.sides.reduce((sum, side) => sum + 1 + (side.depots?.length ?? 0), 0);
  if (placements * Math.max(1, points) > 2_000_000)
    throw new Error('Native scenario exceeds placement work budget');
  return raw;
}

function describe(
  raw: RawScenario,
  world: GameState,
  input: { scenarioId: string; pairingId: string; name: string; isDefault: boolean },
): ApprovedBattlefield {
  const legacy = describeDefaultBattlefield(world, input.name);
  const map = {
    ...legacy.map,
    id: input.pairingId,
    source: input.isDefault ? ('scenario-default' as const) : ('included' as const),
  };
  const identity = {
    scenarioId: input.scenarioId,
    resolvedScenarioId: raw.id,
    scenarioRevision: legacy.pairing.scenarioRevision,
    terrainIdentity: map.terrainIdentity,
    assemblyVersion: NATIVE_ASSEMBLY_VERSION,
    mapId: map.id,
    pairingId: input.pairingId,
  };
  return decodeApprovedBattlefield(
    {
      map,
      pairing: {
        id: input.pairingId,
        revision: digest('engine-pairing-v1', identity),
        scenarioId: input.scenarioId,
        resolvedScenarioId: raw.id,
        scenarioRevision: identity.scenarioRevision,
        terrainIdentity: identity.terrainIdentity,
        assemblyVersion: NATIVE_ASSEMBLY_VERSION,
      },
      isDefault: input.isDefault,
    },
    input.scenarioId,
  );
}

export function createNativeScenarioPin(input: {
  rawScenario: unknown;
  scenarioId: string;
  pairingId: string;
  name: string;
  isDefault: boolean;
}): NativeScenarioPinV1 {
  const rawScenario = parsedRaw(input.rawScenario);
  const initialWorld = loadScenario(rawScenario);
  const battlefield = describe(rawScenario, initialWorld, input);
  const body = {
    schemaVersion: 1 as const,
    assemblyVersion: NATIVE_ASSEMBLY_VERSION,
    publicScenarioId: input.scenarioId,
    battlefield,
    rawScenario,
    initialWorld,
  };
  const pin = { ...body, pinIdentity: digest('engine-native-pin-v1', body) };
  assertBattlefieldBudget(pin, BATTLEFIELD_LIMITS.pinBytes);
  return pin;
}

const PinEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    assemblyVersion: z.literal(NATIVE_ASSEMBLY_VERSION),
    publicScenarioId: id,
    battlefield: ApprovedBattlefieldSchema,
    rawScenario: z.unknown(),
    initialWorld: z.unknown(),
    pinIdentity: z.string().regex(/^engine-native-pin-v1:sha256:[a-f0-9]{64}$/),
  })
  .strict();

/** Durable decoder: engine validation plus exact redundant-world/public/digest agreement. */
export function decodeNativeScenarioPin(value: unknown): NativeScenarioPinV1 {
  assertBattlefieldBudget(value, BATTLEFIELD_LIMITS.pinBytes);
  const stored = PinEnvelope.parse(value);
  const raw = parsedRaw(stored.rawScenario);
  const world = loadScenario(raw);
  if (nativeCanonicalJson(world) !== nativeCanonicalJson(stored.initialWorld))
    throw new Error('Native initial-world pin mismatch');
  const expected = createNativeScenarioPin({
    rawScenario: raw,
    scenarioId: stored.publicScenarioId,
    pairingId: stored.battlefield.pairing.id,
    name: stored.battlefield.map.name,
    isDefault: stored.battlefield.isDefault,
  });
  if (nativeCanonicalJson(expected) !== nativeCanonicalJson(stored))
    throw new Error('Native battlefield pin identity mismatch');
  return expected;
}
