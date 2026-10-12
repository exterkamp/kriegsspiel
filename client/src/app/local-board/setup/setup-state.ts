import { computed, signal } from '@angular/core';
import { battlefieldPreset, type BattlefieldPreset } from '@kriegsspiel/maps';
import {
  parseReplayParameters,
  type ReplayParameters,
} from '../../../legacy/map-authoring/generation/protocol.js';
import type {
  BoardPreparation,
  CertifiedBoard,
  MapRef,
  MapSummary,
  SetupProps,
} from '../../../shared/game-setup/contracts.js';

export const SETUP_PRESETS = ['flat-countryside', 'wooded-hills', 'river-valley'] as const;
export function mapRefKey(ref: MapRef): string {
  return `${ref.kind}:${ref.id}`;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Map operation failed';
}
interface Operation {
  readonly id: number;
  readonly owner: number;
  readonly abort: AbortController;
  readonly props: SetupProps;
}

/** One setup lifetime, independent of its canvas. Ports own resources; signals hold plain snapshots. */
export class SetupState {
  private readonly mapValues = signal<readonly MapSummary[]>([]);
  private readonly selection = signal('');
  private readonly seedValue = signal(String(battlefieldPreset('flat-countryside').seed));
  private readonly presetValue = signal<string>('flat-countryside');
  private readonly recipeValue = signal(
    parseReplayParameters(battlefieldPreset('flat-countryside')),
  );
  private readonly boardValue = signal<CertifiedBoard | null>(null);
  private readonly certifiedRecipe = signal<string | null>(null);
  private readonly status = signal('Choose a saved map or generate one.');
  private readonly working = signal(false);
  private readonly committing = signal(false);
  private readonly stopped = signal(false);
  readonly maps = this.mapValues.asReadonly();
  readonly selectedKey = this.selection.asReadonly();
  readonly seed = this.seedValue.asReadonly();
  readonly preset = this.presetValue.asReadonly();
  readonly recipe = this.recipeValue.asReadonly();
  readonly size = computed(() => {
    const { widthM, heightM } = this.recipe().settings;
    return widthM === heightM && [5000, 10000, 15000].includes(widthM) ? String(widthM) : '';
  });
  readonly board = this.boardValue.asReadonly();
  readonly phase = this.status.asReadonly();
  readonly busy = this.working.asReadonly();
  readonly starting = this.committing.asReadonly();
  readonly closed = this.stopped.asReadonly();
  readonly currentDraft = computed<ReplayParameters | null>(() => {
    if (!/^\d+$/.test(this.seed())) return null;
    try {
      return parseReplayParameters({ ...this.recipe(), seed: Number(this.seed()) });
    } catch {
      return null;
    }
  });
  readonly matches = computed(() => {
    const draft = this.currentDraft();
    return draft !== null && JSON.stringify(draft) === this.certifiedRecipe();
  });
  readonly canGenerate = computed(
    () => !!this.currentDraft() && !this.starting() && !this.closed(),
  );
  readonly canSave = computed(
    () => !!this.board() && !this.board()?.summary.ref && this.matches() && this.idle(),
  );
  readonly canStart = computed(() => !!this.board()?.summary.ref && this.matches() && this.idle());
  private props: SetupProps | null = null;
  private owner = 0;
  private token = 0;
  private active: Operation | null = null;
  private listAbort: AbortController | null = null;
  private userWorked = false;
  private readonly pendingPreparation = new Set<Promise<void>>();
  private readonly disposedPreparations = new WeakSet<BoardPreparation>();
  private teardown: Promise<void> | null = null;
  private cancellation: Promise<void> | null = null;
  private notifyCancel = false;

  private idle(): boolean {
    return !this.busy() && !this.starting() && !this.closed();
  }

  /** Inputs may refresh callbacks without restarting work. New ports retire the old owner first. */
  async configure(props: SetupProps): Promise<void> {
    if (this.closed()) return;
    const snapshot: SetupProps = {
      catalog: props.catalog,
      preparation: props.preparation,
      initialRef: props.initialRef ? structuredClone(props.initialRef) : undefined,
      onStart: props.onStart,
      onCancel: props.onCancel,
    };
    const previous = this.props;
    this.props = snapshot;
    if (previous?.catalog === props.catalog && previous.preparation === props.preparation) return;
    const owner = ++this.owner;
    this.invalidate();
    const list = this.listAbort;
    this.listAbort = null;
    list?.abort();
    if (previous && previous.preparation !== props.preparation)
      this.releasePreparation(previous.preparation);
    if (this.closed() || owner !== this.owner) return;
    this.userWorked = false;
    this.committing.set(false);
    this.mapValues.set([]);
    this.selection.set('');
    this.boardValue.set(null);
    this.certifiedRecipe.set(null);
    this.recipeValue.set(parseReplayParameters(battlefieldPreset('flat-countryside')));
    this.seedValue.set(String(this.recipe().seed));
    this.presetValue.set('flat-countryside');
    this.status.set('Choose a saved map or generate one.');
    await this.whenRetired();
    if (this.closed() || owner !== this.owner) return;
    const controller = new AbortController();
    this.listAbort = controller;
    try {
      const values = await snapshot.catalog.list(controller.signal);
      if (!this.listCurrent(owner, controller)) return;
      const retained = this.maps();
      const merged = new Map<string, MapSummary>();
      for (const value of values) merged.set(mapRefKey(value.ref), structuredClone(value));
      for (const value of retained) merged.set(mapRefKey(value.ref), value);
      this.mapValues.set([...merged.values()]);
      // Selection is already a reference key, so insertion/reordering cannot rebind it.
      const initial = this.props?.initialRef;
      if (!this.userWorked && initial && merged.has(mapRefKey(initial)))
        void this.selectSaved(mapRefKey(initial));
    } catch (error) {
      if (this.listCurrent(owner, controller) && !this.userWorked) this.status.set(message(error));
    }
  }

