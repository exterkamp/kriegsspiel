import { battlefieldPreset, utf8Bytes, type MapAsset } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from './runtime/index.js';
import { MapPreview, type PreviewFrame } from './preview.js';
import type { ViewBounds, Viewport } from './viewport.js';
import type { ReplayParameters, ReadonlyData } from './generation/index.js';

const WIDTH = 1440,
  HEIGHT = 900,
  WARMUP = 30,
  RUN_LIMIT_MS = 120_000;
const PRESETS = ['flat-countryside', 'wooded-hills', 'river-valley'] as const;
export function durationStats(values: readonly number[]) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new RangeError('Expected nonempty finite nonnegative samples');
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted.at(-1)!,
  };
}
/** Presentation-only trajectory: fit translated detail rectangles, interleaved with anchored zoom. */
export function benchmarkBounds(bounds: ViewBounds, frame: number): ViewBounds {
  const phase = frame % 120;
  const triangle = (phase < 60 ? phase / 60 : (120 - phase) / 60) * 2 - 1;
  const width = (bounds.maxX - bounds.minX) * 0.4,
    height = (width * HEIGHT) / WIDTH;
  const x = (bounds.minX + bounds.maxX) / 2 + (bounds.maxX - bounds.minX) * 0.15 * triangle;
  const y = (bounds.minY + bounds.maxY) / 2 - (bounds.maxY - bounds.minY) * 0.15 * triangle;
  return { minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2, maxY: y + height / 2 };
}
export function mountBenchmark(root: HTMLElement): { dispose(): void } {
  const document = root.ownerDocument;
  const parentWindow = document.defaultView;
  if (!parentWindow) throw new Error('Benchmark requires a browser window');
  const win = parentWindow;
  // The page title is the host's (ks-tool-header); the layout is the shared design system's classes (#308).
  const note = document.createElement('p');
  note.className = 'ks-muted';
  note.textContent =
    'Diagnostic run only. Real generation, validation and export run in workers. Keep this page visible and record the machine/browser. No fixture fallback. Canvas is fixed at 1440 × 900 CSS pixels; browser viewport is reported separately.';
  const form = document.createElement('form');
  form.className = 'benchmark-form';
  function field(label: string, input: HTMLElement) {
    const wrapper = document.createElement('label');
    const checkbox = input.tagName === 'INPUT' && (input as HTMLInputElement).type === 'checkbox';
    wrapper.className = checkbox ? 'ks-choice' : 'ks-field';
    if (checkbox) wrapper.append(input, document.createTextNode(label));
    else wrapper.append(document.createTextNode(label), input);
    form.append(wrapper);
  }
  const preset = document.createElement('select');
  preset.id = 'benchmark-preset';
  for (const name of PRESETS) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    preset.append(option);
  }
  field('Real preset', preset);
  function number(label: string, id: string, value: number, min: number, max: number) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.required = true;
    field(label, input);
    return input;
  }
  const seed = number('Seed', 'benchmark-seed', 17, 0, Number.MAX_SAFE_INTEGER);
  const width = number('Map width (m)', 'benchmark-width', 5000, 5000, 15000);
  const height = number('Map height (m)', 'benchmark-height', 5000, 5000, 15000);
  const frames = number('Measured frames (30 warmup)', 'benchmark-frames', 240, 60, 600);
  const machine = document.createElement('input');
  machine.id = 'benchmark-machine';
  machine.required = true;
  machine.maxLength = 512;
  machine.placeholder = 'Model / CPU / RAM / exact browser version';
  field('Operator machine metadata', machine);
  const contrast = document.createElement('input');
  contrast.type = 'checkbox';
  contrast.id = 'benchmark-contrast';
  field('High contrast', contrast);
  const run = document.createElement('button');
  run.type = 'submit';
  run.id = 'benchmark-run';
  run.textContent = 'Run real benchmark';
  run.className = 'ks-primary';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.id = 'benchmark-cancel';
  cancel.textContent = 'Cancel run';
  cancel.disabled = true;
  const status = document.createElement('p');
  status.id = 'benchmark-status';
  status.className = 'ks-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Not run · G public implementations and real successful assets required';
  const output = document.createElement('pre');
  output.id = 'benchmark-result';
  output.className = 'benchmark-result ks-mono';
  const wrap = document.createElement('div');
  wrap.className = 'benchmark-canvas';
  const canvas = document.createElement('canvas');
  canvas.id = 'benchmark-canvas';
  canvas.style.cssText = `display:block;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none`;
  wrap.append(canvas);
  const actions = document.createElement('div');
  actions.className = 'ks-cluster benchmark-actions';
  actions.append(run, cancel);
  form.append(actions);
  root.replaceChildren(note, form, status, output, wrap);
  const runtime = createAuthoringRuntime({
    generationWorkerFactory: () =>
      new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' }),
    validationWorkerFactory: () =>
      new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' }),
  });
  let viewport: Viewport | undefined;
  let pending: {
    resolve(frame: Readonly<PreviewFrame>): void;
    reject(error: unknown): void;
  } | null = null;
  let active: AbortController | null = null;
  let disposed = false;
  const preview = new MapPreview(
    canvas,
    (state) => {
      viewport = state.view;
    },
    (frame) => {
      const wait = pending;
      pending = null;
      wait?.resolve(frame);
    },
  );
  function abort(message: string) {
    active?.abort(new Error(message));
    if (runtime.controller.state.status !== 'disposed') runtime.controller.cancel();
    pending?.reject(new Error(message));
    pending = null;
  }
  function nextFrame(action: () => void, signal: AbortSignal): Promise<Readonly<PreviewFrame>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timeout = setTimeout(
        () => fail(new Error('No preview RAF frame within 2 seconds')),
        2000,
      );
      function cleanup() {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancelled);
        pending = null;
      }
      function fail(error: unknown) {
        cleanup();
        reject(error);
      }
      function cancelled() {
        fail(signal.reason);
      }
      pending = {
        resolve: (frame) => {
          cleanup();
          resolve(frame);
        },
        reject: fail,
      };
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        action();
      } catch (error) {
        fail(error);
      }
    });
  }
  function generate(input: ReplayParameters, signal: AbortSignal): Promise<ReadonlyData<MapAsset>> {
    return new Promise((resolve, reject) => {
      let id: number | null = null;
      const unsubscribe = runtime.controller.subscribe(check);
      function cleanup() {
        unsubscribe();
        signal.removeEventListener('abort', cancelled);
      }
      function cancelled() {
        cleanup();
        reject(signal.reason);
      }
      function check() {
        const state = runtime.controller.state;
        if (state.requestId !== id) return;
        if (state.status === 'ready' && state.lastValidatedAsset) {
          cleanup();
          resolve(state.lastValidatedAsset);
        } else if (
          state.status === 'failed' ||
          state.status === 'cancelled' ||
          state.status === 'disposed'
        ) {
          cleanup();
          reject(
            new Error(
              (state.failure?.message ??
                state.candidateDiagnostics.map((d) => `${d.code}: ${d.message}`).join('; ')) ||
                'Generation/validation cancelled',
            ),
          );
        } else
          status.textContent = `${state.status} · request ${id} · generation + validation + worker export`;
      }
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        id = runtime.controller.generate(input);
        check();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  const eventAbort = new AbortController();
  preset.addEventListener(
    'change',
    () => {
      seed.value = String(battlefieldPreset(preset.value as (typeof PRESETS)[number]).seed);
    },
    { signal: eventAbort.signal },
  );
  cancel.addEventListener('click', () => abort('Cancelled by operator'), {
    signal: eventAbort.signal,
  });
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      if (active || disposed || !form.reportValidity()) return;
      void execute();
    },
    { signal: eventAbort.signal },
  );
  async function execute(): Promise<void> {
    const signalOwner = new AbortController();
    active = signalOwner;
    const signal = signalOwner.signal;
    const runTimer = setTimeout(() => abort('Diagnostic run exceeded 120 seconds'), RUN_LIMIT_MS);
    const controls = Array.from(form.elements) as (
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    )[];
    const measured = Number(frames.value),
      highContrast = contrast.checked,
      operator = machine.value.trim();
    controls.forEach((control) => {
      control.disabled = true;
    });
    cancel.disabled = false;
    output.textContent = '';
    status.classList.remove('ks-ok', 'ks-error');
    const start = performance.now();
    const metadata = {
      operator,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      browserViewport: { width: win.innerWidth, height: win.innerHeight },
      canvasViewport: { width: canvas.clientWidth, height: canvas.clientHeight },
      devicePixelRatio: win.devicePixelRatio,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      highContrast,
    };
    // Latch interruptions even when the environment returns to its original values
    // before a frame resumes. Only one error is retained for the bounded run.
    let interruption: Error | null = null;
    const removeRunListeners: (() => void)[] = [];
    function invalidate(event: Event): void {
      interruption ??= new Error(`${event.type} interrupted the diagnostic run`);
      abort(interruption.message);
    }
    function listen(target: EventTarget, type: string): void {
      target.addEventListener(type, invalidate);
      removeRunListeners.push(() => target.removeEventListener(type, invalidate));
    }
    function assertEnvironment(): void {
      if (interruption) throw interruption;
      if (signal.aborted) throw signal.reason;
      if (
        document.visibilityState !== 'visible' ||
        document.hasFocus() !== metadata.focused ||
        canvas.clientWidth !== WIDTH ||
        canvas.clientHeight !== HEIGHT ||
        win.innerWidth !== metadata.browserViewport.width ||
        win.innerHeight !== metadata.browserViewport.height ||
        win.devicePixelRatio !== metadata.devicePixelRatio
      )
        throw new Error('Visibility, focus, viewport or DPR changed during diagnostic run');
    }
    try {
      listen(document, 'visibilitychange');
      for (const type of ['resize', 'focus', 'blur', 'pagehide', 'pageshow']) listen(win, type);
      listen(win.matchMedia(`(resolution: ${metadata.devicePixelRatio}dppx)`), 'change');
      const recipe = battlefieldPreset(preset.value as (typeof PRESETS)[number]);
      recipe.seed = Number(seed.value);
      recipe.settings.widthM = Number(width.value);
      recipe.settings.heightM = Number(height.value);
      if (!operator || !Number.isInteger(measured) || measured < 60 || measured > 600)
        throw new RangeError('Provide machine metadata and 60–600 measured frames');
      if (
        document.visibilityState !== 'visible' ||
        canvas.clientWidth !== WIDTH ||
        canvas.clientHeight !== HEIGHT
      )
        throw new Error('Run requires visible page and actual 1440×900 CSS canvas');
      const asset = await generate(
        { seed: recipe.seed, settings: recipe.settings, overrides: recipe.overrides ?? [] },
        signal,
      );
      const ready = performance.now();
      assertEnvironment();
      preview.setHighContrast(highContrast);
      const loadStart = performance.now();
      let previewSetupMs = 0;
      const initial = await nextFrame(() => {
        const loaded = preview.loadAsset(asset);
        if (!loaded.ok) throw new Error('Complete validated asset rejected by preview');
        previewSetupMs = performance.now() - loadStart;
      }, signal);
      const firstDrawEnd = performance.now(),
        loadAndFirstFrameMs = firstDrawEnd - loadStart;
      assertEnvironment();
      const samples: Readonly<PreviewFrame>[] = [],
        intervals: number[] = [],
        operationMs: number[] = [];
      let previous = initial.rafTimestampMs;
      const sampleStart = performance.now();
      for (let i = 0; i < WARMUP + measured; i++) {
        assertEnvironment();
        const operationStart = performance.now();
        const frame = await nextFrame(() => {
          if (i % 3 === 0) preview.fit(benchmarkBounds(asset.bounds, i));
          else preview.zoom(i % 3 === 1 ? 1.04 : 1 / 1.04, [WIDTH * 0.35, HEIGHT * 0.6]);
        }, signal);
        const operationEnd = performance.now();
        assertEnvironment();
        if (frame.width !== WIDTH || frame.height !== HEIGHT || !viewport)
          throw new Error('Measured preview viewport mismatch');
        if (i >= WARMUP) {
          samples.push(frame);
          intervals.push(frame.rafTimestampMs - previous);
          operationMs.push(operationEnd - operationStart);
        }
        previous = frame.rafTimestampMs;
        // No DOM work in the measured loop; all samples are bounded to the requested count.
      }
      const framesEnd = performance.now();
      const polygonVertices = (polygon: {
        readonly outer: readonly unknown[];
        readonly holes: readonly (readonly unknown[])[];
      }) => polygon.outer.length + polygon.holes.reduce((sum, ring) => sum + ring.length, 0);
      const layers = asset.layers;
      const vectorPointOccurrences =
        layers.cover.reduce(
          (sum, feature) =>
            sum + feature.polygons.reduce((n, polygon) => n + polygonVertices(polygon), 0),
          0,
        ) +
        layers.water.reduce(
          (sum, feature) =>
            sum +
            feature.polygons.reduce((n, polygon) => n + polygonVertices(polygon), 0) +
            ('centreline' in feature ? feature.centreline.length : 0),
          0,
        ) +
        layers.roads.reduce((sum, road) => sum + road.path.length, 0) +
        layers.roadNodes.length +
        layers.landmarks.length +
        layers.crossings.reduce(
          (sum, crossing) => sum + polygonVertices(crossing.deck) + crossing.endpoints.length,
          0,
        ) +
        layers.buildings.reduce((sum, building) => sum + polygonVertices(building.footprint), 0) +
        layers.contours.reduce((sum, contour) => sum + contour.path.length, 0) +
        layers.sites.reduce(
          (sum, site) =>
            sum +
            1 +
            site.entrances.length +
            polygonVertices(site.placementArea) +
            (site.occupiedFootprint ? polygonVertices(site.occupiedFootprint) : 0),
          0,
        );
      const counts = {
        features: Object.fromEntries(
          Object.entries(asset.layers).map(([name, values]) => [name, values.length]),
        ),
        elevationSamples: asset.elevation.samples.length,
        vectorPointOccurrences,
        assignedPopulation: asset.layers.sites.reduce(
          (sum, site) => sum + site.population.assigned,
          0,
        ),
        exportedJsonBytes: runtime.exportFiles ? utf8Bytes(runtime.exportFiles.json) : null,
        exportedSvgBytes: runtime.exportFiles ? utf8Bytes(runtime.exportFiles.svg) : null,
      };
      const result = {
        status: 'completed-diagnostic',
        certification: 'No acceptance claim; coordinator review required',
        recipe: {
          preset: preset.value,
          seed: recipe.seed,
          widthM: recipe.settings.widthM,
          heightM: recipe.settings.heightM,
          settings: recipe.settings,
          overrides: recipe.overrides,
        },
        provenance: asset.provenance,
        metadata: {
          ...metadata,
          backingCanvas: { width: canvas.width, height: canvas.height },
          renderDpr: initial.dpr,
        },
        counts,
        timings: {
          generationValidationExportMs: ready - start,
          previewLoadAndFirstFrameMs: loadAndFirstFrameMs,
          previewSynchronousSetupMs: previewSetupMs,
          warmupFrames: WARMUP,
          measuredFrames: measured,
          warmupAndMeasuredWallMs: framesEnd - sampleStart,
          countsAndMetadataMs: performance.now() - framesEnd,
          totalDiagnosticMs: performance.now() - start,
          frameInterval: durationStats(intervals),
          draw: durationStats(samples.map((f) => f.drawMs)),
          frameWork: durationStats(samples.map((f) => f.workMs)),
          requestToFrameStart: durationStats(samples.map((f) => f.requestToStartMs)),
          requestToFrameEnd: durationStats(samples.map((f) => f.requestToEndMs)),
          operationToObservedEnd: durationStats(operationMs),
        },
        samples: samples.map((frame, index) => ({
          ...frame,
          intervalMs: intervals[index],
          operationToObservedEndMs: operationMs[index],
        })),
      };
      const resultText = JSON.stringify(result, null, 2);
      assertEnvironment();
      output.textContent = resultText;
      status.textContent = `Completed diagnostic · ${measured} frames · p95 interval ${result.timings.frameInterval.p95Ms.toFixed(2)} ms · p95 draw ${result.timings.draw.p95Ms.toFixed(2)} ms · no gate acceptance`;
      status.classList.add('ks-ok');
    } catch (error) {
      if (runtime.controller.state.status !== 'disposed') runtime.controller.cancel();
      status.textContent = `Run failed · ${error instanceof Error ? error.message : String(error)}`;
      status.classList.add('ks-error');
      output.textContent = JSON.stringify(
        {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          metadata,
          elapsedMs: performance.now() - start,
        },
        null,
        2,
      );
    } finally {
      removeRunListeners.forEach((remove) => remove());
      clearTimeout(runTimer);
      active = null;
      controls.forEach((control) => {
        control.disabled = false;
      });
      cancel.disabled = true;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort('Benchmark disposed');
    eventAbort.abort();
    preview.dispose();
    runtime.dispose();
  }
  win.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) dispose();
      else if (active) abort('Cached-page departure interrupted the diagnostic run');
    },
    { signal: eventAbort.signal },
  );
  return { dispose };
}
const root = document.getElementById('benchmark');
if (root) mountBenchmark(root);
