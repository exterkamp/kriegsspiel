import { describe, expect, it, vi } from 'vitest';
import { createReferenceAsset, type GenerationResult, type MapAsset } from '@kriegsspiel/maps';
import { createWorkerRunner } from './worker-runner';
import {
  checkJson,
  parseGeneratorResult,
  parseRequest,
  parseResponse,
  parseValidation,
  type GenerateRequest,
  type Progress,
  type WorkerResponse,
} from './protocol';

function request(): GenerateRequest {
  const fixture = createReferenceAsset();
  return {
    v: 1,
    type: 'generate',
    requestId: 17,
    seed: fixture.provenance.seed,
    settings: fixture.settings,
    overrides: fixture.overrides,
  };
}
const progress: Progress = { stage: 'sites', fraction: 0.5, message: 'Test-only progress' };
const infeasible: GenerationResult<MapAsset> = {
  ok: false,
  kind: 'infeasible',
  diagnostics: [
    { severity: 'error', stage: 'sites', code: 'NO_TEST_SITE', message: 'Test-only infeasibility' },
  ],
};

describe('injected worker runner', () => {
  it('passes detached frozen replay data unchanged and emits separate progress and unvalidated candidate', async () => {
    const messages: WorkerResponse[] = [];
    const input = request();
    const before = structuredClone(input);
    const fixture = createReferenceAsset();
    let lateReport!: (data: Progress) => void;
    const runner = createWorkerRunner({
      generate: (data, report) => {
        expect(data).toEqual(before);
        expect(data).not.toBe(input);
        expect(Object.isFrozen(data.settings.terrain)).toBe(true);
        expect(() => {
          (data.settings as GenerateRequest['settings']).widthM = 5;
        }).toThrow();
        lateReport = report;
        report(progress);
        return { ok: true, value: fixture, diagnostics: [] };
      },
      postMessage: (message) => messages.push(parseResponse(message)),
    });
    await runner.handleMessage(input);
    expect(input).toEqual(before);
    expect(messages.map((message) => message.type)).toEqual(['progress', 'candidate']);
    expect(messages[1]).toMatchObject({ requestId: 17, type: 'candidate', asset: fixture });
    expect(fixture).not.toHaveProperty('progress');
    lateReport(progress);
    expect(messages).toHaveLength(2);
    await expect(runner.handleMessage(input)).rejects.toThrow('only one');
  });
  it('keeps expected bounded infeasibility separate from unexpected generator errors', async () => {
    const expected: WorkerResponse[] = [];
    await createWorkerRunner({
      generate: () => infeasible,
      postMessage: (message) => expected.push(message),
    }).handleMessage(request());
    expect(expected[0]).toMatchObject({ type: 'infeasible', diagnostics: infeasible.diagnostics });
    const defect = new TypeError('original generator defect');
    const unexpected: WorkerResponse[] = [];
    await createWorkerRunner({
      generate: () => {
        throw defect;
      },
      postMessage: (message) => unexpected.push(message),
    }).handleMessage(request());
    expect(unexpected[0]).toMatchObject({
      type: 'error',
      error: { kind: 'programming', code: 'GENERATOR_EXCEPTION', message: defect.message },
    });
  });
  it('rejects invalid request before invoking generator/postMessage, without consuming the runner', async () => {
    const generate = vi.fn(() => infeasible);
    const postMessage = vi.fn();
    const runner = createWorkerRunner({ generate, postMessage });
    const invalid = request();
    invalid.settings.widthM = -1;
    await expect(runner.handleMessage(invalid)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    await runner.handleMessage(request());
    expect(generate).toHaveBeenCalledOnce();
  });
  it('reports invalid asynchronous progress once and suppresses later success/progress', async () => {
    let report!: (data: Progress) => void;
    let resolve!: (value: GenerationResult<MapAsset>) => void;
    const promise = new Promise<GenerationResult<MapAsset>>((yes) => {
      resolve = yes;
    });
    const messages: WorkerResponse[] = [];
    const runner = createWorkerRunner({
      generate: (_, callback) => {
        report = callback;
        return promise;
      },
      postMessage: (message) => messages.push(message),
    });
    const done = runner.handleMessage(request());
    report({ ...progress, fraction: Infinity });
    report(progress);
    resolve({ ok: true, value: createReferenceAsset(), diagnostics: [] });
    await done;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'error', error: { kind: 'programming' } });
  });
  it('preserves a terminal transport failure for the entry adapter rather than swallowing it', async () => {
    const defect = new Error('postMessage transport broken');
    const runner = createWorkerRunner({
      generate: () => infeasible,
      postMessage: () => {
        throw defect;
      },
    });
    await expect(runner.handleMessage(request())).rejects.toBe(defect);
  });
  it('does not turn malformed generator output into infeasibility or successful empty output', async () => {
    const getter = vi.fn(() => true);
    const unsafe = Object.defineProperty({}, 'ok', { enumerable: true, get: getter });
    const messages: WorkerResponse[] = [];
    await createWorkerRunner({
      generate: () => unsafe as GenerationResult<MapAsset>,
      postMessage: (message) => messages.push(message),
    }).handleMessage(request());
    expect(getter).not.toHaveBeenCalled();
    expect(messages[0]).toMatchObject({ type: 'error', error: { kind: 'programming' } });
  });
});

