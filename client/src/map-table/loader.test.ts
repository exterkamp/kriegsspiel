// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  generateBattlefield,
  exportBattlefield,
  canonicalizeAsset,
  canonicalGeometry,
  assetIdentity,
  importAsset,
  type MapAsset,
} from '@kriegsspiel/maps';
import {
  createAuthoringRuntime,
  type ValidationWorker,
  type ValidationRequest,
} from '../map-authoring/runtime/index.js';
import { TableScene, PreviewApplyError, type PreviewRaster } from '../table/FixtureTableScene.js';
import { createSavedMapLoader, readSavedFile } from './loader.js';
import * as THREE from 'three';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class Renderer {
    capabilities = { maxTextureSize: 2048, getMaxAnisotropy: () => 4 };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    getContext() {
      return { isContextLost: () => false };
    }
  }
  return { ...actual, WebGLRenderer: Renderer };
});

// A real generated small fixture, not the analytic reference asset used in raster tests.
let certified: MapAsset, saved: string;
beforeAll(() => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 500;
  settings.terrain.reliefM = 0;
  settings.cover.woodFraction = settings.cover.fieldFraction = 0;
  settings.settlements.villageCount = settings.settlements.farmCount = 1;
  settings.settlements.villagePopulation = 12;
  settings.settlements.minSpacingM = 150;
  settings.roads.extraLinks = 0;
  const generated = generateBattlefield({ seed: 17, settings, overrides: [] });
  if (!generated.ok) throw new Error(JSON.stringify(generated));
  certified = generated.value;
  const exported = exportBattlefield(certified);
  if (!exported.ok) throw new Error(JSON.stringify(exported));
  saved = exported.value.json;
}, 30000);

