import type { Coord } from '@kriegsspiel/protocol';
import {
  TableScene as FixtureTableScene,
  type PreviewRaster,
} from '../../legacy/table/FixtureTableScene';
import { prepareRaster, rasterLayout } from '../../shared/map-table/raster';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import {
  createLocalBoardBinding,
  sameLocalBinding,
  snapshotCertifiedBoard,
  validateLocalBinding,
  validateLocalPresentation,
  type BoardIdentity,
} from './board-binding';
import type { LocalBoardBinding, LocalPresentation, LocalSessionKey } from './contracts';

export type BoardScene = Pick<
  FixtureTableScene,
  | 'applyLocalBoard'
  | 'localBoardTextureLimit'
  | 'renderLocalBoardFrame'
  | 'snapTopDown'
  | 'snapOblique'
  | 'pickAt'
  | 'resize'
  | 'dispose'
> & {
  readonly controls: Pick<
    FixtureTableScene['controls'],
    'enabled' | 'update' | 'listenToKeyEvents'
  >;
};
export interface BoardSurfaceDependencies {
  sceneFactory?: (canvas: HTMLCanvasElement) => BoardScene;
  prepare?: typeof prepareRaster;
  identity?: BoardIdentity;
  observerFactory?: (callback: ResizeObserverCallback) => ResizeObserver;
  requestFrame?: typeof requestAnimationFrame;
  cancelFrame?: typeof cancelAnimationFrame;
  onAvailability?: (ready: boolean, error?: string) => void;
}
interface Mount {
  readonly canvas: HTMLCanvasElement;
  readonly abort: AbortController;
  pending: Promise<void>;
  retirement?: Promise<void>;
  scene?: BoardScene;
  observer?: ResizeObserver;
  listeners?: AbortController;
  detachAbort?: () => void;
  frame?: number;
  ready: boolean;
  retired: boolean;
}

/** Session-owned fixed geography; replaceable canvases own their own GPU/control lifetime. */
export class BoardSurface {
  readonly binding: LocalBoardBinding;
  private readonly board: CertifiedBoard;
  private mountLifetime?: Mount;
  private retirement = Promise.resolve();
  private disposal?: Promise<void>;
  private terminal = false;
  private interaction = true;
  private cameraEnabled = true;
  private raster?: PreviewRaster;
  private rasterRegistration?: {
    width: number;
    height: number;
    layout: ReturnType<typeof rasterLayout>;
  };
  private updating = false;