  private listCurrent(owner: number, controller: AbortController): boolean {
    return !this.closed() && !this.starting() && owner === this.owner && !controller.signal.aborted;
  }

  /** Invalidate/detach before abort dispatch, which can synchronously reenter a command. */
  private invalidate(): number {
    const id = ++this.token;
    const previous = this.active;
    this.active = null;
    this.working.set(false);
    previous?.abort.abort();
    return id;
  }

  private begin(): Operation | null {
    if (this.closed() || this.starting() || !this.props) return null;
    this.userWorked = true;
    const id = this.invalidate();
    if (this.closed() || this.starting() || id !== this.token || !this.props) return null;
    const operation = { id, owner: this.owner, abort: new AbortController(), props: this.props };
    this.active = operation;
    this.working.set(true);
    return operation;
  }

  private current(operation: Operation): boolean {
    return (
      !this.closed() &&
      operation.id === this.token &&
      operation.owner === this.owner &&
      !operation.abort.signal.aborted
    );
  }

  private finish(operation: Operation): void {
    if (!this.current(operation)) return;
    this.active = null;
    this.working.set(false);
  }

  private edit(change: () => void): void {
    if (this.closed() || this.starting()) return;
    this.userWorked = true;
    const id = this.invalidate();
    if (this.closed() || this.starting() || id !== this.token) return;
    change();
    this.selection.set('');
    if (this.board()?.summary.ref) this.boardValue.set(null);
    this.status.set('Draft changed. Generate to certify this recipe.');
  }

  setSeed(value: string): void {
    this.edit(() => this.seedValue.set(value));
  }
  setPreset(value: string): void {
    if (value && !SETUP_PRESETS.includes(value as BattlefieldPreset)) return;
    this.edit(() => {
      this.presetValue.set(value);
      if (value)
        this.recipeValue.set({
          ...this.recipe(),
          settings: structuredClone(battlefieldPreset(value as BattlefieldPreset).settings),
        });
    });
  }
  setSize(value: string): void {
    if (!['', '5000', '10000', '15000'].includes(value)) return;
    this.edit(() => {
      this.presetValue.set('');
      if (value)
        this.recipeValue.set({
          ...this.recipe(),
          settings: { ...this.recipe().settings, widthM: Number(value), heightM: Number(value) },
        });
    });
  }

  /** Reserve settlement before calling a port: a factory may synchronously destroy this owner. */
  private prepare<T>(invoke: () => Promise<T>): Promise<T> {
    let settle!: () => void;
    const retirement = new Promise<void>((resolve) => (settle = resolve));
    this.pendingPreparation.add(retirement);
    return (async () => {
      try {
        return await invoke();
      } finally {
        this.pendingPreparation.delete(retirement);
        settle();
      }
    })();
  }

  async whenRetired(): Promise<void> {
    while (this.pendingPreparation.size) await Promise.all([...this.pendingPreparation]);
  }

  async selectSaved(key: string): Promise<void> {
    const operation = this.begin();
    if (!operation) return;
    this.selection.set(key);
    this.boardValue.set(null);
    this.certifiedRecipe.set(null);
    const summary = this.maps().find((value) => mapRefKey(value.ref) === key);
    if (!summary) {
      this.status.set('Choose a saved map or generate one.');
      this.finish(operation);
      return;
    }
    this.status.set('Certifying saved map…');
    try {
      const ownedSummary = structuredClone(summary);
      const json = await operation.props.catalog.read(
        structuredClone(ownedSummary.ref),
        operation.abort.signal,
      );
      if (!this.current(operation)) return;
      await this.whenRetired();
      if (!this.current(operation)) return;
      const result = await this.prepare(() =>
        operation.props.preparation.load(json, ownedSummary, operation.abort.signal),
      );
      if (!this.current(operation)) return;
      const board = structuredClone(result);
      if (!board.summary.ref || mapRefKey(board.summary.ref) !== key)
        throw new Error('Certification does not match the selected map reference');
      const recipe = parseReplayParameters({
        seed: board.asset.provenance.seed,
        settings: board.asset.settings,
        overrides: board.asset.overrides,
      });
      this.recipeValue.set(recipe);
      this.seedValue.set(String(recipe.seed));
      this.presetValue.set('');
      this.certifiedRecipe.set(JSON.stringify(recipe));
      this.boardValue.set(board);
      this.status.set('Saved map ready.');
    } catch (error) {
      if (this.current(operation)) this.status.set(message(error));
    } finally {
      this.finish(operation);
    }
  }

