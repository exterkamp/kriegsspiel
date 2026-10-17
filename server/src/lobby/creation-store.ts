import { randomInt, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { assertBattlefieldBudget } from '@kriegsspiel/protocol';
import { SqliteAuthStore } from '../auth/store.js';
import {
  decodeNativeScenarioPin,
  nativeCanonicalJson,
  type NativeScenarioPinV1,
} from '../game/native-scenario-pin.js';
import { SqliteLobbyStore, type LobbyGame } from './store.js';
import {
  CreationDefaultsSchema,
  creationDefaults,
  creationIntentFingerprint,
  decodeCreationRequest,
  normalizeCreationIntent,
  validateNewCreationIntent,
  type CreationDefaults,
  type CreationIntent,
  type CreationRequest,
} from './creation-intent.js';

const RECEIPT_BYTES = 2 * 1024 * 1024;
const ownerId = z.string().min(1).max(128);
const operationId = z.uuid();
export type CreationState = 'reserved' | 'lobby' | 'started' | 'tombstone';
export interface CreationReceipt {
  schemaVersion: 1;
  receiptId: string;
  originalOwnerId: string;
  ownerId: string;
  requestId: string;
  gameId: string;
  createdAtMs: number;
  state: CreationState;
  originalRequest: CreationRequest;
  defaults: CreationDefaults;
  intent: CreationIntent;
  fingerprint: string;
  pin: NativeScenarioPinV1;
  /**
   * The game's own dice (#534): the request's seed, or one drawn once when the receipt is
   * accepted, so a retry or later activation plays the same game. Server-only, like the pin.
   */
  seed: number;
  activationError?: string;
}
export interface PinnedCreationLobby extends LobbyGame {
  creationFormat: 1;
  creationReceiptId: string;
  battlefieldPin: NativeScenarioPinV1;
}
export class CreationStoreError extends Error {
  constructor(
    readonly code: string,
    readonly gameIds: readonly string[] = [],
  ) {
    super(code);
  }
}
const envelope = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: operationId,
    originalOwnerId: ownerId,
    ownerId,
    requestId: operationId,
    gameId: operationId,
    createdAtMs: z.number().int().min(0),
    state: z.enum(['reserved', 'lobby', 'started', 'tombstone']),
    originalRequest: z.unknown(),
    defaults: z.unknown(),
    intent: z.unknown(),
    fingerprint: z.string().regex(/^game-creation-intent-v1:sha256:[a-f0-9]{64}$/),
    pin: z.unknown(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
    activationError: z.string().min(1).max(128).optional(),
  })
  .strict();

function decodeReceipt(value: unknown): CreationReceipt {
  assertBattlefieldBudget(value, RECEIPT_BYTES);
  const row = envelope.parse(value);
  const originalRequest = decodeCreationRequest(row.originalRequest);
  if (originalRequest.requestId !== row.requestId)
    throw new CreationStoreError('corrupt_creation_receipt');
  const defaults = CreationDefaultsSchema.parse(row.defaults);
  const intent = normalizeCreationIntent(originalRequest, defaults);
  const pin = decodeNativeScenarioPin(row.pin);
  if (
    nativeCanonicalJson(intent) !== nativeCanonicalJson(row.intent) ||
    creationIntentFingerprint(intent) !== row.fingerprint ||
    pin.publicScenarioId !== intent.scenario ||
    pin.battlefield.pairing.id !== intent.pairing.pairingId ||
    pin.battlefield.pairing.revision !== intent.pairing.revision ||
    (intent.seed !== undefined && intent.seed !== row.seed) ||
    nativeCanonicalJson(defaults.sides) !==
      nativeCanonicalJson(
        pin.initialWorld.sides.map((side) => ({ id: side.id, controller: side.controller })),
      )
  )
    throw new CreationStoreError('corrupt_creation_receipt');
  return { ...row, originalRequest, defaults, intent, pin };
}

