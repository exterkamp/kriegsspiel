import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { describe, expect, it, vi } from 'vitest';
import { createAuthoringRuntime, type ValidationRequest } from '../map-authoring/runtime/index.js';
import type { GenerateRequest } from '../map-authoring/generation/protocol.js';
import { defaultParameters } from '../map-authoring/controls/recipe.js';
import { createBoardPreparation } from './preparation.js';
import type { MapSummary } from './contracts.js';
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
function harness() {
  const generation: Worker<GenerateRequest>[] = [];
  const validation: Worker<ValidationRequest>[] = [];
  const generationFactory = vi.fn(() => {
    const worker = new Worker<GenerateRequest>();
    generation.push(worker);
    return worker;
  });
  const preparation = createBoardPreparation({
    runtimeFactory: () =>
      createAuthoringRuntime({
        generationWorkerFactory: generationFactory,
        validationWorkerFactory: () => {
          const worker = new Worker<ValidationRequest>();
          validation.push(worker);
          return worker;
        },
      }),
  });
  return { preparation, generation, validation, generationFactory };
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
