import type {
  HqError,
  HqSnapshot,
  MarkCreateInput,
  MarkEditInput,
  PersonalMark,
  PersonalMarksDocument,
  PersonalMarksRepository,
  PublicArtwork,
  Result,
  Scope,
  Unsubscribe,
} from '../../contracts/index.js';
import { failure, immutable, success } from '../common.js';
import {
  cloneBinding,
  createPersonalMark,
  editPersonalMark,
  validateDocument,
  validateMarks,
} from './validation.js';

export interface PersonalMarksState {
  readonly marks: readonly PersonalMark[];
  readonly phase: 'loading' | 'ready' | 'saving' | 'reloading' | 'blocked' | 'disposed';
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly writable: boolean;
  readonly error: HqError | null;
}
export interface PersonalMarksController {
  readonly scope: Scope;
  readonly artwork: PublicArtwork;
  getState(): PersonalMarksState;
  subscribe(listener: (state: PersonalMarksState) => void): Unsubscribe;
  initialize(): Promise<Result<void>>;
  create(input: MarkCreateInput, snapshot: HqSnapshot | null, gameMs: number | null): Result<void>;
  edit(id: string, input: MarkEditInput, gameMs: number | null): Result<void>;
  remove(id: string): Result<void>;
  save(): Promise<Result<void>>;
  reload(): Promise<Result<void>>;
  dispose(): void;
}