  async generate(): Promise<void> {
    const draft = this.currentDraft();
    if (!draft || !this.canGenerate()) return;
    const operation = this.begin();
    if (!operation) return;
    this.selection.set('');
    this.boardValue.set(null);
    this.certifiedRecipe.set(null);
    this.status.set('Generating and certifying map…');
    try {
      const recipe = structuredClone(draft);
      await this.whenRetired();
      if (!this.current(operation)) return;
      const result = await this.prepare(() =>
        operation.props.preparation.generate(recipe, operation.abort.signal),
      );
      if (!this.current(operation)) return;
      const board = structuredClone(result);
      if (board.summary.ref) throw new Error('Generated certification must be unsaved');
      this.boardValue.set(board);
      this.certifiedRecipe.set(JSON.stringify(draft));
      this.status.set('Certified map ready to save.');
    } catch (error) {
      if (this.current(operation)) this.status.set(message(error));
    } finally {
      this.finish(operation);
    }
  }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    const board = this.board()!;
    const key = this.certifiedRecipe();
    const operation = this.begin();
    if (!operation) return;
    this.status.set('Saving map…');
    try {
      const response = await operation.props.catalog.save(
        board.canonicalJson,
        operation.abort.signal,
      );
      if (
        !this.current(operation) ||
        this.board() !== board ||
        key !== this.certifiedRecipe() ||
        !this.matches()
      )
        return;
      const summary = structuredClone(response);
      if (summary.widthM !== board.bounds.maxX || summary.heightM !== board.bounds.maxY)
        throw new Error('Saved map dimensions do not match the certified board');
      this.boardValue.set({ ...board, summary });
      const values = new Map(this.maps().map((value) => [mapRefKey(value.ref), value]));
      values.set(mapRefKey(summary.ref), structuredClone(summary));
      this.mapValues.set([...values.values()]);
      this.selection.set(mapRefKey(summary.ref));
      this.status.set('Saved map ready.');
    } catch (error) {
      if (this.current(operation)) this.status.set(`${message(error)} Retry Save map.`);
    } finally {
      this.finish(operation);
    }
  }

  async start(): Promise<void> {
    if (!this.canStart()) return;
    this.committing.set(true);
    const id = this.invalidate();
    const owner = this.owner;
    this.listAbort?.abort();
    if (this.closed() || id !== this.token || owner !== this.owner) return;
    this.status.set('Starting board…');
    try {
      const board = structuredClone(this.board()!);
      await this.whenRetired();
      if (this.closed() || id !== this.token || owner !== this.owner) return;
      // Deliberately outside the retirement ledger: the owner may await dispose() inside onStart.
      await this.props!.onStart(board);
    } catch (error) {
      if (!this.closed() && id === this.token && owner === this.owner) {
        this.committing.set(false);
        this.status.set(message(error));
      }
    }
  }

  private releasePreparation(preparation: BoardPreparation): void {
    if (this.disposedPreparations.has(preparation)) return;
    this.disposedPreparations.add(preparation);
    try {
      preparation.dispose();
    } catch {
      // Still await every operation handed back by the port, even if injected cleanup throws.
    }
  }

  /** Synchronous invalidation, awaitable preparation retirement. Catalog and Start cannot hold it open. */
  dispose(): Promise<void> {
    this.notifyCancel = false;
    return this.retire();
  }

  private retire(): Promise<void> {
    if (this.teardown) return this.teardown;
    let settle!: () => void;
    this.teardown = new Promise<void>((resolve) => (settle = resolve));
    this.stopped.set(true);
    ++this.owner;
    const preparation = this.props?.preparation;
    this.props = null;
    this.invalidate();
    const list = this.listAbort;
    this.listAbort = null;
    list?.abort();
    if (preparation) this.releasePreparation(preparation);
    void this.whenRetired().then(settle);
    return this.teardown;
  }

  cancel(): Promise<void> {
    if (this.cancellation) return this.cancellation;
    if (this.closed() || this.starting()) return Promise.resolve();
    const callback = this.props?.onCancel;
    this.notifyCancel = true;
    this.cancellation = this.retire().then(() => {
      if (!this.notifyCancel) return;
      this.notifyCancel = false;
      callback?.();
    });
    return this.cancellation;
  }
}
