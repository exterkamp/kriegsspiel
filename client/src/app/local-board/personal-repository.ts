import { z } from 'zod';
import { validateSceneMarks } from '../../legacy/table/fixtureMarks';
import type { SceneMark, SceneMarkGeometry } from '../../legacy/table/types';
import { freezeBoardSnapshot, sameLocalBinding, validateLocalBinding } from './board-binding';
import type { LocalBoardBinding, LocalScope } from './contracts';

export interface PersonalMark {
  readonly id: string;
  readonly scope: LocalScope;
  readonly binding: LocalBoardBinding;
  readonly source: { readonly kind: 'manual' };
  readonly placedAtGame: 0;
  readonly editedAtGame: 0 | null;
  readonly label: string;
  readonly geometry: SceneMarkGeometry;
}
export interface PersonalMarksDocument {
  readonly schemaVersion: 1;
  readonly scope: LocalScope;
  readonly binding: LocalBoardBinding;
  readonly revision: string;
  readonly marks: readonly PersonalMark[];
}
export interface PersonalNotebookDocument {
  readonly schemaVersion: 1;
  readonly scope: LocalScope;
  readonly binding: LocalBoardBinding;
  readonly text: string;
}
export interface PersonalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type PersonalErrorCode =
  | 'invalid-data'
  | 'future-version'
  | 'scope-mismatch'
  | 'binding-mismatch'
  | 'conflict'
  | 'storage-unavailable'
  | 'quota-exceeded'
  | 'not-ready'
  | 'not-found'
  | 'aborted'
  | 'disposed'
  | 'internal';
export interface PersonalError {
  readonly code: PersonalErrorCode;
  readonly message: string;
  readonly retry: 'reload' | 'same-request' | 'edit' | 'none';
}
export type PersonalResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PersonalError };
export const PERSONAL_MARKS_RECORD_LIMIT = 1_048_576;
export const PERSONAL_NOTEBOOK_RECORD_LIMIT = 131_072;
export const PERSONAL_NOTEBOOK_TEXT_LIMIT = 16_384;

const messages: Record<PersonalErrorCode, string> = {
  'invalid-data': 'Personal data is invalid or exceeds the limits.',
  'future-version': 'Stored personal data uses a newer version. The record was preserved.',
  'scope-mismatch': 'Personal data belongs to another local session. The record was preserved.',
  'binding-mismatch': 'Personal data belongs to another board. The record was preserved.',
  conflict: 'Personal data changed or an operation was interrupted. Reload before saving.',
  'storage-unavailable': 'Browser storage is unavailable. Personal data was not saved.',
  'quota-exceeded': 'Browser storage is full. Personal data was not saved.',
  'not-ready': 'Load personal data safely before saving.',
  'not-found': 'The personal mark was not found.',
  aborted: 'The personal operation was cancelled.',
  disposed: 'The personal session is closed.',
  internal: 'The personal operation could not be completed.',
};
export function personalFailure<T = never>(
  code: PersonalErrorCode,
  retry: PersonalError['retry'] = 'none',
): PersonalResult<T> {
  return { ok: false, error: Object.freeze({ code, message: messages[code], retry }) };
}
export function personalSuccess<T>(value: T): PersonalResult<T> {
  return { ok: true, value };
}
const id = z.string().min(1).max(128);
const scopeSchema = z
  .object({
    gameId: z
      .string()
      .regex(/^local-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    sideId: z.literal('blue'),
    playerId: z.literal('local-general'),
  })
  .strict();
export function snapshotPersonalScope(value: unknown): LocalScope {
  return freezeBoardSnapshot(scopeSchema.parse(value) as LocalScope);
}
export function samePersonalScope(a: LocalScope, b: LocalScope): boolean {
  return a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
}
const markSchema = z
  .object({
    id,
    scope: scopeSchema,
    binding: z.unknown(),
    source: z.object({ kind: z.literal('manual') }).strict(),
    placedAtGame: z.literal(0),
    editedAtGame: z.union([z.literal(0), z.null()]),
    label: z.string().max(256),
    geometry: z.unknown(),
  })
  .strict();
const marksDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    binding: z.unknown(),
    revision: id,
    marks: z.unknown(),
  })
  .strict();
const notebookDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    binding: z.unknown(),
    text: z.string().max(PERSONAL_NOTEBOOK_TEXT_LIMIT),
  })
  .strict();

function matchingBinding(
  value: unknown,
  binding: LocalBoardBinding,
): PersonalResult<LocalBoardBinding> {
  try {
    const parsed = validateLocalBinding(value);
    return sameLocalBinding(parsed, binding)
      ? personalSuccess(parsed)
      : personalFailure('binding-mismatch', 'reload');
  } catch {
    return personalFailure('invalid-data', 'edit');
  }
}
/** Structural validation deliberately excludes the serialized storage budget. */
export function validatePersonalMarks(
  value: unknown,
  scope: LocalScope,
  binding: LocalBoardBinding,
): PersonalResult<readonly PersonalMark[]> {
  try {
    const parsed = z.array(markSchema).max(200).parse(value);
    const marks: PersonalMark[] = [];
    for (const mark of parsed) {
      if (!samePersonalScope(mark.scope as LocalScope, scope))
        return personalFailure('scope-mismatch', 'reload');
      const fixed = matchingBinding(mark.binding, binding);
      if (!fixed.ok) return fixed;
      marks.push({
        ...mark,
        scope: mark.scope as LocalScope,
        binding: fixed.value,
        geometry: mark.geometry as SceneMarkGeometry,
      });
    }
    const scene = validateSceneMarks(
      marks.map(({ id, label, geometry }) => ({ id, label, geometry })),
      { width: binding.bounds.maxX, height: binding.bounds.maxY },
    );
    return personalSuccess(
      freezeBoardSnapshot(marks.map((mark, i) => ({ ...mark, geometry: scene[i]!.geometry }))),
    );
  } catch {
    return personalFailure('invalid-data', 'edit');
  }
}
export function projectSceneMarks(
  marks: readonly PersonalMark[],
  scope: LocalScope,
  binding: LocalBoardBinding,
): readonly SceneMark[] {
  const validated = validatePersonalMarks(
    marks,
    snapshotPersonalScope(scope),
    validateLocalBinding(binding),
  );
  if (!validated.ok) throw new TypeError(validated.error.message);
  return freezeBoardSnapshot(
    validateSceneMarks(
      validated.value.map(({ id, label, geometry }) => ({ id, label, geometry })),
      { width: binding.bounds.maxX, height: binding.bounds.maxY },
    ),
  );
}
export function personalRecordKey(
  kind: 'marks' | 'notebook',
  scope: LocalScope,
  binding: LocalBoardBinding,
): string {
  const s = snapshotPersonalScope(scope),
    b = validateLocalBinding(binding);
  if (kind !== 'marks' && kind !== 'notebook') throw new TypeError('Invalid personal record kind.');
  return JSON.stringify([
    'kriegsspiel.local-board.personal.v1',
    kind,
    s.gameId,
    s.sideId,
    s.playerId,
    b.assetIdentity,
    b.revision,
    b.mapId,
    b.bounds.minX,
    b.bounds.minY,
    b.bounds.maxX,
    b.bounds.maxY,
    b.registration.origin,
    b.registration.units,
    b.registration.xAxis,
    b.registration.yAxis,
  ]);
}

type Kind = 'marks' | 'notebook';
interface RecordState {
  readonly key: string;
  raw: string | null | undefined;
  blocked: boolean;
  queue: Promise<void>;
}
interface ActiveOperation {
  readonly state: RecordState;
  interrupted: boolean;
}

/** Observed changes are detected; localStorage supplies no cross-tab atomic transaction. */
export class PersonalRepository {
  readonly scope: LocalScope;
  readonly binding: LocalBoardBinding;
  private readonly records: Record<Kind, RecordState>;
  private currentMarks?: PersonalMarksDocument;
  private readonly known = new Map<string, PersonalMark>();
  private active?: ActiveOperation;
  private terminal = false;
  private disposal?: Promise<void>;
  private readonly storage: () => PersonalStorage;
  private readonly revision: () => string;

