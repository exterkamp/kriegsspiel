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

interface MountLifetime {
  readonly canvas: HTMLCanvasElement;
  scene?: MapTableScene;
  loader?: ReturnType<typeof createSavedMapLoader>;
  unsubscribe?: () => void;
  observer?: ResizeObserver;
  listeners?: AbortController;
  suspended: boolean;
}

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

  private lifetime: MountLifetime | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private disposed = false;
  private releasing = false;
  private allocating = false;

  constructor() {
    // Terminal lifetime is independent of replaceable canvas views.
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  mount(canvas: HTMLCanvasElement): void {
    if (this.disposed || this.releasing || this.allocating || this.canvas === canvas) return;
    if (this.lifetime) this.retire(this.lifetime);
    if (this.disposed) return;
    this.canvas = canvas;
    this.current.set(this.emptyState());
    const lifetime: MountLifetime = { canvas, suspended: false };
    this.lifetime = lifetime;
    const active = () => !this.disposed && this.lifetime === lifetime;
    this.allocating = true;
    try {
      const scene = this.makeScene(canvas, (error) => {
        if (active())
          this.unavailable(
            `Table rendering failed: ${error.message}. Reload the page to restore the display.`,
          );
      });
      if (!active()) {
        scene.dispose();
        return;
      }
      lifetime.scene = scene;
      if (!this.state().available) throw new Error(this.state().message);
      const loader = this.makeLoader(scene);
      if (!active()) {
        loader.dispose();
        return;
      }
      lifetime.loader = loader;
      const unsubscribe = loader.subscribe((state) => {
        if (active()) this.current.set(state);
      });
      if (!active()) {
        unsubscribe();
        return;
      }
      lifetime.unsubscribe = unsubscribe;
      const observer = this.makeObserver(() => {
        if (active()) this.resize();
      });
      if (!active()) {
        observer.disconnect();
        return;
      }
      lifetime.observer = observer;
      observer.observe(canvas);
      if (!active()) return;
      const listeners = new AbortController();
      lifetime.listeners = listeners;
      const options = { signal: listeners.signal };
      const view = canvas.ownerDocument.defaultView;
      view?.addEventListener(
        'resize',
        () => {
          if (active()) this.resize();
        },
        options,
      );
      view?.addEventListener(
        'pagehide',
        (event) => {
          if (!active()) return;
          if (!event.persisted) {
            this.dispose();
            return;
          }
          if (lifetime.suspended) return;
          lifetime.suspended = true;
          scene.stop();
          if (active()) loader.cancel();
        },
        options,
      );
      view?.addEventListener(
        'pageshow',
        (event) => {
          if (!active() || !event.persisted || !lifetime.suspended) return;
          lifetime.suspended = false;
          this.resize();
          if (active() && this.state().available) scene.start();
        },
        options,
      );
      this.mounted.set(true);
      scene.start();
    } catch (error) {
      if (!active()) return;
      this.retire(lifetime);
      if (this.disposed) return;
      this.current.update((state) => ({
        ...state,
        phase: 'failed',
        available: false,
        message: `Table unavailable: ${error instanceof Error ? error.message : 'initialization failed'}. Reload with WebGL enabled.`,
      }));
    } finally {
      this.allocating = false;
    }
  }

  /** Canvas cleanup is resettable; a route/service destroy remains terminal. */
  unmount(canvas: HTMLCanvasElement): void {
    if (this.canvas !== canvas) return;
    this.canvas = undefined;
    if (this.lifetime) this.retire(this.lifetime);
    this.current.set(this.emptyState());
  }

  private emptyState(): LoadState {
    return {
      phase: 'empty',
      message: 'Load saved generated map JSON to inspect it here.',
      displayed: null,
      available: true,
    };
  }

  load(file: File): void {
    if (!this.disposed && !this.lifetime?.suspended) void this.lifetime?.loader?.load(file);
  }
  cancel(): void {
    if (!this.disposed && !this.lifetime?.suspended) this.lifetime?.loader?.cancel();
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
    if (!this.disposed && !this.lifetime?.suspended && this.canInspect() && this.lifetime?.scene)
      action(this.lifetime.scene);
  }
  contextLost(event: Event): void {
    if (this.disposed) return;
    event.preventDefault();
    this.lifetime?.scene?.stop();
    this.unavailable('WebGL context was lost. Reload the page to restore the table.');
  }
  private unavailable(message: string): void {
    if (this.disposed) return;
    if (this.lifetime?.loader) this.lifetime.loader.unavailable(message);
    else this.current.update((state) => ({ ...state, phase: 'failed', available: false, message }));
  }
  private resize(): void {
    if (this.disposed || this.lifetime?.suspended) return;
    try {
      this.lifetime?.scene?.resize();
    } catch (error) {
      this.lifetime?.scene?.stop();
      this.unavailable(error instanceof Error ? error.message : 'Table resize failed');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.lifetime) this.retire(this.lifetime);
  }

  private retire(lifetime: MountLifetime): void {
    if (this.lifetime !== lifetime) return;
    // Invalidate all callbacks and detach ownership before any external release.
    this.lifetime = undefined;
    this.mounted.set(false);
    const { scene, loader, observer, unsubscribe, listeners } = lifetime;
    this.releasing = true;
    try {
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
          /* One failing release must not strand later resources. */
        }
      }
    } finally {
      this.releasing = false;
    }
  }
}
