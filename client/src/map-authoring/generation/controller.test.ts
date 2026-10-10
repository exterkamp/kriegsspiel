import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReferenceAsset, type MapAsset } from '@kriegsspiel/maps';
import {
  GenerationController,
  type CompleteAssetValidator,
  type GenerationWorker,
} from './controller';
import { type GenerateRequest, type ReplayParameters, type ValidationOutcome } from './protocol';

// Hand-authored contract fixture only. This test validator is NOT composition certification.
const accepted: ValidationOutcome = { ok: true, diagnostics: [] };
const rejected: ValidationOutcome = {
  ok: false,
  kind: 'infeasible',
  diagnostics: [
    {
      severity: 'error',
      stage: 'validation',
      code: 'TEST_CONSTRAINT',
      message: 'Test-only rejected candidate',
    },
  ],
};
class FakeWorker implements GenerationWorker {
  onmessage: GenerationWorker['onmessage'] = null;
  onerror: GenerationWorker['onerror'] = null;
  onmessageerror: GenerationWorker['onmessageerror'] = null;
  sent: GenerateRequest[] = [];
  terminated = 0;
  startupError: Error | null = null;
  postMessage(request: GenerateRequest): void {
    if (this.startupError) throw this.startupError;
    this.sent.push(request);
  }
  terminate(): void {
    this.terminated++;
  }
  send(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
  capture() {
    const message = this.onmessage;
    const error = this.onerror;
    const deserialize = this.onmessageerror;
    return {
      send: (data: unknown) => message?.({ data } as MessageEvent<unknown>),
      error: () => error?.({ message: 'Late worker failure' } as ErrorEvent),
      deserialize: () => deserialize?.({ data: null } as MessageEvent<unknown>),
    };
  }
}
function parameters(seed = 7): ReplayParameters {
  const fixture = createReferenceAsset();
  return { seed, settings: fixture.settings, overrides: fixture.overrides };
}
function candidate(request: GenerateRequest, name = 'Test contract fixture'): MapAsset {
  const fixture = createReferenceAsset();
  fixture.provenance.seed = request.seed;
  fixture.settings = structuredClone(request.settings);
  fixture.overrides = structuredClone(request.overrides);
  fixture.name = name;
  return fixture;
}
function sendCandidate(worker: FakeWorker): MapAsset {
  const request = worker.sent[0]!;
  const asset = candidate(request);
  worker.send({ v: 1, type: 'candidate', requestId: request.requestId, asset, diagnostics: [] });
  return asset;
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const controllers: GenerationController[] = [];
function setup(validate: CompleteAssetValidator = () => accepted, timeout = 0) {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const controller = new GenerationController({
    workerFactory: factory,
    validateCompleteAsset: validate,
    waitTimeoutMs: timeout,
  });
  controllers.push(controller);
  return { controller, workers, factory };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

describe('isolated generation request lifecycle', () => {
  it('terminates A/B in rapid A/B/C and ignores every late event, accepting only C', async () => {
    const validate = vi.fn<CompleteAssetValidator>(() => accepted);
    const { controller, workers } = setup(validate);
    const ids: number[] = [];
    const late: ReturnType<FakeWorker['capture']>[] = [];
    for (const seed of [11, 12, 13]) {
      ids.push(controller.generate(parameters(seed)));
      late.push(workers.at(-1)!.capture());
    }
    expect(ids[0]!).toBeLessThan(ids[1]!);
    expect(ids[1]!).toBeLessThan(ids[2]!);
    expect(workers.map((worker) => worker.terminated)).toEqual([1, 1, 0]);
    for (let i = 0; i < 2; i++) {
      const request = workers[i]!.sent[0]!;
      late[i]!.send({
        v: 1,
        type: 'progress',
        requestId: request.requestId,
        progress: { stage: 'sites', fraction: 0.9, message: 'stale' },
      });
      late[i]!.send({
        v: 1,
        type: 'candidate',
        requestId: request.requestId,
        asset: candidate(request),
        diagnostics: [],
      });
      late[i]!.send({
        v: 1,
        type: 'error',
        requestId: request.requestId,
        error: { kind: 'programming', code: 'STALE', message: 'stale' },
      });
      late[i]!.error();
      late[i]!.deserialize();
    }
    expect(controller.state.requestId).toBe(ids[2]);
    expect(controller.state.progress).toBeNull();
    expect(validate).not.toHaveBeenCalled();
    const asset = sendCandidate(workers[2]!);
    expect(controller.state.status).toBe('validating');
    expect(controller.exportAsset).toBeNull();
    await settle();
    expect(controller.state.status).toBe('ready');
    expect(controller.exportAsset).toEqual(asset);
    expect(workers[2]!.terminated).toBe(1);
    asset.name = 'mutated transport';
    expect(controller.exportAsset!.name).toBe('Test contract fixture');
    expect(Object.isFrozen(controller.exportAsset!.elevation.samples)).toBe(true);
  });
  it('cancel/retry/dispose detach callbacks and timers, including idempotent disposal', async () => {
    const { controller, workers } = setup();
    const first = controller.generate(parameters());
    const late = workers[0]!.capture();
    controller.cancel();
    expect(workers[0]!.terminated).toBe(1);
    expect(workers[0]!.onmessage).toBeNull();
    expect(controller.state.status).toBe('cancelled');
    const second = controller.generate(parameters());
    expect(second).toBeGreaterThan(first);
    late.send({});
    expect(controller.state.status).toBe('generating');
    controller.dispose();
    controller.dispose();
    workers[1]!.capture().send({});
    await settle();
    expect(workers[1]!.terminated).toBe(1);
    expect(controller.state.status).toBe('disposed');
    expect(() => controller.generate(parameters())).toThrow('disposed');
    expect(() => controller.cancel()).toThrow('disposed');
    expect(() => controller.loadSavedAsset(createReferenceAsset())).toThrow('disposed');
  });
  it('handles factory and postMessage startup failures and permits recovery', async () => {
    const factoryError = new Error('factory failed');
    let attempt = 0;
    const worker = new FakeWorker();
    worker.startupError = new Error('clone/post failed');
    const controller = new GenerationController({
      workerFactory: () => {
        if (++attempt === 1) throw factoryError;
        return worker;
      },
      validateCompleteAsset: () => accepted,
      waitTimeoutMs: 0,
    });
    controllers.push(controller);
    controller.generate(parameters());
    expect(controller.failureCause).toBe(factoryError);
    expect(controller.state.failure?.code).toBe('WORKER_STARTUP');
    controller.generate(parameters());
    expect(controller.state.failure?.message).toBe('clone/post failed');
    expect(worker.terminated).toBe(1);
    worker.startupError = null;
    controller.generate(parameters());
    sendCandidate(worker);
    await settle();
    expect(controller.state.status).toBe('ready');
  });
  it('ignores wrong positive IDs without walking their invalid payload, rejects malformed current payload', () => {
    const { controller, workers } = setup();
    const id = controller.generate(parameters());
    const getter = vi.fn(() => {
      throw new Error('must not inspect stale asset');
    });
    const wrong = { v: 1, requestId: id + 100, type: 'candidate' };
    Object.defineProperty(wrong, 'asset', { enumerable: true, get: getter });
    workers[0]!.send(wrong);
    expect(getter).not.toHaveBeenCalled();
    expect(controller.state.status).toBe('generating');
    workers[0]!.send({
      v: 1,
      requestId: id,
      type: 'progress',
      progress: { stage: 'sites', fraction: 2, message: 'bad' },
    });
    expect(controller.state.failure?.kind).toBe('protocol');
    expect(controller.exportAsset).toBeNull();
  });
  it.each([
    null,
    { v: 1, type: 'error', requestId: NaN },
    { v: 2, type: 'progress', requestId: 1 },
  ])('rejects invalid envelope %j', (input) => {
    const { controller, workers } = setup();
    controller.generate(parameters());
    // Keep NaN/non-object/version payload invalid without depending on process-global ID.
    if (input && input.v === 2) input.requestId = controller.state.requestId!;
    workers[0]!.send(input);
    expect(controller.state.failure?.kind).toBe('protocol');
    expect(workers[0]!.terminated).toBe(1);
  });
  it('rejects contract-invalid candidates and preserves numeric validation issues', () => {
    const { controller, workers } = setup();
    controller.generate(parameters());
    const asset = candidate(workers[0]!.sent[0]!);
    asset.elevation.samples.pop();
    workers[0]!.send({
      v: 1,
      type: 'candidate',
      requestId: controller.state.requestId,
      asset,
      diagnostics: [],
    });
    expect(controller.state.status).toBe('failed');
    expect(controller.state.candidateDiagnostics.length).toBeGreaterThan(0);
    expect(controller.state.lastValidatedAsset).toBeNull();
  });
  it.each(['seed', 'settings', 'override-order'] as const)(
    'rejects candidate %s mismatch before complete validation',
    (mismatch) => {
      const validate = vi.fn<CompleteAssetValidator>(() => accepted);
      const { controller, workers } = setup(validate);
      const replay = parameters(9);
      replay.overrides = [
        { kind: 'rename', siteId: 'site:village:0000', name: 'First' },
        { kind: 'rename', siteId: 'site:village:0000', name: 'Last' },
      ];
      controller.generate(replay);
      const asset = candidate(workers[0]!.sent[0]!);
      if (mismatch === 'seed') asset.provenance.seed = 10;
      if (mismatch === 'settings') asset.settings.cover.woodFraction = 0.1;
      if (mismatch === 'override-order') asset.overrides.reverse();
      workers[0]!.send({
        v: 1,
        type: 'candidate',
        requestId: controller.state.requestId,
        asset,
        diagnostics: [],
      });
      expect(validate).not.toHaveBeenCalled();
      expect(controller.state.failure?.message).toContain('does not match');
    },
  );
  it.each(['replace', 'cancel', 'dispose'] as const)(
    'ignores delayed validation acceptance after %s',
    async (action) => {
      const pending = deferred<ValidationOutcome>();
      const { controller, workers } = setup(() => pending.promise);
      controller.generate(parameters(20));
      sendCandidate(workers[0]!);
      expect(controller.state.status).toBe('validating');
      if (action === 'replace') controller.generate(parameters(21));
      else controller[action]();
      const state = controller.state;
      pending.resolve(accepted);
      await settle();
      expect(controller.state).toBe(state);
      expect(controller.exportAsset).toBeNull();
    },
  );
  it('ignores delayed validation rejection after replacement and validates new request', async () => {
    const pending = deferred<ValidationOutcome>();
    let count = 0;
    const { controller, workers } = setup(() => (++count === 1 ? pending.promise : accepted));
    controller.generate(parameters(1));
    sendCandidate(workers[0]!);
    controller.generate(parameters(2));
    sendCandidate(workers[1]!);
    await settle();
    const ready = controller.state;
    pending.reject(new Error('late validator programming failure'));
    await settle();
    expect(controller.state).toBe(ready);
    expect(controller.exportAsset!.provenance.seed).toBe(2);
  });
  it('ignores callbacks from the terminated worker while its candidate validator remains pending', async () => {
    const pending = deferred<ValidationOutcome>();
    const { controller, workers } = setup(() => pending.promise);
    controller.generate(parameters());
    const late = workers[0]!.capture();
    sendCandidate(workers[0]!);
    late.error();
    late.deserialize();
    late.send({});
    expect(controller.state.status).toBe('validating');
    pending.resolve(accepted);
    await settle();
    expect(controller.state.status).toBe('ready');
  });
  it('a saved load supersedes generation and a later generation supersedes delayed saved validation', async () => {
    const pending = deferred<ValidationOutcome>();
    const { controller, workers } = setup((_, context) =>
      context.source === 'saved' ? pending.promise : accepted,
    );
    const first = controller.generate(parameters(40));
    const stale = workers[0]!.capture();
    const saved = controller.loadSavedAsset(createReferenceAsset());
    expect(saved).toBeGreaterThan(first);
    expect(workers[0]!.terminated).toBe(1);
    stale.error();
    controller.generate(parameters(41));
    sendCandidate(workers[1]!);
    await settle();
    pending.resolve(accepted);
    await settle();
    expect(controller.exportAsset!.provenance.seed).toBe(41);
  });
  it('retains last validated map for expected generation/validation failure; disables export and clears diagnostics on retry', async () => {
    let outcome: ValidationOutcome = accepted;
    const { controller, workers } = setup(() => outcome);
    await controller.loadSavedAsset(createReferenceAsset());
    const retained = controller.state.lastValidatedAsset;
    controller.generate(parameters(22));
    workers[0]!.send({
      v: 1,
      type: 'infeasible',
      requestId: controller.state.requestId,
      diagnostics: rejected.diagnostics,
    });
    expect(controller.state.failure).toBeNull();
    expect(controller.state.candidateDiagnostics).toEqual(rejected.diagnostics);
    expect(controller.state.lastValidatedAsset).toBe(retained);
    expect(controller.exportAsset).toBeNull();
    controller.generate(parameters(23));
    expect(controller.state.candidateDiagnostics).toEqual([]);
    outcome = rejected;
    sendCandidate(workers[1]!);
    await settle();
    expect(controller.state.lastValidatedAsset).toBe(retained);
    expect(controller.state.status).toBe('failed');
  });
  it('preserves validator exceptions as programming failures, never expected infeasibility', async () => {
    const defect = new TypeError('validator bug');
    const { controller, workers } = setup(() => {
      throw defect;
    });
    controller.generate(parameters());
    sendCandidate(workers[0]!);
    await settle();
    expect(controller.failureCause).toBe(defect);
    expect(controller.state.failure?.kind).toBe('programming');
    expect(controller.state.canExport).toBe(false);
  });
  it.each(['generating', 'validating'] as const)(
    'watchdog bounds %s, ignores late completion and retains last valid map',
    async (phase) => {
      vi.useFakeTimers();
      const pending = deferred<ValidationOutcome>();
      let count = 0;
      const { controller, workers } = setup(() => (++count === 1 ? accepted : pending.promise), 50);
      await controller.loadSavedAsset(createReferenceAsset());
      const retained = controller.state.lastValidatedAsset;
      controller.generate(parameters(31));
      const late = workers[0]!.capture();
      if (phase === 'validating') sendCandidate(workers[0]!);
      await vi.advanceTimersByTimeAsync(49);
      if (phase === 'generating')
        workers[0]!.send({
          v: 1,
          type: 'progress',
          requestId: controller.state.requestId,
          progress: { stage: 'roads', fraction: 0.5, message: 'still working' },
        });
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.state.failure?.kind).toBe('timeout');
      expect(controller.state.lastValidatedAsset).toBe(retained);
      expect(controller.exportAsset).toBeNull();
      expect(workers[0]!.terminated).toBe(1);
      pending.resolve(accepted);
      late.send({});
      await settle();
      expect(controller.state.failure?.kind).toBe('timeout');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('loads a saved asset without worker creation; validates recorded provenance and preserves original data', async () => {
    const validate = vi.fn<CompleteAssetValidator>(() => accepted);
    const { controller, factory } = setup(validate);
    const asset = createReferenceAsset();
    const original = JSON.stringify(asset);
    await controller.loadSavedAsset(original);
    expect(factory).not.toHaveBeenCalled();
    expect(validate.mock.calls[0]![0]).toEqual(asset);
    expect(controller.exportAsset).toEqual(asset);
    expect(controller.state.source).toBe('saved');
    await controller.loadSavedAsset('{broken json');
    expect(controller.state.failure?.kind).toBe('invalid-input');
    expect(controller.state.lastValidatedAsset).toEqual(asset);
    expect(controller.exportAsset).toBeNull();
    expect(JSON.stringify(asset)).toBe(original);
  });
  it('detaches replay data without reordering overrides or mutating seed/settings/geometry', async () => {
    const validate = vi.fn<CompleteAssetValidator>(() => accepted);
    const { controller, workers } = setup(validate);
    const data = parameters(17);
    data.overrides = [
      { kind: 'rename', siteId: 'site:village:0000', name: 'First' },
      { kind: 'rename', siteId: 'site:village:0000', name: 'Last' },
      { kind: 'move-site', siteId: 'site:village:0000', anchor: [50, 60] },
    ];
    const before = structuredClone(data);
    controller.generate(data);
    const sent = workers[0]!.sent[0]!;
    expect({ seed: sent.seed, settings: sent.settings, overrides: sent.overrides }).toEqual(before);
    data.settings.terrain.reliefM += 10;
    data.overrides.reverse();
    expect(sent.settings).toEqual(before.settings);
    sendCandidate(workers[0]!);
    await settle();
    const context = validate.mock.calls[0]![1];
    expect(context.source).toBe('generated');
    if (context.source !== 'generated') throw new Error('wrong context');
    expect(context.replay).toEqual(before);
    sent.overrides.reverse();
    expect(context.replay.overrides).toEqual(before.overrides);
    expect(Object.isFrozen(context.replay.overrides)).toBe(true);
  });
  it('rejects invalid settings/accessor parameters before worker creation without executing getters', () => {
    const { controller, factory } = setup();
    const data = parameters();
    data.settings.widthM = -1;
    controller.generate(data);
    expect(controller.state.failure?.kind).toBe('invalid-input');
    expect(factory).not.toHaveBeenCalled();
    const getter = vi.fn(() => 7);
    const unsafe = parameters();
    Object.defineProperty(unsafe, 'seed', { enumerable: true, get: getter });
    controller.generate(unsafe);
    expect(getter).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
  it('reports native worker error/deserialization failure and coalesces immutable state notifications', async () => {
    const { controller, workers } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.generate(parameters());
    workers[0]!.onerror?.({ message: 'startup syntax failure' } as ErrorEvent);
    await settle();
    expect(controller.state.failure?.code).toBe('WORKER_RUNTIME');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    unsubscribe();
    controller.generate(parameters());
    workers[1]!.onmessageerror?.({ data: undefined } as MessageEvent);
    expect(controller.state.failure?.code).toBe('MESSAGE_DESERIALIZATION');
  });
  it('rejects invalid watchdog configuration', () => {
    for (const waitTimeoutMs of [-1, NaN, Infinity, 0.5, 2_147_483_648]) {
      expect(
        () =>
          new GenerationController({
            workerFactory: () => new FakeWorker(),
            validateCompleteAsset: () => accepted,
            waitTimeoutMs,
          }),
      ).toThrow(RangeError);
    }
  });
});
