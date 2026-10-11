import { z } from 'zod';
import type {
  HqRepository,
  LocalDocument,
  Operation,
  RepositoryLoad,
  Result,
  Scope,
} from '../contracts/index.js';
import { failure, immutable, sameScope, success } from './common.js';

const id = z.string().min(1).max(128);
const scopeSchema = z.object({ gameId: id, sideId: id, playerId: id }).strict();
const selectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.enum(['unit', 'paper']), id, scope: scopeSchema }).strict(),
]);
const viewSchema = z.enum([
  'table',
  'in-tray',
  'orders',
  'roster',
  'conference',
  'terrain-studies',
  'journal',
  'replay',
]);
const cameraSchema = z
  .object({
    mapId: id,
    mapRevision: id,
    target: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    distanceM: z.number().finite().positive(),
    azimuthRad: z.number().finite(),
    tiltRad: z
      .number()
      .finite()
      .min(0)
      .max(Math.PI / 2),
  })
  .strict();
const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    revision: id,
    view: viewSchema,
    selection: selectionSchema,
    camera: cameraSchema.nullable(),
    highContrast: z.boolean(),
    reducedMotion: z.boolean(),
  })
  .strict();
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One writer per scoped document. Observed conflicts require reload; this is not cross-tab CAS. */
export class BrowserRepository implements HqRepository {
  readonly durability = 'browser';
  readonly scope: Scope;
  private current: LocalDocument | null = null;
  private disposed = false;
  private baseline: string | null | undefined;
  private busy = false;
  private reentered = false;
  private readonly key: string;
  constructor(
    scope: Scope,
    private storage: () => StoragePort,
    private revision: () => string = () => crypto.randomUUID(),
  ) {
    this.scope = immutable({ ...scope });
    scopeSchema.parse(this.scope);
    this.key = JSON.stringify([
      'kriegsspiel.hq.preferences.v1',
      scope.gameId,
      scope.sideId,
      scope.playerId,
    ]);
  }
  private defaults(): Result<LocalDocument> {
    const revision = this.revision();
    if (revision === this.current?.revision)
      return failure('invalid-data', 'The new preferences revision is invalid. Retry loading.');
    return this.validate({
      schemaVersion: 1,
      scope: this.scope,
      revision,
      view: 'table',
      selection: { kind: 'none' },
      camera: null,
      highContrast: false,
      reducedMotion: false,
    });
  }
  private validate(raw: unknown): Result<LocalDocument> {
    if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion !== 1)
      return failure(
        'migration-required',
        'These preferences use an unsupported version. Stored data was preserved.',
      );
    const parsed = documentSchema.safeParse(raw);
    if (!parsed.success)
      return failure(
        'invalid-data',
        'Stored preferences are malformed. Stored data was preserved.',
      );
    const d = parsed.data;
    if (
      !sameScope(this.scope, d.scope) ||
      (d.selection.kind !== 'none' && !sameScope(this.scope, d.selection.scope))
    )
      return failure('scope-mismatch', 'These preferences belong to another headquarters.');
    return success(immutable(d));
  }
  private read(storage: StoragePort): Result<{ document: LocalDocument; raw: string | null }> {
    const raw = storage.getItem(this.key);
    if (raw === null) {
      const result =
        this.baseline === null && this.current ? success(this.current) : this.defaults();
      return result.ok ? success({ document: result.value, raw }) : result;
    }
    if (raw.length > 16384)
      return failure('invalid-data', 'Stored preferences exceed the size limit.');
    const result = this.validate(JSON.parse(raw));
    return result.ok ? success({ document: result.value, raw }) : result;
  }
  private unavailable(error: unknown): Result<never> {
    if (error instanceof SyntaxError)
      return failure(
        'invalid-data',
        'Stored preferences are malformed. Stored data was preserved.',
      );
    const quota = error instanceof Error && error.name === 'QuotaExceededError';
    return failure(
      quota ? 'quota-exceeded' : 'storage-unavailable',
      quota
        ? 'Browser storage is full. Preferences were not saved.'
        : 'Browser storage is unavailable. Changes cannot be saved.',
    );
  }
  private boundary(op: Operation): Result<never> | null {
    if (this.disposed) return failure('disposed', 'The preferences session is closed.');
    if (op.signal.aborted) return failure('aborted', 'Preferences operation cancelled.');
    if (this.reentered)
      return failure('conflict', 'A preferences operation was interrupted. Retry loading.');
    return null;
  }
  private enter(): Result<never> | null {
    if (this.busy) {
      this.reentered = true;
      return failure('conflict', 'A preferences operation is already in progress.');
    }
    this.busy = true;
    this.reentered = false;
    return null;
  }
  async load(op: Operation): Promise<Result<RepositoryLoad>> {
    const blocked = this.enter();
    if (blocked) return blocked;
    try {
      const before = this.boundary(op);
      if (before) return before;
      const storage = this.storage();
      const result = this.read(storage);
      if (!result.ok) return result;
      const unchanged = storage.getItem(this.key) === result.value.raw;
      const after = this.boundary(op);
      if (after) return after;
      if (!unchanged)
        return failure('conflict', 'Preferences changed elsewhere. Reload before saving.');
      this.current = result.value.document;
      this.baseline = result.value.raw;
      return success({ document: result.value.document, durability: this.durability });
    } catch (error) {
      return this.unavailable(error);
    } finally {
      this.busy = false;
    }
  }
  async save(
    document: LocalDocument,
    expectedRevision: string,
    op: Operation,
  ): Promise<Result<RepositoryLoad>> {
    const blocked = this.enter();
    if (blocked) return blocked;
    try {
      const before = this.boundary(op);
      if (before) return before;
      const candidate = this.validate(document);
      if (!candidate.ok) return candidate;
      const baseline = this.baseline;
      const storage = this.storage();
      const stored = this.read(storage);
      if (!stored.ok) return stored;
      if (
        baseline === undefined ||
        stored.value.raw !== baseline ||
        document.revision !== expectedRevision ||
        this.current?.revision !== expectedRevision ||
        stored.value.document.revision !== expectedRevision
      )
        return failure('conflict', 'Preferences changed elsewhere. Reload before saving.');
      const revision = this.revision();
      if (!id.safeParse(revision).success || revision === expectedRevision)
        return failure(
          'invalid-data',
          'The new preferences revision is invalid. Preferences were not saved.',
        );
      const next = immutable({ ...candidate.value, revision });
      const raw = JSON.stringify(next);
      if (raw.length > 16384) return failure('invalid-data', 'Preferences exceed the size limit.');
      // All injected callbacks run before the final comparison/cancellation boundary.
      const unchanged = storage.getItem(this.key) === baseline;
      const after = this.boundary(op);
      if (after) return after;
      if (!unchanged)
        return failure('conflict', 'Preferences changed elsewhere. Reload before saving.');
      storage.setItem(this.key, raw);
      // A completed synchronous write is committed even if its callback aborts/disposes.
      if (!this.disposed) {
        this.current = next;
        this.baseline = raw;
      }
      return success({ document: next, durability: this.durability });
    } catch (error) {
      return this.unavailable(error);
    } finally {
      this.busy = false;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.current = null;
  }
}
