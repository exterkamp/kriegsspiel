import { assetIdentity, HARD_LIMITS, type MapAsset } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from '../map-authoring/runtime/index.js';
import type { PreviewAsset } from '../map-authoring/asset.js';
import {
  PreviewApplyError,
  type PreviewRaster,
  type PreviewResourceCounts,
  type PreviewSceneObservation,
} from '../table/FixtureTableScene.js';
import { prepareRaster } from './raster.js';

type Runtime = ReturnType<typeof createAuthoringRuntime>;
type ObservationTimestamp =
  | 'readStart'
  | 'readEnd'
  | 'dispatchStart'
  | 'dispatchEnd'
  | 'ready'
  | 'identityStart'
  | 'identityEnd'
  | 'rasterStart'
  | 'rasterEnd'
  | 'applyStart'
  | 'applyEnd';
export interface PreviewTable {
  previewTextureLimit(): number;
  applyPreviewRaster(raster: PreviewRaster): void;
  previewObservation(): PreviewSceneObservation | null;
}
export type DisplayInspection = Readonly<{
  sourceKey: string;
  textureLimitPx: number;
  deviceMaxTextureSizePx: number | null;
  textureWidthPx: number;
  textureHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  readMs: number | null;
  // Synchronous parse, candidate setup, worker construction and dispatch.
  parseAndDispatchMs: number | null;
  // Remaining worker/export/response/scheduling wait, not validation CPU time.
  certificationWaitMs: number | null;
  identityMs: number | null;
  rasterMs: number | null;
  // Synchronous apply and retirement, not GPU completion or presentation.
  applyAndRetireMs: number | null;
  resources: PreviewResourceCounts | null;
}>;
export type DisplayedMap = Readonly<{
  name: string;
  filename: string;
  sourceKey: string;
  widthM: number;
  heightM: number;
  inspection: DisplayInspection | null;
}>;
export type LoadState = Readonly<{
  phase: 'empty' | 'reading' | 'validating' | 'preparing' | 'ready' | 'cancelled' | 'failed';
  message: string;
  displayed: DisplayedMap | null;
  available: boolean;
}>;

/** Abortable, bounded read. File size is checked before starting any read. */
export function readSavedFile(
  file: File,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<string> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    return Promise.reject(new RangeError('File read requires a finite positive watchdog'));
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > HARD_LIMITS.maxBytes)
    return Promise.reject(
      new RangeError(`Choose a JSON file no larger than ${HARD_LIMITS.maxBytes / 1024 / 1024} MiB`),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let done = false;
    const finish = (error?: Error, value?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) {
        try {
          reader.abort();
        } finally {
          reject(error);
        }
      } else resolve(value!);
    };
    const abort = () => finish(new Error('Saved file read cancelled'));
    const timer = setTimeout(
      () => finish(new Error('Saved file read timed out; try loading again')),
      timeoutMs,
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    reader.onerror = () =>
      finish(new Error('Could not read this file; choose a readable saved JSON file'));
    reader.onabort = abort;
    reader.onload = () =>
      typeof reader.result === 'string'
        ? finish(undefined, reader.result)
        : finish(new Error('Saved file was not text'));
    try {
      reader.readAsText(file);
    } catch (error) {
      finish(error instanceof Error ? error : new Error('File read failed'));
    }
  });
}

