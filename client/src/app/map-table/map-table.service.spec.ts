import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  assetIdentity,
  exportBattlefield,
  generateBattlefield,
  supportsReplay,
  validateBattlefield,
  type MapAsset,
} from '@kriegsspiel/maps';
import { createSavedMapLoader, readSavedFile, type LoadState } from '../../shared/map-table/loader';
import {
  createAuthoringRuntime,
  createValidationRunner,
  type ValidationRequest,
  type ValidationWorker,
} from '../../legacy/map-authoring/runtime/index';
import { PreviewApplyError } from '../../legacy/table/FixtureTableScene';
import type { PreviewAsset } from '../../legacy/map-authoring/asset';
import {
  MAP_TABLE_LOADER_FACTORY,
  MAP_TABLE_OBSERVER_FACTORY,
  MAP_TABLE_SCENE_FACTORY,
  MapTableService,
  type MapTableScene,
} from './map-table.service';

const displayed = {
  name: '<Village & Hills>',
  filename: 'public.json',
  sourceKey: 'full-asset-digest',
  widthM: 15000,
  heightM: 5000,
  inspection: null,
};
function setup() {
  let publish!: (state: LoadState) => void;
  let resize!: ResizeObserverCallback;
  let report!: (error: PreviewApplyError) => void;
  const scene = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    fitPreview: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    previewTextureLimit: () => 4096,
    previewObservation: () => null,
    applyPreviewRaster: vi.fn(),
  } satisfies MapTableScene;
  const unsubscribe = vi.fn(() => true);
  const loader = {
    load: vi.fn(async () => {}),
    cancel: vi.fn(),
    dispose: vi.fn(),
    unavailable: vi.fn((message: string) =>
      publish({
        ...service.state(),
        phase: 'failed',
        available: false,
        message,
      }),
    ),
    subscribe: vi.fn((listener: (state: LoadState) => void) => {
      publish = listener;
      listener({ phase: 'empty', message: 'Load saved JSON.', displayed: null, available: true });
      return unsubscribe;
    }),
  };
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  const sceneFactory = vi.fn((_canvas: HTMLCanvasElement, callback: typeof report) => {
    report = callback;
    return scene;
  });
  const loaderFactory = vi.fn(() => loader);
  const observerFactory = vi.fn((callback: ResizeObserverCallback) => {
    resize = callback;
    return observer;
  });
  TestBed.configureTestingModule({
    providers: [
      MapTableService,
      { provide: MAP_TABLE_SCENE_FACTORY, useValue: sceneFactory },
      { provide: MAP_TABLE_LOADER_FACTORY, useValue: loaderFactory },
      { provide: MAP_TABLE_OBSERVER_FACTORY, useValue: observerFactory },
    ],
  });
  const service = TestBed.inject(MapTableService);
  const canvas = document.createElement('canvas');
  return {
    service,
    canvas,
    scene,
    loader,
    observer,
    unsubscribe,
    sceneFactory,
    loaderFactory,
    observerFactory,
    publish: (state: LoadState) => publish(state),
    ready: () => publish({ phase: 'ready', message: 'Map loaded.', displayed, available: true }),
    resize: () => resize([], observer as unknown as ResizeObserver),
    report: (error: PreviewApplyError) => report(error),
  };
}
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MapTableService scoped resource ownership', () => {
  it('allocates only on mount, subscribes once, and handles selection/cancel and camera controls', () => {
    const h = setup();
    expect(h.service.canLoad()).toBe(false);
    expect(h.sceneFactory).not.toHaveBeenCalled();
    h.service.mount(h.canvas);
    h.service.mount(h.canvas);
    expect(h.sceneFactory).toHaveBeenCalledExactlyOnceWith(h.canvas, expect.any(Function));
    expect(h.loaderFactory).toHaveBeenCalledExactlyOnceWith(h.scene);
    expect(h.scene.start).toHaveBeenCalledOnce();
    expect(h.service.canLoad()).toBe(true);
    h.service.fit();
    expect(h.scene.fitPreview).not.toHaveBeenCalled();
    const file = new File(['{}'], 'map.json');
    h.service.load(file);
    expect(h.loader.load).toHaveBeenCalledExactlyOnceWith(file);
    h.publish({
      phase: 'validating',
      message: 'Certifying saved geometry…',
      displayed: null,
      available: true,
    });
    expect(h.service.busy()).toBe(true);
    h.service.cancel();
    expect(h.loader.cancel).toHaveBeenCalledOnce();
    h.ready();
    h.service.fit();
    h.service.topDown();
    h.service.oblique();
    expect(h.scene.fitPreview).toHaveBeenCalledOnce();
    expect(h.scene.snapTopDown).toHaveBeenCalledOnce();
    expect(h.scene.snapOblique).toHaveBeenCalledOnce();
    expect(h.service.extent()).toContain('15,000 × 5,000 m');
    h.resize();
    window.dispatchEvent(new Event('resize'));
    expect(h.scene.resize).toHaveBeenCalledTimes(2);
  });

  it('retains accepted identity on cancellation and failure, and disables controls for unavailable history', () => {
    const h = setup();
    h.service.mount(h.canvas);
    h.ready();
    for (const phase of ['reading', 'validating', 'preparing', 'cancelled', 'failed'] as const) {
      h.publish({ phase, message: 'Replacement request', displayed, available: true });
      expect(h.service.displayed()).toBe(displayed);
      expect(h.service.retained()).toBe(true);
      expect(h.service.canInspect()).toBe(true);
    }
    h.report(new PreviewApplyError('later frame failed', 'unavailable'));
    expect(h.service.state().message).toContain('later frame failed');
    expect(h.service.retainedMessage()).toContain('historical');
    expect(h.service.canInspect()).toBe(false);
    h.service.oblique();
    expect(h.scene.snapOblique).not.toHaveBeenCalled();
    h.service.dispose();
    h.report(new PreviewApplyError('late report', 'unavailable'));
    expect(h.loader.unavailable).toHaveBeenCalledOnce();
  });

  it('publishes optional source-bound inspection without losing an accepted display on serialization failure', () => {
    const h = setup();
    h.service.mount(h.canvas);
    const snapshot = { sourceKey: displayed.sourceKey, textureLimitPx: 4096 };
    h.publish({
      phase: 'ready',
      message: 'ready',
      displayed: {
        ...displayed,
        inspection: snapshot as unknown as NonNullable<LoadState['displayed']>['inspection'],
      },
      available: true,
    });
    expect(JSON.parse(h.service.inspection()!)).toEqual(snapshot);
    const broken = {
      ...snapshot,
      toJSON() {
        throw new Error('serialization failed');
      },
    };
    h.publish({
      ...h.service.state(),
      displayed: {
        ...displayed,
        inspection: broken as unknown as NonNullable<LoadState['displayed']>['inspection'],
      },
    });
    expect(h.service.inspection()).toBeNull();
    expect(h.service.canInspect()).toBe(true);
    h.ready();
    expect(h.service.inspection()).toBeNull();
  });

  it('stops and cancels on repeated persisted navigation, preserves the same scene and resumes once', () => {
    const h = setup();
    h.service.mount(h.canvas);
    h.ready();
    for (let visit = 1; visit <= 3; visit++) {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      expect(h.scene.stop).toHaveBeenCalledTimes(visit);
      expect(h.loader.cancel).toHaveBeenCalledTimes(visit);
      h.resize();
      h.service.load(new File(['{}'], 'late.json'));
      h.service.oblique();
      expect(h.scene.resize).toHaveBeenCalledTimes(visit - 1);
      expect(h.loader.load).not.toHaveBeenCalled();
      expect(h.scene.snapOblique).not.toHaveBeenCalled();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(h.scene.resize).toHaveBeenCalledTimes(visit);
      expect(h.scene.start).toHaveBeenCalledTimes(visit + 1);
      expect(h.service.displayed()).toBe(displayed);
      expect(h.scene.dispose).not.toHaveBeenCalled();
      expect(h.loader.dispose).not.toHaveBeenCalled();
    }
    expect(h.sceneFactory).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    h.service.mount(h.canvas);
    h.service.dispose();
    expect(h.scene.dispose).toHaveBeenCalledOnce();
    expect(h.scene.start).toHaveBeenCalledTimes(4);
    expect(h.sceneFactory).toHaveBeenCalledOnce();
  });

  it('cannot restart an unavailable or explicitly disposed suspended scene', () => {
    const h = setup();
    h.service.mount(h.canvas);
    h.ready();
    h.report(new PreviewApplyError('frame failed', 'unavailable'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(h.scene.start).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    h.service.dispose();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(h.scene.start).toHaveBeenCalledOnce();
  });

  it('reports lost context and resize failures through the loader', () => {
    const h = setup();
    h.service.mount(h.canvas);
    h.ready();
    const event = new Event('webglcontextlost', { cancelable: true });
    h.service.contextLost(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.scene.stop).toHaveBeenCalledOnce();
    expect(h.loader.unavailable).toHaveBeenCalledWith(expect.stringContaining('context was lost'));
    h.scene.resize.mockImplementation(() => {
      throw new Error('resize failed');
    });
    h.resize();
    expect(h.loader.unavailable).toHaveBeenLastCalledWith('resize failed');
    h.service.dispose();
    const late = new Event('webglcontextlost', { cancelable: true });
    h.service.contextLost(late);
    expect(late.defaultPrevented).toBe(false);
  });

  it.each(['scene', 'loader', 'subscribe', 'observer', 'observe', 'start'] as const)(
    'cleans acquired resources after %s startup failure without allocating again',
    (step) => {
      const h = setup();
      const fail = () => {
        throw new Error(`${step} failed`);
      };
      if (step === 'scene') h.sceneFactory.mockImplementation(fail);
      if (step === 'loader') h.loaderFactory.mockImplementation(fail);
      if (step === 'subscribe') h.loader.subscribe.mockImplementation(fail);
      if (step === 'observer') h.observerFactory.mockImplementation(fail);
      if (step === 'observe') h.observer.observe.mockImplementation(fail);
      if (step === 'start') h.scene.start.mockImplementation(fail);
      h.service.mount(h.canvas);
      expect(h.service.state().message).toContain(`${step} failed`);
      expect(h.service.state().available).toBe(false);
      expect(h.service.canLoad()).toBe(false);
      expect(h.scene.dispose).toHaveBeenCalledTimes(step === 'scene' ? 0 : 1);
      expect(h.loader.dispose).toHaveBeenCalledTimes(['scene', 'loader'].includes(step) ? 0 : 1);
      expect(h.observer.disconnect).toHaveBeenCalledTimes(
        ['observe', 'start'].includes(step) ? 1 : 0,
      );
      h.service.mount(h.canvas);
      h.service.dispose();
      window.dispatchEvent(new Event('resize'));
      h.service.load(new File(['{}'], 'late.json'));
      expect(h.loader.load).not.toHaveBeenCalled();
      expect(h.scene.resize).not.toHaveBeenCalled();
      expect(h.sceneFactory).toHaveBeenCalledOnce();
    },
  );

  it.each(['scene', 'loader', 'subscribe', 'observer', 'observe', 'start'] as const)(
    'releases late resources when destruction reenters during %s acquisition',
    (step) => {
      const h = setup();
      if (step === 'scene')
        h.sceneFactory.mockImplementation(() => {
          h.service.dispose();
          return h.scene;
        });
      if (step === 'loader')
        h.loaderFactory.mockImplementation(() => {
          h.service.dispose();
          return h.loader;
        });
      if (step === 'subscribe')
        h.loader.subscribe.mockImplementation(() => {
          h.service.dispose();
          return h.unsubscribe;
        });
      if (step === 'observer')
        h.observerFactory.mockImplementation(() => {
          h.service.dispose();
          return h.observer;
        });
      if (step === 'observe') h.observer.observe.mockImplementation(() => h.service.dispose());
      if (step === 'start') h.scene.start.mockImplementation(() => h.service.dispose());
      h.service.mount(h.canvas);
      h.service.dispose();
      expect(h.scene.dispose).toHaveBeenCalledOnce();
      expect(h.loader.dispose).toHaveBeenCalledTimes(step === 'scene' ? 0 : 1);
      expect(h.unsubscribe).toHaveBeenCalledTimes(
        ['subscribe', 'observer', 'observe', 'start'].includes(step) ? 1 : 0,
      );
      expect(h.observer.disconnect).toHaveBeenCalledTimes(
        ['observer', 'observe', 'start'].includes(step) ? 1 : 0,
      );
      expect(h.service.canLoad()).toBe(false);
      h.service.mount(h.canvas);
      expect(h.sceneFactory).toHaveBeenCalledOnce();
    },
  );

  it('detaches all ownership before reentrant or throwing releases and rejects captured callbacks', () => {
    const h = setup();
    h.service.mount(h.canvas);
    h.ready();
    h.unsubscribe.mockImplementation(() => {
      h.service.dispose();
      throw new Error('release failed');
    });
    h.loader.dispose.mockImplementation(() => h.service.dispose());
    h.scene.stop.mockImplementation(() => {
      throw new Error('stop failed');
    });
    h.scene.dispose.mockImplementation(() => h.service.dispose());
    h.service.dispose();
    h.service.dispose();
    h.resize();
    h.publish({ phase: 'empty', message: 'late', displayed: null, available: true });
    expect(h.service.displayed()).toBe(displayed);
    expect(h.scene.resize).not.toHaveBeenCalled();
    expect(h.observer.disconnect).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.loader.dispose).toHaveBeenCalledOnce();
    expect(h.scene.dispose).toHaveBeenCalledOnce();
  });

  it('registers DestroyRef before mounting and suppresses post-destroy allocation', () => {
    const h = setup();
    TestBed.resetTestingModule();
    h.service.mount(h.canvas);
    expect(h.sceneFactory).not.toHaveBeenCalled();
  });

  it('DestroyRef releases mounted resources exactly once', () => {
    const h = setup();
    h.service.mount(h.canvas);
    TestBed.resetTestingModule();
    h.service.dispose();
    expect(h.scene.dispose).toHaveBeenCalledOnce();
    expect(h.loader.dispose).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.observer.disconnect).toHaveBeenCalledOnce();
  });

  it('registers all window listeners with a single lifetime signal and aborts it on teardown', () => {
    const h = setup();
    const add = vi.spyOn(window, 'addEventListener');
    h.service.mount(h.canvas);
    const registrations = add.mock.calls.filter(([type]) =>
      ['resize', 'pagehide', 'pageshow'].includes(type),
    );
    expect(registrations.map(([type]) => type)).toEqual(['resize', 'pagehide', 'pageshow']);
    const signals = registrations.map(
      ([, , options]) => (options as AddEventListenerOptions).signal!,
    );
    expect(new Set(signals).size).toBe(1);
    expect(signals[0]!.aborted).toBe(false);
    h.service.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

it('composes the Angular service with real saved-file certification, retained display and stale read/hash cleanup', async () => {
  // Native worker scheduling/WebGL remain browser gates. This transport executes the retained
  // validation runner and full map validator/export algorithms in this test process.
  vi.stubGlobal('crypto', webcrypto);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 500;
  settings.terrain.reliefM = 0;
  settings.cover.woodFraction = settings.cover.fieldFraction = 0;
  settings.settlements.villageCount = settings.settlements.farmCount = 1;
  settings.settlements.villagePopulation = 12;
  settings.settlements.minSpacingM = 150;
  settings.roads.extraLinks = 0;
  const result = generateBattlefield({ seed: 17, settings, overrides: [] });
  if (!result.ok) throw new Error(JSON.stringify(result));
  const exported = exportBattlefield(result.value);
  if (!exported.ok) throw new Error(JSON.stringify(exported));
  const key = await assetIdentity(result.value, 'asset');
  const workers: WorkerTransport[] = [];
  class WorkerTransport implements ValidationWorker {
    onmessage: ValidationWorker['onmessage'] = null;
    onerror: ValidationWorker['onerror'] = null;
    onmessageerror: ValidationWorker['onmessageerror'] = null;
    terminated = 0;
    private readonly runner = createValidationRunner({
      validate: (asset) => {
        expect(supportsReplay(asset)).toBe(true);
        const outcome = validateBattlefield(asset);
        return outcome.ok ? { ok: true, diagnostics: outcome.diagnostics } : outcome;
      },
      exportValidated: (asset) => exportBattlefield(structuredClone(asset) as MapAsset),
      postMessage: (message) =>
        this.onmessage?.({ data: structuredClone(message) } as MessageEvent),
    });
    postMessage(message: ValidationRequest): void {
      void this.runner
        .handleMessage(structuredClone(message))
        .catch((error) => this.onerror?.({ message: String(error) } as ErrorEvent));
    }
    terminate(): void {
      this.terminated++;
    }
  }
  const generation = vi.fn(() => {
    throw new Error('Inspector never generates');
  });
  const runtime = createAuthoringRuntime({
    generationWorkerFactory: generation,
    validationWorkerFactory: () => {
      const worker = new WorkerTransport();
      workers.push(worker);
      return worker;
    },
  });
  const runtimeDispose = vi.spyOn(runtime, 'dispose');
  const scene: MapTableScene = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    fitPreview: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    previewTextureLimit: () => 4096,
    previewObservation: () => null,
    applyPreviewRaster: vi.fn(),
  };
  let delayRead = false,
    delayIdentity = false;
  let finishRead!: (json: string) => void, finishIdentity!: (identity: string) => void;
  let readSignal!: AbortSignal;
  const prepare = vi.fn((asset: PreviewAsset, sourceKey: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 500;
    return {
      canvas,
      sourceKey,
      widthM: asset.bounds.maxX - asset.bounds.minX,
      heightM: asset.bounds.maxY - asset.bounds.minY,
      contentWidthPx: 500,
      contentHeightPx: 500,
    };
  });
  TestBed.configureTestingModule({
    providers: [
      MapTableService,
      { provide: MAP_TABLE_SCENE_FACTORY, useValue: () => scene },
      { provide: MAP_TABLE_OBSERVER_FACTORY, useValue: () => ({ observe() {}, disconnect() {} }) },
      {
        provide: MAP_TABLE_LOADER_FACTORY,
        useValue: (table: MapTableScene) =>
          createSavedMapLoader(table, {
            runtime,
            prepare,
            read: (file, signal, timeout) => {
              readSignal = signal;
              return delayRead
                ? new Promise((resolve) => {
                    finishRead = resolve;
                  })
                : readSavedFile(file, signal, timeout);
            },
            identity: (asset) =>
              delayIdentity
                ? new Promise((resolve) => {
                    finishIdentity = resolve;
                  })
                : assetIdentity(structuredClone(asset) as MapAsset, 'asset'),
          }),
      },
    ],
  });
  const service = TestBed.inject(MapTableService);
  service.mount(document.createElement('canvas'));
  const file = new File([exported.value.json], 'certified.json');
  service.load(file);
  await vi.waitFor(() => expect(service.state().phase).toBe('ready'));
  const accepted = service.displayed();
  expect(accepted?.sourceKey).toBe(key);
  expect(accepted?.name).toBe(result.value.name);
  expect(scene.applyPreviewRaster).toHaveBeenCalledOnce();
  expect(workers[0]!.terminated).toBe(1);
  expect(generation).not.toHaveBeenCalled();
  service.load(new File(['invalid JSON'], 'bad.json'));
  await vi.waitFor(() => expect(service.state().phase).toBe('failed'));
  expect(service.displayed()).toBe(accepted);
  delayRead = true;
  service.load(file);
  service.cancel();
  expect(readSignal.aborted).toBe(true);
  finishRead(exported.value.json);
  await Promise.resolve();
  await Promise.resolve();
  expect(workers).toHaveLength(1);
  expect(service.state().phase).toBe('cancelled');
  expect(service.displayed()).toBe(accepted);
  delayRead = false;
  delayIdentity = true;
  service.load(file);
  await vi.waitFor(() => expect(finishIdentity).toBeTypeOf('function'));
  expect(service.state().phase).toBe('preparing');
  TestBed.resetTestingModule();
  finishIdentity(key);
  await Promise.resolve();
  await Promise.resolve();
  expect(prepare).toHaveBeenCalledOnce();
  expect(scene.applyPreviewRaster).toHaveBeenCalledOnce();
  expect(service.displayed()).toBe(accepted);
  expect(scene.dispose).toHaveBeenCalledOnce();
  expect(runtimeDispose).toHaveBeenCalledOnce();
  expect(workers.every((worker) => worker.terminated === 1)).toBe(true);
}, 30000);