class FakeWorker implements ValidationWorker {
  onmessage: ValidationWorker['onmessage'] = null;
  onerror: ValidationWorker['onerror'] = null;
  onmessageerror: ValidationWorker['onmessageerror'] = null;
  request?: ValidationRequest;
  terminated = 0;
  postMessage(message: ValidationRequest) {
    this.request = message;
  }
  terminate() {
    this.terminated++;
  }
  reply() {
    this.onmessage?.({
      data: {
        v: 1,
        type: 'validated',
        requestId: this.request!.requestId,
        outcome: { ok: true, diagnostics: [] },
      },
    } as MessageEvent);
  }
}
// Executes the actual validation worker module (support check, full certification and export).
// Transport runs in this test process; native worker scheduling is a coordinator browser gate.
class RealEntryWorker extends FakeWorker {
  override postMessage(message: ValidationRequest) {
    super.postMessage(message);
    void (async () => {
      vi.resetModules();
      vi.stubGlobal('postMessage', (data: unknown) => this.onmessage?.({ data } as MessageEvent));
      vi.stubGlobal('onmessage', null);
      await import('../map-authoring/validate.worker.js');
      (globalThis as unknown as { onmessage: (event: MessageEvent) => void }).onmessage({
        data: message,
      } as MessageEvent);
    })().catch((error) => this.onerror?.({ message: String(error) } as ErrorEvent));
  }
}
const loaders: ReturnType<typeof createSavedMapLoader>[] = [];
function setup(options: Parameters<typeof createSavedMapLoader>[1] = {}, real = false) {
  const workers: FakeWorker[] = [];
  const noGeneration = vi.fn(() => {
    throw new Error('Generation is forbidden');
  });
  const runtime = createAuthoringRuntime({
    generationWorkerFactory: noGeneration,
    validationWorkerFactory: () => {
      const w = real ? new RealEntryWorker() : new FakeWorker();
      workers.push(w);
      return w;
    },
    waitTimeoutMs: options.waitTimeoutMs ?? 30000,
  });
  const table = { previewTextureLimit: vi.fn(() => 2048), applyPreviewRaster: vi.fn() };
  const prepare = vi.fn((asset, sourceKey: string, limit: number): PreviewRaster => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = limit;
    return {
      canvas,
      sourceKey,
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
      contentWidthPx: limit,
      contentHeightPx: limit,
    };
  });
  const loader = createSavedMapLoader(table, { runtime, prepare, ...options });
  loaders.push(loader);
  return { loader, workers, noGeneration, runtime, table, prepare };
}
const file = (text = saved, name = 'saved.json') =>
  new File([text], name, { type: 'application/json' });
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
async function ready(r: ReturnType<typeof setup>, name = 'saved.json') {
  await r.loader.load(file(saved, name));
  r.workers.at(-1)!.reply();
  await vi.waitFor(() => expect(r.loader.state.phase).toBe('ready'));
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  loaders.splice(0).forEach((l) => l.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saved-only independent certification and immutable full identity', () => {
  it('composes certified saved loading, actual MapRenderer raster, metre scene and rendered acknowledgment together', async () => {
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo() {}
        lineTo() {}
        closePath() {}
      },
    );
    const context = {
      save() {},
      restore() {},
      setTransform() {},
      fillRect() {},
      translate() {},
      scale() {},
      beginPath() {},
      rect() {},
      clip() {},
      drawImage() {},
      fill() {},
      stroke() {},
      fillText() {},
      measureText: () => ({ width: 12 }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const scene = new TableScene(document.createElement('canvas'), { mode: 'public-map-preview' });
    const noGeneration = vi.fn(() => {
      throw new Error('No generation during saved loading');
    });
    const runtime = createAuthoringRuntime({
      generationWorkerFactory: noGeneration,
      validationWorkerFactory: () => new RealEntryWorker(),
    });
    const loader = createSavedMapLoader(scene, { runtime });
    loaders.push(loader);
    const raster = vi.spyOn(scene, 'applyPreviewRaster');
    const render = vi.spyOn(scene.renderer, 'render').mockImplementation(() => {
      expect(loader.state.displayed).toBeNull();
      expect(scene.scene.getObjectByName('map-artwork')).toBeDefined();
    });
    try {
      await loader.load(file());
      await vi.waitFor(() => expect(loader.state.phase).toBe('ready'), { timeout: 20000 });
      expect(noGeneration).not.toHaveBeenCalled();
      expect(render).toHaveBeenCalledOnce();
      const prepared = raster.mock.calls[0]![0];
      const paper = scene.scene.getObjectByName('map-artwork') as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(prepared.canvas.width).toBe(2048);
      expect(prepared.canvas.height).toBe(2048);
      expect(paper.geometry.parameters).toMatchObject({ width: 500, height: 500 });
      expect(paper.material.map!.image).toBe(prepared.canvas);
      expect(loader.state.displayed!.sourceKey).toBe(await assetIdentity(certified, 'asset'));
      expect(canonicalizeAsset(structuredClone(runtime.controller.exportAsset) as MapAsset)).toBe(
        saved,
      );
      const disposed = vi.spyOn(paper.material.map!, 'dispose');
      loader.dispose();
      scene.dispose();
      scene.dispose();
      expect(disposed).toHaveBeenCalledOnce();
    } finally {
      loader.dispose();
      scene.dispose();
    }
  }, 30000);

  it('loads real generated/exported JSON through the actual certification worker entry, without generation', async () => {
    const r = setup({}, true);
    const before = canonicalizeAsset(certified);
    await r.loader.load(file());
    await vi.waitFor(() => expect(r.loader.state.phase).toBe('ready'), { timeout: 20000 });
    expect(r.noGeneration).not.toHaveBeenCalled();
    expect(r.workers[0]!.terminated).toBe(1);
    expect(r.loader.state.displayed).toMatchObject({
      name: certified.name,
      widthM: 500,
      heightM: 500,
      filename: 'saved.json',
      sourceKey: await assetIdentity(certified, 'asset'),
    });
    const asset = r.prepare.mock.calls[0]![0];
    expect(canonicalGeometry(structuredClone(asset))).toBe(canonicalGeometry(certified));
    expect(Object.isFrozen(asset.layers.buildings[0]!.footprint.outer[0])).toBe(true);
    expect(canonicalizeAsset(certified)).toBe(before);
    expect(r.table.applyPreviewRaster).toHaveBeenCalledTimes(1);
    expect(r.prepare.mock.calls[0]![2]).toBe(2048);
  }, 30000);
  it.each(['unsupported', 'composition'] as const)(
    'rejects %s saved geometry through the real validator',
    async (mutation) => {
      const changed = structuredClone(certified);
      if (mutation === 'unsupported') changed.provenance.generator.version = 'unsupported-v99';
      else
        changed.layers.buildings[0]!.kind =
          changed.layers.buildings[0]!.kind === 'residential' ? 'agricultural' : 'residential';
      const text = canonicalizeAsset(changed);
      expect(importAsset(text)).toEqual(changed);
      const r = setup({}, true);
      await r.loader.load(file(text));
      await vi.waitFor(() => expect(r.loader.state.phase).toBe('failed'), { timeout: 20000 });
      expect(r.loader.state.message).toContain(
        mutation === 'unsupported' ? 'UNSUPPORTED_REPLAY' : 'BUILDING_IDENTITY',
      );
      expect(r.table.applyPreviewRaster).not.toHaveBeenCalled();
      expect(r.noGeneration).not.toHaveBeenCalled();
    },
    30000,
  );
  it('rejects malformed JSON without worker creation and retains the displayed identity', async () => {
    const r = setup();
    await ready(r);
    const prior = r.loader.state.displayed;
    await r.loader.load(file('{bad', 'broken.json'));
    await settle();
    expect(r.loader.state.phase).toBe('failed');
    expect(r.workers).toHaveLength(1);
    expect(r.loader.state.displayed).toBe(prior);
    expect(r.table.applyPreviewRaster).toHaveBeenCalledTimes(1);
  });
  it('uses full asset identity so rename-only replacement does not collapse to geometry identity', async () => {
    const r = setup();
    await ready(r);
    const first = r.loader.state.displayed!.sourceKey;
    const renamed = { ...certified, name: 'Renamed saved map' };
    expect(canonicalGeometry(renamed)).toBe(canonicalGeometry(certified));
    await r.loader.load(file(canonicalizeAsset(renamed)));
    r.workers.at(-1)!.reply();
    await vi.waitFor(() => expect(r.loader.state.displayed!.name).toBe('Renamed saved map'));
    expect(r.loader.state.displayed!.sourceKey).not.toBe(first);
  });
});

