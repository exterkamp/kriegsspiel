import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterRenderEffect,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  type OnChanges,
} from '@angular/core';
import { MapPreview } from '../../../legacy/map-authoring/preview.js';
import type { SetupProps } from '../../../shared/game-setup/contracts.js';
import { SETUP_PRESETS, SetupState, mapRefKey } from './setup-state';

export type SetupPreview = Pick<MapPreview, 'loadAsset' | 'dispose'>;
export const SETUP_PREVIEW_FACTORY = new InjectionToken<
  (canvas: HTMLCanvasElement) => SetupPreview
>('setup preview factory', { factory: () => (canvas) => new MapPreview(canvas) });
interface PreviewMount {
  readonly canvas: HTMLCanvasElement;
  preview: SetupPreview | null;
  released: boolean;
}

@Component({
  selector: 'ks-local-board-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent implements OnChanges {
  readonly catalog = input.required<SetupProps['catalog']>();
  readonly preparation = input.required<SetupProps['preparation']>();
  readonly initialRef = input<SetupProps['initialRef']>();
  readonly onStart = input.required<SetupProps['onStart']>();
  readonly onCancel = input.required<SetupProps['onCancel']>();
  readonly state = new SetupState();
  readonly presets = SETUP_PRESETS;
  readonly refKey = mapRefKey;
  readonly previewError = signal('');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly previewFactory = inject(SETUP_PREVIEW_FACTORY);
  private mount: PreviewMount | null = null;
  private destroyed = false;

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => void this.dispose());
    const render = afterRenderEffect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (!canvas || this.destroyed) return;
      onCleanup(() => untracked(() => this.unmount(canvas)));
      untracked(() => this.mountPreview(canvas));
    });
    destroy.onDestroy(() => render.destroy());
    effect(() => {
      const board = this.state.board();
      untracked(() => {
        if (board && this.mount?.preview) this.show(this.mount, board.asset);
      });
    });
  }

  ngOnChanges(): void {
    void this.state.configure({
      catalog: this.catalog(),
      preparation: this.preparation(),
      initialRef: this.initialRef(),
      onStart: this.onStart(),
      onCancel: this.onCancel(),
    });
  }

  private owns(mount: PreviewMount): boolean {
    return !this.destroyed && !this.state.closed() && this.mount === mount && !mount.released;
  }
  private release(mount: PreviewMount | null): void {
    if (!mount || mount.released) return;
    mount.released = true;
    const preview = mount.preview;
    mount.preview = null;
    try {
      preview?.dispose();
    } catch (error) {
      if (!this.destroyed && !this.state.closed()) this.previewError.set(this.message(error));
    }
  }
  private unmount(canvas: HTMLCanvasElement): void {
    if (this.mount?.canvas !== canvas) return;
    const mount = this.mount;
    this.mount = null;
    this.release(mount);
  }
  private mountPreview(canvas: HTMLCanvasElement): void {
    if (this.destroyed || this.state.closed()) return;
    const previous = this.mount;
    const mount: PreviewMount = { canvas, preview: null, released: false };
    this.mount = mount;
    this.release(previous);
    if (!this.owns(mount)) return;
    this.previewError.set('');
    try {
      const preview = this.previewFactory(canvas);
      if (!this.owns(mount)) {
        preview.dispose();
        return;
      }
      mount.preview = preview;
      const board = this.state.board();
      if (board) this.show(mount, board.asset);
    } catch (error) {
      if (this.owns(mount)) this.previewError.set(this.message(error));
    }
  }
  private show(mount: PreviewMount, asset: unknown): void {
    if (!this.owns(mount) || !mount.preview) return;
    try {
      const result = mount.preview.loadAsset(structuredClone(asset));
      if (!this.owns(mount)) return;
      this.previewError.set(result.ok ? '' : 'Certified map preview could not be displayed.');
    } catch (error) {
      if (this.owns(mount)) this.previewError.set(this.message(error));
    }
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Map preview failed';
  }

  /** A5 calls this from its dialog's native cancel event after preventDefault(). */
  cancel(): Promise<void> {
    if (this.state.starting()) return Promise.resolve();
    const cancelled = this.state.cancel();
    if (this.mount) this.unmount(this.mount.canvas);
    return cancelled;
  }

  /** A5 retains this promise before removing the component or allocating another owner. */
  dispose(): Promise<void> {
    this.destroyed = true;
    const retired = this.state.dispose();
    if (this.mount) this.unmount(this.mount.canvas);
    return retired;
  }
}
