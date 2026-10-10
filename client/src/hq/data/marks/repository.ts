import type {
  Operation,
  PersonalMark,
  PersonalMarksDocument,
  PersonalMarksRepository,
  PublicArtwork,
  Result,
  Scope,
} from '../../contracts/index.js';
import type { StoragePort } from '../repository.js';
import { failure, immutable, success } from '../common.js';
import {
  checkEditHistory,
  cloneBinding,
  idSchema,
  MAX_RECORD_LENGTH,
  validateDocument,
  validateMarks,
} from './validation.js';

function storageFailure(
  code: 'storage-unavailable' | 'quota-exceeded',
  message: string,
  retry: 'read-only' | 'same-request' = 'same-request',
): Result<never> {
  return { ok: false, error: { code, message, retry } };
}

/** Browser-only single writer with observed-change detection, not cross-tab atomicity. */
export class BrowserPersonalMarksRepository implements PersonalMarksRepository {
  readonly scope: Scope;
  readonly artwork: PublicArtwork;
  private readonly key: string;
  private current: PersonalMarksDocument | null = null;
  private raw: string | null | undefined;
  private blocked = false;
  private known = new Map<string, PersonalMark>();
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    scope: Scope,
    artwork: PublicArtwork,
    private storage: () => StoragePort,
    private revision: () => string = () => crypto.randomUUID(),
  ) {
    const binding = cloneBinding(scope, artwork);
    this.scope = binding.scope;
    this.artwork = binding.artwork;
    Object.defineProperties(this, {
      scope: { writable: false, configurable: false },
      artwork: { writable: false, configurable: false },
    });
    this.key = JSON.stringify([
      'kriegsspiel.hq.personal-marks',
      this.scope.gameId,
      this.scope.sideId,
      this.scope.playerId,
    ]);
  }
  private stopped(op: Operation): Result<never> | null {
    if (this.disposed) return failure('disposed', 'The personal marks session is closed.');
    return op.signal.aborted ? failure('aborted', 'Personal marks operation cancelled.') : null;
  }
  private enqueue<T>(task: () => Result<T>): Promise<Result<T>> {
    const result = this.queue.then(() => {
      try {
        return task();
      } catch {
        return failure<T>('internal', 'The personal marks operation failed.');
      }
    });
    this.queue = result.then(() => undefined);
    return result;
  }
  private newRevision(previous?: string): Result<string> {
    try {
      const next = this.revision();
      if (!idSchema.safeParse(next).success || next === previous)
        return failure('internal', 'A fresh personal marks revision could not be generated.');
      return success(next);
    } catch {
      return failure('internal', 'A personal marks revision could not be generated.');
    }
  }
  load(op: Operation): Promise<Result<PersonalMarksDocument>> {
    return this.enqueue(() => {
      const stopped = this.stopped(op);
      if (stopped) return stopped;
      let text: string | null;
      try {
        text = this.storage().getItem(this.key);
      } catch {
        return (
          this.stopped(op) ??
          storageFailure(
            'storage-unavailable',
            'Browser storage is unavailable. Personal marks were preserved.',
            'read-only',
          )
        );
      }
      const cancelled = this.stopped(op);
      if (cancelled) return cancelled;
      let result: Result<PersonalMarksDocument>;
      if (text === null) {
        if (this.current && this.raw === null && !this.blocked) result = success(this.current);
        else {
          const revision = this.newRevision(this.current?.revision);
          if (!revision.ok) return revision;
          result = success(
            immutable({
              schemaVersion: 1,
              scope: this.scope,
              map: { id: this.artwork.id, revision: this.artwork.revision },
              revision: revision.value,
              marks: [],
            }),
          );
        }
      } else if (text.length > MAX_RECORD_LENGTH)
        result = failure(
          'invalid-data',
          'Stored personal marks exceed the size limit. Stored data was preserved.',
        );
      else {
        try {
          result = validateDocument(JSON.parse(text), this.scope, this.artwork);
        } catch {
          result = failure(
            'invalid-data',
            'Stored personal marks are malformed. Stored data was preserved.',
          );
        }
      }
      const finalStop = this.stopped(op);
      if (finalStop) return finalStop;
      if (!result.ok) {
        this.blocked = true;
        return result;
      }
      this.current = result.value;
      this.known = new Map(result.value.marks.map((mark) => [mark.id, mark]));
      this.raw = text;
      this.blocked = false;
      return result;
    });
  }
  save(
    marks: readonly PersonalMark[],
    expectedRevision: string,
    op: Operation,
  ): Promise<Result<PersonalMarksDocument>> {
    const stopped = this.stopped(op);
    if (stopped) return Promise.resolve(stopped);
    if (!this.current)
      return Promise.resolve(failure('not-ready', 'Load personal marks before saving.'));
    const candidate = validateMarks(marks, this.scope, this.artwork);
    if (!candidate.ok) return Promise.resolve(candidate);
    if (!idSchema.safeParse(expectedRevision).success)
      return Promise.resolve(
        failure('invalid-data', 'The expected personal marks revision is invalid.'),
      );
    return this.enqueue(() => {
      const stopped = this.stopped(op);
      if (stopped) return stopped;
      if (this.blocked) return failure('conflict', 'Reload personal marks before saving again.');
      const current = this.current!;
      if (expectedRevision !== current.revision) {
        this.blocked = true;
        return failure('conflict', 'Personal marks changed. Reload before saving.');
      }
      for (const next of candidate.value) {
        const previous = this.known.get(next.id);
        if (previous) {
          const history = checkEditHistory(previous, next);
          if (!history.ok) {
            if (history.error.code === 'conflict') this.blocked = true;
            return history;
          }
        }
      }
      let store: StoragePort;
      try {
        store = this.storage();
        const actual = store.getItem(this.key);
        const cancelled = this.stopped(op);
        if (cancelled) return cancelled;
        if (actual !== this.raw) {
          this.blocked = true;
          return failure(
            'conflict',
            'Stored personal marks changed or were deleted. Reload before saving.',
          );
        }
      } catch {
        return (
          this.stopped(op) ??
          storageFailure(
            'storage-unavailable',
            'Browser storage is unavailable. Personal marks were not saved.',
          )
        );
      }
      const revision = this.newRevision(current.revision);
      if (!revision.ok) return revision;
      const next = immutable({ ...current, revision: revision.value, marks: candidate.value });
      const text = JSON.stringify(next);
      if (text.length > MAX_RECORD_LENGTH)
        return failure('invalid-data', 'Personal marks exceed the storage size limit.');
      const finalStop = this.stopped(op);
      if (finalStop) return finalStop;
      // Revision factories are caller callbacks and may change storage. Compare
      // again after all preparation, with cancellation checked after the read.
      try {
        const actual = store.getItem(this.key);
        const cancelled = this.stopped(op);
        if (cancelled) return cancelled;
        if (actual !== this.raw) {
          this.blocked = true;
          return failure(
            'conflict',
            'Stored personal marks changed or were deleted. Reload before saving.',
          );
        }
      } catch {
        return (
          this.stopped(op) ??
          storageFailure(
            'storage-unavailable',
            'Browser storage is unavailable. Personal marks were not saved.',
          )
        );
      }
      try {
        store.setItem(this.key, text);
      } catch (error) {
        const quota = error instanceof Error && error.name === 'QuotaExceededError';
        return (
          this.stopped(op) ??
          storageFailure(
            quota ? 'quota-exceeded' : 'storage-unavailable',
            quota
              ? 'Browser storage is full. Personal marks were not saved.'
              : 'Personal marks could not be saved.',
          )
        );
      }
      // A successful synchronous write is committed, even if it triggered abort/dispose.
      if (!this.disposed) {
        this.current = next;
        for (const mark of next.marks) this.known.set(mark.id, mark);
        this.raw = text;
      }
      return success(next);
    });
  }
  dispose(): void {
    this.disposed = true;
    this.current = null;
    this.known.clear();
  }
}
