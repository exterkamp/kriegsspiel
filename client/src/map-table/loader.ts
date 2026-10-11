import { assetIdentity, HARD_LIMITS, type MapAsset } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from '../map-authoring/runtime/index.js';
import type { PreviewAsset } from '../map-authoring/asset.js';
import { PreviewApplyError, type PreviewRaster } from '../table/FixtureTableScene.js';
import { prepareRaster } from './raster.js';

type Runtime = ReturnType<typeof createAuthoringRuntime>;
export interface PreviewTable {
  previewTextureLimit(): number;
  applyPreviewRaster(raster: PreviewRaster): void;
}
export type DisplayedMap = Readonly<{
  name: string;
  filename: string;
  sourceKey: string;
  widthM: number;
  heightM: number;
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
  } | null = null;
  let disposed = false;
  const update = (patch: Partial<LoadState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener(state);
  };
  const current = (target: NonNullable<typeof operation>) =>
    !disposed && operation === target && !target.abort.signal.aborted;
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
      update({ phase: 'preparing', message: 'Preparing registered map artwork…' });
      void (async () => {
        try {
          if (!current(target)) return;
          const key = await (
            options.identity ?? ((a) => assetIdentity(structuredClone(a) as MapAsset, 'asset'))
          )(asset);
          if (!current(target)) return;
          const raster = (options.prepare ?? prepareRaster)(
            asset,
            key,
            table.previewTextureLimit(),
          );
          if (!current(target)) return;
          table.applyPreviewRaster(raster);
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
      };
      operation = target;
      update({ phase: 'reading', message: `Reading ${file.name}…` });
      try {
        if (!current(target)) return;
        // Also enforce the cap before an injected reader (not just the native reader).
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > HARD_LIMITS.maxBytes)
          throw new RangeError('Saved JSON exceeds the 64 MiB file limit');
        const text = await (options.read ?? readSavedFile)(
          file,
          target.abort.signal,
          options.waitTimeoutMs,
        );
        if (!current(target)) return;
        update({ phase: 'validating', message: 'Independently certifying saved geometry…' });
        if (!current(target)) return;
        target.id = runtime.controller.loadSavedAsset(text);
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