export function creationLobby(receipt: CreationReceipt): PinnedCreationLobby {
  const intent = receipt.intent;
  return {
    id: receipt.gameId,
    scenario: intent.scenario,
    rate: intent.rate,
    sessionType: intent.sessionType,
    creator: receipt.ownerId,
    status: 'lobby',
    ready: [],
    createdAtMs: receipt.createdAtMs,
    hierarchy: intent.hierarchy,
    umpire: {
      dial: intent.dial,
      persona: intent.persona,
      ...(intent.mode === 'turns'
        ? {
            mode: 'turns' as const,
            turnMinutes: intent.turnMinutes!,
            ...(intent.turnDeadlineHours === null
              ? {}
              : { turnDeadlineHours: intent.turnDeadlineHours }),
          }
        : {}),
    },
    ...(intent.pause === null
      ? {}
      : {
          pause: {
            rule: intent.pause.rule,
            voteTimeoutMs: intent.pause.voteTimeoutMs,
            holdMs: intent.pause.holdMs,
            holdsPerPlayer: intent.pause.holdsPerPlayer,
            holdsPerGame: intent.pause.holdsPerGame,
            ...(intent.pause.maxPauseMs === null ? {} : { maxPauseMs: intent.pause.maxPauseMs }),
          },
        }),
    seed: receipt.seed,
    creationFormat: 1,
    creationReceiptId: receipt.receiptId,
    battlefieldPin: receipt.pin,
  };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS creation_receipts (
    receipt_id TEXT PRIMARY KEY,
    original_owner_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    game_id TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL,
    body TEXT NOT NULL,
    UNIQUE (original_owner_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS creation_receipts_owner_key ON creation_receipts (owner_id, request_id);
`;
interface ReceiptRow {
  receipt_id: string;
  original_owner_id: string;
  owner_id: string;
  request_id: string;
  game_id: string;
  created_at_ms: number;
  state: string;
  body_bytes: number;
  safe_body: string | null;
}
const COLUMNS = `receipt_id, original_owner_id, owner_id, request_id, game_id, created_at_ms, state,
  length(CAST(body AS BLOB)) AS body_bytes,
  CASE WHEN length(CAST(body AS BLOB)) <= ${RECEIPT_BYTES} THEN body ELSE NULL END AS safe_body`;

/**
 * Receipt/seat/lobby unit of work only. Actor activation is deliberately outside
 * its synchronous transaction. API/adoption integration is a separate gate.
 */
export class SqliteCreationStore {
  readonly database: DatabaseSync;
  readonly auth: SqliteAuthStore;
  readonly lobby: SqliteLobbyStore;
  readonly durable: boolean;
  private readonly ownsDatabase: boolean;
  private failedTransaction = false;

  constructor(
    database: string | DatabaseSync,
    private readonly clock: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    /** Each game its own seed (#534) when the request names none; as `AppOptions.newSeed`. */
    private readonly newSeed: () => number = () => randomInt(0, 2 ** 32),
  ) {
    this.ownsDatabase = typeof database === 'string';
    this.database = typeof database === 'string' ? new DatabaseSync(database) : database;
    if (this.ownsDatabase)
      this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(SCHEMA);
    this.lobby = new SqliteLobbyStore(this.database);
    this.auth = new SqliteAuthStore(this.database, {
      adoptGuest: (from, to) => {
        if (!this.auth.getUser(from)?.guest || !this.auth.getUser(to) || from === to)
          throw new CreationStoreError('invalid_adoption');
        this.lobby.reassignUser(from, to);
        for (const receipt of this.ownedReceipts(from))
          this.updateReceipt({ ...receipt, ownerId: to });
      },
      deleteUser: (id) => {
        this.lobby.forgetUser(id);
        for (const receipt of this.ownedReceipts(id))
          this.updateReceipt({
            ...receipt,
            ownerId: `removed:${receipt.receiptId}`,
            state: 'tombstone',
          });
      },
    });
    const location = this.database.prepare('PRAGMA database_list').get() as { file?: unknown };
    this.durable = typeof location.file === 'string' && location.file.length > 0;
  }

  private transaction<T>(run: () => T): T {
    if (this.failedTransaction) throw new CreationStoreError('creation_recovery_required');
    if (this.database.isTransaction)
      throw new CreationStoreError('creation_transaction_already_active');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) {
        try {
          this.database.exec('ROLLBACK');
        } catch (rollbackError) {
          this.failedTransaction = true;
          throw new AggregateError(
            [error, rollbackError],
            'Creation transaction requires recovery',
          );
        }
      }
      throw error;
    }
  }

  private read(row: ReceiptRow): CreationReceipt {
    try {
      if (row.safe_body === null || row.body_bytes > RECEIPT_BYTES)
        throw new Error('Oversized receipt');
      const value = decodeReceipt(JSON.parse(row.safe_body));
      if (
        value.receiptId !== row.receipt_id ||
        value.originalOwnerId !== row.original_owner_id ||
        value.ownerId !== row.owner_id ||
        value.requestId !== row.request_id ||
        value.gameId !== row.game_id ||
        value.createdAtMs !== row.created_at_ms ||
        value.state !== row.state
      )
        throw new Error('Receipt index mismatch');
      return value;
    } catch {
      throw new CreationStoreError('corrupt_creation_receipt');
    }
  }

  private ownedReceipts(owner: string): CreationReceipt[] {
    return (
      this.database
        .prepare(`SELECT ${COLUMNS} FROM creation_receipts WHERE owner_id = ? ORDER BY receipt_id`)
        .all(owner) as unknown as ReceiptRow[]
    ).map((row) => this.read(row));
  }

  private updateReceipt(receipt: CreationReceipt): CreationReceipt {
    const checked = decodeReceipt(receipt);
    this.database
      .prepare(
        'UPDATE creation_receipts SET owner_id = ?, state = ?, body = ? WHERE receipt_id = ? AND game_id = ?',
      )
      .run(
        checked.ownerId,
        checked.state,
        JSON.stringify(checked),
        checked.receiptId,
        checked.gameId,
      );
    return checked;
  }

  /** Server-only identity lookup; never expose this unscoped body through an API. */
  forGame(gameId: string): CreationReceipt | undefined {
    if (this.failedTransaction) throw new CreationStoreError('creation_recovery_required');
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM creation_receipts WHERE game_id = ?`)
      .get(gameId) as ReceiptRow | undefined;
    return row && this.read(row);
  }

  /** Commit activation status using current ownership, which may have changed during actor startup. */
  activationResult(gameId: string, started: boolean): CreationReceipt {
    return this.transaction(() => {
      const receipt = this.forGame(gameId);
      if (!receipt || receipt.state === 'tombstone')
        throw new CreationStoreError('request_removed');
      const record = this.lobby.get(gameId) as PinnedCreationLobby | undefined;
      if (
        !record ||
        record.creator !== receipt.ownerId ||
        record.creationReceiptId !== receipt.receiptId ||
        record.creationFormat !== 1 ||
        decodeNativeScenarioPin(record.battlefieldPin).pinIdentity !== receipt.pin.pinIdentity
      )
        throw new CreationStoreError('creation_recovery_required');
      const accepted = { ...receipt };
      delete accepted.activationError;
      if (started) {
        this.lobby.put({ ...record, status: 'started' });
        return this.updateReceipt({ ...accepted, state: 'started' });
      }
      if (receipt.state === 'started') return receipt;
      return this.updateReceipt({ ...accepted, activationError: 'activation_failed' });
    });
  }

  lookup(owner: string, requestId: string): CreationReceipt | undefined {
    if (this.failedTransaction) throw new CreationStoreError('creation_recovery_required');
    ownerId.parse(owner);
    operationId.parse(requestId);
    if (!this.auth.getUser(owner)) return undefined;
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM creation_receipts WHERE owner_id = ? AND request_id = ? ORDER BY receipt_id LIMIT 2`,
      )
      .all(owner, requestId) as unknown as ReceiptRow[];
    const receipts = rows.map((row) => this.read(row));
    if (receipts.length > 1)
      throw new CreationStoreError(
        'request_ambiguous',
        receipts.map((receipt) => receipt.gameId),
      );
    return receipts[0];
  }

  /** No latest catalog/default/limit callback is consulted for an accepted identical retry. */
  reserve(
    owner: string,
    value: unknown,
    plan: (request: CreationRequest) => {
      defaultPin: NativeScenarioPinV1;
      selectedPin: NativeScenarioPinV1;
      aiAvailable: boolean;
    },
    checkNewLimit: () => void = () => undefined,
  ): CreationReceipt {
    ownerId.parse(owner);
    const request = decodeCreationRequest(value);
    if (!request.requestId) throw new CreationStoreError('request_id_required');
    return this.transaction(() => {
      if (!this.auth.getUser(owner)) throw new CreationStoreError('not_signed_in');
      const existing = this.lookup(owner, request.requestId!);
      if (existing) {
        if (existing.state === 'tombstone')
          throw new CreationStoreError('request_removed', [existing.gameId]);
        if (
          creationIntentFingerprint(normalizeCreationIntent(request, existing.defaults)) !==
          existing.fingerprint
        )
          throw new CreationStoreError('request_conflict', [existing.gameId]);
        return existing;
      }
      const proposal = plan(request);
      const defaults = creationDefaults(
        decodeNativeScenarioPin(proposal.defaultPin),
        proposal.aiAvailable,
      );
      const intent = normalizeCreationIntent(request, defaults);
      validateNewCreationIntent(intent, defaults);
      const pin = decodeNativeScenarioPin(proposal.selectedPin);
      if (
        pin.publicScenarioId !== intent.scenario ||
        pin.battlefield.pairing.id !== intent.pairing.pairingId ||
        pin.battlefield.pairing.revision !== intent.pairing.revision
      )
        throw new CreationStoreError('invalid_battlefield');
      checkNewLimit();
      const receipt = decodeReceipt({
        schemaVersion: 1,
        receiptId: this.newId(),
        gameId: this.newId(),
        originalOwnerId: owner,
        ownerId: owner,
        requestId: request.requestId,
        createdAtMs: this.clock(),
        state: intent.lobby ? 'lobby' : 'reserved',
        originalRequest: request,
        defaults,
        intent,
        fingerprint: creationIntentFingerprint(intent),
        pin,
        seed: intent.seed ?? this.newSeed(),
      });
      if (this.lobby.get(receipt.gameId) || this.auth.seatsOf(receipt.gameId).length)
        throw new CreationStoreError('game_id_conflict');
      const record = creationLobby(receipt);
      if (intent.sessionType !== 'hot_seat' && !this.auth.claimSeat(record.id, intent.side, owner))
        throw new CreationStoreError('seat_failed');
      this.lobby.put(record);
      this.database
        .prepare(
          `INSERT INTO creation_receipts (receipt_id, original_owner_id, owner_id, request_id, game_id, created_at_ms, state, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          receipt.receiptId,
          receipt.originalOwnerId,
          receipt.ownerId,
          receipt.requestId,
          receipt.gameId,
          receipt.createdAtMs,
          receipt.state,
          JSON.stringify(receipt),
        );
      return receipt;
    });
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}
