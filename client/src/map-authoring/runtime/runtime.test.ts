import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthoringRuntime, type ValidationWorker } from './adapter.js';
import { createValidationRunner } from './validation-runner.js';
import { parseValidationRequest, type ValidationRequest } from './protocol.js';
import type {
  CompleteAssetValidator,
  GenerationWorker,
  GenerateRequest,
  ValidationOutcome,
} from '../generation/index.js';

// These fixtures/validators are lifecycle test doubles, not composed map evidence.
const accepted: ValidationOutcome = { ok: true, diagnostics: [] };
const rejected: ValidationOutcome = {
  ok: false,
  kind: 'infeasible',
  diagnostics: [
    { severity: 'error', stage: 'validation', code: 'TEST_REJECT', message: 'Test infeasibility' },
  ],
};
class FakeWorker<T> {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  sent: T[] = [];
  terminated = 0;
  postMessage(message: T) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated++;
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
  capture() {
    const message = this.onmessage,
      error = this.onerror,
      deserialize = this.onmessageerror;
    return {
      send: (data: unknown) => message?.({ data } as MessageEvent<unknown>),
      error: () => error?.({ message: 'late' } as ErrorEvent),
      deserialize: () => deserialize?.({ data: null } as MessageEvent<unknown>),
    };
  }
}
const runtimes: ReturnType<typeof createAuthoringRuntime>[] = [];
function setup(timeout = 30_000, factory?: () => ValidationWorker) {
  const generation: FakeWorker<GenerateRequest>[] = [],
    validation: FakeWorker<ValidationRequest>[] = [];
  const generationFactory = vi.fn((): GenerationWorker => {
    const w = new FakeWorker<GenerateRequest>();
    generation.push(w);
    return w;
  });
  const validationFactory = vi.fn(
    factory ??
      (() => {
        const w = new FakeWorker<ValidationRequest>();
        validation.push(w);
        return w;
      }),
  );
  const runtime = createAuthoringRuntime({
    generationWorkerFactory: generationFactory,
    validationWorkerFactory: validationFactory,
    waitTimeoutMs: timeout,
  });
  runtimes.push(runtime);
  return { ...runtime, generation, validation, generationFactory, validationFactory };
}
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function reply(worker: FakeWorker<ValidationRequest>, outcome = accepted) {
  worker.send({ v: 1, type: 'validated', requestId: worker.sent[0]!.requestId, outcome });
}
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.dispose());
  vi.useRealTimers();
});