describe('strict detached protocol boundaries', () => {
  it('rejects accessors, hidden properties, cycles, sparse arrays, symbols, custom prototypes and nonfinite data', () => {
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get: getter });
    const hidden = Object.defineProperty({}, 'x', { value: 1 });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const symbol = { [Symbol('x')]: 1 };
    const array = [1];
    Object.defineProperty(array, 'x', { value: 2, enumerable: true });
    for (const input of [
      accessor,
      hidden,
      cycle,
      symbol,
      array,
      new Array(2),
      new Date(),
      NaN,
      Infinity,
      () => 1,
      Object.create(null),
    ]) {
      expect(() => checkJson(input)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('caps arrays/depth/overrides/diagnostics before schema cloning and rejects unknown fields', () => {
    expect(() => checkJson(new Array(6_000_001))).toThrow('Array limit');
    let deep: unknown = 1;
    for (let i = 0; i < 34; i++) deep = { child: deep };
    expect(() => checkJson(deep)).toThrow('work limit');
    expect(() =>
      parseRequest({
        ...request(),
        overrides: Array.from({ length: 257 }, () => ({ kind: 'rename', siteId: 'x', name: 'y' })),
      }),
    ).toThrow('256');
    expect(() => parseRequest({ ...request(), extra: true })).toThrow('fields');
    expect(() =>
      parseResponse({ v: 1, requestId: 17, type: 'infeasible', diagnostics: [] }),
    ).toThrow('error diagnostic');
    expect(() =>
      parseResponse({
        v: 1,
        requestId: 17,
        type: 'infeasible',
        diagnostics: Array(1025).fill(infeasible.diagnostics[0]),
      }),
    ).toThrow('diagnostics');
    expect(() => parseValidation({ ok: true, diagnostics: infeasible.diagnostics })).toThrow(
      'contains errors',
    );
    expect(() =>
      parseGeneratorResult({
        ok: true,
        value: createReferenceAsset(),
        diagnostics: [],
        surprise: 1,
      }),
    ).toThrow('fields');
  });
  it('rejects nonstring error kinds even when string coercion would match the allowlist', () => {
    for (const kind of [['worker'], ['programming'], null, 1, true, {}]) {
      expect(() =>
        parseResponse({
          v: 1,
          requestId: 17,
          type: 'error',
          error: { kind, code: 'TEST_ERROR', message: 'Malformed kind' },
        }),
      ).toThrow('Invalid error payload');
    }
    for (const kind of ['protocol', 'programming', 'worker', 'timeout', 'invalid-input']) {
      expect(
        parseResponse({
          v: 1,
          requestId: 17,
          type: 'error',
          error: { kind, code: 'TEST_ERROR', message: 'Valid kind' },
        }),
      ).toMatchObject({ type: 'error', error: { kind } });
    }
  });
  it('accepts a contract-scale dense numerical message without charging array-index text as JSON keys', () => {
    // Comparable to all four maximum-size ground/drainage arrays. No geography is invented.
    const data = Array.from({ length: 1_600_000 }, (_, i) => i / 1000);
    expect(() => checkJson(data)).not.toThrow();
  });
});
