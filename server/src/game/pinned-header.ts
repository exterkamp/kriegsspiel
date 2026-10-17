import type { GameState } from '@kriegsspiel/engine';
import {
  assertBattlefieldBudget,
  DIALS,
  PERSONAS,
  GAME_MODES,
  MIN_TURN_MINUTES,
  MAX_TURN_MINUTES,
  MIN_TURN_DEADLINE_HOURS,
  MAX_TURN_DEADLINE_HOURS,
} from '@kriegsspiel/protocol';
import { z } from 'zod';
import {
  decodeNativeScenarioPin,
  nativeCanonicalJson,
  type NativeScenarioPinV1,
} from './native-scenario-pin.js';
import { engineTerrainIdentity } from './battlefield.js';
import { loadScenarioById } from './registry.js';
import type { InputLogHeader } from './store.js';

const settings = z
  .object({
    dial: z.enum(DIALS),
    persona: z.enum(PERSONAS),
    mode: z.enum(GAME_MODES).optional(),
    turnMinutes: z.number().int().min(MIN_TURN_MINUTES).max(MAX_TURN_MINUTES).optional(),
    turnDeadlineHours: z
      .number()
      .finite()
      .min(MIN_TURN_DEADLINE_HOURS)
      .max(MAX_TURN_DEADLINE_HOURS)
      .optional(),
  })
  .strict();
const id = z.string().min(1).max(128);
const NativeHeader = z
  .object({
    gameId: id,
    scenarioId: id,
    seed: z.number().int().min(0).max(0xffff_ffff),
    settings: settings.optional(),
    rules: z.number().int().min(1).max(1024).optional(),
    battlefieldFormat: z.literal(1),
    battlefieldPin: z.unknown(),
    creationReceiptId: z.uuid().optional(),
  })
  .strict();

/**
 * Presence of either field forbids the historical scenario-only fallback. The header's seed is the
 * game's own (#534) and need not be the pinned scenario's authored seed: the pin retains the
 * authored time-zero world and replay re-seeds it from the header, as it does an unpinned game.
 */
export function headerPin(
  header: InputLogHeader,
  expectedGameId?: string,
): NativeScenarioPinV1 | undefined {
  const modern =
    Object.hasOwn(header, 'battlefieldFormat') ||
    Object.hasOwn(header, 'battlefieldPin') ||
    Object.hasOwn(header, 'creationReceiptId');
  if (!modern) return undefined;
  assertBattlefieldBudget(header, 2 * 1024 * 1024);
  const parsed = NativeHeader.parse(header);
  const pin = decodeNativeScenarioPin(parsed.battlefieldPin);
  if (
    parsed.gameId !== (expectedGameId ?? parsed.gameId) ||
    parsed.scenarioId !== pin.initialWorld.scenarioId
  )
    throw new Error('Pinned input header identity mismatch');
  return pin;
}

/** Memory and durable stores retain detached headers; malformed new-format records fail closed. */
export function detachedInputHeader(header: InputLogHeader): InputLogHeader {
  const pin = headerPin(header);
  return pin
    ? { ...structuredClone(header), battlefieldFormat: 1, battlefieldPin: pin }
    : structuredClone(header);
}

export function initialWorldFromHeader(header: InputLogHeader, expectedGameId?: string): GameState {
  const pin = headerPin(header, expectedGameId);
  return pin ? structuredClone(pin.initialWorld) : loadScenarioById(header.scenarioId);
}

/** Compare only immutable assembly fields: unit positions and runtime state legitimately evolve. */
export function assertPinnedWorld(
  header: InputLogHeader,
  world: GameState,
  expectedGameId?: string,
): void {
  const pin = headerPin(header, expectedGameId);
  if (!pin) return;
  const statics = {
    map: world.map,
    sides: world.sides,
    victory: world.victory,
    startStrength: world.startStrength ?? null,
  };
  assertBattlefieldBudget(statics, 1024 * 1024);
  if (
    world.scenarioId !== header.scenarioId ||
    world.seed !== header.seed ||
    engineTerrainIdentity(world.map) !== pin.battlefield.map.terrainIdentity ||
    nativeCanonicalJson(world.sides) !== nativeCanonicalJson(pin.initialWorld.sides) ||
    nativeCanonicalJson(world.victory) !== nativeCanonicalJson(pin.initialWorld.victory) ||
    nativeCanonicalJson(world.startStrength) !==
      nativeCanonicalJson(pin.initialWorld.startStrength) ||
    (world.dial ?? 'standard') !== (header.settings?.dial ?? pin.initialWorld.dial ?? 'standard')
  )
    throw new Error('Recovered world contradicts pinned scenario');
}