describe('dedicated validation lifecycle', () => {
  it('loads saved assets in fresh validation workers without any generation and detaches payloads', async () => {
    const r = setup();
    const input = createReferenceAsset();
    const id = r.controller.loadSavedAsset(input);
    expect(r.generationFactory).not.toHaveBeenCalled();
    expect(r.controller.exportAsset).toBeNull();
    expect(r.validation[0]!.sent[0]!.context).toEqual({ source: 'saved', requestId: id });
    Object.assign(r.validation[0]!.sent[0]!.asset, { name: 'transport mutation' });
    reply(r.validation[0]!);
    await settle();
    expect(r.controller.exportAsset?.name).toBe(input.name);
    expect(r.validation[0]!.terminated).toBe(1);
    r.controller.loadSavedAsset(input);
    expect(r.validation).toHaveLength(2);
    expect(r.validation[1]).not.toBe(r.validation[0]);
  });
  it('terminates generation before validating and forwards exact detached ordered replay context', async () => {
    const r = setup();
    const asset = createReferenceAsset();
    asset.overrides = [
      { kind: 'rename', siteId: asset.layers.sites[0]!.id, name: 'First' },
      { kind: 'rename', siteId: asset.layers.sites[0]!.id, name: 'Second' },
    ];
    const parameters = {
      seed: asset.provenance.seed,
      settings: asset.settings,
      overrides: asset.overrides,
    };
    const id = r.controller.generate(parameters);
    r.generation[0]!.send({ v: 1, type: 'candidate', requestId: id, asset, diagnostics: [] });
    expect(r.generation[0]!.terminated).toBe(1);
    expect(r.validation[0]!.sent[0]!.context).toEqual({
      source: 'generated',
      requestId: id,
      replay: parameters,
    });
    expect(r.validation[0]!.sent[0]!.context).not.toBe(parameters);
    reply(r.validation[0]!);
    await settle();
    expect(r.controller.state.status).toBe('ready');
  });
  it('rapid A/B/C and late captured replies/errors cannot replace the current map before notifications', async () => {
    const r = setup();
    const asset = createReferenceAsset();
    r.controller.loadSavedAsset(asset);
    const a = r.validation[0]!,
      lateA = a.capture();
    r.controller.loadSavedAsset(asset);
    const b = r.validation[1]!,
      lateB = b.capture();
    const id = r.controller.loadSavedAsset({ ...asset, name: 'C' });
    expect(a.terminated).toBe(1);
    expect(b.terminated).toBe(1);
    lateA.send({ v: 1, type: 'validated', requestId: a.sent[0]!.requestId, outcome: accepted });
    lateB.error();
    lateB.deserialize();
    expect(r.controller.state.requestId).toBe(id);
    expect(r.controller.exportAsset).toBeNull();
    reply(r.validation[2]!);
    await settle();
    expect(r.controller.exportAsset?.name).toBe('C');
  });
  it.each(['cancel', 'dispose'] as const)(
    'terminates and settles validation on direct controller %s',
    async (action) => {
      const r = setup();
      r.controller.loadSavedAsset(createReferenceAsset());
      const w = r.validation[0]!,
        late = w.capture();
      r.controller[action]();
      expect(w.terminated).toBe(1);
      late.send({ v: 1, type: 'validated', requestId: w.sent[0]!.requestId, outcome: accepted });
      await settle();
      expect(r.controller.state.status).toBe(action === 'cancel' ? 'cancelled' : 'disposed');
      expect(r.controller.exportAsset).toBeNull();
      if (action === 'cancel') {
        r.controller.loadSavedAsset(createReferenceAsset());
        reply(r.validation[1]!);
        await settle();
        expect(r.controller.state.status).toBe('ready');
      }
    },
  );
  it('ignores a wrong valid ID but rejects malformed current payloads', async () => {
    const r = setup();
    const id = r.controller.loadSavedAsset(createReferenceAsset());
    const w = r.validation[0]!;
    w.send({ requestId: id + 1, outcome: 'invalid' });
    expect(w.terminated).toBe(0);
    w.send({
      v: 1,
      type: 'validated',
      requestId: id,
      outcome: { ok: true, diagnostics: [], extra: true },
    });
    await settle();
    expect(r.controller.state.status).toBe('failed');
    expect(r.controller.failureCause).toMatchObject({ kind: 'protocol' });
    expect(w.terminated).toBe(1);
  });
  it.each(['factory', 'post', 'runtime', 'deserialize', 'validator'] as const)(
    'reports %s failure without accepting a candidate',
    async (mode) => {
      const w = new FakeWorker<ValidationRequest>();
      if (mode === 'post')
        w.postMessage = () => {
          throw new Error('post failure');
        };
      const r = setup(30_000, () => {
        if (mode === 'factory') throw new Error('factory failure');
        return w;
      });
      const id = r.controller.loadSavedAsset(createReferenceAsset());
      if (mode === 'runtime') w.onerror?.({ message: 'runtime failure' } as ErrorEvent);
      if (mode === 'deserialize') w.onmessageerror?.({ data: null } as MessageEvent<unknown>);
      if (mode === 'validator')
        w.send({
          v: 1,
          type: 'error',
          requestId: id,
          code: 'FULL_VALIDATOR_EXCEPTION',
          message: 'Unexpected defect',
        });
      await settle();
      expect(r.controller.state.status).toBe('failed');
      expect(r.controller.state.failure?.kind).toBe('programming');
      expect(r.controller.exportAsset).toBeNull();
      expect(r.controller.failureCause).toMatchObject({
        kind: mode === 'deserialize' ? 'protocol' : mode === 'validator' ? 'programming' : 'worker',
      });
      expect(w.terminated).toBe(mode === 'factory' ? 0 : 1);
    },
  );
  it('retains the last valid map on infeasibility and finite total timeout, killing the validation worker', async () => {
    vi.useFakeTimers();
    const r = setup(50);
    const asset = createReferenceAsset();
    r.controller.loadSavedAsset(asset);
    reply(r.validation[0]!);
    await settle();
    r.controller.loadSavedAsset(asset);
    reply(r.validation[1]!, rejected);
    await settle();
    expect(r.controller.state.failure).toBeNull();
    expect(r.controller.state.candidateDiagnostics).toEqual(rejected.diagnostics);
    r.controller.loadSavedAsset(asset);
    const late = r.validation[2]!.capture();
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(r.controller.state.failure?.kind).toBe('timeout');
    expect(r.validation[2]!.terminated).toBe(1);
    late.send({
      v: 1,
      type: 'validated',
      requestId: r.validation[2]!.sent[0]!.requestId,
      outcome: accepted,
    });
    await settle();
    expect(r.controller.state.lastValidatedAsset?.name).toBe(asset.name);
    expect(r.controller.exportAsset).toBeNull();
  });
  it.each([0, -1, Infinity, 0.5])(
    'rejects non-finite/unbounded runtime timeout %s',
    (waitTimeoutMs) => {
      expect(() =>
        createAuthoringRuntime({
          generationWorkerFactory: () => new FakeWorker(),
          validationWorkerFactory: () => new FakeWorker(),
          waitTimeoutMs,
        }),
      ).toThrow(RangeError);
    },
  );
});

