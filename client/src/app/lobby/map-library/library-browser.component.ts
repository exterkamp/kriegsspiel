import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  afterRenderEffect,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { assetIdentity, canonicalizeAsset, importAsset, parseAsset } from '@kriegsspiel/maps';
import type {
  BoardPreparation,
  CertifiedBoard,
  MapSummary,
} from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import { MAP_LIBRARY_PREVIEW_FACTORY, type LibraryPreview } from './map-library.component';

type Source = 'included' | 'owned';
type Load = { abort: AbortController; preparation?: BoardPreparation; disposed: boolean };
type Mount = { canvas: HTMLCanvasElement; preview?: LibraryPreview; disposed: boolean };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function summary(value: LibraryMapSummary, source: Source): LibraryMapSummary {
  const item = structuredClone(value);
  if (
    !item ||
    Array.isArray(item) ||
    Object.keys(item).some(
      (key) =>
        !['ref', 'name', 'widthM', 'heightM', 'assetIdentity', 'status', 'createdAtMs'].includes(
          key,
        ),
    ) ||
    !item.ref ||
    Array.isArray(item.ref) ||
    Object.keys(item.ref).length !== 2 ||
    item.ref.kind !== source ||
    typeof item.ref.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(item.ref.id) ||
    (source === 'owned' && !uuid.test(item.ref.id)) ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.length > 160 ||
    item.status !== 'needs-scenario' ||
    typeof item.assetIdentity !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.assetIdentity) ||
    ![item.widthM, item.heightM].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 20000,
    ) ||
    (item.createdAtMs !== undefined &&
      (!Number.isSafeInteger(item.createdAtMs) || item.createdAtMs < 0))
  )
    throw new Error('Invalid map summary');
  return item;
}
const same = (a: LibraryMapSummary, b: LibraryMapSummary) =>
  a.ref.kind === b.ref.kind &&
  a.ref.id === b.ref.id &&
  a.name === b.name &&
  a.widthM === b.widthM &&
  a.heightM === b.heightM &&
  a.assetIdentity === b.assetIdentity &&
  a.status === b.status &&
  a.createdAtMs === b.createdAtMs;
const cursorValid = (cursor: unknown): cursor is string =>
  typeof cursor === 'string' && /^[\x21-\x7e]{1,512}$/.test(cursor);

/** Read-only geography inspection. Library references are adapted only for the preparation port. */
@Component({
  selector: 'ks-library-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './library-browser.component.html',
  styleUrl: './library-browser.component.css',
  host: { class: 'ks-theme' },
})
export class LibraryBrowserComponent implements OnChanges {
  readonly library = input.required<MapLibraryPort>();
  readonly preparationFactory = input.required<() => BoardPreparation>();
  readonly source = input.required<Source>();
  readonly initialItem = input<LibraryMapSummary>();
  readonly enabled = input(true);
  readonly addRequested = output<void>();
  readonly backRequested = output<void>();
  readonly items = signal<readonly LibraryMapSummary[]>([]);
  readonly selected = signal<LibraryMapSummary | undefined>(undefined);
  readonly board = signal<CertifiedBoard | undefined>(undefined);
  readonly loading = signal(false);
  readonly reading = signal(false);
  readonly listError = signal('');
  readonly readError = signal('');
  readonly previewError = signal('');
  readonly nextCursor = signal<string | undefined>(undefined);
  readonly page = signal(0);
  private cursors: (string | undefined)[] = [undefined];
  private listAbort: AbortController | undefined;
  private load: Load | undefined;
  private destroyed = false;
  private retired = false;
  private owner = 0;
  private readonly inspectionHeading = viewChild<ElementRef<HTMLElement>>('inspectionHeading');
  private readonly inspectionFocus = signal<
    { owner: number; item: LibraryMapSummary; page: number } | undefined
  >(undefined);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly factory = inject(MAP_LIBRARY_PREVIEW_FACTORY);
  private mount: Mount | undefined;

