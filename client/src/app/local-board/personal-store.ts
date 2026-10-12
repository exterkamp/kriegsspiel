import { computed, signal } from '@angular/core';
import type { Coord } from '@kriegsspiel/protocol';
import type { SceneMarkGeometry } from '../../legacy/table/types';
import { freezeBoardSnapshot, sameLocalBinding, validateLocalBinding } from './board-binding';
import type { LocalBoardPoint } from './board-host.component';
import type { LocalBoardBinding, LocalScope } from './contracts';
import {
  PERSONAL_NOTEBOOK_TEXT_LIMIT,
  PersonalRepository,
  personalFailure,
  personalSuccess,
  projectSceneMarks,
  samePersonalScope,
  snapshotPersonalScope,
  validatePersonalMarks,
  type PersonalError,
  type PersonalMark,
  type PersonalMarksDocument,
  type PersonalNotebookDocument,
  type PersonalResult,
} from './personal-repository';

export type ManualTool = 'pin' | 'symbol' | 'ring' | 'polyline' | 'arrow';
export interface PersonalMarkForm {
  readonly tool: ManualTool;
  readonly editingId?: string;
  readonly label: string;
  readonly x: string;
  readonly y: string;
  readonly radiusM: string;
  readonly symbol: 'cross' | 'dot' | 'flag';
  readonly points: readonly Readonly<Coord>[];
  readonly error?: PersonalError;
}
export interface PersonalDraftState<T> {
  readonly draft: T;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly writable: boolean;
  readonly error?: PersonalError;
}
export interface NotebookMatch {
  readonly line: number;
  readonly text: string;
}
const emptyForm = (tool: ManualTool = 'pin'): PersonalMarkForm =>
  freezeBoardSnapshot({
    tool,
    label: '',
    x: '',
    y: '',
    radiusM: '',
    symbol: 'cross',
    points: [],
  });
const emptyMarks = (): PersonalDraftState<readonly PersonalMark[]> =>
  freezeBoardSnapshot({
    draft: [],
    dirty: false,
    busy: false,
    writable: false,
  });
const emptyNotebook = (): PersonalDraftState<string> =>
  Object.freeze({
    draft: '',
    dirty: false,
    busy: false,
    writable: false,
  });

/** Explicitly session-owned. Components only consume this instance; navigation is not teardown. */
export class PersonalStore {
  readonly scope: LocalScope;
  readonly binding: LocalBoardBinding;
  private readonly marksState = signal(emptyMarks());
  private readonly notebookState = signal(emptyNotebook());
  private readonly formState = signal(emptyForm());
  private readonly drawingState = signal(false);
  private readonly queryState = signal('');
  private readonly interactionState = signal(true);
  private readonly disposedState = signal(false);
  readonly marks = this.marksState.asReadonly();
  readonly notebook = this.notebookState.asReadonly();
  readonly markForm = this.formState.asReadonly();
  readonly drawingActive = this.drawingState.asReadonly();
  readonly notebookQuery = this.queryState.asReadonly();
  readonly interactionEnabled = this.interactionState.asReadonly();
  readonly disposed = this.disposedState.asReadonly();
  readonly cameraEnabled = computed(() => !this.drawingState());
  readonly sceneMarks = computed(() =>
    projectSceneMarks(this.marksState().draft, this.scope, this.binding),
  );
  readonly notebookMatches = computed<readonly NotebookMatch[]>(() => {
    const query = this.queryState().trim().toLowerCase();
    if (!query) return Object.freeze([]);
    return freezeBoardSnapshot(
      this.notebookState()
        .draft.split('\n')
        .flatMap((text, index) =>
          text.toLowerCase().includes(query) ? [{ line: index + 1, text }] : [],
        ),
    );
  });
  readonly notebookExport = computed(() =>
    this.disposedState()
      ? ''
      : `${this.notebookState().dirty ? 'Personal notebook — unsaved changes' : 'Personal notebook — current text'}\n\n${this.notebookState().draft}`,
  );
  private readonly lifetime = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private initial?: Promise<void>;
  private disposal?: Promise<void>;
  private marksReloading = false;
  private notebookReloading = false;
  private marksBaseline: readonly PersonalMark[] = [];
  private notebookBaseline = '';
  private marksRevision = '';
  private marksGeneration = 0;
  private notebookGeneration = 0;
  private readonly usedIds = new Set<string>();
  private readonly markId: () => string;

