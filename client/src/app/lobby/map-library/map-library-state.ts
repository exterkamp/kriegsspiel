import { computed, signal } from '@angular/core';
import {
  assetIdentity,
  battlefieldPreset,
  canonicalizeAsset,
  importAsset,
  parseAsset,
  type BattlefieldPreset,
} from '@kriegsspiel/maps';
import {
  parseReplayParameters,
  type ReplayParameters,
} from '../../../legacy/map-authoring/generation/protocol';
import type { BoardPreparation, CertifiedBoard } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';

export const LANDSCAPES = [
  { id: 'flat-countryside', name: 'Countryside' },
  { id: 'wooded-hills', name: 'Wooded hills' },
  { id: 'river-valley', name: 'River valley' },
] as const;
type Ports = { preparation: BoardPreparation; library: MapLibraryPort };
type Operation = { owner: number; token: number; abort: AbortController; ports: Ports };
type Intent = {
  requestId: string;
  name: string;
  canonicalJson: string;
  assetIdentity: string;
  accepted?: LibraryMapSummary;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validName = (value: string) => value.length <= 160 && value.trim().length > 0;
function checkedSummary(value: LibraryMapSummary): LibraryMapSummary {
  const summary = structuredClone(value);
  if (
    !summary ||
    Array.isArray(summary) ||
    Object.keys(summary).some(
      (key) =>
        !['ref', 'name', 'widthM', 'heightM', 'assetIdentity', 'status', 'createdAtMs'].includes(
          key,
        ),
    ) ||
    !summary.ref ||
    Array.isArray(summary.ref) ||
    Object.keys(summary.ref).length !== 2 ||
    summary.ref.kind !== 'owned' ||
    typeof summary.ref.id !== 'string' ||
    !uuid.test(summary.ref.id) ||
    typeof summary.name !== 'string' ||
    !validName(summary.name) ||
    summary.status !== 'needs-scenario' ||
    typeof summary.assetIdentity !== 'string' ||
    !/^[a-f0-9]{64}$/.test(summary.assetIdentity) ||
    ![summary.widthM, summary.heightM].every((n) => Number.isFinite(n) && n >= 1 && n <= 20000) ||
    (summary.createdAtMs !== undefined &&
      (!Number.isSafeInteger(summary.createdAtMs) || summary.createdAtMs < 0))
  )
    throw new Error('Invalid saved metadata');
  return summary;
}
const sameSummary = (a: LibraryMapSummary, b: LibraryMapSummary) =>
  a.ref.kind === b.ref.kind &&
  a.ref.id === b.ref.id &&
  a.name === b.name &&
  a.widthM === b.widthM &&
  a.heightM === b.heightM &&
  a.assetIdentity === b.assetIdentity &&
  a.status === b.status &&
  a.createdAtMs === b.createdAtMs;

/** Portable Add geography owner. No library implementation, dialog, session, game or selection. */
export class MapLibraryState {
  private readonly ports = signal<Ports | undefined>(undefined);
  readonly recipe = signal<ReplayParameters | undefined>(undefined);
  readonly landscape = signal<string>('flat-countryside');
  readonly seed = signal('');
  readonly name = signal('');
  readonly board = signal<CertifiedBoard | undefined>(undefined);
  readonly busy = signal(false);
  readonly closed = signal(false);
  readonly dirty = signal(false);
  readonly confirming = signal(false);
  readonly pending = signal(false);
  readonly completed = signal<LibraryMapSummary | undefined>(undefined);
  readonly phase = signal('Choose a landscape, then Generate map.');
  readonly error = signal('');
  readonly size = computed(() => {
    const settings = this.recipe()?.settings;
    return settings &&
      settings.widthM === settings.heightM &&
      [5000, 10000, 15000].includes(settings.widthM)
      ? String(settings.widthM)
      : '';
  });
  readonly draft = computed(() => {
    const recipe = this.recipe();
    if (!recipe || !/^\d+$/.test(this.seed())) return undefined;
    try {
      return parseReplayParameters({ ...recipe, seed: Number(this.seed()) });
    } catch {
      return undefined;
    }
  });
  readonly locked = computed(
    () => this.closed() || this.busy() || this.pending() || this.confirming() || !!this.completed(),
  );
  readonly canGenerate = computed(() => !!this.ports() && !!this.draft() && !this.locked());
  readonly canSave = computed(
    () =>
      !!this.board() &&
      validName(this.name()) &&
      !this.closed() &&
      !this.busy() &&
      !this.confirming() &&
      !this.completed(),
  );
  private owner = 0;
  private token = 0;
  private active: Operation | undefined;
  private intent: Intent | undefined;
  private destroyed = false;
  private readonly released = new WeakSet<BoardPreparation>();
  private readonly acquired = new Set<BoardPreparation>();
  constructor(
    private readonly events: {
      saved(value: LibraryMapSummary): void;
      cancelled(): void;
      dirty(value: boolean): void;
    },
  ) {}

  configure(
    preparation: BoardPreparation,
    library: MapLibraryPort,
    initialRecipe?: ReplayParameters,
  ): void {
    if (this.destroyed) {
      this.release(preparation);
      return;
    }
    this.acquired.add(preparation);
    const old = this.ports();
    const owner = ++this.owner;
    this.ports.set(undefined);
    this.invalidate();
    if (old && old.preparation !== preparation) this.release(old.preparation);
    if (owner !== this.owner || this.destroyed) {
      if (this.ports()?.preparation !== preparation) this.release(preparation);
      return;
    }
    this.closed.set(false);
    this.confirming.set(false);
    this.pending.set(false);
    this.completed.set(undefined);
    this.intent = undefined;
    this.board.set(undefined);
    this.name.set('');
    this.error.set('');
    this.setDirty(false);
    if (owner !== this.owner || this.destroyed) {
      if (this.ports()?.preparation !== preparation) this.release(preparation);
      return;
    }
    if (this.released.has(preparation)) {
      this.recipe.set(undefined);
      this.error.set('Reopen Add map to prepare another map.');
      return;
    }
    this.ports.set({ preparation, library });
    try {
      const recipe = parseReplayParameters(initialRecipe ?? battlefieldPreset('flat-countryside'));
      this.recipe.set(recipe);
      this.seed.set(String(recipe.seed));
      this.landscape.set(initialRecipe ? '' : 'flat-countryside');
      this.phase.set('Choose a landscape, then Generate map.');
    } catch {
      this.recipe.set(undefined);
      this.error.set('The recorded map settings could not be read. Please reopen Add map.');
    }
  }
  private setDirty(value: boolean): void {
    if (this.dirty() === value) return;
    this.dirty.set(value);
    this.events.dirty(value);
  }
  private invalidate(): void {
    ++this.token;
    const previous = this.active;
    this.active = undefined;
    this.busy.set(false);
    previous?.abort.abort();
  }
  private begin(): Operation | undefined {
    const ports = this.ports();
    if (!ports || this.destroyed || this.closed() || this.busy() || this.confirming())
      return undefined;
    const operation = {
      ports,
      owner: this.owner,
      token: ++this.token,
      abort: new AbortController(),
    };
    this.active = operation;
    this.busy.set(true);
    this.error.set('');
    return operation;
  }
  private current(operation: Operation): boolean {
    return (
      !this.destroyed &&
      !this.closed() &&
      this.active === operation &&
      this.owner === operation.owner &&
      this.token === operation.token &&
      !operation.abort.signal.aborted
    );
  }
  private finish(operation: Operation): void {
    if (this.current(operation)) {
      this.active = undefined;
      this.busy.set(false);
    }
  }
  private edit(change: () => void, recipeChange: boolean): void {
    if (this.locked()) return;
    change();
    if (recipeChange) {
      this.board.set(undefined);
      this.phase.set('Generate map to preview these settings.');
    }
    this.error.set('');
    this.setDirty(true);
  }
  setName(value: string): void {
    this.edit(() => this.name.set(value), false);
  }
  setSeed(value: string): void {
    this.edit(() => this.seed.set(value), true);
  }
  setSize(value: string): void {
    if (!['5000', '10000', '15000'].includes(value)) return;
    const recipe = this.recipe();
    if (recipe)
      this.edit(
        () =>
          this.recipe.set({
            ...recipe,
            settings: { ...recipe.settings, widthM: Number(value), heightM: Number(value) },
          }),
        true,
      );
  }
  setLandscape(value: string): void {
    if (!LANDSCAPES.some((item) => item.id === value)) return;
    const recipe = this.recipe();
    if (!recipe) return;
    this.edit(() => {
      const settings = battlefieldPreset(value as BattlefieldPreset).settings;
      this.recipe.set({
        ...recipe,
        settings: { ...settings, widthM: recipe.settings.widthM, heightM: recipe.settings.heightM },
      });
      this.landscape.set(value);
    }, true);
  }
  async generate(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.canGenerate()) return;
    const operation = this.begin();
    if (!operation) return;
    this.board.set(undefined);
    this.setDirty(true);
    if (!this.current(operation)) return;
    this.phase.set('Generating map…');
    try {
      const received = await operation.ports.preparation.generate(
        structuredClone(draft),
        operation.abort.signal,
      );
      if (!this.current(operation)) return;
      const result = structuredClone(received);
      const asset = parseAsset(result.asset);
      if (
        result.summary.ref !== null ||
        canonicalizeAsset(asset) !== result.canonicalJson ||
        JSON.stringify(
          parseReplayParameters({
            seed: asset.provenance.seed,
            settings: asset.settings,
            overrides: asset.overrides,
          }),
        ) !== JSON.stringify(draft) ||
        asset.bounds.minX !== 0 ||
        asset.bounds.minY !== 0 ||
        result.bounds.minX !== 0 ||
        result.bounds.minY !== 0 ||
        result.bounds.maxX !== asset.bounds.maxX ||
        result.bounds.maxY !== asset.bounds.maxY ||
        result.summary.widthM !== asset.bounds.maxX ||
        result.summary.heightM !== asset.bounds.maxY ||
        (await assetIdentity(asset, 'asset')) !== result.assetIdentity
      )
        throw new Error('Candidate mismatch');
      if (!this.current(operation)) return;
      this.board.set({ ...result, asset });
      this.phase.set('Unsaved');
    } catch {
      if (this.current(operation)) {
        this.phase.set('Not generated');
        this.error.set('The map could not be generated. Please try Generate map again.');
      }
    } finally {
      this.finish(operation);
    }
  }
  async save(): Promise<void> {
    if (!this.canSave()) return;
    const board = this.board()!;
    if (!this.intent)
      this.intent = {
        requestId: crypto.randomUUID(),
        name: this.name(),
        canonicalJson: board.canonicalJson,
        assetIdentity: board.assetIdentity,
      };
    const intent = this.intent;
    this.pending.set(true);
    const operation = this.begin();
    if (!operation) return;
    this.phase.set('Saving map…');
    try {
      const received = await operation.ports.library.save(
        {
          requestId: intent.requestId,
          name: intent.name,
          canonicalJson: intent.canonicalJson,
          assetIdentity: intent.assetIdentity,
        },
        operation.abort.signal,
      );
      if (!this.current(operation)) return;
      const saved = checkedSummary(received);
      if (
        saved.name !== intent.name ||
        saved.assetIdentity !== intent.assetIdentity ||
        saved.widthM !== board.bounds.maxX ||
        saved.heightM !== board.bounds.maxY ||
        (intent.accepted && !sameSummary(intent.accepted, saved))
      )
        throw new Error('Save mismatch');
      intent.accepted = saved;
      const readback = await operation.ports.library.read({ ...saved.ref }, operation.abort.signal);
      if (!this.current(operation)) return;
      if (
        !sameSummary(saved, checkedSummary(readback.item)) ||
        readback.canonicalJson !== intent.canonicalJson
      )
        throw new Error('Readback mismatch');
      const asset = importAsset(readback.canonicalJson);
      if (
        canonicalizeAsset(asset) !== intent.canonicalJson ||
        (await assetIdentity(asset, 'asset')) !== intent.assetIdentity ||
        asset.bounds.maxX !== saved.widthM ||
        asset.bounds.maxY !== saved.heightM
      )
        throw new Error('Identity mismatch');
      if (!this.current(operation)) return;
      this.completed.set(saved);
      this.pending.set(false);
      this.phase.set('Saved · Needs a scenario');
      this.setDirty(false);
      if (this.current(operation)) this.events.saved(structuredClone(saved));
    } catch {
      if (this.current(operation) && !this.completed()) {
        this.phase.set('Save not verified');
        this.error.set(
          'The save could not be verified. It may already be saved. Retry Save map to recover the same map, or discard this draft.',
        );
      }
    } finally {
      this.finish(operation);
    }
  }
  requestCancel(): void {
    if (this.destroyed || this.closed() || !this.ports() || this.confirming()) return;
    const owner = this.owner;
    this.invalidate();
    if (owner !== this.owner || this.destroyed || this.closed()) return;
    if (this.dirty()) {
      this.phase.set(
        this.pending()
          ? 'Save not verified'
          : this.board()
            ? 'Unsaved'
            : 'Generation stopped. Generate map to try again.',
      );
      this.confirming.set(true);
      if (this.pending())
        this.error.set(
          'The map may already be saved. Discarding stops recovery; it does not delete a saved map.',
        );
    } else this.close();
  }
  keepEditing(): void {
    if (!this.closed()) this.confirming.set(false);
  }
  discard(): void {
    if (this.confirming()) this.close();
  }
  private close(): void {
    const ports = this.ports();
    const owner = ++this.owner;
    this.closed.set(true);
    this.ports.set(undefined);
    this.invalidate();
    if (owner !== this.owner || this.destroyed) {
      if (ports && this.ports()?.preparation !== ports.preparation) this.release(ports.preparation);
      return;
    }
    this.board.set(undefined);
    this.confirming.set(false);
    this.setDirty(false);
    if (ports && this.ports()?.preparation !== ports.preparation) this.release(ports.preparation);
    if (!this.destroyed && owner === this.owner) this.events.cancelled();
  }
  private release(preparation: BoardPreparation): void {
    if (this.released.has(preparation)) return;
    this.released.add(preparation);
    this.acquired.delete(preparation);
    try {
      preparation.dispose();
    } catch {
      /* Cleanup is owned once even when a port throws. */
    }
  }
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const ports = this.ports();
    this.ports.set(undefined);
    ++this.owner;
    this.closed.set(true);
    this.invalidate();
    this.board.set(undefined);
    if (ports) this.release(ports.preparation);
    for (const preparation of this.acquired) this.release(preparation);
  }
}