export function createSavedMapLoader(
  table: PreviewTable,
  options: {
    runtime?: Runtime;
    read?: typeof readSavedFile;
    prepare?: typeof prepareRaster;
    identity?: (asset: PreviewAsset) => Promise<string>;
    waitTimeoutMs?: number;
    now?: () => number;
  } = {},
) {
  const runtime =
    options.runtime ??
    createAuthoringRuntime({
      generationWorkerFactory: () => {
        throw new Error('Saved-map inspection never generates maps');
      },
      validationWorkerFactory: () =>
        new Worker(new URL('../map-authoring/validate.worker.ts', import.meta.url), {
          type: 'module',
        }),
      waitTimeoutMs: options.waitTimeoutMs,
    });
  let state: LoadState = Object.freeze({
    phase: 'empty',
    message: 'Load saved generated map JSON to inspect it here.',
    displayed: null,
    available: true,
  });
  const listeners = new Set<(state: LoadState) => void>();
  let operation: {
    abort: AbortController;
    filename: string;
    id: number | null;
    preparing: boolean;
    lastClock: number | null;
    timestamps: Partial<Record<ObservationTimestamp, number | null>>;
    readMs: number | null;
    parseAndDispatchMs: number | null;
  } | null = null;
  let disposed = false;
  const update = (patch: Partial<LoadState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener(state);
  };
  const current = (target: NonNullable<typeof operation>) =>
    !disposed && operation === target && !target.abort.signal.aborted;
  const timestamp = (target: NonNullable<typeof operation>, phase: ObservationTimestamp): void => {
    target.timestamps[phase] = null;
    try {
      const value = (options.now ?? (() => performance.now()))();
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (target.lastClock !== null && value < target.lastClock)
      )
        return;
      target.lastClock = value;
      target.timestamps[phase] = value;
    } catch {
      // Missing timestamps remain null; use neither zero nor wall-clock time.
    }
  };
  const duration = (
    target: NonNullable<typeof operation>,
    from: ObservationTimestamp,
    to: ObservationTimestamp,
  ): number | null => {
    const start = target.timestamps[from] ?? null;
    const end = target.timestamps[to] ?? null;
    if (start === null || end === null) return null;
    const elapsed = end - start;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  };
  const failure = (target: NonNullable<typeof operation>, error: unknown) => {
    if (!current(target)) return;
    operation = null;
    const unavailable = error instanceof PreviewApplyError && error.display === 'unavailable';
    update({
      phase: 'failed',
      available: unavailable ? false : state.available,
      message: error instanceof Error ? error.message : 'Map load failed',
    });
  };
  const unsubscribe = runtime.controller.subscribe((snapshot) => {
    const target = operation;
    if (!target || !current(target) || target.id !== snapshot.requestId) return;
    if (snapshot.status === 'failed') {
      failure(
        target,
        new Error(
          snapshot.failure?.message ??
            (snapshot.candidateDiagnostics
              .filter((d) => d.severity === 'error')
              .map((d) => `${d.code}: ${d.message}${d.remediation ? ` — ${d.remediation}` : ''}`)
              .join('\n') ||
              'Map certification failed'),
        ),
      );
    } else if (snapshot.status === 'ready' && !target.preparing) {
      const asset = runtime.controller.exportAsset;
      if (!asset) {
        failure(target, new Error('Certification did not provide a current asset'));
        return;
      }
      target.preparing = true;
      timestamp(target, 'ready');
      const certificationWaitMs = duration(target, 'dispatchEnd', 'ready');
      update({ phase: 'preparing', message: 'Preparing registered map artwork…' });
      void (async () => {
        try {
          if (!current(target)) return;
          timestamp(target, 'identityStart');
          const key = await (
            options.identity ?? ((a) => assetIdentity(structuredClone(a) as MapAsset, 'asset'))
          )(asset);
          timestamp(target, 'identityEnd');
          const identityMs = duration(target, 'identityStart', 'identityEnd');
          if (!current(target)) return;
          timestamp(target, 'rasterStart');
          const textureLimitPx = table.previewTextureLimit();
          const raster = (options.prepare ?? prepareRaster)(asset, key, textureLimitPx);
          timestamp(target, 'rasterEnd');
          const rasterMs = duration(target, 'rasterStart', 'rasterEnd');
          if (!current(target)) return;
          timestamp(target, 'applyStart');
          table.applyPreviewRaster(raster);
          timestamp(target, 'applyEnd');
          const applyAndRetireMs = duration(target, 'applyStart', 'applyEnd');
          if (!current(target)) return;
          let inspection: DisplayInspection | null = null;
          try {
            const observation = table.previewObservation();
            if (observation?.sourceKey === key) {
              inspection = Object.freeze({
                sourceKey: key,
                textureLimitPx,
                deviceMaxTextureSizePx: observation.deviceMaxTextureSizePx,
                textureWidthPx: raster.canvas.width,
                textureHeightPx: raster.canvas.height,
                contentWidthPx: raster.contentWidthPx,
                contentHeightPx: raster.contentHeightPx,
                readMs: target.readMs,
                parseAndDispatchMs: target.parseAndDispatchMs,
                certificationWaitMs,
                identityMs,
                rasterMs,
                applyAndRetireMs,
                resources: observation.resources
                  ? Object.freeze({
                      textures: observation.resources.textures,
                      geometries: observation.resources.geometries,
                    })
                  : null,
              });
            }
          } catch {
            // Snapshot failure must not invalidate an acknowledged map.
          }
          if (!current(target)) return;
          operation = null;
          update({
            phase: 'ready',
            available: true,
            message: 'Map loaded. Drag to orbit; right-drag to pan; scroll to zoom.',
            displayed: Object.freeze({
              name: asset.name,
              filename: target.filename,
              sourceKey: key,
              widthM: raster.widthM,
              heightM: raster.heightM,
              inspection,
            }),
          });
        } catch (error) {
          failure(target, error);
        }
      })();
    }
  });
  function stop() {
    const previous = operation;
    operation = null;
    previous?.abort.abort();
    runtime.controller.cancel();
  }
  return {
    get state() {
      return state;
    },
    subscribe(listener: (state: LoadState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async load(file: File): Promise<void> {
      if (disposed) return;
      stop();
      const target = {
        abort: new AbortController(),
        filename: file.name,
        id: null as number | null,
        preparing: false,
        lastClock: null as number | null,
        timestamps: {} as Partial<Record<ObservationTimestamp, number | null>>,
        readMs: null as number | null,
        parseAndDispatchMs: null as number | null,
      };
      operation = target;
      update({ phase: 'reading', message: `Reading ${file.name}…` });
      try {
        if (!current(target)) return;
        // Also enforce the cap before an injected reader (not just the native reader).
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > HARD_LIMITS.maxBytes)
          throw new RangeError('Saved JSON exceeds the 64 MiB file limit');
        timestamp(target, 'readStart');
        const text = await (options.read ?? readSavedFile)(
          file,
          target.abort.signal,
          options.waitTimeoutMs,
        );
        timestamp(target, 'readEnd');
        target.readMs = duration(target, 'readStart', 'readEnd');
        if (!current(target)) return;
        update({ phase: 'validating', message: 'Independently certifying saved geometry…' });
        if (!current(target)) return;
        timestamp(target, 'dispatchStart');
        target.id = runtime.controller.loadSavedAsset(text);
        timestamp(target, 'dispatchEnd');
        target.parseAndDispatchMs = duration(target, 'dispatchStart', 'dispatchEnd');
      } catch (error) {
        failure(target, error);
      }
    },
    cancel() {
      if (disposed || !operation) return;
      stop();
      update({ phase: 'cancelled', message: 'Load cancelled.' });
    },
    unavailable(message: string) {
      if (disposed) return;
      stop();
      update({ phase: 'failed', available: false, message });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operation?.abort.abort();
      operation = null;
      unsubscribe();
      listeners.clear();
      runtime.dispose();
    },
  };
}
