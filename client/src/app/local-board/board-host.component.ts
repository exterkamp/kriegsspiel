import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  InjectionToken,
  afterRenderEffect,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Coord } from '@kriegsspiel/protocol';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import {
  createLocalBoardBinding,
  snapshotCertifiedBoard,
  validateLocalPresentation,
} from './board-binding';
import { BoardSurface } from './board-surface';
import type {
  LocalBoardBinding,
  LocalInitializationResult,
  LocalPresentation,
  LocalSessionKey,
} from './contracts';

export interface LocalBoardAvailability {
  readonly key: LocalSessionKey;
  readonly ready: boolean;
  readonly error?: string;
}
export interface LocalBoardPoint {
  readonly key: LocalSessionKey;
  readonly at: Readonly<Coord>;
}
export type BoardSurfaceHandle = Pick<
  BoardSurface,
  | 'mount'
  | 'unmount'
  | 'dispose'
  | 'apply'
  | 'setInteractionEnabled'
  | 'setCameraEnabled'
  | 'resize'
  | 'snap'
  | 'pickAt'
>;
export type BoardSurfaceFactory = (
  key: LocalSessionKey,
  board: CertifiedBoard,
  binding: LocalBoardBinding,
  availability: (ready: boolean, error?: string) => void,
) => BoardSurfaceHandle;
export const BOARD_SURFACE_FACTORY = new InjectionToken<BoardSurfaceFactory>(
  'BOARD_SURFACE_FACTORY',
  {
    providedIn: 'root',
    factory: () => (key, board, binding, onAvailability) =>
      new BoardSurface(key, board, binding, { onAvailability }),
  },
);
export const BOARD_BINDING_FACTORY = new InjectionToken<typeof createLocalBoardBinding>(
  'BOARD_BINDING_FACTORY',
  {
    providedIn: 'root',
    factory: () => createLocalBoardBinding,
  },
);
interface CanvasMount {
  readonly canvas: HTMLCanvasElement;
  readonly abort: AbortController;
  pending: Promise<void>;
  retired: boolean;
  retirement?: Promise<void>;
}

