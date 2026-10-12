import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthoringRuntime,
  type ValidationRequest,
} from '../../legacy/map-authoring/runtime/index.js';
import type { GenerateRequest } from '../../legacy/map-authoring/generation/protocol.js';
import { defaultParameters } from '../../legacy/map-authoring/controls/recipe.js';
import { createBoardPreparation } from './preparation.js';
import type { BoardPreparation, CertifiedBoard, MapSummary } from './contracts.js';
type Runtime = ReturnType<typeof createAuthoringRuntime>;
class Worker<T> {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  sent: T[] = [];
  terminate = vi.fn();
  postMessage(message: T) {
    this.sent.push(message);
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const preparations: BoardPreparation[] = [];
afterEach(() => {
  preparations.splice(0).forEach((preparation) => preparation.dispose());
  vi.restoreAllMocks();
});
function harness(
  options: {
    runtime?: (runtime: Runtime) => void;
    generation?: (worker: Worker<GenerateRequest>) => void;
    validation?: (worker: Worker<ValidationRequest>) => void;
  } = {},
) {
  const generation: Worker<GenerateRequest>[] = [];
  const validation: Worker<ValidationRequest>[] = [];
  const runtimes: Runtime[] = [];
  const generationFactory = vi.fn(() => {
    const worker = new Worker<GenerateRequest>();
    generation.push(worker);
    options.generation?.(worker);
    return worker;
  });
  const runtimeFactory = vi.fn(() => {
    const runtime = createAuthoringRuntime({
      generationWorkerFactory: generationFactory,
      validationWorkerFactory: () => {
        const worker = new Worker<ValidationRequest>();
        validation.push(worker);
        options.validation?.(worker);
        return worker;
      },
    });
    runtimes.push(runtime);
    options.runtime?.(runtime);
    return runtime;
  });
  const preparation = createBoardPreparation({ runtimeFactory });
  preparations.push(preparation);
  return { preparation, generation, validation, generationFactory, runtimeFactory, runtimes };
}
const asset = createReferenceAsset();
const json = canonicalizeAsset(asset);
const summary: MapSummary = {
  ref: { kind: 'premade', id: 'reference' },
  name: asset.name,
  widthM: 150,
  heightM: 150,
};
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function accept(worker: Worker<ValidationRequest>, exportJson = json) {
  worker.reply({
    v: 1,
    type: 'validated',
    requestId: worker.sent[0]!.requestId,
    outcome: { ok: true, diagnostics: [] },
    files: { json: exportJson, svg: '<svg/>' },
  });
}
// Accepted worker replies here are lifecycle doubles, not complete-composition evidence.
describe('board preparation runtime boundary', () => {
  it('loads saved geometry without generating, requires matching export, and returns full identity', async () => {
    const h = harness();
    const pending = h.preparation.load(json, summary, new AbortController().signal);
    expect(h.generationFactory).not.toHaveBeenCalled();
    accept(h.validation[0]!);
    const board = await pending;
    expect(board.assetIdentity).toBe(await assetIdentity(asset, 'asset'));
    expect(board.canonicalJson).toBe(json);
    expect(board.summary.ref).toEqual(summary.ref);
    expect(board.bounds).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 150 });
    expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
    h.preparation.dispose();
    h.preparation.dispose();
  });
  it('rejects current certification without its matching canonical export', async () => {
    const h = harness();
    const pending = h.preparation.load(json, summary, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('does not match');
    accept(h.validation[0]!, canonicalizeAsset({ ...asset, name: 'different' }));
    await rejection;
    h.preparation.dispose();
  });
  it('generates the exact full recipe and leaves the reference null', async () => {
    const h = harness();
    const recipe = {
      seed: asset.provenance.seed,
      settings: structuredClone(asset.settings),
      overrides: structuredClone(asset.overrides),
    };
    const pending = h.preparation.generate(recipe, new AbortController().signal);
    const worker = h.generation[0]!;
    expect(worker.sent[0]).toMatchObject(recipe);
    worker.reply({
      v: 1,
      type: 'candidate',
      requestId: worker.sent[0]!.requestId,
      asset,
      diagnostics: [],
    });
    await flush();
    accept(h.validation[0]!);
    expect((await pending).summary.ref).toBeNull();
    h.preparation.dispose();
  });
  it('cancellation/replacement/disposal settle promises and terminate owned workers', async () => {
    const h = harness();
    const controller = new AbortController();
    const first = h.preparation.load(json, summary, controller.signal);
    const cancelled = expect(first).rejects.toThrow('cancelled');
    controller.abort();
    await cancelled;
    expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
    const next = h.preparation.generate(defaultParameters(), new AbortController().signal);
    const replaced = expect(next).rejects.toThrow('cancelled');
    const last = h.preparation.load(json, summary, new AbortController().signal);
    const disposed = expect(last).rejects.toThrow('cancelled');
    await replaced;
    h.preparation.dispose();
    h.preparation.dispose();
    await disposed;
    expect(h.generation[0]!.terminate).toHaveBeenCalledOnce();
    expect(h.validation[1]!.terminate).toHaveBeenCalledOnce();
  });
});

describe('preparation ownership regressions', () => {
  it('does not allocate for an already aborted signal or a disposed service', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(h.preparation.load(json, summary, controller.signal)).rejects.toThrow('cancelled');
    h.preparation.dispose();
    await expect(
      h.preparation.generate(defaultParameters(), new AbortController().signal),
    ).rejects.toThrow('cancelled');
    expect(h.runtimeFactory).not.toHaveBeenCalled();
  });

  it.each(['abort', 'dispose', 'replace'] as const)(
    'releases a runtime handed back after %s inside its factory without dispatching work',
    async (action) => {
      const controller = new AbortController();
      let replacement: Promise<CertifiedBoard> | undefined;
      const h = harness({
        runtime(runtime) {
          vi.spyOn(runtime, 'dispose');
          if (h.runtimes.length !== 1) return;
          if (action === 'abort') controller.abort();
          else if (action === 'dispose') h.preparation.dispose();
          else replacement = h.preparation.load(json, summary, new AbortController().signal);
        },
      });
      await expect(h.preparation.load(json, summary, controller.signal)).rejects.toThrow(
        'cancelled',
      );
      expect(h.runtimes[0]!.dispose).toHaveBeenCalledOnce();
      expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
      expect(h.generation).toHaveLength(0);
      if (action === 'replace') {
        expect(h.validation).toHaveLength(1);
        accept(h.validation[0]!);
        expect((await replacement!).summary.ref).toEqual(summary.ref);
      } else expect(h.validation).toHaveLength(0);
    },
  );

  it('releases partial subscription startup and permits a fresh retry', async () => {
    const error = new Error('Subscription startup failed');
    const h = harness({
      runtime(runtime) {
        vi.spyOn(runtime, 'dispose');
        if (h.runtimes.length === 1)
          vi.spyOn(runtime.controller, 'subscribe').mockImplementationOnce(() => {
            throw error;
          });
      },
    });
    await expect(h.preparation.load(json, summary, new AbortController().signal)).rejects.toBe(
      error,
    );
    expect(h.runtimes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.validation).toHaveLength(0);
    const next = h.preparation.load(json, summary, new AbortController().signal);
    accept(h.validation[0]!);
    await next;
    expect(h.runtimes[1]!.dispose).toHaveBeenCalledOnce();
  });

  it('releases the subscription returned after reentrant abort and never dispatches', async () => {
    const controller = new AbortController();
    const unsubscribe = vi.fn();
    const h = harness({
      runtime(runtime) {
        vi.spyOn(runtime, 'dispose');
        const subscribe = runtime.controller.subscribe.bind(runtime.controller);
        vi.spyOn(runtime.controller, 'subscribe').mockImplementation((listener) => {
          const stop = subscribe(listener);
          controller.abort();
          return () => {
            unsubscribe();
            stop();
          };
        });
      },
    });
    await expect(h.preparation.load(json, summary, controller.signal)).rejects.toThrow('cancelled');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(h.runtimes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.validation).toHaveLength(0);
  });

  it.each(['generation', 'validation'] as const)(
    'owns and terminates a worker returned after abort inside the %s factory',
    async (kind) => {
      const controller = new AbortController();
      const h = harness({ [kind]: () => controller.abort() });
      const pending =
        kind === 'generation'
          ? h.preparation.generate(defaultParameters(), controller.signal)
          : h.preparation.load(json, summary, controller.signal);
      await expect(pending).rejects.toThrow('cancelled');
      const worker = h[kind][0]!;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
    },
  );

  it.each(['generation', 'validation'] as const)(
    'releases partial %s dispatch after postMessage throws',
    async (kind) => {
      const h = harness({
        [kind]: (worker: Worker<GenerateRequest> | Worker<ValidationRequest>) => {
          worker.postMessage = vi.fn(() => {
            throw new Error('Cannot dispatch worker');
          });
        },
      });
      const pending =
        kind === 'generation'
          ? h.preparation.generate(defaultParameters(), new AbortController().signal)
          : h.preparation.load(json, summary, new AbortController().signal);
      await expect(pending).rejects.toThrow('Cannot dispatch worker');
      expect(h[kind][0]!.terminate).toHaveBeenCalledOnce();
      expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
    },
  );

  it.each(['abort', 'dispose', 'replace'] as const)(
    'owns a validation worker returned after %s during asynchronous candidate certification',
    async (action) => {
      const controller = new AbortController();
      const retirementRuntimeCounts: number[] = [];
      let replacement: Promise<CertifiedBoard> | undefined;
      const h = harness({
        validation(worker) {
          if (h.validation.length !== 1) return;
          const terminate = worker.terminate;
          worker.terminate = vi.fn(() => {
            // Replacement allocation must follow completion of predecessor cleanup.
            retirementRuntimeCounts.push(h.runtimes.length);
            terminate();
          });
          if (action === 'abort') controller.abort();
          else if (action === 'dispose') h.preparation.dispose();
          else replacement = h.preparation.load(json, summary, new AbortController().signal);
        },
      });
      const pending = h.preparation.generate(
        { seed: asset.provenance.seed, settings: asset.settings, overrides: asset.overrides },
        controller.signal,
      );
      const rejection = expect(pending).rejects.toThrow('cancelled');
      const worker = h.generation[0]!;
      worker.reply({
        v: 1,
        type: 'candidate',
        requestId: worker.sent[0]!.requestId,
        asset,
        diagnostics: [],
      });
      await rejection;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
      expect(h.validation[0]!.onmessage).toBeNull();
      expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
      expect(retirementRuntimeCounts).toEqual([1]);
      if (replacement) {
        accept(h.validation[1]!);
        expect((await replacement).canonicalJson).toBe(json);
      }
    },
  );

  it('a replacement reentered from predecessor cleanup supersedes the outer operation', async () => {
    let newest: Promise<CertifiedBoard> | undefined;
    const h = harness({
      runtime(runtime) {
        if (h.runtimes.length !== 1) return;
        const dispose = runtime.dispose;
        vi.spyOn(runtime, 'dispose').mockImplementation(() => {
          dispose();
          newest = h.preparation.load(json, summary, new AbortController().signal);
        });
      },
    });
    const first = h.preparation.load(json, summary, new AbortController().signal);
    const rejected = expect(first).rejects.toThrow('cancelled');
    await expect(
      h.preparation.generate(defaultParameters(), new AbortController().signal),
    ).rejects.toThrow('cancelled');
    await rejected;
    expect(h.runtimes).toHaveLength(2);
    expect(h.generation).toHaveLength(0);
    expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
    expect(h.runtimes[0]!.dispose).toHaveBeenCalledOnce();
    accept(h.validation[1]!);
    expect((await newest!).canonicalJson).toBe(json);
    expect(h.validation[1]!.terminate).toHaveBeenCalledOnce();
  });

  it('cleanup exceptions cannot block release, promise settlement, or later disposal', async () => {
    const unsubscribe = vi.fn();
    const controller = new AbortController();
    const h = harness({
      runtime(runtime) {
        const subscribe = runtime.controller.subscribe.bind(runtime.controller);
        vi.spyOn(runtime.controller, 'subscribe').mockImplementation((listener) => {
          const stop = subscribe(listener);
          return () => {
            stop();
            unsubscribe();
            throw new Error('Subscription cleanup failed');
          };
        });
        const dispose = runtime.dispose;
        vi.spyOn(runtime, 'dispose').mockImplementation(() => {
          dispose();
          h.preparation.dispose();
          throw new Error('Runtime cleanup failed');
        });
      },
    });
    const pending = h.preparation.load(json, summary, controller.signal);
    const rejection = expect(pending).rejects.toThrow('cancelled');
    controller.abort();
    await rejection;
    h.preparation.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(h.runtimes[0]!.dispose).toHaveBeenCalledOnce();
    expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)(
    'a delayed identity %s cannot publish after replacement or clean up its successor',
    async (outcome) => {
      let resolve!: (value: ArrayBuffer) => void;
      let reject!: (error: Error) => void;
      const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((ok, fail) => {
            resolve = ok;
            reject = fail;
          }),
      );
      const h = harness();
      const first = h.preparation.load(json, summary, new AbortController().signal);
      accept(h.validation[0]!);
      await flush();
      expect(digest).toHaveBeenCalledOnce();
      const rejection = expect(first).rejects.toThrow('cancelled');
      const next = h.preparation.load(json, summary, new AbortController().signal);
      await rejection;
      if (outcome === 'resolve') resolve(new ArrayBuffer(32));
      else reject(new Error('Late hash failure'));
      await flush();
      expect(h.runtimes[1]!.controller.state.status).toBe('validating');
      expect(h.validation[1]!.terminate).not.toHaveBeenCalled();
      accept(h.validation[1]!);
      expect((await next).assetIdentity).toBe(await assetIdentity(asset, 'asset'));
    },
  );

  it('rejects an export whose request became stale while its identity was pending', async () => {
    let resolve!: (value: ArrayBuffer) => void;
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((ok) => {
          resolve = ok;
        }),
    );
    const h = harness();
    const pending = h.preparation.load(json, summary, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('no longer belongs');
    accept(h.validation[0]!);
    await flush();
    h.runtimes[0]!.controller.cancel();
    resolve(new ArrayBuffer(32));
    await rejection;
    expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
  });
});

