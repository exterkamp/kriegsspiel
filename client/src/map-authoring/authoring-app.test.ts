// @vitest-environment jsdom
import { canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAuthoringApp } from './authoring-app.js';
import { createAuthoringRuntime, type ValidationRequest } from './runtime/index.js';

vi.mock('@kriegsspiel/maps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kriegsspiel/maps')>();
  return { ...actual, canonicalizeAsset: vi.fn(actual.canonicalizeAsset) };
});

const previewCalls = vi.hoisted(() => ({
  loaded: [] as unknown[],
  sites: [] as string[],
  dispose: vi.fn(),
}));
vi.mock('./preview.js', () => ({
  MapPreview: class {
    loadAsset(asset: unknown) {
      previewCalls.loaded.push(asset);
      return { ok: true, asset };
    }
    fitSite(id: string) {
      previewCalls.sites.push(id);
      return id === 'site:village:0000';
    }
    fit() {}
    zoom() {}
    setHighContrast() {}
    setLayer() {}
    dispose() {
      previewCalls.dispose();
    }
  },
}));
class ValidationDouble {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  sent: ValidationRequest[] = [];
  postMessage(message: ValidationRequest) {
    this.sent.push(message);
  }
  terminate() {}
  accept() {
    const request = this.sent[0]!;
    this.onmessage?.({
      data: {
        v: 1,
        type: 'validated',
        requestId: request.requestId,
        outcome: { ok: true, diagnostics: [] },
        files: { json: canonicalizeAsset(createReferenceAsset()), svg: '<svg>TEST DOUBLE</svg>' },
      },
    } as MessageEvent<unknown>);
  }
}
const apps: ReturnType<typeof mountAuthoringApp>[] = [];
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function setup(readFileText?: (file: File, signal: AbortSignal) => Promise<string>) {
  document.body.innerHTML = `<h1>Preview</h1><p id="asset-status"></p><aside><section><div id="summary"></div><p class="note">Fixture</p></section><div id="layers"></div><input id="contrast" type="checkbox"><ul id="diagnostics"></ul></aside><nav><button id="fit"></button><button id="detail"></button><button id="zoom-in"></button><button id="zoom-out"></button></nav><canvas id="map"></canvas><p id="position"></p>`;
  const workers: ValidationDouble[] = [];
  const generation = vi.fn(() => {
    throw new Error('No generation expected in saved test');
  });
  const runtime = createAuthoringRuntime({
    generationWorkerFactory: generation,
    validationWorkerFactory: () => {
      const w = new ValidationDouble();
      workers.push(w);
      return w;
    },
  });
  const app = mountAuthoringApp(document, runtime, {
    checkReplaySupport: () => ({ supported: true }),
    readFileText,
  });
  apps.push(app);
  return { app, runtime, workers, generation };
}
afterEach(() => {
  apps.splice(0).forEach((app) => app.dispose());
  previewCalls.loaded.length = 0;
  previewCalls.sites.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('authoring mount integration (injected fixture worker doubles)', () => {
  it('downloads cached certified JSON without main-thread asset canonicalization or cloning and blocks stale readiness', async () => {
    const r = setup();
    r.app.panel.loadText(canonicalizeAsset(createReferenceAsset()));
    r.workers[0]!.accept();
    await settle();
    const json = r.runtime.exportFiles!.json;
    const blob = vi.fn(() => 'blob:test');
    class DownloadURL extends URL {
      static override createObjectURL = blob;
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', DownloadURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(canonicalizeAsset).mockClear();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const asset = r.runtime.controller.exportAsset;
    expect(r.app.panel.exportJson()!.text).toBe(json);
    const button = r.app.panel.element.querySelector<HTMLButtonElement>(
      'button[data-action="export"]',
    )!;
    button.click();
    expect(blob).toHaveBeenCalledOnce();
    expect(canonicalizeAsset).not.toHaveBeenCalled();
    expect(clone.mock.calls.some(([value]) => value === asset)).toBe(false);
    r.runtime.controller.cancel(); // Before subscriber notification.
    button.click();
    expect(blob).toHaveBeenCalledOnce();
  });
  it('rechecks exact certified provider JSON at the final download callback', async () => {
    const r = setup();
    r.app.panel.loadText(canonicalizeAsset(createReferenceAsset()));
    r.workers[0]!.accept();
    await settle();
    const files = r.runtime.exportFiles!;
    const getter = vi.spyOn(r.runtime, 'exportFiles', 'get');
    getter.mockReturnValueOnce(files).mockReturnValue({ ...files, json: `${files.json}\n` });
    const button = r.app.panel.element.querySelector<HTMLButtonElement>(
      'button[data-action="export"]',
    )!;
    button.click();
    await settle();
    expect(r.app.panel.element.textContent).toContain('unavailable or inconsistent');
  });
  it('renders only accepted saved assets and detail selection requires an explicit stable ID', async () => {
    const r = setup();
    expect(previewCalls.loaded).toHaveLength(0);
    r.app.panel.loadText(canonicalizeAsset(createReferenceAsset()));
    expect(previewCalls.loaded).toHaveLength(0);
    r.workers[0]!.accept();
    await settle();
    expect(previewCalls.loaded).toHaveLength(1);
    expect(r.generation).not.toHaveBeenCalled();
    const select = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Site detail selection"]',
    )!;
    const detail = document.getElementById('detail') as HTMLButtonElement;
    expect(select.value).toBe('');
    expect(detail.disabled).toBe(true);
    select.value = 'site:village:0000';
    select.dispatchEvent(new Event('change'));
    detail.click();
    expect(previewCalls.sites).toEqual(['site:village:0000']);
    expect(document.getElementById('asset-status')!.textContent).toContain(
      'Complete validated map',
    );
    r.runtime.controller.cancel();
    await settle();
    expect(previewCalls.loaded).toHaveLength(1);
    expect(r.app.panel.canExport()).toBe(false);
  });
  it('blocks worker SVG export during a newer saved-file read, including before any controller notification', async () => {
    let resolve!: (text: string) => void;
    const r = setup(
      () =>
        new Promise<string>((yes) => {
          resolve = yes;
        }),
    );
    const blob = vi.fn(() => 'blob:test');
    class DownloadURL extends URL {
      static override createObjectURL = blob;
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', DownloadURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    r.app.panel.loadText(canonicalizeAsset(createReferenceAsset()));
    r.workers[0]!.accept();
    await settle();
    const svg = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Export SVG',
    )!;
    svg.click();
    expect(blob).toHaveBeenCalledTimes(1);
    const load = r.app.panel.loadFile(new File(['saved'], 'saved.json'));
    expect(r.app.panel.canExport()).toBe(false);
    svg.click();
    expect(blob).toHaveBeenCalledTimes(1);
    resolve(canonicalizeAsset(createReferenceAsset()));
    await load;
    await settle();
    expect(r.app.panel.canExport()).toBe(false);
    r.workers[1]!.accept();
    await settle();
    expect(r.app.panel.canExport()).toBe(true);
    svg.click();
    expect(blob).toHaveBeenCalledTimes(2);
  });
  it('disposes on final departure but keeps the authoring runtime on persisted pagehide', () => {
    const r = setup();
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(r.runtime.controller.state.status).toBe('idle');
    window.dispatchEvent(new Event('pagehide'));
    expect(r.runtime.controller.state.status).toBe('disposed');
    expect(previewCalls.dispose).toHaveBeenCalled();
  });
});
