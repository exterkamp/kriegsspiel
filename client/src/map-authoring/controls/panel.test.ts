// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizeAsset,
  createReferenceAsset,
  HARD_LIMITS,
  type MapAsset,
} from '@kriegsspiel/maps';
import {
  GenerationController,
  type CompleteAssetValidator,
  type GenerateRequest,
  type GenerationWorker,
  type ValidationOutcome,
} from '../generation/index.js';
import { createAuthoringPanel, type AuthoringPanel, type PanelOptions } from './panel.js';
import { editOverrides, type OverrideEdit } from './recipe.js';

// Contract fixture and validators below are lifecycle test doubles, not generated/certified geography.
const accept: ValidationOutcome = { ok: true, diagnostics: [] };
const reject: ValidationOutcome = {
  ok: false,
  kind: 'infeasible',
  diagnostics: [
    {
      severity: 'error',
      stage: 'settlements',
      code: 'TEST_NO_SITE',
      message: 'No test placement',
      remediation: 'Change test constraints',
    },
  ],
};
class FakeWorker implements GenerationWorker {
  onmessage: GenerationWorker['onmessage'] = null;
  onerror: GenerationWorker['onerror'] = null;
  onmessageerror: GenerationWorker['onmessageerror'] = null;
  sent: GenerateRequest[] = [];
  terminated = 0;
  postMessage(request: GenerateRequest): void {
    this.sent.push(request);
  }
  terminate(): void {
    this.terminated++;
  }
  send(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  result(): MapAsset {
    const request = this.sent[0]!;
    const asset = createReferenceAsset();
    asset.provenance.seed = request.seed;
    asset.settings = structuredClone(request.settings);
    asset.overrides = structuredClone(request.overrides);
    this.send({ v: 1, type: 'candidate', requestId: request.requestId, asset, diagnostics: [] });
    return asset;
  }
}
const cleanup: (() => void)[] = [];
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(options: PanelOptions = {}, validate: CompleteAssetValidator = () => accept) {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const controller = new GenerationController({
    workerFactory: factory,
    validateCompleteAsset: validate,
    waitTimeoutMs: 0,
  });
  const fixture = createReferenceAsset();
  const panel = createAuthoringPanel(document, controller, {
    initialParameters: {
      seed: fixture.provenance.seed,
      settings: fixture.settings,
      overrides: fixture.overrides,
    },
    ...options,
  });
  document.body.append(panel.element);
  cleanup.push(() => {
    panel.dispose();
    controller.dispose();
  });
  return { panel, controller, workers, factory };
}
function input(panel: AuthoringPanel, name: string): HTMLInputElement {
  const result = panel.element.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!result) throw new Error(`Missing field ${name}`);
  return result;
}
function change(panel: AuthoringPanel, name: string, value: string): void {
  const field = input(panel, name);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(panel: AuthoringPanel, action: string): HTMLButtonElement {
  return panel.element.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;
}
function status(panel: AuthoringPanel): string {
  return panel.element.querySelector('[data-role="status"]')!.textContent!;
}
afterEach(() => {
  for (const finish of cleanup.splice(0)) finish();
  document.body.replaceChildren();
});

describe('bounded authoring DOM panel', () => {
  it('exposes extent, terrain, water, cover, settlement/population, policies and every configured numeric limit', () => {
    const { panel, factory } = setup();
    for (const name of [
      'widthM',
      'heightM',
      'sampleSpacingM',
      'terrain.reliefM',
      'terrain.roughness',
      'hydrology.riverThresholdSamples',
      'hydrology.requireRiver',
      'cover.woodFraction',
      'cover.fieldFraction',
      'settlements.villageCount',
      'settlements.farmCount',
      'settlements.villagePopulation',
      'settlements.farmPopulation',
      'settlements.maxGlobalReconciliationWork',
      'limits.maxTopologyChecks',
      'roads.maxGlobalExpansions',
      'contours.maxRefinementWork',
    ])
      expect(input(panel, name)).toBeTruthy();
    expect(input(panel, 'geometry.corridorPolicy').readOnly).toBe(true);
    expect(input(panel, 'hydrology.requireRiver').type).toBe('checkbox');
    expect(button(panel, 'export').disabled).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(status(panel)).toContain('no generated map');
  });
  it('schema/relational validation prevents invalid or empty draft generation before worker creation', () => {
    const callback = vi.fn();
    const { panel, factory } = setup({ onDraftChange: callback });
    change(panel, 'seed', '');
    expect(button(panel, 'generate').disabled).toBe(true);
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(status(panel)).toContain('input error');
    expect(status(panel)).not.toContain('programming error');
    change(panel, 'seed', '17');
    change(panel, 'cover.woodFraction', '0.9');
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(status(panel)).toContain('fractions exceed one');
    change(panel, 'cover.woodFraction', '0.3');
    change(panel, 'roads.maxExpansionsPerRoute', '9999999');
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    change(panel, 'roads.maxExpansionsPerRoute', '1000000');
    expect(panel.generate()).toBeTypeOf('number');
    expect(factory).toHaveBeenCalledOnce();
  });
  it('transmits detached edited parameters, handles rapid replacement, progress and cancellation', async () => {
    const { panel, controller, workers } = setup();
    change(panel, 'seed', '11');
    button(panel, 'generate').click();
    const stale = workers[0]!.onmessage;
    change(panel, 'seed', '12');
    change(panel, 'terrain.roughness', '0.7');
    button(panel, 'generate').click();
    change(panel, 'seed', '13');
    button(panel, 'generate').click();
    expect(workers.map((worker) => worker.terminated)).toEqual([1, 1, 0]);
    const request = workers[2]!.sent[0]!;
    expect(request.seed).toBe(13);
    expect(request.settings.terrain.roughness).toBe(0.7);
    stale?.({
      data: {
        v: 1,
        type: 'error',
        requestId: workers[0]!.sent[0]!.requestId,
        error: { kind: 'worker', code: 'STALE', message: 'obsolete' },
      },
    } as MessageEvent);
    workers[2]!.send({
      v: 1,
      type: 'progress',
      requestId: request.requestId,
      progress: { stage: 'roads', fraction: 0.25, message: '<img src=x onerror=bad>' },
    });
    await settle();
    expect(status(panel)).toContain('roads: <img');
    expect(panel.element.querySelector('img')).toBeNull();
    expect(panel.element.querySelector('progress')!.value).toBe(0.25);
    expect(button(panel, 'cancel').disabled).toBe(false);
    button(panel, 'cancel').click();
    expect(controller.state.status).toBe('cancelled');
    expect(workers[2]!.terminated).toBe(1);
    expect(button(panel, 'export').disabled).toBe(true);
  });
  it('retains the last validated preview and distinguishes expected infeasibility from programming error', async () => {
    let outcome: ValidationOutcome = accept;
    const preview = vi.fn();
    const { panel, controller, workers } = setup(
      { onValidatedAsset: preview, checkReplaySupport: () => ({ supported: true }) },
      () => outcome,
    );
    panel.loadText(canonicalizeAsset(createReferenceAsset()));
    await settle();
    expect(preview).toHaveBeenCalledOnce();
    const last = controller.state.lastValidatedAsset;
    panel.generate();
    outcome = reject;
    workers[0]!.result();
    await settle();
    expect(status(panel)).toContain('Expected infeasibility');
    expect(status(panel)).toContain('Last validated map retained');
    expect(panel.element.querySelector('[data-role="diagnostics"]')!.textContent).toContain(
      'Change test constraints',
    );
    expect(controller.state.lastValidatedAsset).toBe(last);
    expect(preview).toHaveBeenCalledOnce();
    outcome = accept;
    panel.generate();
    workers[1]!.send({
      v: 1,
      type: 'error',
      requestId: workers[1]!.sent[0]!.requestId,
      error: { kind: 'programming', code: 'BUG', message: 'Original defect' },
    });
    await settle();
    expect(status(panel)).toContain('programming failure [BUG]');
    expect(button(panel, 'export').disabled).toBe(true);
  });
  it('adopts every recorded setting and ordered override without default reset or regeneration', async () => {
    const asset = createReferenceAsset();
    asset.provenance.seed = 97;
    asset.settings.terrain.roughness = 0.2;
    asset.settings.contours.maxRefinementWork = 12345;
    asset.settings.settlements.maxGlobalReconciliationWork = 123456;
    asset.settings.roads.maxGlobalExpansions = 2345678;
    asset.overrides = [
      { kind: 'rename', siteId: 'site:village:0000', name: 'First' },
      { kind: 'rename', siteId: 'site:village:0000', name: 'Second' },
    ];
    const support = vi.fn<NonNullable<PanelOptions['checkReplaySupport']>>(() => ({
      supported: true,
    }));
    const { panel, factory, workers } = setup({ checkReplaySupport: support });
    panel.loadText(canonicalizeAsset(asset));
    await settle();
    expect(factory).not.toHaveBeenCalled();
    expect(panel.getParameters()).toEqual({
      seed: 97,
      settings: asset.settings,
      overrides: asset.overrides,
    });
    expect(input(panel, 'contours.maxRefinementWork').value).toBe('12345');
    expect(panel.element.querySelector('[data-role="provenance"]')!.textContent).toContain(
      asset.provenance.generator.version,
    );
    panel.generate();
    expect(support.mock.calls[0]![0]).toEqual(asset.provenance);
    expect(workers[0]!.sent[0]!.settings).toEqual(asset.settings);
    expect(workers[0]!.sent[0]!.overrides).toEqual(asset.overrides);
  });
  it('does not regenerate loaded recipes without explicit version support; direct export remains validated', async () => {
    const { panel, factory } = setup();
    panel.loadText(canonicalizeAsset(createReferenceAsset()));
    await settle();
    expect(button(panel, 'generate').disabled).toBe(true);
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(status(panel)).toContain('generator-version adapter');
    expect(panel.exportJson()).not.toBeNull();
    const unsupported = setup({
      checkReplaySupport: () => ({ supported: false, reason: 'Unsupported fork version' }),
    });
    unsupported.panel.loadText(canonicalizeAsset(createReferenceAsset()));
    await settle();
    expect(unsupported.panel.generate()).toBeNull();
    expect(status(unsupported.panel)).toContain('Unsupported fork version');
  });
  it('preserves an existing validated recipe when mounted during a later pending request', async () => {
    const asset = createReferenceAsset();
    asset.provenance.seed = 55337;
    asset.settings.contours.maxRefinementWork = 23456;
    const controller = new GenerationController({
      workerFactory: () => new FakeWorker(),
      validateCompleteAsset: () => accept,
      waitTimeoutMs: 0,
    });
    controller.loadSavedAsset(JSON.stringify(asset));
    await settle();
    controller.generate({ seed: 31, settings: asset.settings, overrides: [] });
    const panel = createAuthoringPanel(document, controller);
    cleanup.push(() => {
      panel.dispose();
      controller.dispose();
    });
    expect(panel.getParameters()).toEqual({
      seed: 55337,
      settings: asset.settings,
      overrides: asset.overrides,
    });
    expect(panel.element.querySelector('[data-role="provenance"]')!.textContent).toContain(
      asset.provenance.generator.version,
    );
    expect(panel.exportJson()).toBeNull();
    expect(panel.generate()).toBeNull();
    expect(status(panel)).toContain('generator-version adapter');
  });
  it('blocks unsupported saved replay after exactly one microtask, before the ready notification', async () => {
    const { panel, controller, factory } = setup();
    const asset = createReferenceAsset();
    asset.provenance.seed = 97;
    panel.loadText(canonicalizeAsset(asset));
    await Promise.resolve();
    expect(controller.state.status).toBe('ready');
    expect(controller.state.source).toBe('saved');
    expect(status(panel)).not.toContain('Ready:');
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(panel.getParameters().seed).toBe(97);
    change(panel, 'seed', '31');
    expect(panel.generate()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
  it('permits explicit supported replay before notification and retains that provenance during replacement', async () => {
    let supported = true;
    const adapter = vi.fn<NonNullable<PanelOptions['checkReplaySupport']>>(() =>
      supported ? { supported: true } : { supported: false, reason: 'Unsupported saved version' },
    );
    const { panel, controller, factory, workers } = setup({ checkReplaySupport: adapter });
    const asset = createReferenceAsset();
    asset.provenance.seed = 97;
    panel.loadText(canonicalizeAsset(asset));
    await Promise.resolve();
    expect(controller.state.status).toBe('ready');
    expect(status(panel)).not.toContain('Ready:');
    expect(panel.generate()).toBeTypeOf('number');
    expect(factory).toHaveBeenCalledOnce();
    expect(workers[0]!.sent[0]!.seed).toBe(97);
    expect(adapter.mock.calls.at(-1)![0]).toEqual(asset.provenance);
    supported = false;
    change(panel, 'seed', '31');
    expect(panel.generate()).toBeNull();
    expect(factory).toHaveBeenCalledOnce();
    expect(adapter.mock.calls.at(-1)![0]).toEqual(asset.provenance);
  });
  it('older saved readiness does not adopt its fields or cancel a newer file read', async () => {
    const validation = pending<ValidationOutcome>();
    const text = pending<string>();
    let calls = 0;
    let signal!: AbortSignal;
    const { panel, controller, factory } = setup(
      {
        readFileText: (_, cancellation) => {
          signal = cancellation;
          return text.promise;
        },
      },
      () => (++calls === 1 ? validation.promise : accept),
    );
    const old = createReferenceAsset();
    old.provenance.seed = 31;
    const next = createReferenceAsset();
    next.provenance.seed = 97;
    const oldId = panel.loadText(canonicalizeAsset(old));
    const read = panel.loadFile(new File(['pending'], 'newer.json'));
    validation.resolve(accept);
    await settle();
    expect(controller.state.status).toBe('ready');
    expect(controller.state.requestId).toBe(oldId);
    expect(input(panel, 'seed').value).toBe('7');
    expect(signal.aborted).toBe(false);
    expect(status(panel)).toContain('Reading saved file');
    expect(panel.exportJson()).toBeNull();
    text.resolve(canonicalizeAsset(next));
    expect(await read).toBeGreaterThan(oldId);
    await settle();
    expect(controller.state.lastValidatedAsset!.provenance.seed).toBe(97);
    expect(panel.getParameters().seed).toBe(97);
    expect(factory).not.toHaveBeenCalled();
  });
  it('uses an explicit preset replacement without overwriting seed/overrides, and recovers invalid settings', () => {
    const settings = createReferenceAsset().settings;
    settings.terrain.reliefM = 0;
    const { panel } = setup({ presets: [{ id: 'flat', label: 'Flat test preset', settings }] });
    panel.applyOverride({
      type: 'append',
      override: { kind: 'rename', siteId: 'site:village:0000', name: 'Name' },
    });
    change(panel, 'seed', '31');
    change(panel, 'widthM', '-1');
    const select = panel.element.querySelector<HTMLSelectElement>('select[name="preset"]')!;
    select.value = 'flat';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(panel.getParameters().seed).toBe(31);
    expect(panel.getParameters().settings).toEqual(settings);
    expect(panel.getParameters().overrides).toHaveLength(1);
    expect(button(panel, 'generate').disabled).toBe(false);
  });
  it('appends rename/move/exclusion via DOM, retaining holes and order; supports reorder/remove and map callback', () => {
    const focus = vi.fn();
    const { panel } = setup({ onFocusOverride: focus });
    input(panel, 'siteId').value = 'site:village:0000';
    input(panel, 'placeName').value = '<b>First</b>';
    button(panel, 'rename').click();
    input(panel, 'placeName').value = 'Last';
    button(panel, 'rename').click();
    input(panel, 'anchorX').value = '50.000001';
    input(panel, 'anchorY').value = '60';
    button(panel, 'move').click();
    input(panel, 'exclusionId').value = 'exclude:test';
    const polygon = {
      outer: [
        [2, 2],
        [10, 2],
        [10, 10],
        [2, 10],
        [2, 2],
      ],
      holes: [
        [
          [3, 3],
          [3, 4],
          [4, 4],
          [4, 3],
          [3, 3],
        ],
      ],
    };
    panel.element.querySelector<HTMLTextAreaElement>('textarea[name="exclusionPolygon"]')!.value =
      JSON.stringify(polygon);
    button(panel, 'exclude').click();
    const overrides = panel.getParameters().overrides;
    expect(overrides.map((override) => override.kind)).toEqual([
      'rename',
      'rename',
      'move-site',
      'exclude-sites',
    ]);
    expect(overrides[3]).toEqual({ kind: 'exclude-sites', id: 'exclude:test', polygon });
    expect(panel.element.querySelector('b')).toBeNull();
    panel.applyOverride({ type: 'reorder', from: 3, to: 0 });
    panel.applyOverride({
      type: 'replace',
      index: 2,
      override: { kind: 'rename', siteId: 'site:village:0000', name: 'Replacement' },
    });
    button(panel, 'focus').click();
    expect(focus.mock.calls[0]![0]).toEqual(panel.getParameters().overrides[0]);
    button(panel, 'remove').click();
    expect(panel.getParameters().overrides).toHaveLength(3);
  });
  it('rejects invalid override edits without changing recipe, and caps their count', () => {
    const { panel } = setup();
    const before = panel.getParameters();
    input(panel, 'siteId').value = 'invalid spaces';
    button(panel, 'rename').click();
    expect(panel.getParameters()).toEqual(before);
    expect(() => panel.applyOverride({ type: 'remove', index: 0 })).toThrow('index');
    const getter = vi.fn(() => 'append');
    const unsafe = Object.defineProperty({}, 'type', { enumerable: true, get: getter });
    expect(() => editOverrides(before, unsafe as OverrideEdit)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      editOverrides(before, {
        type: 'append',
        override: { kind: 'rename', siteId: 'site:village:0000', name: 'A' },
        extra: true,
      } as OverrideEdit),
    ).toThrow('fields');
    const many = {
      ...before,
      overrides: Array.from({ length: 256 }, () => ({
        kind: 'rename' as const,
        siteId: 'site:village:0000',
        name: 'A',
      })),
    };
    expect(() => editOverrides(many, { type: 'append', override: many.overrides[0]! })).toThrow(
      '256',
    );
    expect(before.overrides).toEqual([]);
  });
  it('gates export on live controller state even before notification, and on draft equality', async () => {
    const onExport = vi.fn();
    const { panel, controller } = setup({ onExport });
    const asset = createReferenceAsset();
    panel.loadText(canonicalizeAsset(asset));
    await settle();
    expect(button(panel, 'export').disabled).toBe(false);
    button(panel, 'export').click();
    await settle();
    expect(onExport.mock.calls[0]![0].text).toBe(canonicalizeAsset(asset));
    change(panel, 'terrain.roughness', '0.2');
    expect(panel.exportJson()).toBeNull();
    expect(button(panel, 'export').disabled).toBe(true);
    panel.setParameters({
      seed: asset.provenance.seed,
      settings: asset.settings,
      overrides: asset.overrides,
    });
    expect(button(panel, 'export').disabled).toBe(false);
    controller.generate(panel.getParameters()); // Deliberately do not flush coalesced notification.
    button(panel, 'export').click();
    expect(onExport).toHaveBeenCalledOnce();
    expect(panel.exportJson()).toBeNull();
    await settle();
    expect(button(panel, 'export').disabled).toBe(true);
  });
  it('keeps newer draft edits when an older candidate validates and disables its export', async () => {
    const outcome = pending<ValidationOutcome>();
    const { panel, workers } = setup({}, () => outcome.promise);
    panel.generate();
    workers[0]!.result();
    change(panel, 'seed', '31');
    outcome.resolve(accept);
    await settle();
    expect(input(panel, 'seed').value).toBe('31');
    expect(panel.getParameters().seed).toBe(31);
    expect(status(panel)).toContain('Draft changed');
    expect(status(panel)).toContain('Last validated map retained');
    expect(button(panel, 'export').disabled).toBe(true);
  });
  it('reads real saved files directly via FileReader and delegates malformed data to the controller', async () => {
    const { panel, factory, controller } = setup();
    const asset = createReferenceAsset();
    const file = new File([canonicalizeAsset(asset)], 'saved.json', { type: 'application/json' });
    expect(await panel.loadFile(file)).toBeTypeOf('number');
    await settle();
    expect(factory).not.toHaveBeenCalled();
    expect(
      canonicalizeAsset(structuredClone(controller.state.lastValidatedAsset) as MapAsset),
    ).toBe(canonicalizeAsset(asset));
    await panel.loadFile(new File(['{broken'], 'bad.json'));
    await settle();
    expect(controller.state.failure?.kind).toBe('invalid-input');
    expect(
      canonicalizeAsset(structuredClone(controller.state.lastValidatedAsset) as MapAsset),
    ).toBe(canonicalizeAsset(asset));
    expect(panel.exportJson()).toBeNull();
  });
  it('ignores replaced/cancelled/disposed file reads and stale read errors', async () => {
    const first = pending<string>();
    const second = pending<string>();
    let calls = 0;
    const readFileText = vi.fn(() => (++calls === 1 ? first.promise : second.promise));
    const { panel, controller } = setup({ readFileText });
    const file = new File(['x'], 'saved.json');
    const a = panel.loadFile(file);
    const b = panel.loadFile(file);
    second.resolve(canonicalizeAsset(createReferenceAsset()));
    await b;
    await settle();
    const id = controller.state.requestId;
    first.reject(new Error('obsolete file error'));
    await a;
    expect(controller.state.requestId).toBe(id);
    expect(status(panel)).not.toContain('obsolete');
    const later = pending<string>();
    const cancelled = setup({ readFileText: () => later.promise });
    const read = cancelled.panel.loadFile(file);
    cancelled.panel.cancel();
    later.resolve(canonicalizeAsset(createReferenceAsset()));
    expect(await read).toBeNull();
    expect(cancelled.controller.state.status).toBe('cancelled');
    const last = pending<string>();
    const disposed = setup({ readFileText: () => last.promise });
    const abandoned = disposed.panel.loadFile(file);
    disposed.panel.dispose();
    last.resolve(canonicalizeAsset(createReferenceAsset()));
    expect(await abandoned).toBeNull();
    expect(disposed.controller.state.status).toBe('idle');
  });
  it('aborts the native FileReader when a pending saved load is cancelled', async () => {
    const abort = vi.spyOn(window.FileReader.prototype, 'abort');
    try {
      const { panel, controller } = setup();
      const read = panel.loadFile(
        new File([canonicalizeAsset(createReferenceAsset())], 'pending.json'),
      );
      panel.cancel();
      expect(await read).toBeNull();
      expect(abort).toHaveBeenCalledOnce();
      expect(controller.state.lastValidatedAsset).toBeNull();
      expect(controller.state.status).toBe('cancelled');
    } finally {
      abort.mockRestore();
    }
  });
  it('signals injected file readers on draft change, generation replacement and disposal', async () => {
    for (const action of ['draft', 'generate', 'dispose']) {
      const wait = pending<string>();
      let signal!: AbortSignal;
      const { panel } = setup({
        readFileText: (_, cancellation) => {
          signal = cancellation;
          return wait.promise;
        },
      });
      const read = panel.loadFile(new File(['pending'], 'pending.json'));
      expect(signal.aborted).toBe(false);
      if (action === 'draft') change(panel, 'seed', '31');
      else if (action === 'generate') panel.generate();
      else panel.dispose();
      expect(signal.aborted).toBe(true);
      wait.resolve(canonicalizeAsset(createReferenceAsset()));
      expect(await read).toBeNull();
    }
  });
  it('bounds file size before reading and reports read failure without destroying a validated map', async () => {
    const readFileText = vi.fn(async () => {
      throw new Error('disk unavailable');
    });
    const { panel, controller } = setup({ readFileText });
    panel.loadText(canonicalizeAsset(createReferenceAsset()));
    await settle();
    const retained = controller.state.lastValidatedAsset;
    const huge = new File(['x'], 'huge.json');
    Object.defineProperty(huge, 'size', { value: HARD_LIMITS.maxBytes + 1 });
    expect(await panel.loadFile(huge)).toBeNull();
    expect(readFileText).not.toHaveBeenCalled();
    expect(status(panel)).toContain('byte cap');
    await panel.loadFile(new File(['x'], 'failed.json'));
    expect(status(panel)).toContain('file error: disk unavailable');
    expect(status(panel)).toContain('export disabled until another validated request');
    expect(status(panel)).toContain('Last validated map retained');
    expect(button(panel, 'export').disabled).toBe(true);
    expect(panel.exportJson()).toBeNull();
    expect(controller.state.lastValidatedAsset).toBe(retained);
  });
  it('reports injected callback defects as programming errors and disposal leaves the injected controller alive', async () => {
    const { panel, controller } = setup({
      onDraftChange: () => {
        throw new Error('draft callback defect');
      },
      checkReplaySupport: () => {
        throw new Error('version callback defect');
      },
    });
    change(panel, 'seed', '17');
    expect(status(panel)).toContain('programming error: draft callback defect');
    panel.loadText(canonicalizeAsset(createReferenceAsset()));
    await settle();
    expect(status(panel)).toContain('programming error: version callback defect');
    expect(panel.generate()).toBeNull();
    panel.dispose();
    panel.dispose();
    expect(() => panel.getParameters()).toThrow('disposed');
    expect(() => panel.generate()).toThrow('disposed');
    expect(controller.state.status).toBe('ready');
  });
});
