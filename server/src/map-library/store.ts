import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { decodeLibraryMapSummary, type LibraryMapDescriptor } from '@kriegsspiel/protocol';
import type { AuthStore, AuthOwnershipParticipant } from '../auth/store.js';
import { LIBRARY_ASSET_BYTES, type ValidatedLibraryAsset } from './validation.js';
export class LibraryStoreError extends Error {
  constructor(
    readonly code: string,
    readonly mapIds: readonly string[] = [],
  ) {
    super(code);
  }
}
const operationId = z.uuid();
const SCHEMA = `CREATE TABLE IF NOT EXISTS library_meta (id TEXT PRIMARY KEY,version INTEGER NOT NULL);
 INSERT OR IGNORE INTO library_meta(id,version) VALUES ('map-library',1);
 CREATE TABLE IF NOT EXISTS library_operations (
 operation_id TEXT PRIMARY KEY,original_owner TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,
 asset_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,name TEXT,identity TEXT,width REAL,height REAL,created_at_ms INTEGER NOT NULL,
 UNIQUE(original_owner,request_id));
 CREATE INDEX IF NOT EXISTS library_owner_key ON library_operations(owner,request_id);
 CREATE INDEX IF NOT EXISTS library_owner_page ON library_operations(owner,state,created_at_ms DESC,asset_id DESC);
 CREATE TABLE IF NOT EXISTS library_assets(asset_id TEXT PRIMARY KEY,canonical_json TEXT NOT NULL);`;
type Row = {
  operation_id: string;
  owner: string;
  request_id: string;
  asset_id: string;
  state: string;
  name: string | null;
  identity: string | null;
  width: number | null;
  height: number | null;
  created_at_ms: number;
};
const columns = `operation_id,owner,request_id,
 CASE WHEN length(CAST(asset_id AS BLOB))<=128 THEN asset_id ELSE NULL END AS asset_id,state,
 CASE WHEN length(CAST(name AS BLOB))<=640 THEN name ELSE NULL END AS name,
 CASE WHEN length(CAST(identity AS BLOB))<=64 THEN identity ELSE NULL END AS identity,width,height,created_at_ms`;