describe('injected validation worker runner boundaries', () => {
  function request(): ValidationRequest {
    return {
      v: 1,
      type: 'validate',
      requestId: 1,
      context: { source: 'saved', requestId: 1 },
      asset: createReferenceAsset(),
    };
  }
  it('invokes the validator on frozen detached saved data and emits typed infeasibility', async () => {
    const validate = vi.fn<CompleteAssetValidator>(() => rejected),
      post = vi.fn();
    const input = request();
    const runner = createValidationRunner({ validate, postMessage: post });
    await runner.handleMessage(input);
    expect(validate.mock.calls[0]![0]).not.toBe(input.asset);
    expect(Object.isFrozen(validate.mock.calls[0]![0])).toBe(true);
    expect(post).toHaveBeenCalledWith({ v: 1, requestId: 1, type: 'validated', outcome: rejected });
    await expect(runner.handleMessage(input)).rejects.toThrow('one candidate');
  });
  it('rejects mismatched IDs, extra fields and getters before invoking the validator', async () => {
    const validate = vi.fn(() => accepted);
    const runner = createValidationRunner({ validate, postMessage: vi.fn() });
    const getter = vi.fn();
    const invalid = { ...request(), context: { source: 'saved', requestId: 2 } };
    await expect(runner.handleMessage(invalid)).rejects.toThrow();
    expect(() => parseValidationRequest({ ...request(), extra: true })).toThrow();
    Object.defineProperty(invalid, 'asset', { get: getter, enumerable: true });
    await expect(runner.handleMessage(invalid)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });
  it('keeps validator defects distinct from expected infeasibility and surfaces broken transport', async () => {
    const post = vi.fn();
    await createValidationRunner({
      validate: () => {
        throw new Error('defect');
      },
      postMessage: post,
    }).handleMessage(request());
    expect(post).toHaveBeenCalledWith({
      v: 1,
      requestId: 1,
      type: 'error',
      code: 'FULL_VALIDATOR_EXCEPTION',
      message: 'defect',
    });
    await expect(
      createValidationRunner({
        validate: () => accepted,
        postMessage: () => {
          throw new Error('transport');
        },
      }).handleMessage(request()),
    ).rejects.toThrow('transport');
  });
});

describe('worker-certified file exports', () => {
  it('exposes files only for the current accepted ID and disables them synchronously on replacement/cancel', async () => {
    const r = setup();
    const files = { json: '{"test":"explicit double"}', svg: '<svg />' };
    const id = r.controller.loadSavedAsset(createReferenceAsset());
    const runtime = runtimes.at(-1)!;
    expect(runtime.exportFiles).toBeNull();
    r.validation[0]!.send({ v: 1, type: 'validated', requestId: id, outcome: accepted, files });
    expect(runtime.exportFiles).toBeNull();
    await settle();
    expect(runtime.exportFiles).toEqual(files);
    expect(Object.isFrozen(runtime.exportFiles)).toBe(true);
    r.controller.loadSavedAsset(createReferenceAsset());
    expect(runtime.exportFiles).toBeNull();
    reply(r.validation[1]!);
    await settle();
    expect(runtime.exportFiles).toBeNull();
    r.controller.cancel();
    expect(runtime.exportFiles).toBeNull();
  });
  it('rejects files on an infeasible reply and malformed file payloads', async () => {
    for (const [outcome, files] of [
      [rejected, { json: '{}', svg: '<svg />' }],
      [accepted, { json: '{}', svg: '' }],
    ] as const) {
      const r = setup();
      const id = r.controller.loadSavedAsset(createReferenceAsset());
      r.validation[0]!.send({ v: 1, type: 'validated', requestId: id, outcome, files });
      await settle();
      expect(r.controller.state.failure).not.toBeNull();
      expect(r.controller.exportAsset).toBeNull();
    }
  });
  it('runs export only after complete validation and returns no partial files if export is infeasible', async () => {
    const exportValidated = vi.fn(() => rejected),
      post = vi.fn();
    const request: ValidationRequest = {
      v: 1,
      type: 'validate',
      requestId: 1,
      asset: createReferenceAsset(),
      context: { source: 'saved', requestId: 1 },
    };
    await createValidationRunner({
      validate: () => rejected,
      exportValidated,
      postMessage: post,
    }).handleMessage(request);
    expect(exportValidated).not.toHaveBeenCalled();
    await createValidationRunner({
      validate: () => accepted,
      exportValidated,
      postMessage: post,
    }).handleMessage(request);
    expect(exportValidated).toHaveBeenCalledTimes(1);
    expect(post.mock.calls.at(-1)![0]).toEqual({
      v: 1,
      type: 'validated',
      requestId: 1,
      outcome: rejected,
    });
  });
  it('returns complete strings from the injected export and rejects malformed success diagnostics', async () => {
    const post = vi.fn(),
      files = { json: '{}', svg: '<svg />' };
    const request: ValidationRequest = {
      v: 1,
      type: 'validate',
      requestId: 1,
      asset: createReferenceAsset(),
      context: { source: 'saved', requestId: 1 },
    };
    await createValidationRunner({
      validate: () => accepted,
      exportValidated: () => ({ ok: true, value: files, diagnostics: [] }),
      postMessage: post,
    }).handleMessage(request);
    expect(post).toHaveBeenLastCalledWith({
      v: 1,
      type: 'validated',
      requestId: 1,
      outcome: accepted,
      files,
    });
    await createValidationRunner({
      validate: () => accepted,
      exportValidated: () => ({ ok: true, value: files, diagnostics: rejected.diagnostics }),
      postMessage: post,
    }).handleMessage(request);
    expect(post.mock.calls.at(-1)![0]).toMatchObject({
      type: 'error',
      code: 'FULL_EXPORT_EXCEPTION',
    });
  });
});