  constructor(
    scope: LocalScope,
    binding: LocalBoardBinding,
    options: {
      storage?: () => PersonalStorage;
      revision?: () => string;
    } = {},
  ) {
    this.scope = snapshotPersonalScope(scope);
    this.binding = validateLocalBinding(binding);
    Object.defineProperties(this, {
      scope: { writable: false, configurable: false },
      binding: { writable: false, configurable: false },
    });
    this.storage = options.storage ?? (() => window.localStorage);
    this.revision = options.revision ?? (() => crypto.randomUUID());
    const state = (kind: Kind): RecordState => ({
      key: personalRecordKey(kind, this.scope, this.binding),
      raw: undefined,
      blocked: false,
      queue: Promise.resolve(),
    });
    this.records = { marks: state('marks'), notebook: state('notebook') };
  }
  private stopped(signal: AbortSignal): PersonalResult<never> | null {
    if (this.terminal) return personalFailure('disposed');
    if (signal.aborted) return personalFailure('aborted');
    if (this.active?.interrupted) return personalFailure('conflict', 'reload');
    return null;
  }
  private reentry(kind: Kind): PersonalResult<never> | null {
    if (!this.active) return null;
    this.active.interrupted = true;
    this.active.state.blocked = true;
    this.records[kind].blocked = true;
    return personalFailure('conflict', 'reload');
  }
  private enqueue<T>(
    kind: Kind,
    signal: AbortSignal,
    task: (state: RecordState) => PersonalResult<T>,
  ): Promise<PersonalResult<T>> {
    const nested = this.reentry(kind);
    if (nested) return Promise.resolve(nested);
    const state = this.records[kind];
    const result = state.queue.then(() => {
      const stopped = this.stopped(signal);
      if (stopped) return stopped;
      this.active = { state, interrupted: false };
      try {
        return task(state);
      } catch {
        state.blocked = true;
        return this.stopped(signal) ?? personalFailure<T>('internal', 'reload');
      } finally {
        this.active = undefined;
      }
    });
    state.queue = result.then(() => undefined);
    return result;
  }
  private storageError(error: unknown, loading: boolean): PersonalResult<never> {
    // Read exception names defensively; never expose exception strings or private data.
    let quota = false;
    try {
      quota =
        !!error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'QuotaExceededError';
    } catch {
      /* denied */
    }
    return personalFailure(
      quota ? 'quota-exceeded' : 'storage-unavailable',
      loading ? 'reload' : 'same-request',
    );
  }
  private freshRevision(previous?: string): PersonalResult<string> {
    try {
      const value = this.revision();
      return id.safeParse(value).success && value !== previous
        ? personalSuccess(value)
        : personalFailure('internal', 'same-request');
    } catch {
      return personalFailure('internal', 'same-request');
    }
  }
  private history(marks: readonly PersonalMark[]): PersonalResult<void> {
    for (const mark of marks) {
      const previous = this.known.get(mark.id);
      // All original provenance is fixed by validation; the edited flag cannot regress.
      if (
        previous &&
        ((previous.editedAtGame === 0 && mark.editedAtGame !== 0) ||
          ((previous.label !== mark.label ||
            JSON.stringify(previous.geometry) !== JSON.stringify(mark.geometry)) &&
            mark.editedAtGame !== 0))
      )
        return personalFailure('conflict', 'reload');
    }
    return personalSuccess(undefined);
  }
  private remember(marks: readonly PersonalMark[]): void {
    for (const mark of marks) this.known.set(mark.id, mark);
  }
  private parse(
    kind: Kind,
    raw: string,
  ): PersonalResult<PersonalMarksDocument | PersonalNotebookDocument> {
    const limit = kind === 'marks' ? PERSONAL_MARKS_RECORD_LIMIT : PERSONAL_NOTEBOOK_RECORD_LIMIT;
    if (raw.length > limit) return personalFailure('invalid-data', 'reload');
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && 'schemaVersion' in value) {
        const version = value.schemaVersion;
        if (
          typeof version === 'number' &&
          version > 1 &&
          (kind === 'notebook' || Number.isSafeInteger(version))
        )
          return personalFailure('future-version', 'reload');
      }
      const parsed = (kind === 'marks' ? marksDocumentSchema : notebookDocumentSchema).parse(value);
      if (!samePersonalScope(parsed.scope as LocalScope, this.scope))
        return personalFailure('scope-mismatch', 'reload');
      const binding = matchingBinding(parsed.binding, this.binding);
      if (!binding.ok) return personalFailure(binding.error.code, 'reload');
      if ('marks' in parsed) {
        const marks = validatePersonalMarks(parsed.marks, this.scope, this.binding);
        if (!marks.ok) return personalFailure(marks.error.code, 'reload');
        const history = this.history(marks.value);
        if (!history.ok) return history;
        return personalSuccess(
          freezeBoardSnapshot({
            ...parsed,
            scope: this.scope,
            binding: binding.value,
            marks: marks.value,
          }),
        );
      }
      return personalSuccess(
        freezeBoardSnapshot({ ...parsed, scope: this.scope, binding: binding.value }),
      );
    } catch {
      return personalFailure('invalid-data', 'reload');
    }
  }
  private load(
    kind: Kind,
    signal: AbortSignal,
  ): Promise<PersonalResult<PersonalMarksDocument | PersonalNotebookDocument>> {
    return this.enqueue(kind, signal, (state) => {
      state.blocked = true;
      let storage: PersonalStorage, raw: string | null;
      try {
        storage = this.storage();
        const stopped = this.stopped(signal);
        if (stopped) return stopped;
        raw = storage.getItem(state.key);
      } catch (error) {
        return this.stopped(signal) ?? this.storageError(error, true);
      }
      const stopped = this.stopped(signal);
      if (stopped) return stopped;
      let result: PersonalResult<PersonalMarksDocument | PersonalNotebookDocument>;
      if (raw === null) {
        if (kind === 'marks') {
          const revision = this.freshRevision(this.currentMarks?.revision);
          const stopped = this.stopped(signal);
          if (stopped) return stopped;
          if (!revision.ok) return revision;
          result = personalSuccess(
            freezeBoardSnapshot({
              schemaVersion: 1,
              scope: this.scope,
              binding: this.binding,
              revision: revision.value,
              marks: [],
            }),
          );
        } else
          result = personalSuccess(
            freezeBoardSnapshot({
              schemaVersion: 1,
              scope: this.scope,
              binding: this.binding,
              text: '',
            }),
          );
      } else result = this.parse(kind, raw);
      if (!result.ok) return result;
      try {
        const actual = storage.getItem(state.key);
        const stopped = this.stopped(signal);
        if (stopped) return stopped;
        if (actual !== raw) return personalFailure('conflict', 'reload');
      } catch (error) {
        return this.stopped(signal) ?? this.storageError(error, true);
      }
      state.raw = raw;
      state.blocked = false;
      if ('marks' in result.value) {
        this.currentMarks = result.value;
        this.remember(result.value.marks);
      }
      return result;
    });
  }
  loadMarks(signal: AbortSignal): Promise<PersonalResult<PersonalMarksDocument>> {
    return this.load('marks', signal) as Promise<PersonalResult<PersonalMarksDocument>>;
  }
  loadNotebook(signal: AbortSignal): Promise<PersonalResult<PersonalNotebookDocument>> {
    return this.load('notebook', signal) as Promise<PersonalResult<PersonalNotebookDocument>>;
  }
  saveMarks(
    marks: readonly PersonalMark[],
    expectedRevision: string,
    signal: AbortSignal,
  ): Promise<PersonalResult<PersonalMarksDocument>> {
    const nested = this.reentry('marks');
    if (nested) return Promise.resolve(nested);
    const stopped = this.stopped(signal);
    if (stopped) return Promise.resolve(stopped);
    const candidate = validatePersonalMarks(marks, this.scope, this.binding);
    if (!candidate.ok) return Promise.resolve(candidate);
    if (!id.safeParse(expectedRevision).success)
      return Promise.resolve(personalFailure('invalid-data', 'edit'));
    return this.save('marks', signal, () => {
      if (this.currentMarks?.revision !== expectedRevision)
        return personalFailure('conflict', 'reload');
      const history = this.history(candidate.value);
      if (!history.ok) return history;
      const revision = this.freshRevision(expectedRevision);
      if (!revision.ok) return revision;
      return personalSuccess(
        freezeBoardSnapshot({
          schemaVersion: 1,
          scope: this.scope,
          binding: this.binding,
          revision: revision.value,
          marks: candidate.value,
        }),
      );
    }) as Promise<PersonalResult<PersonalMarksDocument>>;
  }
  saveNotebook(
    text: string,
    signal: AbortSignal,
  ): Promise<PersonalResult<PersonalNotebookDocument>> {
    const nested = this.reentry('notebook');
    if (nested) return Promise.resolve(nested);
    const stopped = this.stopped(signal);
    if (stopped) return Promise.resolve(stopped);
    if (typeof text !== 'string' || text.length > PERSONAL_NOTEBOOK_TEXT_LIMIT)
      return Promise.resolve(personalFailure('invalid-data', 'edit'));
    return this.save('notebook', signal, () =>
      personalSuccess(
        freezeBoardSnapshot({
          schemaVersion: 1,
          scope: this.scope,
          binding: this.binding,
          text,
        }),
      ),
    ) as Promise<PersonalResult<PersonalNotebookDocument>>;
  }
  private save(
    kind: Kind,
    signal: AbortSignal,
    prepare: () => PersonalResult<PersonalMarksDocument | PersonalNotebookDocument>,
  ): Promise<PersonalResult<PersonalMarksDocument | PersonalNotebookDocument>> {
    return this.enqueue(kind, signal, (state) => {
      if (state.blocked) return personalFailure('conflict', 'reload');
      if (state.raw === undefined) return personalFailure('not-ready', 'reload');
      let storage: PersonalStorage;
      let write: PersonalStorage['setItem'];
      try {
        storage = this.storage();
        const stopped = this.stopped(signal);
        if (stopped) return stopped;
        const actual = storage.getItem(state.key);
        const cancelled = this.stopped(signal);
        if (cancelled) return cancelled;
        if (actual !== state.raw) {
          state.blocked = true;
          return personalFailure('conflict', 'reload');
        }
      } catch (error) {
        return this.stopped(signal) ?? this.storageError(error, false);
      }
      try {
        // Accessor-backed ports can invoke caller code. Capture the writer before the final read.
        write = storage.setItem;
      } catch (error) {
        return this.stopped(signal) ?? this.storageError(error, false);
      }
      const beforePreparation = this.stopped(signal);
      if (beforePreparation) return beforePreparation;
      const next = prepare();
      const stopped = this.stopped(signal);
      if (stopped) return stopped;
      if (!next.ok) {
        if (next.error.code === 'conflict') state.blocked = true;
        return next;
      }
      const raw = JSON.stringify(next.value);
      if (
        raw.length >
        (kind === 'marks' ? PERSONAL_MARKS_RECORD_LIMIT : PERSONAL_NOTEBOOK_RECORD_LIMIT)
      )
        return personalFailure('invalid-data', 'edit');
      try {
        const actual = storage.getItem(state.key);
        const stopped = this.stopped(signal);
        if (stopped) return stopped;
        if (actual !== state.raw) {
          state.blocked = true;
          return personalFailure('conflict', 'reload');
        }
        write.call(storage, state.key, raw);
      } catch (error) {
        return this.stopped(signal) ?? this.storageError(error, false);
      }
      // setItem completed: teardown/abort from its callback cannot uncommit that write.
      if (!this.terminal) {
        state.raw = raw;
        if ('marks' in next.value) {
          this.currentMarks = next.value;
          this.remember(next.value.marks);
        }
      }
      return next;
    });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.terminal = true;
    this.currentMarks = undefined;
    this.known.clear();
    for (const state of Object.values(this.records)) {
      state.raw = undefined;
      state.blocked = true;
    }
    this.disposal = Promise.all(Object.values(this.records).map((state) => state.queue)).then(
      () => undefined,
    );
    return this.disposal;
  }
}
