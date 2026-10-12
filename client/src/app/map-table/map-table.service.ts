import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import {
  createSavedMapLoader,
  type LoadState,
  type PreviewTable,
} from '../../shared/map-table/loader';
import {
  TableScene as FixtureTableScene,
  type PreviewApplyError,
} from '../../legacy/table/FixtureTableScene';

export interface MapTableScene extends PreviewTable {
  start(): void;
  stop(): void;
  dispose(): void;
  resize(): void;
  fitPreview(): void;
  snapTopDown(): void;
  snapOblique(): void;
}
export type MapTableSceneFactory = (
  canvas: HTMLCanvasElement,
  onUnavailable: (error: PreviewApplyError) => void,
) => MapTableScene;
export const MAP_TABLE_SCENE_FACTORY = new InjectionToken<MapTableSceneFactory>(
  'MAP_TABLE_SCENE_FACTORY',
  {
    providedIn: 'root',
    factory: () => (canvas, onPreviewUnavailable) =>
      new FixtureTableScene(canvas, { mode: 'public-map-preview', onPreviewUnavailable }),
  },
);
export const MAP_TABLE_LOADER_FACTORY = new InjectionToken<typeof createSavedMapLoader>(
  'MAP_TABLE_LOADER_FACTORY',
  { providedIn: 'root', factory: () => createSavedMapLoader },
);
export const MAP_TABLE_OBSERVER_FACTORY = new InjectionToken<
  (callback: ResizeObserverCallback) => ResizeObserver
>('MAP_TABLE_OBSERVER_FACTORY', {
  providedIn: 'root',
  factory: () => (callback) => new ResizeObserver(callback),
});

/** Scoped to one inspector component. The pure loader owns certification and worker cancellation. */
@Injectable()
export class MapTableService {
  private readonly makeScene = inject(MAP_TABLE_SCENE_FACTORY);
  private readonly makeLoader = inject(MAP_TABLE_LOADER_FACTORY);
  private readonly makeObserver = inject(MAP_TABLE_OBSERVER_FACTORY);
  private readonly current = signal<LoadState>({
    phase: 'empty',
    message: 'Load saved generated map JSON to inspect it here.',
    displayed: null,
    available: true,
  });
  readonly state = this.current.asReadonly();
  private readonly mounted = signal(false);
  readonly canLoad = this.mounted.asReadonly();
  readonly displayed = computed(() => this.state().displayed);
  readonly busy = computed(() =>
    ['reading', 'validating', 'preparing'].includes(this.state().phase),
  );
  readonly canInspect = computed(() => !!this.displayed() && this.state().available);
  readonly extent = computed(() => {
    const map = this.displayed();
    return map
      ? `${map.widthM.toLocaleString()} × ${map.heightM.toLocaleString()} m · ${map.filename}`
      : '';
  });
  readonly inspection = computed(() => {
    try {
      const snapshot = this.displayed()?.inspection;
      return snapshot ? JSON.stringify(snapshot) : null;
    } catch {
      // Optional inspection evidence cannot invalidate an acknowledged display.
      return null;
    }
  });
  readonly retained = computed(
    () => !!this.displayed() && !(this.state().available && this.state().phase === 'ready'),
  );
  readonly retainedMessage = computed(() =>
    this.state().available
      ? 'The previously displayed map remains on the table.'
      : 'Display unavailable. The last map identity above is historical; reload the page and load the saved JSON again.',
  );
  readonly emptyMessage = computed(() =>
    this.state().available
      ? 'Start in map authoring, generate and export JSON, then load the saved file here.'
      : 'Table display unavailable. Reload the page and try again.',
  );

  private scene: MapTableScene | undefined;
  private loader: ReturnType<typeof createSavedMapLoader> | undefined;
  private unsubscribe: (() => void) | undefined;
  private observer: ResizeObserver | undefined;
  private listeners: AbortController | undefined;
  private started = false;
  private disposed = false;
  private suspended = false;

