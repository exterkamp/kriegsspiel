import { z } from 'zod';
import type { GameState } from '@kriegsspiel/engine';
import { decodeApprovedBattlefield, type ApprovedBattlefield } from '@kriegsspiel/protocol';
import {
  decodeNativeScenarioPin,
  nativeCanonicalJson,
  type NativeScenarioPinV1,
} from '../game/native-scenario-pin.js';
import { headerPin } from '../game/pinned-header.js';
import type { InputLogHeader } from '../game/store.js';
import { loadScenarioById } from '../game/registry.js';
import type { LobbyGame } from './store.js';
import { creationLobby, type CreationReceipt } from './creation-store.js';

export function lobbyPin(record: LobbyGame): NativeScenarioPinV1 | undefined {
  const value = record as LobbyGame & {
    creationFormat?: unknown;
    creationReceiptId?: unknown;
    battlefieldPin?: unknown;
  };
  if (
    !['creationFormat', 'creationReceiptId', 'battlefieldPin'].some((key) =>
      Object.hasOwn(value, key),
    )
  )
    return undefined;
  if (value.creationFormat !== 1 || !z.uuid().safeParse(value.creationReceiptId).success)
    throw new Error('Invalid pinned lobby allocation');
  const pin = decodeNativeScenarioPin(value.battlefieldPin);
  if (pin.publicScenarioId !== record.scenario) throw new Error('Pinned lobby scenario mismatch');
  return pin;
}
export function lobbyWorld(record: LobbyGame): GameState {
  return lobbyPin(record)?.initialWorld ?? loadScenarioById(record.scenario);
}
/** Reconcile all immutable allocation copies; never infer readiness from public terrain alone. */
export function assertLobbyAllocation(
  record: LobbyGame,
  receipt: CreationReceipt | undefined,
  header?: InputLogHeader,
): void {
  const pin = lobbyPin(record);
  if (!pin) {
    if (receipt || (header && headerPin(header)))
      throw new Error('Missing pinned lobby allocation');
    return;
  }
  const identity = record as LobbyGame & { creationReceiptId: string };
  if (
    !receipt ||
    (receipt.state === 'tombstone' &&
      (record.status !== 'started' || receipt.retiredOwnerGuest !== false)) ||
    (record.status === 'started') !==
      (receipt.state === 'started' || receipt.state === 'tombstone') ||
    receipt.gameId !== record.id ||
    (receipt.state === 'tombstone' ? receipt.retiredOwnerId : receipt.ownerId) !== record.creator ||
    receipt.receiptId !== identity.creationReceiptId ||
    receipt.pin.pinIdentity !== pin.pinIdentity ||
    receipt.intent.scenario !== record.scenario ||
    receipt.intent.rate !== record.rate ||
    receipt.intent.sessionType !== record.sessionType ||
    receipt.intent.hierarchy !== (record.hierarchy ?? 'shared')
  )
    throw new Error('Pinned receipt/lobby mismatch');
  const expected = creationLobby(receipt);
  for (const key of [
    'id',
    'scenario',
    'rate',
    'sessionType',
    'creator',
    'createdAtMs',
    'hierarchy',
    'pause',
    'umpire',
    'creationFormat',
    'creationReceiptId',
  ] as const) {
    if (
      nativeCanonicalJson((record as unknown as Record<string, unknown>)[key] ?? null) !==
      nativeCanonicalJson(expected[key] ?? null)
    )
      throw new Error('Pinned lobby intent mismatch');
  }
  if (record.status === 'started' && !header) throw new Error('Missing pinned input header');
  if (
    header &&
    (header.gameId !== record.id ||
      header.creationReceiptId !== receipt.receiptId ||
      headerPin(header, record.id)?.pinIdentity !== pin.pinIdentity ||
      nativeCanonicalJson(header.settings ?? null) !== nativeCanonicalJson(record.umpire ?? null))
  )
    throw new Error('Pinned header/lobby mismatch');
}
export function publicLobbyBattlefield(record: LobbyGame): ApprovedBattlefield | undefined {
  const pin = lobbyPin(record);
  return pin && decodeApprovedBattlefield(pin.battlefield, record.scenario);
}