describe('certified board snapshots', () => {
  it('uses full asset identity for same-geometry maps and detaches the result and saved reference', async () => {
    const renamed = { ...structuredClone(asset), name: 'Same geometry, new name' };
    const renamedJson = canonicalizeAsset(renamed);
    const savedSummary = structuredClone(summary);
    const h = harness();
    const pending = h.preparation.load(renamedJson, savedSummary, new AbortController().signal);
    const workerAsset = h.validation[0]!.sent[0]!.asset;
    Object.assign(savedSummary.ref, { id: 'changed-by-caller' });
    accept(h.validation[0]!, renamedJson);
    const board = await pending;
    expect(await assetIdentity(renamed, 'geometry')).toBe(await assetIdentity(asset, 'geometry'));
    expect(board.assetIdentity).toBe(await assetIdentity(renamed, 'asset'));
    expect(board.assetIdentity).not.toBe(await assetIdentity(asset, 'asset'));
    expect(board.asset).not.toBe(workerAsset);
    expect(board.summary.ref).toEqual(summary.ref);
    expect(board.summary.ref).not.toBe(savedSummary.ref);
    expect(structuredClone(board)).toEqual(board);
    Object.assign(workerAsset, { name: 'Changed transport' });
    expect(board.asset.name).toBe(renamed.name);
    expect(board.canonicalJson).toBe(renamedJson);
  });

  it('requires complete current certification rather than storage import success', async () => {
    const h = harness();
    const pending = h.preparation.load(json, summary, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('Cannot certify composed map');
    h.validation[0]!.reply({
      v: 1,
      type: 'validated',
      requestId: h.validation[0]!.sent[0]!.requestId,
      outcome: {
        ok: false,
        kind: 'infeasible',
        diagnostics: [
          {
            severity: 'error',
            stage: 'validation',
            code: 'TEST_REJECT',
            message: 'Cannot certify composed map',
          },
        ],
      },
    });
    await rejection;
    expect(h.validation[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('rejects catalog dimension mismatch even after successful certification', async () => {
    const h = harness();
    const pending = h.preparation.load(
      json,
      { ...summary, heightM: 300 },
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toThrow('dimensions do not match');
    accept(h.validation[0]!);
    await rejection;
    expect(h.runtimes[0]!.controller.state.status).toBe('disposed');
  });

  it('preserves detached ordered overrides through generation and complete certification', async () => {
    const candidate = structuredClone(asset);
    candidate.overrides = [
      { kind: 'rename', siteId: candidate.layers.sites[0]!.id, name: 'First' },
      { kind: 'rename', siteId: candidate.layers.sites[0]!.id, name: 'Second' },
    ];
    const recipe = {
      seed: candidate.provenance.seed,
      settings: structuredClone(candidate.settings),
      overrides: structuredClone(candidate.overrides),
    };
    const expectedRecipe = structuredClone(recipe);
    const h = harness();
    const pending = h.preparation.generate(recipe, new AbortController().signal);
    recipe.overrides.reverse();
    recipe.settings.widthM = 200;
    const worker = h.generation[0]!;
    expect(worker.sent[0]).toMatchObject(expectedRecipe);
    worker.reply({
      v: 1,
      type: 'candidate',
      requestId: worker.sent[0]!.requestId,
      asset: candidate,
      diagnostics: [],
    });
    await flush();
    expect(h.validation[0]!.sent[0]!.context).toEqual({
      source: 'generated',
      requestId: worker.sent[0]!.requestId,
      replay: expectedRecipe,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    accept(h.validation[0]!, canonicalizeAsset(candidate));
    const board = await pending;
    expect(board.asset.overrides).toEqual(expectedRecipe.overrides);
    expect(board.summary.ref).toBeNull();
  });

  it('rejects candidate replay mismatch before creating a validation worker', async () => {
    const h = harness();
    const recipe = {
      seed: asset.provenance.seed,
      settings: asset.settings,
      overrides: asset.overrides,
    };
    const pending = h.preparation.generate(recipe, new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('does not match requested');
    const worker = h.generation[0]!;
    worker.reply({
      v: 1,
      type: 'candidate',
      requestId: worker.sent[0]!.requestId,
      asset: { ...asset, provenance: { ...asset.provenance, seed: asset.provenance.seed + 1 } },
      diagnostics: [],
    });
    await rejection;
    expect(h.validation).toHaveLength(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
