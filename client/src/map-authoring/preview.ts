import type { Point } from '@kriegsspiel/maps';
import { loadPreviewAsset, type AssetLoadResult, type PreviewAsset } from './asset.js';
import { DEFAULT_LAYERS, MapRenderer, type Layer, type Layers } from './renderer.js';
import { observeDisplayLifecycle } from './display-lifecycle.js';
import { geometryBounds } from './geometry.js';
import {
  fitViewport,
  panViewport,
  resizeViewport,
  screenToMap,
  zoomViewport,
  type Viewport,
  type ViewBounds,
} from './viewport.js';

export interface PreviewState {
  asset?: PreviewAsset;
  source: 'reference-fixture' | 'asset';
  issues: Extract<AssetLoadResult, { ok: false }>['issues'];
  view?: Viewport;
}
/** Optional diagnostic timing only; no asset/view references and no retained samples. */
export interface PreviewFrame {
  rafTimestampMs: number;
  requestToStartMs: number;
  drawMs: number;
  workMs: number;
  requestToEndMs: number;
  width: number;
  height: number;
  dpr: number;
}

/** Standalone asset-loading seam for later generation/worker controls. No game state. */
export class MapPreview {
  private renderer?: MapRenderer;
  private view?: Viewport;
  private layers: Layers = { ...DEFAULT_LAYERS };
  private highContrast = false;
  private source: PreviewState['source'] = 'asset';
  private issues: PreviewState['issues'] = [];
  private readonly context: CanvasRenderingContext2D;
  private readonly abort = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly stopDisplayEvents: () => void;
  private frame = 0;
  private drag?: { id: number; point: Point };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly changed: (state: PreviewState) => void = () => {},
    private readonly onFrame?: (frame: Readonly<PreviewFrame>) => void,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This preview requires Canvas2D');
    this.context = context;
    const signal = this.abort.signal;
    const point = (event: MouseEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (!event.isPrimary || event.button !== 0 || this.drag) return;
        canvas.focus();
        canvas.setPointerCapture(event.pointerId);
        this.drag = { id: event.pointerId, point: point(event) };
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!this.view || !this.drag || event.pointerId !== this.drag.id) return;
        const next = point(event);
        this.view = panViewport(this.view, [
          next[0] - this.drag.point[0],
          next[1] - this.drag.point[1],
        ]);
        this.drag.point = next;
        this.schedule();
      },
      { signal },
    );
    const end = (event: PointerEvent) => {
      if (event.pointerId === this.drag?.id) this.drag = undefined;
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
    canvas.addEventListener('lostpointercapture', end, { signal });
    canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.view) return;
        event.preventDefault();
        const delta =
          event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.view.height : 1);
        this.zoom(Math.exp(-Math.max(-400, Math.min(400, delta)) * 0.002), point(event));
      },
      { signal, passive: false },
    );
    canvas.addEventListener(
      'keydown',
      (event) => {
        if (!this.view) return;
        const deltas: Record<string, Point> = {
          ArrowLeft: [40, 0],
          ArrowRight: [-40, 0],
          ArrowUp: [0, 40],
          ArrowDown: [0, -40],
        };
        if (deltas[event.key]) this.view = panViewport(this.view, deltas[event.key]!);
        else if (event.key === '+' || event.key === '=') this.zoom(1.4);
        else if (event.key === '-') this.zoom(1 / 1.4);
        else if (event.key.toLowerCase() === 'f') this.fit();
        else return;
        event.preventDefault();
        this.schedule();
      },
      { signal },
    );
    this.observer = new ResizeObserver(() => {
      if (this.view) {
        const size = this.size();
        this.view = resizeViewport(this.view, size[0], size[1]);
        this.schedule();
      }
    });
    this.observer.observe(canvas);
    this.stopDisplayEvents = observeDisplayLifecycle(
      window,
      () => this.refresh(),
      () => this.dispose(),
    );
  }

  /** Invalid candidates report issues while the last valid snapshot remains visible. */
  loadAsset(input: unknown, source: PreviewState['source'] = 'asset'): AssetLoadResult {
    const result = loadPreviewAsset(input);
    if (result.ok) {
      const renderer = new MapRenderer(result.asset);
      this.renderer = renderer;
      this.source = source;
      this.issues = [];
      this.fit();
    } else {
      this.issues = result.issues;
      this.publish();
    }
    return result;
  }
  setLayer(layer: Layer, enabled: boolean): void {
    this.layers = { ...this.layers, [layer]: enabled };
    this.schedule();
  }
  setHighContrast(enabled: boolean): void {
    this.highContrast = enabled;
    this.schedule();
  }
  fit(bounds: ViewBounds | undefined = this.renderer?.asset.bounds): void {
    if (!bounds) return;
    const [width, height] = this.size();
    this.view = fitViewport(bounds, width, height);
    this.schedule();
  }
  /** Fit one stable site ID with 15 m context. Missing IDs leave the current view intact. */
  fitSite(siteId: string): boolean {
    const site = this.renderer?.asset.layers.sites.find((candidate) => candidate.id === siteId);
    if (!site) return false;
    this.fit(geometryBounds(site.placementArea.outer, 15));
    return true;
  }
  zoom(factor: number, anchor?: Point): void {
    if (!this.view || !this.renderer) return;
    this.view = zoomViewport(
      this.view,
      anchor ?? [this.view.width / 2, this.view.height / 2],
      factor,
      this.renderer.asset.bounds,
    );
    this.schedule();
  }
  private size(): Point {
    return [Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight)];
  }
  private refresh(): void {
    // A frozen page may carry a suspended RAF; replace it when restoring.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.view) {
      const [width, height] = this.size();
      this.view = resizeViewport(this.view, width, height);
      this.schedule();
    }
  }
  private publish(): void {
    this.changed({
      asset: this.renderer?.asset,
      source: this.source,
      issues: this.issues,
      view: this.view ? { ...this.view, offset: [...this.view.offset] } : undefined,
    });
  }
  private schedule(): void {
    if (this.frame) return;
    const requested = this.onFrame ? performance.now() : 0;
    this.frame = requestAnimationFrame((rafTimestampMs) => {
      this.frame = 0;
      if (!this.view || !this.renderer) return;
      const started = this.onFrame ? performance.now() : 0;
      const view = this.view;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(view.width * dpr);
      const height = Math.round(view.height * dpr);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      const drawStarted = this.onFrame ? performance.now() : 0;
      this.renderer.render(this.context, view, this.layers, this.highContrast, dpr);
      const drawEnded = this.onFrame ? performance.now() : 0;
      this.publish();
      if (this.onFrame) {
        const ended = performance.now();
        this.onFrame(
          Object.freeze({
            rafTimestampMs,
            requestToStartMs: started - requested,
            drawMs: drawEnded - drawStarted,
            workMs: ended - started,
            requestToEndMs: ended - requested,
            width: view.width,
            height: view.height,
            dpr,
          }),
        );
      }
    });
  }
  /** Centre of the displayed viewport in the authoritative map frame. */
  center(): Point | undefined {
    return this.view
      ? screenToMap(this.view, [this.view.width / 2, this.view.height / 2])
      : undefined;
  }
  dispose(): void {
    this.stopDisplayEvents();
    this.abort.abort();
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
