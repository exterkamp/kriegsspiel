import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ValidationRequest, ValidationResponse } from './runtime/index.js';
import type { GenerateRequest, WorkerResponse } from './generation/index.js';

// Mock G public calls only; these tests exercise entry plumbing, not real composition.
const core = vi.hoisted(() => ({
  generate: vi.fn(),
  validate: vi.fn(),
  export: vi.fn(),
  support: vi.fn(),
}));
vi.mock('@kriegsspiel/maps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kriegsspiel/maps')>()),
  generateBattlefield: core.generate,
  validateBattlefield: core.validate,
  exportBattlefield: core.export,
  supportsReplay: core.support,
}));
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function send(input: unknown) {
  const scope = globalThis as unknown as { onmessage: (event: MessageEvent<unknown>) => void };
  scope.onmessage({ data: input } as MessageEvent<unknown>);
  await settle();
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});
describe('native module worker entry plumbing (G test doubles)', () => {
  it('forwards exact seed/settings/ordered overrides to G and emits only a candidate, not acceptance', async () => {
    const asset = createReferenceAsset();
    core.generate.mockReturnValue({ ok: true, value: asset, diagnostics: [] });
    const post = vi.fn<(message: WorkerResponse) => void>();
    vi.stubGlobal('postMessage', post);
    vi.stubGlobal('onmessage', null);
    await import('./generate.worker.js');
    const request: GenerateRequest = {
      v: 1,
      type: 'generate',
      requestId: 11,
      seed: asset.provenance.seed,
      settings: asset.settings,
      overrides: asset.overrides,
    };
    await send(request);
    expect(core.generate).toHaveBeenCalledWith({
      seed: request.seed,
      settings: request.settings,
      overrides: request.overrides,
    });
    expect(core.generate.mock.calls[0]![0].settings).not.toBe(request.settings);
    expect(post.mock.calls[0]![0]).toMatchObject({ type: 'progress', requestId: 11 });
    expect(post.mock.calls[1]![0]).toMatchObject({ type: 'candidate', requestId: 11, asset });
    expect(core.validate).not.toHaveBeenCalled();
    expect(core.export).not.toHaveBeenCalled();
  });
  it('uses authoritative G support, full validation and expensive export within the validation entry', async () => {
    core.support.mockReturnValue(true);
    core.validate.mockReturnValue({
      ok: true,
      value: { version: 'test-double-only' },
      diagnostics: [],
    });
    core.export.mockReturnValue({
      ok: true,
      value: { json: '{}', svg: '<svg />' },
      diagnostics: [],
    });
    const post = vi.fn<(message: ValidationResponse) => void>();
    vi.stubGlobal('postMessage', post);
    vi.stubGlobal('onmessage', null);
    await import('./validate.worker.js');
    const request: ValidationRequest = {
      v: 1,
      type: 'validate',
      requestId: 12,
      asset: createReferenceAsset(),
      context: { source: 'saved', requestId: 12 },
    };
    await send(request);
    expect(core.support).toHaveBeenCalledTimes(1);
    expect(core.validate).toHaveBeenCalledTimes(1);
    expect(core.export).toHaveBeenCalledTimes(1);
    expect(core.export.mock.calls[0]![0]).not.toBe(request.asset);
    expect(post).toHaveBeenCalledWith({
      v: 1,
      requestId: 12,
      type: 'validated',
      outcome: { ok: true, diagnostics: [] },
      files: { json: '{}', svg: '<svg />' },
    });
    expect(core.generate).not.toHaveBeenCalled();
  });
  it('rejects unsupported saved provenance without generation/full validation/export', async () => {
    core.support.mockReturnValue(false);
    const post = vi.fn<(message: ValidationResponse) => void>();
    vi.stubGlobal('postMessage', post);
    vi.stubGlobal('onmessage', null);
    await import('./validate.worker.js');
    await send({
      v: 1,
      type: 'validate',
      requestId: 13,
      asset: createReferenceAsset(),
      context: { source: 'saved', requestId: 13 },
    });
    expect(post.mock.calls[0]![0]).toMatchObject({
      type: 'validated',
      outcome: { ok: false, kind: 'infeasible', diagnostics: [{ code: 'UNSUPPORTED_REPLAY' }] },
    });
    expect(core.validate).not.toHaveBeenCalled();
    expect(core.export).not.toHaveBeenCalled();
    expect(core.generate).not.toHaveBeenCalled();
  });
});