@Component({
  selector: 'ks-local-board-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-host.component.html',
  styleUrl: './board-host.component.css',
})
export class BoardHostComponent {
  readonly key = input.required<LocalSessionKey>();
  readonly board = input.required<CertifiedBoard>();
  readonly presentation = input.required<LocalPresentation>();
  readonly interactionEnabled = input(true);
  readonly cameraEnabled = input(true);
  readonly initialized = output<LocalInitializationResult>();
  readonly availability = output<LocalBoardAvailability>();
  readonly pointed = output<LocalBoardPoint>();
  private readonly currentState = signal<{ readonly ready: boolean; readonly error?: string }>({
    ready: false,
  });
  readonly state = this.currentState.asReadonly();
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly makeSurface = inject(BOARD_SURFACE_FACTORY);
  private readonly makeBinding = inject(BOARD_BINDING_FACTORY);
  private surface?: BoardSurfaceHandle;
  private binding?: LocalBoardBinding;
  private session?: { key: LocalSessionKey; input: CertifiedBoard; board: CertifiedBoard };
  private current?: CanvasMount;
  private retirement = Promise.resolve();
  private disposal?: Promise<void>;
  private surfaceDisposal?: Promise<void>;
  private terminal = false;
  private failed = false;
  private destroyed = false;
  private initialResultSent = false;
  private readonly listeners = new AbortController();

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.destroyed = true;
      void this.teardown();
    });
    // Departure can happen before the first canvas render or while binding is hashing.
    inject(DOCUMENT).defaultView?.addEventListener(
      'pagehide',
      () => {
        void this.teardown();
      },
      { signal: this.listeners.signal },
    );
    const render = afterRenderEffect((onCleanup) => {
      const canvas = this.canvas()?.nativeElement;
      if (this.terminal || this.failed || !canvas) return;
      // Only canvas identity is tracked. Cleanup exists before any asynchronous acquisition.
      onCleanup(() =>
        untracked(() => {
          this.releaseCanvas(canvas);
        }),
      );
      untracked(() => this.mountCanvas(canvas));
    });
    destroy.onDestroy(() => render.destroy());
    effect(() => {
      const key = this.key();
      const board = this.board();
      const presentation = this.presentation();
      const enabled = this.interactionEnabled();
      const cameraEnabled = this.cameraEnabled();
      untracked(() => {
        if (this.terminal || this.failed || !this.session) return;
        try {
          if (key !== this.session.key || board !== this.session.input)
            throw new Error('Replace the board through a fresh keyed host.');
          if (this.binding) validateLocalPresentation(presentation, this.binding);
          this.surface?.setInteractionEnabled(enabled);
          this.surface?.setCameraEnabled(cameraEnabled);
          if (this.state().ready) this.surface?.apply(presentation);
        } catch (error) {
          this.fail(error);
        }
      });
    });
  }

  private active(mount: CanvasMount): boolean {
    return (
      !this.terminal &&
      !this.failed &&
      !mount.retired &&
      !mount.abort.signal.aborted &&
      this.current === mount
    );
  }
  private publish(ready: boolean, error?: string): void {
    this.currentState.set(error ? { ready, error } : { ready });
    const key = this.session?.key;
    if (!this.destroyed && key)
      this.availability.emit(error ? { key, ready, error } : { key, ready });
  }
  private initial(ok: boolean, error?: string): void {
    if (this.destroyed || this.terminal || this.initialResultSent || !this.session) return;
    this.initialResultSent = true;
    this.initialized.emit(
      ok
        ? { key: this.session.key, ok: true }
        : { key: this.session.key, ok: false, error: error ?? 'Board initialization failed.' },
    );
  }
  private fail(error: unknown): void {
    if (this.terminal || this.failed || this.destroyed) return;
    this.failed = true;
    const message = error instanceof Error ? error.message : 'Board rendering failed.';
    this.publish(false, message);
    this.initial(false, message);
    if (this.current) this.releaseCanvas(this.current.canvas, message);
    void this.disposeSurface();
  }

  private mountCanvas(canvas: HTMLCanvasElement): void {
    if (this.terminal || this.failed || this.current?.canvas === canvas) return;
    if (this.current) this.releaseCanvas(this.current.canvas);
    const predecessor = this.retirement;
    const mount: CanvasMount = {
      canvas,
      abort: new AbortController(),
      pending: Promise.resolve(),
      retired: false,
    };
    this.current = mount;
    mount.pending = Promise.resolve()
      .then(async () => {
        await predecessor;
        if (!this.active(mount)) return;
        if (!this.session) {
          const input = this.board();
          // Captured before the first await; later caller mutation cannot alter session geography.
          this.session = { key: this.key(), input, board: input };
          this.session.board = snapshotCertifiedBoard(input);
        }
        const session = this.session;
        if (session.key !== this.key() || session.input !== this.board())
          throw new Error('Replace the board through a fresh keyed host.');
        if (!this.surface) {
          const binding = await this.makeBinding(session.board, mount.abort.signal);
          if (!this.active(mount)) return;
          validateLocalPresentation(this.presentation(), binding);
          const handoff: { surface?: BoardSurfaceHandle; error?: string } = {};
          handoff.surface = this.makeSurface(
            session.key,
            session.board,
            binding,
            (ready, error) => {
              // Success is published by the host only after the latest inputs also render.
              if (!ready && !handoff.surface) handoff.error = error ?? 'Board acquisition failed.';
              if (
                !ready &&
                handoff.surface &&
                !this.terminal &&
                !this.failed &&
                this.surface === handoff.surface
              )
                this.publish(false, error);
            },
          );
          const surface = handoff.surface;
          if (!this.active(mount)) {
            await surface.dispose();
            return;
          }
          this.binding = binding;
          this.surface = surface;
          if (handoff.error) throw new Error(handoff.error);
        }
        const surface = this.surface;
        surface.setInteractionEnabled(this.interactionEnabled());
        surface.setCameraEnabled(this.cameraEnabled());
        if (!this.active(mount)) return;
        const initial = validateLocalPresentation(this.presentation(), this.binding!);
        await surface.mount(canvas, mount.abort.signal, initial);
        if (!this.active(mount)) return;
        // Inputs can change during hashing/mounting. Render the current detached marks before success.
        surface.apply(validateLocalPresentation(this.presentation(), this.binding!));
        if (!this.active(mount)) return;
        this.publish(true);
        if (this.active(mount)) this.initial(true);
      })
      .catch((error: unknown) => {
        if (this.active(mount)) this.fail(error);
      });
    this.publish(false);
  }

  private releaseCanvas(canvas: HTMLCanvasElement, error?: string): Promise<void> {
    const mount = this.current;
    if (!mount || mount.canvas !== canvas) return this.retirement;
    if (mount.retirement) return mount.retirement;
    mount.retired = true;
    this.current = undefined;
    const surface = this.surface;
    mount.retirement = mount.pending
      .catch(() => {})
      .then(async () => {
        try {
          await surface?.unmount(canvas);
        } catch {
          /* Teardown acknowledgement still settles. */
        }
      });
    this.retirement = mount.retirement;
    this.publish(false, error);
    mount.abort.abort();
    return mount.retirement;
  }

  /** A5 retains this promise before keyed replacement; Angular destruction initiates it too. */
  teardown(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.terminal = true;
    this.disposal = Promise.resolve().then(async () => {
      await this.retirement;
      await this.disposeSurface();
      this.surface = undefined;
    });
    if (this.current) this.releaseCanvas(this.current.canvas);
    else this.publish(false, this.state().error);
    try {
      this.listeners.abort();
    } catch {
      /* Keep retiring pending canvas work. */
    }
    // Invalidate surface callbacks/RAF immediately, while awaiting late acquisition separately.
    void this.disposeSurface();
    return this.disposal;
  }
  private disposeSurface(): Promise<void> {
    if (this.surfaceDisposal) return this.surfaceDisposal;
    const surface = this.surface;
    if (!surface) return Promise.resolve();
    this.surface = undefined;
    let settle!: () => void;
    this.surfaceDisposal = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      void Promise.resolve(surface.dispose()).then(settle, settle);
    } catch {
      settle();
    }
    return this.surfaceDisposal;
  }
  snap(view: 'top-down' | 'oblique'): void {
    if (!this.terminal && this.state().ready && this.interactionEnabled() && this.cameraEnabled())
      this.surface?.snap(view);
  }
  resize(): void {
    if (!this.terminal) this.surface?.resize();
  }
  pickAt(x: number, y: number): Readonly<Coord> | null {
    return !this.terminal && this.state().ready && this.interactionEnabled()
      ? (this.surface?.pickAt(x, y) ?? null)
      : null;
  }
  point(event: MouseEvent): void {
    if (
      event.button !== 0 ||
      this.cameraEnabled() ||
      this.terminal ||
      !this.interactionEnabled() ||
      !this.state().ready ||
      this.session?.key !== this.key()
    )
      return;
    const at = this.pickAt(event.clientX, event.clientY);
    if (at && !this.terminal && this.state().ready)
      this.pointed.emit(Object.freeze({ key: this.session!.key, at: Object.freeze({ ...at }) }));
  }
}