export function createPersonalMarksController(
  repository: PersonalMarksRepository,
): PersonalMarksController {
  const { scope, artwork } = cloneBinding(repository.scope, repository.artwork);
  let state: PersonalMarksState = immutable({
    marks: [],
    phase: 'loading',
    busy: true,
    dirty: false,
    writable: false,
    error: null,
  });
  let initialized = false;
  let disposed = false;
  let baseline: PersonalMarksDocument | null = null;
  let generation = 0;
  let blockedUntilLoad = false;
  const lifetime = new AbortController();
  const listeners = new Set<(state: PersonalMarksState) => void>();
  const deliver = (listener: (state: PersonalMarksState) => void) => {
    try {
      listener(state);
    } catch {
      /* A subscriber cannot corrupt the session. */
    }
  };
  const emit = (next: PersonalMarksState) => {
    if (disposed) return;
    state = immutable(next);
    for (const listener of [...listeners]) {
      if (disposed) break;
      deliver(listener);
    }
  };
  const unavailable = (): Result<never> | null => {
    if (disposed) return failure('disposed', 'The personal marks session is closed.');
    if (state.busy) return failure('conflict', 'Wait for the current personal marks operation.');
    if (!state.writable)
      return failure('not-ready', 'Reload valid personal marks before editing or saving.');
    return null;
  };
  const update = (marks: readonly PersonalMark[]): Result<void> => {
    const checked = validateMarks(marks, scope, artwork);
    if (!checked.ok) return checked;
    generation++;
    emit({ ...state, marks: checked.value, dirty: true, error: null });
    return success(undefined);
  };
  const failOperation = (result: Result<void>, blockInvalidData = true): Result<void> => {
    if (result.ok) return result;
    if (
      ['conflict', 'migration-required', 'scope-mismatch'].includes(result.error.code) ||
      (blockInvalidData && result.error.code === 'invalid-data')
    )
      blockedUntilLoad = true;
    const blocked = blockedUntilLoad || baseline === null;
    emit({
      ...state,
      phase: blocked ? 'blocked' : 'ready',
      busy: false,
      writable: !blocked,
      error: { ...result.error },
    });
    return result;
  };
  const load = async (phase: 'loading' | 'reloading'): Promise<Result<void>> => {
    emit({ ...state, phase, busy: true, writable: false, error: null });
    // A listener may close the lifetime synchronously while observing busy.
    if (disposed) return failure('disposed', 'The personal marks session is closed.');
    const startedGeneration = generation;
    let result: Result<PersonalMarksDocument>;
    try {
      result = await repository.load({ signal: lifetime.signal });
    } catch {
      result = failure('internal', 'Personal marks could not be loaded.');
    }
    if (disposed) return failure('disposed', 'The personal marks session is closed.');
    if (!result.ok) return failOperation(result);
    const validated = validateDocument(result.value, scope, artwork);
    if (!validated.ok) return failOperation(validated);
    if (generation !== startedGeneration)
      return failOperation(
        failure('conflict', 'Personal marks changed while loading. Reload again.'),
      );
    baseline = validated.value;
    blockedUntilLoad = false;
    generation++;
    emit({
      marks: baseline.marks,
      phase: 'ready',
      busy: false,
      dirty: false,
      writable: true,
      error: null,
    });
    return success(undefined);
  };

  const controller: PersonalMarksController = {
    scope,
    artwork,
    getState: () => state,
    subscribe(listener) {
      deliver(listener);
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize() {
      if (disposed)
        return Promise.resolve(failure('disposed', 'The personal marks session is closed.'));
      if (initialized)
        return Promise.resolve(
          failure('conflict', 'Personal marks initialization has already started.'),
        );
      initialized = true;
      return load('loading');
    },
    create(input, snapshot, gameMs) {
      const blocked = unavailable();
      if (blocked) return blocked;
      const result = createPersonalMark(input, { scope, artwork, snapshot, gameMs });
      return result.ok ? update([...state.marks, result.value]) : result;
    },
    edit(id, input, gameMs) {
      const blocked = unavailable();
      if (blocked) return blocked;
      const existing = state.marks.find((mark) => mark.id === id);
      if (!existing) return failure('not-found', 'The personal mark is unavailable.');
      const result = editPersonalMark(existing, input, artwork, gameMs);
      return result.ok
        ? update(state.marks.map((mark) => (mark.id === id ? result.value : mark)))
        : result;
    },
    remove(id) {
      const blocked = unavailable();
      if (blocked) return blocked;
      if (!state.marks.some((mark) => mark.id === id))
        return failure('not-found', 'The personal mark is unavailable.');
      return update(state.marks.filter((mark) => mark.id !== id));
    },
    async save() {
      const blocked = unavailable();
      if (blocked) return blocked;
      const document = baseline!;
      const captured = state.marks;
      const startedGeneration = generation;
      emit({ ...state, phase: 'saving', busy: true, writable: false, error: null });
      if (disposed) return failure('disposed', 'The personal marks session is closed.');
      let result: Result<PersonalMarksDocument>;
      try {
        result = await repository.save(captured, document.revision, { signal: lifetime.signal });
      } catch {
        result = failure('internal', 'Personal marks could not be saved.');
      }
      // A successful repository write remains success after teardown; never revive state.
      if (disposed)
        return result.ok
          ? success(undefined)
          : failure('disposed', 'The personal marks session is closed.');
      // A rejected candidate did not commit. Keep its dirty draft editable so a
      // size-limit failure can be recovered by reducing geometry or removing marks.
      if (!result.ok) return failOperation(result, false);
      const validated = validateDocument(result.value, scope, artwork);
      if (!validated.ok) return failOperation(validated);
      if (
        validated.value.revision === document.revision ||
        JSON.stringify(validated.value.marks) !== JSON.stringify(captured)
      )
        return failOperation(
          failure('invalid-data', 'The saved personal marks result did not match the request.'),
        );
      baseline = validated.value;
      emit({
        ...state,
        phase: 'ready',
        busy: false,
        writable: true,
        dirty: generation === startedGeneration ? false : state.dirty,
        error: null,
      });
      return success(undefined);
    },
    reload() {
      if (disposed)
        return Promise.resolve(failure('disposed', 'The personal marks session is closed.'));
      if (!initialized)
        return Promise.resolve(failure('not-ready', 'Initialize personal marks before reloading.'));
      if (state.busy)
        return Promise.resolve(
          failure('conflict', 'Wait for the current personal marks operation.'),
        );
      return load('reloading');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      state = immutable({ ...state, phase: 'disposed', busy: false, writable: false, error: null });
      try {
        repository.dispose();
      } finally {
        for (const listener of [...listeners]) deliver(listener);
        listeners.clear();
        baseline = null;
      }
    },
  };
  return Object.freeze(controller);
}