describe('read, validation and preparation ownership', () => {
  it('caps bytes before any read or worker allocation', async () => {
    const read = vi.fn();
    const r = setup({ read });
    const tooLarge = file();
    Object.defineProperty(tooLarge, 'size', { value: 64 * 1024 * 1024 + 1 });
    await r.loader.load(tooLarge);
    expect(read).not.toHaveBeenCalled();
    expect(r.workers).toHaveLength(0);
    expect(r.loader.state.message).toContain('64 MiB');
    await expect(readSavedFile(tooLarge, new AbortController().signal)).rejects.toThrow('64 MiB');
  });
  it('aborts native reads on cancel and bounds read watchdog/errors', async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    class Reader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsText() {}
      abort = abort;
    }
    vi.stubGlobal('FileReader', Reader);
    const signal = new AbortController();
    const cancelled = readSavedFile(file(), signal.signal, 50);
    const rejected = expect(cancelled).rejects.toThrow('cancelled');
    signal.abort();
    await rejected;
    const timedOut = readSavedFile(file(), new AbortController().signal, 50);
    const timeoutRejected = expect(timedOut).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await timeoutRejected;
    expect(abort).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
    vi.stubGlobal('crypto', webcrypto);
  });
  it('reports read errors while preserving a prior displayed map', async () => {
    let rejectRead = false;
    const read: typeof readSavedFile = async () => {
      if (rejectRead) throw new Error('Unreadable saved file');
      return saved;
    };
    const r = setup({ read });
    await ready(r);
    const prior = r.loader.state.displayed;
    rejectRead = true;
    await r.loader.load(file('', 'unreadable.json'));
    expect(r.loader.state.phase).toBe('failed');
    expect(r.loader.state.displayed).toBe(prior);
  });
  it('A/B/C late reads cannot start obsolete certification, including after cancel/dispose', async () => {
    const reads: { resolve: (s: string) => void; signal: AbortSignal }[] = [];
    const read: typeof readSavedFile = (_f, signal) =>
      new Promise((resolve) => reads.push({ resolve, signal }));
    const r = setup({ read });
    const a = r.loader.load(file('', 'A'));
    const b = r.loader.load(file('', 'B'));
    const c = r.loader.load(file('', 'C'));
    expect(reads[0]!.signal.aborted).toBe(true);
    expect(reads[1]!.signal.aborted).toBe(true);
    reads[0]!.resolve(saved);
    reads[1]!.resolve(saved);
    await Promise.all([a, b]);
    expect(r.workers).toHaveLength(0);
    reads[2]!.resolve(saved);
    await c;
    r.workers[0]!.reply();
    await vi.waitFor(() => expect(r.loader.state.phase).toBe('ready'));
    expect(r.loader.state.displayed!.filename).toBe('C');
    const d = r.loader.load(file('', 'D'));
    r.loader.cancel();
    reads[3]!.resolve(saved);
    await d;
    const e = r.loader.load(file('', 'E'));
    r.loader.dispose();
    reads[4]!.resolve(saved);
    await e;
    expect(r.table.applyPreviewRaster).toHaveBeenCalledTimes(1);
    expect(r.workers).toHaveLength(1);
  });
  it('stale captured certification replies and worker errors cannot replace the current map', async () => {
    const r = setup();
    await r.loader.load(file(saved, 'A'));
    const a = r.workers[0]!;
    const late = a.onmessage;
    await r.loader.load(file(saved, 'B'));
    const b = r.workers[1]!;
    late?.({
      data: {
        v: 1,
        type: 'validated',
        requestId: a.request!.requestId,
        outcome: { ok: true, diagnostics: [] },
      },
    } as MessageEvent);
    b.reply();
    await vi.waitFor(() => expect(r.loader.state.phase).toBe('ready'));
    expect(r.loader.state.displayed!.filename).toBe('B');
    expect(a.terminated).toBe(1);
    await r.loader.load(file());
    r.workers[2]!.onerror?.({ message: 'worker crashed' } as ErrorEvent);
    await settle();
    expect(r.loader.state.phase).toBe('failed');
    expect(r.loader.state.displayed!.filename).toBe('B');
  });
  it('cancel and finite certification watchdog terminate the worker and retain prior display', async () => {
    const r = setup({ waitTimeoutMs: 50, read: async () => saved });
    await ready(r);
    const prior = r.loader.state.displayed;
    await r.loader.load(file());
    r.loader.cancel();
    expect(r.workers[1]!.terminated).toBe(1);
    expect(r.loader.state.phase).toBe('cancelled');
    expect(r.loader.state.displayed).toBe(prior);
    vi.useFakeTimers();
    await r.loader.load(file());
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(r.loader.state.phase).toBe('failed');
    expect(r.loader.state.message).toContain('watchdog');
    expect(r.workers[2]!.terminated).toBe(1);
    expect(r.loader.state.displayed).toBe(prior);
    expect(r.noGeneration).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'replace', 'dispose'] as const)(
    'guards deferred preparation after %s',
    async (action) => {
      const pending: ((s: string) => void)[] = [];
      const r = setup({ identity: () => new Promise((resolve) => pending.push(resolve)) });
      await r.loader.load(file());
      r.workers[0]!.reply();
      await settle();
      expect(r.loader.state.phase).toBe('preparing');
      if (action === 'cancel') r.loader.cancel();
      else if (action === 'dispose') r.loader.dispose();
      else await r.loader.load(file(saved, 'B'));
      pending[0]!('old-key');
      await settle();
      expect(r.prepare).not.toHaveBeenCalled();
      expect(r.table.applyPreviewRaster).not.toHaveBeenCalled();
    },
  );
  it.each(['prepare', 'retained', 'unavailable'] as const)(
    'publishes metadata only after success; handles %s failure honestly',
    async (point) => {
      const r = setup();
      await ready(r);
      const prior = r.loader.state.displayed;
      if (point === 'prepare')
        r.prepare.mockImplementationOnce(() => {
          throw new Error('raster allocation failed');
        });
      else
        r.table.applyPreviewRaster.mockImplementationOnce(() => {
          throw new PreviewApplyError('candidate frame failed', point);
        });
      await r.loader.load(file(saved, 'B'));
      r.workers.at(-1)!.reply();
      await vi.waitFor(() => expect(r.loader.state.phase).toBe('failed'));
      expect(r.loader.state.displayed).toBe(prior);
      expect(r.loader.state.available).toBe(point !== 'unavailable');
      await ready(r, 'C');
      expect(r.loader.state.displayed!.filename).toBe('C');
      expect(r.loader.state.available).toBe(true);
    },
  );
});
