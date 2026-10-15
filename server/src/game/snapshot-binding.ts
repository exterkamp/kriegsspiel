import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertBattlefieldBudget } from '@kriegsspiel/protocol';
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
