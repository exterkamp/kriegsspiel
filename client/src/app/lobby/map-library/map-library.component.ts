import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Injector,
  afterNextRender,
  afterRenderEffect,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type OnChanges,
} from '@angular/core';
import { MapPreview } from '../../../legacy/map-authoring/preview';
import type { ReplayParameters } from '../../../legacy/map-authoring/generation/protocol';
import type { BoardPreparation } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import { LANDSCAPES, MapLibraryState } from './map-library-state';
import { MAP_LIBRARY_ASSET_VERIFIER } from './asset-verifier';

export type LibraryPreview = Pick<MapPreview, 'loadAsset' | 'dispose'>;
export const MAP_LIBRARY_PREVIEW_FACTORY = new InjectionToken<
  (canvas: HTMLCanvasElement) => LibraryPreview
>('library geography preview', { factory: () => (canvas) => new MapPreview(canvas) });
type Mount = { canvas: HTMLCanvasElement; preview: LibraryPreview | undefined; released: boolean };

/** Inline content for the parent's dialog. The parent retains modal, history and final focus ownership. */
@Component({
  selector: 'ks-map-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ks-theme', '(keydown)': 'key($event)' },
  templateUrl: './map-library.component.html',
  styleUrl: './map-library.component.css',
})
export class MapLibraryComponent implements OnChanges {
  readonly preparation = input.required<BoardPreparation>();
  readonly library = input.required<MapLibraryPort>();
  readonly initialRecipe = input<ReplayParameters>();
  readonly saved = output<LibraryMapSummary>();
  readonly cancelled = output<void>();
  readonly dirtyChange = output<boolean>();
  readonly state = new MapLibraryState(
    {
      saved: (value) => this.saved.emit(value),
      cancelled: () => this.cancelled.emit(),
      dirty: (value) => this.dirtyChange.emit(value),
    },
    inject(MAP_LIBRARY_ASSET_VERIFIER),
  );
  protected readonly landscapes = LANDSCAPES;
  protected readonly previewError = signal('');
  protected readonly id = `ks-library-${crypto.randomUUID()}`;
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly factory = inject(MAP_LIBRARY_PREVIEW_FACTORY);
  private mount: Mount | undefined;
  private destroyed = false;
  private returnTo: HTMLElement | undefined;

  constructor() {
    const render = afterRenderEffect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (!canvas || this.destroyed) return;
      onCleanup(() => untracked(() => this.unmount(canvas)));
      untracked(() => this.mountPreview(canvas));
    });
    afterRenderEffect(() => {
      const heading = this.confirmHeading()?.nativeElement;
      if (heading && !this.destroyed) heading.focus({ preventScroll: true });
    });
    effect(() => {
      const board = this.state.board();
      untracked(() => {
        if (board && this.mount) this.show(this.mount, board.asset);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      render.destroy();
      this.state.dispose();
      this.unmount();
    });
  }
  ngOnChanges(): void {
    this.unmount();
    this.previewError.set('');
    this.state.configure(this.preparation(), this.library(), this.initialRecipe());
  }
  /** Parent Cancel/Escape/Back must route here before removing this child. */
  requestCancel(): void {
    const focused = document.activeElement;
    if (!this.state.confirming() && focused instanceof HTMLElement) this.returnTo = focused;
    this.state.requestCancel();
    if (this.state.closed()) this.unmount();
  }
  protected discard(): void {
    this.state.discard();
    if (this.state.closed()) this.unmount();
  }
  protected keepEditing(): void {
    this.state.keepEditing();
    const destination = this.returnTo;
    afterNextRender(
      () => {
        if (this.destroyed || this.state.closed() || this.state.confirming()) return;
        const target =
          destination?.isConnected && !destination.matches(':disabled')
            ? destination
            : this.element.nativeElement.querySelector<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)',
              );
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
  protected key(event: KeyboardEvent): void {
    if (
      event.key === 'Enter' &&
      !(event.target instanceof Element && event.target.matches('button, summary'))
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  protected retryPreview(): void {
    const canvas = this.canvas()?.nativeElement;
    if (canvas) this.mountPreview(canvas);
  }
  private owns(mount: Mount): boolean {
    return !this.destroyed && !this.state.closed() && this.mount === mount && !mount.released;
  }
  private release(mount: Mount | undefined): void {
    if (!mount || mount.released) return;
    mount.released = true;
    const preview = mount.preview;
    mount.preview = undefined;
    try {
      preview?.dispose();
    } catch {
      /* Never retain or double-release a failed preview. */
    }
  }
  private unmount(canvas?: HTMLCanvasElement): void {
    if (canvas && this.mount?.canvas !== canvas) return;
    const mount = this.mount;
    this.mount = undefined;
    this.release(mount);
  }
  private mountPreview(canvas: HTMLCanvasElement): void {
    if (this.destroyed || this.state.closed()) return;
    this.unmount();
    const mount: Mount = { canvas, preview: undefined, released: false };
    this.mount = mount;
    this.previewError.set('');
    try {
      const preview = this.factory(canvas);
      if (!this.owns(mount)) {
        preview.dispose();
        return;
      }
      mount.preview = preview;
      const board = this.state.board();
      if (board) this.show(mount, board.asset);
    } catch {
      if (this.owns(mount))
        this.previewError.set('The map preview could not be displayed. Please try again.');
    }
  }
  private show(mount: Mount, asset: unknown): void {
    if (!this.owns(mount) || !mount.preview) return;
    try {
      const result = mount.preview.loadAsset(structuredClone(asset));
      if (this.owns(mount))
        this.previewError.set(
          result.ok ? '' : 'The map preview could not be displayed. Please try again.',
        );
    } catch {
      if (this.owns(mount))
        this.previewError.set('The map preview could not be displayed. Please try again.');
    }
  }
}
