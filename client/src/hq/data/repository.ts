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
  private persisted = false;
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
  private defaults(): LocalDocument {
    return immutable({
      schemaVersion: 1,
      scope: this.scope,
      revision: this.revision(),
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
  private read(): Result<LocalDocument> {
    try {
      const text = this.storage().getItem(this.key);
      if (text === null) {
        if (this.persisted) {
          this.current = null;
          this.persisted = false;
        }
        return success(this.current ?? this.defaults());
      }
      if (text.length > 16384)
        return failure('invalid-data', 'Stored preferences exceed the size limit.');
      const result = this.validate(JSON.parse(text));
      if (result.ok) this.persisted = true;
      return result;
    } catch (error) {
      return error instanceof SyntaxError
        ? failure('invalid-data', 'Stored preferences are malformed. Stored data was preserved.')
        : failure(
            'storage-unavailable',
            'Browser storage is unavailable. Changes cannot be saved.',
          );
    }
  }
  async load(op: Operation): Promise<Result<RepositoryLoad>> {
    if (this.disposed) return failure('disposed', 'The preferences session is closed.');
    if (op.signal.aborted) return failure('aborted', 'Loading cancelled.');
    const result = this.read();
    if (!result.ok) return result;
    this.current = result.value;
    return success({ document: result.value, durability: this.durability });
  }
  async save(
    document: LocalDocument,
    expectedRevision: string,
    op: Operation,
  ): Promise<Result<RepositoryLoad>> {
    if (this.disposed) return failure('disposed', 'The preferences session is closed.');
    if (op.signal.aborted) return failure('aborted', 'Saving cancelled.');
    const candidate = this.validate(document);
    if (!candidate.ok) return candidate;
    const stored = this.read();
    if (!stored.ok) return stored;
    if (document.revision !== expectedRevision || stored.value.revision !== expectedRevision)
      return failure('conflict', 'Preferences changed elsewhere. Reload before saving.');
    const next = immutable({ ...candidate.value, revision: this.revision() });
    try {
      if (op.signal.aborted) return failure('aborted', 'Saving cancelled.');
      this.storage().setItem(this.key, JSON.stringify(next));
    } catch (error) {
      const quota = error instanceof Error && error.name === 'QuotaExceededError';
      return failure(
        quota ? 'quota-exceeded' : 'storage-unavailable',
        quota
          ? 'Browser storage is full. Preferences were not saved.'
          : 'Preferences could not be saved.',
      );
    }
    // The synchronous write is the commit point: a subsequent abort cannot undo it.
    this.current = next;
    this.persisted = true;
    return success({ document: next, durability: this.durability });
  }
  dispose(): void {
    this.disposed = true;
    this.current = null;
  }
}