  constructor() {
    afterRenderEffect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (!canvas || this.destroyed) return;
      onCleanup(() => untracked(() => this.unmount(canvas)));
      untracked(() => this.mountPreview(canvas));
    });
    afterRenderEffect(() => {
      const request = this.inspectionFocus();
      const heading = this.inspectionHeading()?.nativeElement;
      if (!request || !heading) return;
      this.inspectionFocus.set(undefined);
      if (
        !this.destroyed &&
        !this.retired &&
        this.enabled() &&
        request.owner === this.owner &&
        request.item === this.selected() &&
        request.page === this.page() &&
        heading.isConnected
      )
        heading.focus({ preventScroll: true });
    });
    effect(() => {
      const board = this.board();
      untracked(() => {
        if (board && this.mount) this.show(this.mount, board.asset);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.owner;
      this.listAbort?.abort();
      this.releaseLoad();
      this.unmount();
    });
  }
  /** Called by the dialog owner only after its save/history transition is rendered. */
  requestInspectionFocus(ref: LibraryMapSummary['ref']): boolean {
    const item = this.selected();
    if (
      this.destroyed ||
      this.retired ||
      !this.enabled() ||
      !item ||
      item.ref.kind !== ref.kind ||
      item.ref.id !== ref.id
    )
      return false;
    this.inspectionFocus.set({ owner: this.owner, item, page: this.page() });
    return true;
  }
  retire(): void {
    this.retired = true;
    this.inspectionFocus.set(undefined);
    ++this.owner;
    this.listAbort?.abort();
    this.listAbort = undefined;
    this.releaseLoad();
    this.unmount();
    this.board.set(undefined);
    this.selected.set(undefined);
  }
  ngOnChanges(): void {
    this.inspectionFocus.set(undefined);
    const owner = ++this.owner;
    this.listAbort?.abort();
    this.releaseLoad();
    this.unmount();
    if (this.destroyed || owner !== this.owner) return;
    this.retired = false;
    this.cursors = [undefined];
    this.page.set(0);
    this.items.set([]);
    this.nextCursor.set(undefined);
    void this.loadPage(0);
    const initial = this.initialItem();
    if (initial) void this.inspect(initial);
  }
  async loadPage(page: number): Promise<void> {
    if (
      this.destroyed ||
      this.retired ||
      !this.enabled() ||
      page < 0 ||
      page >= this.cursors.length
    )
      return;
    this.inspectionFocus.set(undefined);
    const owner = this.owner;
    this.listAbort?.abort();
    const abort = new AbortController();
    this.listAbort = abort;
    this.releaseLoad();
    this.unmount();
    this.selected.set(undefined);
    this.board.set(undefined);
    this.page.set(page);
    this.items.set([]);
    this.nextCursor.set(undefined);
    this.listError.set('');
    this.readError.set('');
    this.loading.set(true);
    const source = this.source();
    const cursor = this.cursors[page];
    const current = () =>
      !this.destroyed &&
      !this.retired &&
      owner === this.owner &&
      this.listAbort === abort &&
      !abort.signal.aborted;
    try {
      const received = await this.library().list(source, abort.signal, cursor);
      if (!current()) return;
      const data = structuredClone(received);
      if (
        !data ||
        Object.keys(data).some((key) => !['items', 'nextCursor'].includes(key)) ||
        !Array.isArray(data.items) ||
        data.items.length > 20 ||
        new TextEncoder().encode(JSON.stringify(data)).byteLength > 32768 ||
        (data.nextCursor !== undefined &&
          (!cursorValid(data.nextCursor) ||
            this.cursors.slice(0, page + 1).includes(data.nextCursor)))
      )
        throw new Error('Invalid map page');
      const items = data.items.map((item) => summary(item, source));
      if (new Set(items.map((item) => item.ref.id)).size !== items.length)
        throw new Error('Duplicate map');
      if (!current()) return;
      this.items.set(items);
      this.nextCursor.set(data.nextCursor);
    } catch {
      if (current()) this.listError.set('The maps could not be loaded. Please retry.');
    } finally {
      if (current()) this.loading.set(false);
    }
  }
  restart(): void {
    if (this.destroyed || this.retired || !this.enabled() || this.loading()) return;
    this.cursors = [undefined];
    void this.loadPage(0);
  }
  next(): void {
    const cursor = this.nextCursor();
    if (this.destroyed || this.retired || this.loading() || !cursor || !this.enabled()) return;
    this.cursors = [...this.cursors.slice(0, this.page() + 1), cursor];
    void this.loadPage(this.page() + 1);
  }
  previous(): void {
    if (!this.retired && !this.destroyed && !this.loading() && this.page() > 0)
      void this.loadPage(this.page() - 1);
  }
  async inspect(value: LibraryMapSummary): Promise<void> {
    if (this.destroyed || this.retired || !this.enabled()) return;
    this.inspectionFocus.set(undefined);
    this.releaseLoad();
    this.unmount();
    this.board.set(undefined);
    this.readError.set('');
    this.previewError.set('');
    this.selected.set(undefined);
    const load: Load = { abort: new AbortController(), disposed: false };
    this.load = load;
    const owner = this.owner;
    const current = () =>
      !this.destroyed &&
      !this.retired &&
      owner === this.owner &&
      this.load === load &&
      !load.abort.signal.aborted;
    this.reading.set(true);
    try {
      const item = summary(value, this.source());
      this.selected.set(item);
      const received = await this.library().read({ ...item.ref }, load.abort.signal);
      if (!current()) return;
      const readback = structuredClone(received);
      if (
        !same(item, summary(readback.item, this.source())) ||
        typeof readback.canonicalJson !== 'string' ||
        readback.canonicalJson.length > 64 * 1024 * 1024 ||
        new TextEncoder().encode(readback.canonicalJson).byteLength > 64 * 1024 * 1024
      )
        throw new Error('Invalid readback');
      const asset = importAsset(readback.canonicalJson);
      if (
        canonicalizeAsset(asset) !== readback.canonicalJson ||
        asset.bounds.minX !== 0 ||
        asset.bounds.minY !== 0 ||
        asset.bounds.maxX !== item.widthM ||
        asset.bounds.maxY !== item.heightM ||
        (await assetIdentity(asset, 'asset')) !== item.assetIdentity
      )
        throw new Error('Readback mismatch');
      if (!current()) return;
      const preparation = this.preparationFactory()();
      if (!current()) {
        preparation.dispose();
        return;
      }
      load.preparation = preparation;
      // Explicit in-memory adapter. No development catalog/session or endpoint is consulted.
      const adapted: MapSummary = {
        ref: { kind: item.ref.kind === 'included' ? 'premade' : 'generated', id: item.ref.id },
        name: item.name,
        widthM: item.widthM,
        heightM: item.heightM,
      };
      const receivedBoard = await preparation.load(
        readback.canonicalJson,
        adapted,
        load.abort.signal,
      );
      if (!current()) return;
      const board = structuredClone(receivedBoard);
      const checkedAsset = parseAsset(board.asset);
      if (
        board.canonicalJson !== readback.canonicalJson ||
        canonicalizeAsset(checkedAsset) !== readback.canonicalJson ||
        board.assetIdentity !== item.assetIdentity ||
        (await assetIdentity(checkedAsset, 'asset')) !== item.assetIdentity ||
        board.bounds.minX !== 0 ||
        board.bounds.minY !== 0 ||
        board.bounds.maxX !== item.widthM ||
        board.bounds.maxY !== item.heightM ||
        board.summary.widthM !== item.widthM ||
        board.summary.heightM !== item.heightM ||
        board.summary.ref?.kind !== adapted.ref.kind ||
        board.summary.ref.id !== adapted.ref.id
      )
        throw new Error('Certification mismatch');
      if (!current()) return;
      this.board.set({ ...board, asset: checkedAsset });
    } catch {
      if (current()) {
        this.readError.set('This map could not be checked. Please retry the preview.');
        this.disposePreparation(load);
      }
    } finally {
      if (current()) this.reading.set(false);
    }
  }
  retryRead(): void {
    const item = this.selected();
    if (item) void this.inspect(item);
  }
  private disposePreparation(load: Load): void {
    if (load.disposed) return;
    load.disposed = true;
    try {
      load.preparation?.dispose();
    } catch {
      /* Release ownership once. */
    }
  }
  private releaseLoad(): void {
    const load = this.load;
    this.load = undefined;
    this.reading.set(false);
    if (load) {
      load.abort.abort();
      this.disposePreparation(load);
    }
  }
  retryPreview(): void {
    const canvas = this.canvas()?.nativeElement;
    if (canvas) this.mountPreview(canvas);
  }
  private unmount(canvas?: HTMLCanvasElement): void {
    const mount = this.mount;
    if (!mount || (canvas && mount.canvas !== canvas)) return;
    this.mount = undefined;
    mount.disposed = true;
    try {
      mount.preview?.dispose();
    } catch {
      /* Retired preview never reused. */
    }
  }
  private owns(mount: Mount): boolean {
    return !this.destroyed && this.mount === mount && !mount.disposed;
  }
  private mountPreview(canvas: HTMLCanvasElement): void {
    if (this.destroyed || !this.board()) return;
    this.unmount();
    const mount: Mount = { canvas, disposed: false };
    this.mount = mount;
    this.previewError.set('');
    try {
      const preview = this.factory(canvas);
      if (!this.owns(mount)) {
        preview.dispose();
        return;
      }
      mount.preview = preview;
      const board = this.board();
      if (board) this.show(mount, board.asset);
    } catch {
      if (this.owns(mount))
        this.previewError.set('The preview could not be displayed. Please retry.');
    }
  }
  private show(mount: Mount, asset: unknown): void {
    if (!this.owns(mount) || !mount.preview) return;
    try {
      const result = mount.preview.loadAsset(structuredClone(asset));
      if (this.owns(mount))
        this.previewError.set(result.ok ? '' : 'The preview could not be displayed. Please retry.');
    } catch {
      if (this.owns(mount))
        this.previewError.set('The preview could not be displayed. Please retry.');
    }
  }
}
