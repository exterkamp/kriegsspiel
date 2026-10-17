import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertBattlefieldBudget } from '@kriegsspiel/protocol';
import type { GameState } from '@kriegsspiel/engine';
import { loadScenarioById } from './registry.js';
import { engineTerrainIdentity } from './battlefield.js';
import { headerPin } from './pinned-header.js';
import { nativeCanonicalJson } from './native-scenario-pin.js';
import type { GameSnapshot, InputLogHeader } from './store.js';

const binding = z
  .object({
    format: z.literal(1),
    headerIdentity: z.string().regex(/^native-input-header-v1:sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type NativeSnapshotBinding = z.infer<typeof binding>;
export function decodeSnapshotBinding(value: unknown): NativeSnapshotBinding {
  assertBattlefieldBudget(value, 1024);
  return binding.parse(value);
}
/** Includes settings and allocation identity, not only the terrain digest. */
export function snapshotBinding(header: InputLogHeader): NativeSnapshotBinding | undefined {
  if (!headerPin(header)) return undefined;
  return {
    format: 1,
    headerIdentity: `native-input-header-v1:sha256:${createHash('sha256').update(nativeCanonicalJson(header)).digest('hex')}`,
  };
}
export function assertSnapshotHeader(
  snapshot: GameSnapshot,
  header: InputLogHeader | undefined,
  gameId: string,
): void {
  if (header) headerPin(header, gameId);
  const expected = header ? snapshotBinding(header) : undefined;
  const marked = Object.hasOwn(snapshot, 'battlefield');
  if (!expected && !marked) return;
  if (
    !expected ||
    !marked ||
    decodeSnapshotBinding(snapshot.battlefield).headerIdentity !== expected.headerIdentity
  )
    throw new Error('Snapshot contradicts pinned input header');
}

/** Historical recovery is a positively identified bridge header/world, never marker absence alone. */
export function assertHistoricalWorld(
  header: InputLogHeader | undefined,
  world: GameState,
  gameId: string,
): void {
  if (
    !header ||
    headerPin(header) ||
    header.gameId !== gameId ||
    !z.number().int().min(0).max(0xffff_ffff).safeParse(header.seed).success ||
    header.scenarioId !== 'hold-the-bridge' ||
    world.scenarioId !== header.scenarioId ||
    world.seed !== header.seed
  )
    throw new Error('Unsupported or contradictory historical game header');
  const known = loadScenarioById(header.scenarioId);
  const statics = {
    map: world.map,
    sides: world.sides,
    victory: world.victory,
    startStrength: world.startStrength ?? null,
  };
  assertBattlefieldBudget(statics, 1024 * 1024);
  if (
    engineTerrainIdentity(world.map) !== engineTerrainIdentity(known.map) ||
    nativeCanonicalJson(world.sides) !== nativeCanonicalJson(known.sides) ||
    nativeCanonicalJson(world.victory) !== nativeCanonicalJson(known.victory) ||
    nativeCanonicalJson(world.startStrength) !== nativeCanonicalJson(known.startStrength) ||
    (world.dial ?? 'standard') !== (header.settings?.dial ?? known.dial ?? 'standard')
  )
    throw new Error('Recovered world contradicts supported historical bridge');
}