  constructor(
    scope: LocalScope,
    binding: LocalBoardBinding,
    private readonly repository: PersonalRepository,
    options: { markId?: () => string } = {},
  ) {
    this.scope = snapshotPersonalScope(scope);
    this.binding = validateLocalBinding(binding);
    if (
      !samePersonalScope(this.scope, repository.scope) ||
      !sameLocalBinding(this.binding, repository.binding)
    )
      throw new TypeError('The personal repository must belong to this local session and board.');
    Object.defineProperties(this, {
      scope: { writable: false, configurable: false },
      binding: { writable: false, configurable: false },
    });
    this.markId = options.markId ?? (() => crypto.randomUUID());
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }
  private guard(): PersonalResult<never> | null {
    if (this.disposedState()) return personalFailure('disposed');
    if (!this.interactionState()) return personalFailure('not-ready');
    return null;
  }
  private markGuard(): PersonalResult<never> | null {
    return this.guard() ?? (this.marksReloading ? personalFailure('not-ready') : null);
  }
  private formResult<T>(result: PersonalResult<T>): PersonalResult<T> {
    if (!this.disposedState())
      this.formState.update((form) =>
        freezeBoardSnapshot({
          ...form,
          error: result.ok ? undefined : result.error,
        }),
      );
    return result;
  }
  initialize(signal?: AbortSignal): Promise<void> {
    if (this.initial) return this.initial;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.lifetime.signal.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || this.lifetime.signal.aborted) abort();
    this.initial = this.track(
      Promise.all([this.loadMarks(controller.signal), this.loadNotebook(controller.signal)])
        .then(() => undefined)
        .finally(() => {
          signal?.removeEventListener('abort', abort);
          this.lifetime.signal.removeEventListener('abort', abort);
        }),
    );
    return this.initial;
  }
  reloadMarks(): Promise<PersonalResult<PersonalMarksDocument>> {
    const blocked = this.guard();
    if (blocked) return Promise.resolve(blocked);
    return this.loadMarks(this.lifetime.signal);
  }
  private loadMarks(signal: AbortSignal): Promise<PersonalResult<PersonalMarksDocument>> {
    if (this.disposedState()) return Promise.resolve(personalFailure('disposed'));
    if (this.marksState().busy) return Promise.resolve(personalFailure('not-ready'));
    this.marksReloading = true;
    this.marksState.update((state) => freezeBoardSnapshot({ ...state, busy: true }));
    const generation = this.marksGeneration;
    return this.track(
      this.repository.loadMarks(signal).then((result) => {
        if (this.disposedState()) return result;
        this.marksReloading = false;
        if (result.ok && generation === this.marksGeneration) {
          this.marksBaseline = result.value.marks;
          this.marksRevision = result.value.revision;
          result.value.marks.forEach((mark) => this.usedIds.add(mark.id));
          this.marksState.set(
            freezeBoardSnapshot({
              draft: result.value.marks,
              dirty: false,
              busy: false,
              writable: true,
            }),
          );
        } else
          this.marksState.update((state) =>
            freezeBoardSnapshot({
              ...state,
              busy: false,
              writable: false,
              error: result.ok ? undefined : result.error,
            }),
          );
        return result;
      }),
    );
  }
  reloadNotebook(): Promise<PersonalResult<PersonalNotebookDocument>> {
    const blocked = this.guard();
    if (blocked) return Promise.resolve(blocked);
    return this.loadNotebook(this.lifetime.signal);
  }
  private loadNotebook(signal: AbortSignal): Promise<PersonalResult<PersonalNotebookDocument>> {
    if (this.disposedState()) return Promise.resolve(personalFailure('disposed'));
    if (this.notebookState().busy) return Promise.resolve(personalFailure('not-ready'));
    this.notebookReloading = true;
    this.notebookState.update((state) => Object.freeze({ ...state, busy: true }));
    const generation = this.notebookGeneration;
    return this.track(
      this.repository.loadNotebook(signal).then((result) => {
        if (this.disposedState()) return result;
        this.notebookReloading = false;
        if (result.ok && generation === this.notebookGeneration) {
          this.notebookBaseline = result.value.text;
          this.notebookState.set(
            Object.freeze({ draft: result.value.text, dirty: false, busy: false, writable: true }),
          );
        } else
          this.notebookState.update((state) =>
            Object.freeze({
              ...state,
              busy: false,
              writable: false,
              error: result.ok ? undefined : result.error,
            }),
          );
        return result;
      }),
    );
  }
  saveMarks(): Promise<PersonalResult<PersonalMarksDocument>> {
    const blocked = this.guard();
    if (blocked) return Promise.resolve(blocked);
    const state = this.marksState();
    if (state.busy || !state.writable)
      return Promise.resolve(personalFailure('not-ready', 'reload'));
    const snapshot = state.draft,
      generation = this.marksGeneration;
    this.marksState.set(freezeBoardSnapshot({ ...state, busy: true, error: undefined }));
    return this.track(
      this.repository
        .saveMarks(snapshot, this.marksRevision, this.lifetime.signal)
        .then((result) => {
          if (this.disposedState()) return result;
          if (result.ok) {
            this.marksBaseline = result.value.marks;
            this.marksRevision = result.value.revision;
            this.marksState.update((current) =>
              freezeBoardSnapshot({
                ...current,
                busy: false,
                writable: true,
                dirty: generation === this.marksGeneration ? false : this.marksDirty(current.draft),
                error: undefined,
              }),
            );
          } else
            this.marksState.update((current) =>
              freezeBoardSnapshot({
                ...current,
                busy: false,
                writable: result.error.retry !== 'reload',
                error: result.error,
              }),
            );
          return result;
        }),
    );
  }
  saveNotebook(): Promise<PersonalResult<PersonalNotebookDocument>> {
    const blocked = this.guard();
    if (blocked) return Promise.resolve(blocked);
    const state = this.notebookState();
    if (state.busy || !state.writable)
      return Promise.resolve(personalFailure('not-ready', 'reload'));
    const snapshot = state.draft,
      generation = this.notebookGeneration;
    this.notebookState.set(Object.freeze({ ...state, busy: true, error: undefined }));
    return this.track(
      this.repository.saveNotebook(snapshot, this.lifetime.signal).then((result) => {
        if (this.disposedState()) return result;
        if (result.ok) {
          this.notebookBaseline = result.value.text;
          this.notebookState.update((current) =>
            Object.freeze({
              ...current,
              busy: false,
              writable: true,
              dirty:
                generation === this.notebookGeneration
                  ? false
                  : current.draft !== this.notebookBaseline,
              error: undefined,
            }),
          );
        } else
          this.notebookState.update((current) =>
            Object.freeze({
              ...current,
              busy: false,
              writable: result.error.retry !== 'reload',
              error: result.error,
            }),
          );
        return result;
      }),
    );
  }
  private marksDirty(draft: readonly PersonalMark[]): boolean {
    return JSON.stringify(draft) !== JSON.stringify(this.marksBaseline);
  }
  private replaceMarks(value: unknown): PersonalResult<readonly PersonalMark[]> {
    const result = validatePersonalMarks(value, this.scope, this.binding);
    if (result.ok) {
      this.marksGeneration++;
      this.marksState.update((state) =>
        freezeBoardSnapshot({
          ...state,
          draft: result.value,
          dirty: this.marksDirty(result.value),
          error: undefined,
        }),
      );
    }
    return result;
  }
  createMark(input: { label: string; geometry: SceneMarkGeometry }): PersonalResult<PersonalMark> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    let id: string;
    try {
      id = this.markId();
    } catch {
      return this.formResult(personalFailure('internal'));
    }
    const afterCallback = this.markGuard();
    if (afterCallback) return this.formResult(afterCallback);
    if (this.usedIds.has(id)) return this.formResult(personalFailure('conflict', 'edit'));
    const mark: PersonalMark = {
      id,
      scope: this.scope,
      binding: this.binding,
      source: { kind: 'manual' },
      placedAtGame: 0,
      editedAtGame: null,
      label: input.label,
      geometry: input.geometry,
    };
    const result = this.replaceMarks([...this.marksState().draft, mark]);
    if (!result.ok) return this.formResult(result);
    this.usedIds.add(id);
    return this.formResult(personalSuccess(result.value[result.value.length - 1]!));
  }
  editMark(
    id: string,
    input: { label: string; geometry: SceneMarkGeometry },
  ): PersonalResult<PersonalMark> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    const index = this.marksState().draft.findIndex((mark) => mark.id === id);
    if (index < 0) return this.formResult(personalFailure('not-found'));
    const draft = [...this.marksState().draft];
    draft[index] = {
      ...draft[index]!,
      label: input.label,
      geometry: input.geometry,
      editedAtGame: 0,
    };
    const result = this.replaceMarks(draft);
    return this.formResult(result.ok ? personalSuccess(result.value[index]!) : result);
  }
  removeMark(id: string): PersonalResult<void> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    if (!this.marksState().draft.some((mark) => mark.id === id))
      return this.formResult(personalFailure('not-found'));
    const result = this.replaceMarks(this.marksState().draft.filter((mark) => mark.id !== id));
    if (!result.ok) return this.formResult(result);
    if (this.formState().editingId === id) {
      this.formState.set(emptyForm(this.formState().tool));
      this.drawingState.set(false);
    }
    return personalSuccess(undefined);
  }
  setNotebookText(text: string): PersonalResult<void> {
    const blocked = this.guard();
    if (blocked) return blocked;
    if (this.notebookReloading || !this.notebookState().writable)
      return personalFailure('not-ready', 'reload');
    if (typeof text !== 'string' || text.length > PERSONAL_NOTEBOOK_TEXT_LIMIT) {
      const result = personalFailure<void>('invalid-data', 'edit');
      if (!result.ok)
        this.notebookState.update((state) => Object.freeze({ ...state, error: result.error }));
      return result;
    }
    this.notebookGeneration++;
    this.notebookState.update((state) =>
      Object.freeze({
        ...state,
        draft: text,
        dirty: text !== this.notebookBaseline,
        error: undefined,
      }),
    );
    return personalSuccess(undefined);
  }
  setNotebookQuery(query: string): void {
    if (!this.disposedState()) this.queryState.set(query);
  }
  setInteractionEnabled(enabled: boolean): void {
    if (!this.disposedState()) this.interactionState.set(enabled);
  }
  beginTool(tool: ManualTool): void {
    if (this.markGuard()) return;
    if (!['pin', 'symbol', 'ring', 'polyline', 'arrow'].includes(tool)) return;
    this.formState.set(emptyForm(tool));
    this.drawingState.set(false);
  }
  beginEdit(id: string): PersonalResult<void> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    const mark = this.marksState().draft.find((candidate) => candidate.id === id);
    if (!mark) return this.formResult(personalFailure('not-found'));
    const geometry = mark.geometry;
    const at =
      geometry.kind === 'polyline' || geometry.kind === 'arrow'
        ? undefined
        : geometry.kind === 'ring'
          ? geometry.centre
          : geometry.at;
    this.formState.set(
      freezeBoardSnapshot({
        ...emptyForm(geometry.kind),
        editingId: id,
        label: mark.label,
        x: at ? String(at.x) : '',
        y: at ? String(at.y) : '',
        radiusM: geometry.kind === 'ring' ? String(geometry.radiusM) : '',
        symbol: geometry.kind === 'symbol' ? geometry.symbol : 'cross',
        points: geometry.kind === 'polyline' || geometry.kind === 'arrow' ? geometry.points : [],
      }),
    );
    this.drawingState.set(false);
    return personalSuccess(undefined);
  }
  setMarkFields(fields: {
    label?: string;
    x?: string;
    y?: string;
    radiusM?: string;
    symbol?: 'cross' | 'dot' | 'flag';
  }): void {
    if (this.markGuard()) return;
    // Copy only the public editable fields; a cast cannot change IDs or provenance.
    const next = { ...this.formState(), error: undefined };
    for (const key of ['label', 'x', 'y', 'radiusM'] as const)
      if (typeof fields[key] === 'string') next[key] = fields[key]!;
    if (fields.symbol && ['cross', 'dot', 'flag'].includes(fields.symbol))
      next.symbol = fields.symbol;
    this.formState.set(freezeBoardSnapshot(next));
  }
  private numericPoint(): PersonalResult<Readonly<Coord>> {
    const { x, y } = this.formState();
    if (!x.trim() || !y.trim()) return personalFailure('invalid-data', 'edit');
    return this.checkPoint({ x: Number(x), y: Number(y) });
  }
  private checkPoint(at: Readonly<Coord>): PersonalResult<Readonly<Coord>> {
    if (
      !at ||
      !Number.isFinite(at.x) ||
      !Number.isFinite(at.y) ||
      at.x < 0 ||
      at.y < 0 ||
      at.x > this.binding.bounds.maxX ||
      at.y > this.binding.bounds.maxY
    )
      return personalFailure('invalid-data', 'edit');
    return personalSuccess(Object.freeze({ x: at.x, y: at.y }));
  }
  private appendPoint(at: Readonly<Coord>): PersonalResult<void> {
    const form = this.formState();
    if ((form.tool !== 'polyline' && form.tool !== 'arrow') || form.points.length >= 256)
      return this.formResult(personalFailure('invalid-data', 'edit'));
    this.formState.set(
      freezeBoardSnapshot({ ...form, points: [...form.points, at], error: undefined }),
    );
    return personalSuccess(undefined);
  }
  appendNumericPoint(): PersonalResult<void> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    const at = this.numericPoint();
    return at.ok ? this.appendPoint(at.value) : this.formResult(at);
  }
  removeDraftPoint(index: number): void {
    if (
      this.markGuard() ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.formState().points.length
    )
      return;
    this.formState.update((form) =>
      freezeBoardSnapshot({
        ...form,
        points: form.points.filter((_, i) => i !== index),
        error: undefined,
      }),
    );
  }
  startDrawing(): PersonalResult<void> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    this.drawingState.set(true);
    return this.formResult(personalSuccess(undefined));
  }
  stopDrawing(): void {
    if (!this.guard()) this.drawingState.set(false);
  }
  acceptPoint(point: LocalBoardPoint): PersonalResult<void> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    if (!this.drawingState() || point.key !== this.scope.gameId)
      return personalFailure('not-ready');
    const checked = this.checkPoint(point.at);
    if (!checked.ok) return this.formResult(checked);
    const form = this.formState();
    if (form.tool === 'polyline' || form.tool === 'arrow') return this.appendPoint(checked.value);
    this.formState.set(
      freezeBoardSnapshot({ ...form, x: String(checked.value.x), y: String(checked.value.y) }),
    );
    const result = this.commitMark();
    return result.ok ? personalSuccess(undefined) : result;
  }
  commitMark(): PersonalResult<PersonalMark> {
    const blocked = this.markGuard();
    if (blocked) return this.formResult(blocked);
    const form = this.formState();
    let geometry: SceneMarkGeometry;
    if (form.tool === 'polyline' || form.tool === 'arrow')
      geometry = { kind: form.tool, points: form.points };
    else {
      const at = this.numericPoint();
      if (!at.ok) return this.formResult(at);
      if (form.tool === 'ring') {
        if (!form.radiusM.trim()) return this.formResult(personalFailure('invalid-data', 'edit'));
        geometry = { kind: 'ring', centre: at.value, radiusM: Number(form.radiusM) };
      } else if (form.tool === 'symbol')
        geometry = { kind: 'symbol', at: at.value, symbol: form.symbol };
      else geometry = { kind: 'pin', at: at.value };
    }
    const result = form.editingId
      ? this.editMark(form.editingId, { label: form.label, geometry })
      : this.createMark({ label: form.label, geometry });
    if (result.ok) {
      this.formState.update((current) =>
        freezeBoardSnapshot({ ...current, editingId: result.value.id, error: undefined }),
      );
      this.drawingState.set(false);
    }
    return this.formResult(result);
  }
  finishDrawing(): PersonalResult<PersonalMark> {
    return this.commitMark();
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposedState.set(true);
    this.lifetime.abort();
    this.interactionState.set(false);
    this.drawingState.set(false);
    this.marksState.set(emptyMarks());
    this.notebookState.set(emptyNotebook());
    this.formState.set(emptyForm());
    this.queryState.set('');
    this.marksBaseline = [];
    this.notebookBaseline = '';
    this.marksRevision = '';
    this.usedIds.clear();
    this.marksReloading = false;
    this.notebookReloading = false;
    this.disposal = Promise.all([this.repository.dispose(), ...this.pending]).then(() => undefined);
    return this.disposal;
  }
}