  constructor(
    readonly key: LocalSessionKey,
    board: CertifiedBoard,
    binding: LocalBoardBinding,
    private readonly dependencies: BoardSurfaceDependencies = {},
  ) {
    if (!/^local-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
      throw new TypeError('A fresh local UUID session key is required.');
    this.board = snapshotCertifiedBoard(board);
    this.binding = validateLocalBinding(binding);
    if (
      this.binding.assetIdentity !== this.board.assetIdentity ||
      this.binding.bounds.maxX !== this.board.bounds.maxX ||
      this.binding.bounds.maxY !== this.board.bounds.maxY
    )
      throw new TypeError('Board binding does not match its certified board.');
  }

  private active(mount: Mount): boolean {
    return (
      !this.terminal &&
      !mount.retired &&
      !mount.abort.signal.aborted &&
      this.mountLifetime === mount
    );
  }
  private check(mount: Mount): void {
    if (!this.active(mount)) throw new Error('Board mount cancelled.');
  }
  private publish(ready: boolean, error?: string): void {
    try {
      this.dependencies.onAvailability?.(ready, error);
    } catch {
      /* Subscribers cannot strand ownership. */
    }
  }

  mount(
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
    presentation: LocalPresentation,
  ): Promise<void> {
    if (this.terminal || signal.aborted) return Promise.reject(new Error('Board mount cancelled.'));
    if (!(canvas instanceof HTMLCanvasElement))
      return Promise.reject(new TypeError('A canvas is required.'));
    if (this.mountLifetime?.canvas === canvas) return this.mountLifetime.pending;
    let initial: LocalPresentation;
    try {
      initial = validateLocalPresentation(presentation, this.binding);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.mountLifetime) this.retire(this.mountLifetime);
    const predecessor = this.retirement;
    const mount: Mount = {
      canvas,
      abort: new AbortController(),
      pending: Promise.resolve(),
      ready: false,
      retired: false,
    };
    this.mountLifetime = mount;
    // Promise handoff is installed before any injected acquisition can reenter.
    mount.pending = Promise.resolve()
      .then(async () => {
        await predecessor;
        this.check(mount);
        const verified = await createLocalBoardBinding(
          this.board,
          mount.abort.signal,
          this.dependencies.identity,
        );
        this.check(mount);
        if (!sameLocalBinding(verified, this.binding))
          throw new TypeError('Verified board binding disagrees.');
        mount.scene = (
          this.dependencies.sceneFactory ??
          ((c) => new FixtureTableScene(c, { mode: 'local-hq-board' }))
        )(canvas);
        this.check(mount);
        const scene = mount.scene;
        const limit = scene.localBoardTextureLimit();
        this.check(mount);
        if (!this.raster) {
          const raster = (this.dependencies.prepare ?? prepareRaster)(
            this.board.asset,
            this.binding.assetIdentity,
            limit,
          );
          this.validateRaster(raster, limit);
          // A synchronous raster handoff can reenter canvas cleanup. Retain its valid
          // session artwork for the successor, without allocating/rendering on the old canvas.
          if (!this.terminal) {
            this.raster = Object.freeze({ ...raster });
            this.rasterRegistration = {
              width: raster.canvas.width,
              height: raster.canvas.height,
              layout: rasterLayout(raster.widthM, raster.heightM, limit),
            };
          }
          this.check(mount);
        } else this.validateRaster(this.raster, limit);
        this.check(mount);
        scene.controls.enabled = false;
        this.check(mount);
        scene.controls.listenToKeyEvents(canvas);
        this.check(mount);
        mount.observer = (
          this.dependencies.observerFactory ?? ((callback) => new ResizeObserver(callback))
        )(() => {
          if (this.active(mount)) this.resize();
        });
        this.check(mount);
        mount.observer.observe(canvas);
        this.check(mount);
        mount.listeners = new AbortController();
        const options = { signal: mount.listeners.signal };
        canvas.addEventListener(
          'webglcontextlost',
          (event) => {
            if (!this.active(mount)) return;
            event.preventDefault();
            this.fail(
              mount,
              new Error('WebGL context was lost. Retry with a fresh board session.'),
            );
          },
          options,
        );
        this.check(mount);
        const view = canvas.ownerDocument.defaultView;
        view?.addEventListener(
          'resize',
          () => {
            if (this.active(mount)) this.resize();
          },
          options,
        );
        this.check(mount);
        view?.addEventListener(
          'pagehide',
          () => {
            if (this.active(mount)) void this.dispose();
          },
          options,
        );
        this.check(mount);
        scene.resize();
        this.check(mount);
        const raster = this.raster;
        if (!raster) throw new Error('Session raster is unavailable.');
        scene.applyLocalBoard(raster, initial.marks);
        this.check(mount);
        scene.snapTopDown();
        this.check(mount);
        scene.renderLocalBoardFrame();
        this.check(mount);
        mount.ready = true;
        scene.controls.enabled = this.interaction && this.cameraEnabled;
        this.check(mount);
        this.schedule(mount);
        this.check(mount);
        this.publish(true);
        this.check(mount);
      })
      .catch((error: unknown) => {
        if (this.active(mount)) this.fail(mount, error);
        throw error;
      });
    const abort = () => this.retire(mount);
    mount.detachAbort = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) this.retire(mount);
    return mount.pending;
  }