  constructor() {
    // Registered before the component schedules afterNextRender or acquires any resource.
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  mount(canvas: HTMLCanvasElement): void {
    if (this.disposed || this.started) return;
    this.started = true;
    try {
      const scene = this.makeScene(canvas, (error) =>
        this.unavailable(
          `Table rendering failed: ${error.message}. Reload the page to restore the display.`,
        ),
      );
      if (this.disposed) {
        scene.dispose();
        return;
      }
      this.scene = scene;
      if (!this.state().available) throw new Error(this.state().message);
      const loader = this.makeLoader(scene);
      if (this.disposed) {
        loader.dispose();
        return;
      }
      this.loader = loader;
      const unsubscribe = loader.subscribe((state) => {
        if (!this.disposed) this.current.set(state);
      });
      if (this.disposed) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      const observer = this.makeObserver(() => this.resize());
      if (this.disposed) {
        observer.disconnect();
        return;
      }
      this.observer = observer;
      observer.observe(canvas);
      if (this.disposed) return;
      const listeners = new AbortController();
      this.listeners = listeners;
      const options = { signal: listeners.signal };
      const view = canvas.ownerDocument.defaultView;
      view?.addEventListener('resize', () => this.resize(), options);
      view?.addEventListener(
        'pagehide',
        (event) => {
          if (this.disposed) return;
          if (!event.persisted) {
            this.dispose();
            return;
          }
          if (this.suspended) return;
          this.suspended = true;
          scene.stop();
          if (!this.disposed) loader.cancel();
        },
        options,
      );
      view?.addEventListener(
        'pageshow',
        (event) => {
          if (this.disposed || !event.persisted || !this.suspended) return;
          this.suspended = false;
          this.resize();
          if (!this.disposed && this.state().available) scene.start();
        },
        options,
      );
      this.mounted.set(true);
      scene.start();
    } catch (error) {
      if (this.disposed) return;
      this.dispose();
      this.current.update((state) => ({
        ...state,
        phase: 'failed',
        available: false,
        message: `Table unavailable: ${error instanceof Error ? error.message : 'initialization failed'}. Reload with WebGL enabled.`,
      }));
    }
  }

  load(file: File): void {
    if (!this.disposed && !this.suspended) void this.loader?.load(file);
  }
  cancel(): void {
    if (!this.disposed && !this.suspended) this.loader?.cancel();
  }
  fit(): void {
    this.inspect((scene) => scene.fitPreview());
  }
  topDown(): void {
    this.inspect((scene) => scene.snapTopDown());
  }
  oblique(): void {
    this.inspect((scene) => scene.snapOblique());
  }
  private inspect(action: (scene: MapTableScene) => void): void {
    if (!this.disposed && !this.suspended && this.canInspect() && this.scene) action(this.scene);
  }
  contextLost(event: Event): void {
    if (this.disposed) return;
    event.preventDefault();
    this.scene?.stop();
    this.unavailable('WebGL context was lost. Reload the page to restore the table.');
  }
  private unavailable(message: string): void {
    if (this.disposed) return;
    if (this.loader) this.loader.unavailable(message);
    else this.current.update((state) => ({ ...state, phase: 'failed', available: false, message }));
  }
  private resize(): void {
    if (this.disposed || this.suspended) return;
    try {
      this.scene?.resize();
    } catch (error) {
      this.scene?.stop();
      this.unavailable(error instanceof Error ? error.message : 'Table resize failed');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mounted.set(false);
    const { scene, loader, observer, unsubscribe, listeners } = this;
    this.scene = this.loader = this.observer = this.unsubscribe = this.listeners = undefined;
    // Detach ownership before callbacks. One failing release must not strand later resources.
    for (const release of [
      () => listeners?.abort(),
      () => observer?.disconnect(),
      () => unsubscribe?.(),
      () => loader?.dispose(),
      () => scene?.stop(),
      () => scene?.dispose(),
    ]) {
      try {
        release();
      } catch {
        /* Continue terminal resource cleanup. */
      }
    }
  }
}