const position = z
  .object({
    id: z.uuid(),
    createdAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export class LibraryCursors {
  private readonly secret = randomBytes(32);
  encode(owner: string, source: 'owned' | 'included', key: unknown): string {
    const payload = Buffer.from(JSON.stringify(key)).toString('base64url');
    return payload + '.' + this.mac(owner, source, payload);
  }
  private mac(owner: string, source: string, payload: string): string {
    return createHmac('sha256', this.secret)
      .update(owner)
      .update('\0')
      .update(source)
      .update('\0')
      .update(payload)
      .digest('hex');
  }
  decode(owner: string, source: 'owned' | 'included', cursor: string): unknown {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(cursor))
      throw new LibraryStoreError('restart_map_list');
    const [payload, mac] = cursor.split('.');
    if (
      !timingSafeEqual(
        Buffer.from(mac!, 'hex'),
        Buffer.from(this.mac(owner, source, payload!), 'hex'),
      )
    )
      throw new LibraryStoreError('restart_map_list');
    try {
      const bytes = Buffer.from(payload!, 'base64url');
      if (bytes.length > 256) throw new Error();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new LibraryStoreError('restart_map_list');
    }
  }
}
export const LIBRARY_QUOTAS = Object.freeze({
  guestMaps: 20,
  accountMaps: 100,
  guestBytes: 128 * 1024 * 1024,
  accountBytes: 512 * 1024 * 1024,
});
export interface LibraryQuotas {
  readonly guestMaps: number;
  readonly accountMaps: number;
  readonly guestBytes: number;
  readonly accountBytes: number;
}
/** Borrowed durable owner; public reads cannot expose a transaction left unresolved by any participant. */
export class LibraryStore implements AuthOwnershipParticipant {
  private failed = false;
  constructor(
    private readonly db: DatabaseSync,
    private readonly auth: AuthStore,
    private readonly now: () => number = Date.now,
    private readonly ids: () => string = randomUUID,
    readonly cursors = new LibraryCursors(),
    private readonly quotas: LibraryQuotas = LIBRARY_QUOTAS,
  ) {
    for (const key of Object.keys(LIBRARY_QUOTAS) as (keyof LibraryQuotas)[]) {
      if (
        !Number.isSafeInteger(quotas[key]) ||
        quotas[key] < 1 ||
        quotas[key] > LIBRARY_QUOTAS[key]
      )
        throw new Error('Invalid library quota ceiling');
    }
    this.quotas = Object.freeze({ ...quotas });
    this.transaction(() => {
      db.exec(SCHEMA);
      const meta = db.prepare("SELECT version FROM library_meta WHERE id='map-library'").get() as
        { version: number } | undefined;
      if (meta?.version !== 1) throw new Error('Unsupported map library version');
      db.prepare(`SELECT ${columns} FROM library_operations LIMIT 0`).all();
      db.prepare('SELECT canonical_json FROM library_assets LIMIT 0').all();
    });
  }
  private healthy(): void {
    if (this.failed || this.db.isTransaction)
      throw new LibraryStoreError('map_library_recovery_required');
  }
  private transaction<T>(run: () => T): T {
    this.healthy();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch (rollback) {
          this.failed = true;
          throw new AggregateError([error, rollback], 'Map library requires recovery');
        }
      }
      throw error;
    }
  }
  private descriptor(row: Row): LibraryMapDescriptor {
    try {
      if (row.state !== 'accepted') throw new Error();
      return decodeLibraryMapSummary({
        ref: { kind: 'owned', id: row.asset_id },
        name: row.name,
        assetIdentity: row.identity,
        widthM: row.width,
        heightM: row.height,
        createdAtMs: row.created_at_ms,
        status: 'needs-scenario',
      });
    } catch {
      throw new LibraryStoreError('map_library_recovery_required');
    }
  }
  private find(owner: string, key: string): Row | undefined {
    const rows = this.db
      .prepare(
        `SELECT ${columns} FROM library_operations WHERE owner=? AND request_id=? ORDER BY operation_id LIMIT 2`,
      )
      .all(owner, key) as unknown as Row[];
    if (rows.length > 1)
      throw new LibraryStoreError(
        'map_request_ambiguous',
        rows.map((row) => this.descriptor(row).ref.id),
      );
    return rows[0];
  }
  operation(owner: string, key: string): LibraryMapDescriptor | undefined {
    this.healthy();
    operationId.parse(key);
    if (!this.auth.getUser(owner)) return undefined;
    const row = this.find(owner, key);
    if (!row) return undefined;
    if (row.state !== 'accepted') throw new LibraryStoreError('map_request_removed');
    return this.descriptor(row);
  }
  private bytes(id: string): string {
    const row = this.db
      .prepare(
        `SELECT length(CAST(canonical_json AS BLOB)) AS bytes,CASE WHEN length(CAST(canonical_json AS BLOB))<=${LIBRARY_ASSET_BYTES} THEN canonical_json ELSE NULL END AS json FROM library_assets WHERE asset_id=?`,
      )
      .get(id) as { bytes: number; json: string | null } | undefined;
    if (!row || row.bytes > LIBRARY_ASSET_BYTES || row.json === null)
      throw new LibraryStoreError('map_library_recovery_required');
    return row.json;
  }
  read(
    owner: string,
    id: string,
  ): { item: LibraryMapDescriptor; canonicalJson: string } | undefined {
    this.healthy();
    operationId.parse(id);
    if (!this.auth.getUser(owner)) return undefined;
    const row = this.db
      .prepare(
        `SELECT ${columns} FROM library_operations WHERE owner=? AND asset_id=? AND state='accepted'`,
      )
      .get(owner, id) as Row | undefined;
    return row && { item: this.descriptor(row), canonicalJson: this.bytes(id) };
  }
  /** Exact accepted retry is resolved before any latest validation or quota decision. Caller already holds admission. */
  accepted(
    owner: string,
    key: string,
    name: string,
    json: string,
    identity: string,
  ): LibraryMapDescriptor | undefined {
    this.healthy();
    operationId.parse(key);
    if (!this.auth.getUser(owner)) throw new LibraryStoreError('owner_changed');
    const row = this.find(owner, key);
    if (!row) return undefined;
    if (row.state !== 'accepted') throw new LibraryStoreError('map_request_removed');
    if (row.name !== name || row.identity !== identity || this.bytes(row.asset_id) !== json)
      throw new LibraryStoreError('map_request_conflict');
    return this.descriptor(row);
  }
  save(
    owner: string,
    key: string,
    name: string,
    asset: ValidatedLibraryAsset,
  ): LibraryMapDescriptor {
    operationId.parse(key);
    return this.transaction(() => {
      const user = this.auth.getUser(owner);
      if (!user) throw new LibraryStoreError('owner_changed');
      const prior = this.find(owner, key);
      if (prior) {
        if (prior.state !== 'accepted') throw new LibraryStoreError('map_request_removed');
        if (
          prior.name !== name ||
          prior.identity !== asset.identity ||
          this.bytes(prior.asset_id) !== asset.canonicalJson
        )
          throw new LibraryStoreError('map_request_conflict');
        return this.descriptor(prior);
      }
      const bytes = Buffer.byteLength(asset.canonicalJson);
      if (bytes > LIBRARY_ASSET_BYTES) throw new LibraryStoreError('map_too_large');
      const quota = this.db
        .prepare(
          `SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(a.canonical_json AS BLOB))),0) AS bytes FROM library_operations o JOIN library_assets a ON a.asset_id=o.asset_id WHERE o.owner=? AND o.state='accepted'`,
        )
        .get(owner) as { n: number; bytes: number };
      if (
        quota.n >= (user.guest ? this.quotas.guestMaps : this.quotas.accountMaps) ||
        quota.bytes + bytes > (user.guest ? this.quotas.guestBytes : this.quotas.accountBytes)
      )
        throw new LibraryStoreError('map_library_full');
      const id = operationId.parse(this.ids());
      const operation = operationId.parse(this.ids());
      const item = decodeLibraryMapSummary({
        ref: { kind: 'owned', id },
        name,
        widthM: asset.widthM,
        heightM: asset.heightM,
        assetIdentity: asset.identity,
        status: 'needs-scenario',
        createdAtMs: this.now(),
      });
      this.db
        .prepare('INSERT INTO library_assets(asset_id,canonical_json) VALUES (?,?)')
        .run(id, asset.canonicalJson);
      this.db
        .prepare(
          "INSERT INTO library_operations(operation_id,original_owner,owner,request_id,asset_id,state,name,identity,width,height,created_at_ms) VALUES (?,?,?,?,?,'accepted',?,?,?,?,?)",
        )
        .run(
          operation,
          owner,
          owner,
          key,
          id,
          item.name,
          item.assetIdentity,
          item.widthM,
          item.heightM,
          item.createdAtMs!,
        );
      return item;
    });
  }
  list(
    owner: string,
    cursor?: string,
  ): { schemaVersion: 1; items: LibraryMapDescriptor[]; nextCursor?: string } {
    this.healthy();
    if (!this.auth.getUser(owner)) throw new LibraryStoreError('owner_changed');
    let last: z.infer<typeof position> | undefined;
    if (cursor !== undefined) {
      try {
        last = position.parse(this.cursors.decode(owner, 'owned', cursor));
      } catch {
        throw new LibraryStoreError('restart_map_list');
      }
    }
    const sql = `SELECT ${columns} FROM library_operations WHERE owner=? AND state='accepted'${last ? ' AND (created_at_ms < ? OR (created_at_ms = ? AND asset_id < ?))' : ''} ORDER BY created_at_ms DESC,asset_id DESC LIMIT 21`;
    const rows = this.db
      .prepare(sql)
      .all(
        ...(last ? [owner, last.createdAtMs, last.createdAtMs, last.id] : [owner]),
      ) as unknown as Row[];
    const items = rows.slice(0, 20).map((row) => this.descriptor(row));
    const end = items.at(-1);
    const page = {
      schemaVersion: 1 as const,
      items,
      ...(rows.length > 20 && end
        ? {
            nextCursor: this.cursors.encode(owner, 'owned', {
              id: end.ref.id,
              createdAtMs: end.createdAtMs,
            }),
          }
        : {}),
    };
    if (Buffer.byteLength(JSON.stringify(page)) > 32768)
      throw new LibraryStoreError('map_library_recovery_required');
    return page;
  }
  adoptGuest(from: string, to: string): void {
    if (!this.db.isTransaction) throw new LibraryStoreError('ownership_transaction_required');
    this.db.prepare('UPDATE library_operations SET owner=? WHERE owner=?').run(to, from);
  }
  deleteUser(owner: string): void {
    if (!this.db.isTransaction) throw new LibraryStoreError('ownership_transaction_required');
    this.db
      .prepare(
        'DELETE FROM library_assets WHERE asset_id IN (SELECT asset_id FROM library_operations WHERE owner=?)',
      )
      .run(owner);
    this.db
      .prepare(
        "UPDATE library_operations SET owner='removed:'||operation_id,state='tombstone',name=NULL,identity=NULL,width=NULL,height=NULL WHERE owner=?",
      )
      .run(owner);
  }
}