  private validateRaster(raster: PreviewRaster, limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096)
      throw new TypeError('Invalid local board device cap.');
    const layout =
      this.rasterRegistration?.layout ??
      rasterLayout(this.binding.bounds.maxX, this.binding.bounds.maxY, limit);
    if (
      !(raster.canvas instanceof HTMLCanvasElement) ||
      raster.sourceKey !== this.binding.assetIdentity ||
      raster.widthM !== this.binding.bounds.maxX ||
      raster.heightM !== this.binding.bounds.maxY ||
      raster.contentWidthPx !== layout.contentWidthPx ||
      raster.contentHeightPx !== layout.contentHeightPx ||
      raster.canvas.width !== layout.width ||
      raster.canvas.height !== layout.height ||
      raster.canvas.width > limit ||
      raster.canvas.height > limit ||
      (this.rasterRegistration &&
        (raster.canvas.width !== this.rasterRegistration.width ||
          raster.canvas.height !== this.rasterRegistration.height))
    )
      throw new TypeError(
        'Raster identity, extent, registration or device cap disagrees with the fixed board.',
      );
  }

  private schedule(mount: Mount): void {
    this.check(mount);
    mount.frame = (this.dependencies.requestFrame ?? requestAnimationFrame)(() => {
      mount.frame = undefined;
      if (!this.active(mount) || !mount.ready) return;
      try {
        mount.scene!.controls.update();
        this.check(mount);
        mount.scene!.renderLocalBoardFrame();
        this.check(mount);
        this.schedule(mount);
      } catch (error) {
        if (this.active(mount)) this.fail(mount, error);
      }
    });
  }

  private fail(mount: Mount, error: unknown): void {
    this.retire(mount, error instanceof Error ? error.message : 'Board rendering failed.');
  }

  private retire(mount: Mount, error?: string): Promise<void> {
    if (mount.retirement) return mount.retirement;
    mount.retired = true;
    mount.ready = false;
    if (this.mountLifetime === mount) this.mountLifetime = undefined;
    // Wait for pending factories/hash handoffs. All acquired handles are recorded before guards.
    mount.retirement = mount.pending
      .catch(() => {})
      .then(() => {
        const { scene, observer, listeners, detachAbort, frame } = mount;
        mount.scene = undefined;
        mount.observer = undefined;
        mount.listeners = undefined;
        mount.detachAbort = undefined;
        mount.frame = undefined;
        for (const release of [
          () => {
            if (frame !== undefined) (this.dependencies.cancelFrame ?? cancelAnimationFrame)(frame);
          },
          () => detachAbort?.(),
          () => listeners?.abort(),
          () => observer?.disconnect(),
          () => {
            if (scene) scene.controls.enabled = false;
          },
          () => scene?.dispose(),
        ]) {
          try {
            release();
          } catch {
            /* Release failure never prevents later retirement. */
          }
        }
      });
    this.retirement = mount.retirement;
    mount.abort.abort();
    this.publish(false, error);
    try {
      if (mount.scene) mount.scene.controls.enabled = false;
    } catch {
      /* Even a faulty controls setter cannot prevent the deferred release sequence. */
    }
    return mount.retirement;
  }

  unmount(canvas: HTMLCanvasElement): Promise<void> {
    if (this.mountLifetime?.canvas === canvas) return this.retire(this.mountLifetime);
    return this.retirement;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.terminal = true;
    // Install the terminal acknowledgement before external notification/release can reenter.
    this.disposal = Promise.resolve().then(async () => {
      await this.retirement;
      this.raster = undefined;
      this.rasterRegistration = undefined;
    });
    if (this.mountLifetime) this.retire(this.mountLifetime);
    return this.disposal;
  }

  apply(presentation: LocalPresentation): void {
    const value = validateLocalPresentation(presentation, this.binding);
    const mount = this.mountLifetime;
    if (!mount || !this.active(mount) || !mount.ready) throw new Error('Board is not ready.');
    if (this.updating) throw new Error('Nested board update rejected.');
    this.updating = true;
    try {
      this.validateRaster(this.raster!, mount.scene!.localBoardTextureLimit());
      this.check(mount);
      mount.scene!.applyLocalBoard(this.raster!, value.marks);
      this.check(mount);
      mount.scene!.renderLocalBoardFrame();
      this.check(mount);
    } catch (error) {
      if (this.active(mount)) this.fail(mount, error);
      throw error;
    } finally {
      this.updating = false;
    }
  }
  setInteractionEnabled(enabled: boolean): void {
    this.interaction = enabled;
    this.syncControls();
  }
  setCameraEnabled(enabled: boolean): void {
    this.cameraEnabled = enabled;
    this.syncControls();
  }
  private syncControls(): void {
    const mount = this.mountLifetime;
    if (mount && this.active(mount) && mount.scene) {
      try {
        mount.scene.controls.enabled = this.interaction && this.cameraEnabled && mount.ready;
      } catch (error) {
        this.fail(mount, error);
      }
    }
  }
  private action(action: (scene: BoardScene, check: () => void) => void): void {
    const mount = this.mountLifetime;
    if (!mount || !this.active(mount) || !mount.scene || !mount.ready) return;
    try {
      action(mount.scene, () => this.check(mount));
      this.check(mount);
    } catch (error) {
      if (this.active(mount)) this.fail(mount, error);
    }
  }
  resize(): void {
    this.action((scene, check) => {
      scene.resize();
      check();
      scene.renderLocalBoardFrame();
    });
  }
  snap(view: 'top-down' | 'oblique'): void {
    if (!this.interaction || !this.cameraEnabled) return;
    this.action((scene, check) => {
      if (view === 'top-down') scene.snapTopDown();
      else scene.snapOblique();
      check();
      scene.renderLocalBoardFrame();
    });
  }
  pickAt(x: number, y: number): Readonly<Coord> | null {
    const mount = this.mountLifetime;
    if (!this.interaction || this.updating || !mount || !this.active(mount) || !mount.ready)
      return null;
    try {
      const pick = mount.scene!.pickAt(x, y);
      if (
        !this.active(mount) ||
        pick.type !== 'point' ||
        !Number.isFinite(pick.coord.x) ||
        !Number.isFinite(pick.coord.y) ||
        pick.coord.x < 0 ||
        pick.coord.y < 0 ||
        pick.coord.x > this.binding.bounds.maxX ||
        pick.coord.y > this.binding.bounds.maxY
      )
        return null;
      return Object.freeze({ ...pick.coord });
    } catch (error) {
      if (this.active(mount)) this.fail(mount, error);
      return null;
    }
  }
}
