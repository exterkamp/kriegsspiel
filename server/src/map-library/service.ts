import { stat, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { decodeLibraryMapSummary, type LibraryMapDescriptor } from '@kriegsspiel/protocol';
import { LibraryAdmission, type LibraryLease } from './admission.js';
import { LibraryStore, LibraryStoreError } from './store.js';
import { LIBRARY_ASSET_BYTES, validateLibraryAsset } from './validation.js';
import type { SqliteCreationStore } from '../lobby/creation-store.js';
export class MapLibraryService {
  readonly admission = new LibraryAdmission();
  readonly store: LibraryStore;
  private readonly included = new Map<
    string,
    { item: LibraryMapDescriptor; canonicalJson: string }
  >();
  private constructor(readonly owner: SqliteCreationStore) {
    if (!owner.durable) throw new Error('Map library requires durable storage');
    this.store = new LibraryStore(owner.database, owner.auth);
    // Account retirement must remain atomic even if included catalog startup later fails.
    owner.registerOwnershipParticipant(this.store);
  }
  static async open(owner: SqliteCreationStore, directory: URL): Promise<MapLibraryService> {
    const service = new MapLibraryService(owner);
    const catalogFile = new URL('catalog.json', directory);
    if ((await stat(catalogFile)).size > 32768) throw new Error('Invalid included catalog');
    const rows = z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
            name: z.string().max(160),
            filename: z.string().regex(/^[a-zA-Z0-9_-]+\.json$/),
          })
          .strict(),
      )
      .max(100)
      .parse(JSON.parse(await readFile(catalogFile, 'utf8')));
    for (const row of rows) {
      if (service.included.has(row.id)) throw new Error('Duplicate included map');
      const file = new URL(row.filename, directory);
      if ((await stat(file)).size > LIBRARY_ASSET_BYTES) throw new Error('Included map too large');
      const lease = service.admission.acquire('startup');
      try {
        const canonicalJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          await readFile(file),
        );
        const asset = await validateLibraryAsset(
          canonicalJson,
          lease,
          new AbortController().signal,
        );
        const item = decodeLibraryMapSummary({
          ref: { kind: 'included', id: row.id },
          name: row.name,
          widthM: asset.widthM,
          heightM: asset.heightM,
          assetIdentity: asset.identity,
          status: 'needs-scenario',
        });
        service.included.set(row.id, { item, canonicalJson });
      } finally {
        await lease.release();
      }
    }
    // No public capability before every shipped map is current-certified and schema initialized.
    return service;
  }
  private principal(owner: string): void {
    if (!this.owner.auth.getUser(owner)) throw new LibraryStoreError('owner_changed');
  }
  list(owner: string, source: 'owned' | 'included', cursor?: string) {
    this.principal(owner);
    if (source === 'owned') return this.store.list(owner, cursor);
    let last: string | undefined;
    if (cursor) {
      try {
        last = z
          .object({ id: z.string().max(128) })
          .strict()
          .parse(this.store.cursors.decode(owner, 'included', cursor)).id;
      } catch {
        throw new LibraryStoreError('restart_map_list');
      }
    }
    const rows = [...this.included.values()]
      .map((x) => x.item)
      .sort((a, b) => (a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : 0))
      .filter((x) => !last || x.ref.id > last);
    const items = rows.slice(0, 20).map((x) => decodeLibraryMapSummary(x));
    return {
      schemaVersion: 1 as const,
      items,
      ...(rows.length > 20
        ? { nextCursor: this.store.cursors.encode(owner, 'included', { id: items.at(-1)!.ref.id }) }
        : {}),
    };
  }
  async read(
    owner: string,
    kind: 'owned' | 'included',
    id: string,
    lease: LibraryLease,
    signal: AbortSignal,
  ) {
    this.principal(owner);
    lease.assertActive();
    const record = kind === 'owned' ? this.store.read(owner, id) : this.included.get(id);
    if (!record) return undefined;
    const checked = await validateLibraryAsset(record.canonicalJson, lease, signal);
    this.principal(owner);
    const current = kind === 'owned' ? this.store.read(owner, id) : this.included.get(id);
    if (
      !current ||
      JSON.stringify(current.item) !== JSON.stringify(record.item) ||
      current.canonicalJson !== record.canonicalJson
    )
      throw new LibraryStoreError('owner_changed');
    if (
      checked.identity !== record.item.assetIdentity ||
      checked.widthM !== record.item.widthM ||
      checked.heightM !== record.item.heightM
    )
      throw new LibraryStoreError('map_library_recovery_required');
    return { item: decodeLibraryMapSummary(record.item), canonicalJson: record.canonicalJson };
  }
  async save(
    owner: string,
    key: string,
    name: string,
    json: string,
    identity: string,
    lease: LibraryLease,
    signal: AbortSignal,
    assertCurrent: () => void = () => undefined,
  ) {
    this.principal(owner);
    assertCurrent();
    lease.assertActive();
    const accepted = this.store.accepted(owner, key, name, json, identity);
    if (accepted) return accepted;
    const asset = await validateLibraryAsset(json, lease, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (asset.identity !== identity) throw new LibraryStoreError('map_identity_mismatch');
    assertCurrent();
    // Store rechecks current principal/key/quotas inside its final transaction.
    return this.store.save(owner, key, name, asset);
  }
}
