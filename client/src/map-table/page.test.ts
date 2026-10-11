// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadState } from './loader.js';
import type { TableScene } from '../table/FixtureTableScene.js';

// DOM composition doubles only; certification/render transactions have dedicated real-boundary tests.
const harness = vi.hoisted(() => ({
  listener: null as null | ((state: LoadState) => void),
  load: vi.fn(),
  cancel: vi.fn(),
  dispose: vi.fn(),
  unavailable: vi.fn(),
  disconnect: vi.fn(),
  observe: vi.fn(),
}));
vi.mock('./loader.js', () => ({
  createSavedMapLoader: () => ({
    subscribe(listener: (state: LoadState) => void) {
      harness.listener = listener;
      listener({
        phase: 'empty',
        message: 'Load saved generated JSON.',
        displayed: null,
        available: true,
      });
    },
    load: harness.load,
    cancel: harness.cancel,
    dispose: harness.dispose,
    unavailable: harness.unavailable,
  }),
}));
import { mountMapTable } from './page.js';
const mounts: ReturnType<typeof mountMapTable>[] = [];
const documentSource = readFileSync(resolve('map-table.html'), 'utf8');
const get = (id: string) => document.getElementById(id)!;
const click = (id: string) => get(id).click();
const displayed = Object.freeze({
  name: '<Village & Hills>',
  sourceKey: 'full-asset-digest',
  filename: 'public.json',
  widthM: 15000,
  heightM: 5000,
});
function setup() {
  const table = {
    resize: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    fitPreview: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
  };
  const create = vi.fn(() => table as unknown as TableScene);
  const mount = mountMapTable(document, create);
  mounts.push(mount);
  return { table, mount, create };
}
beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(
    documentSource,
    'text/html',
  ).body.innerHTML;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = harness.observe;
      disconnect = harness.disconnect;
    },
  );
  vi.clearAllMocks();
});
afterEach(() => {
  mounts.splice(0).forEach((m) => m.dispose());
  vi.unstubAllGlobals();
});
describe('standalone empty page and controls', () => {
  it('starts empty, allows file selection, resets input for equal-file reapply and shows certification progress/cancel', () => {
    const { create, table } = setup();
    expect(create).toHaveBeenCalledWith(get('map-canvas'));
    expect(table.start).toHaveBeenCalledOnce();
    expect(get('displayed-name').textContent).toBe('No map displayed');
    expect((get('fit') as HTMLButtonElement).disabled).toBe(true);
    const input = get('saved-map') as HTMLInputElement;
    const selected = new File(['{}'], 'map.json');
    Object.defineProperty(input, 'files', { value: [selected] });
    input.dispatchEvent(new Event('change'));
    expect(harness.load).toHaveBeenCalledWith(selected);
    expect(input.value).toBe('');
    harness.listener!({
      phase: 'validating',
      message: 'Certifying saved geometry…',
      displayed: null,
      available: true,
    });
    expect(get('load-progress').hidden).toBe(false);
    expect((get('cancel') as HTMLButtonElement).disabled).toBe(false);
    click('cancel');
    expect(harness.cancel).toHaveBeenCalledOnce();
  });
  it('shows displayed metadata safely and provides camera controls while retaining old identity on load errors', () => {
    const { table } = setup();
    harness.listener!({ phase: 'ready', message: 'Map loaded.', displayed, available: true });
    expect(get('displayed-name').textContent).toBe('<Village & Hills>');
    expect(get('displayed-name').children).toHaveLength(0);
    expect(get('displayed-extent').textContent).toContain('15,000 × 5,000 m');
    expect(get('displayed-identity').textContent).toBe('full-asset-digest');
    expect(get('empty-table').hidden).toBe(true);
    click('fit');
    click('top-down');
    click('oblique');
    expect(table.fitPreview).toHaveBeenCalledOnce();
    expect(table.snapTopDown).toHaveBeenCalledOnce();
    expect(table.snapOblique).toHaveBeenCalledOnce();
    harness.listener!({ phase: 'failed', message: 'Unsupported map', displayed, available: true });
    expect(get('retained-display').textContent).toContain('remains');
    expect(get('displayed-name').textContent).toBe(displayed.name);
    harness.listener!({ phase: 'failed', message: 'Restore failed', displayed, available: false });
    expect(get('retained-display').textContent).toContain('historical');
    expect((get('fit') as HTMLButtonElement).disabled).toBe(true);
  });
  it('reports lost context and terminal page teardown without allowing detached handlers to load again', () => {
    const { table, mount } = setup();
    const event = new Event('webglcontextlost', { cancelable: true });
    get('map-canvas').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(table.stop).toHaveBeenCalledOnce();
    expect(harness.unavailable).toHaveBeenCalledWith(expect.stringContaining('context was lost'));
    window.dispatchEvent(new Event('pagehide'));
    mount.dispose();
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(table.dispose).toHaveBeenCalledOnce();
    expect(harness.disconnect).toHaveBeenCalledOnce();
    const input = get('saved-map');
    Object.defineProperty(input, 'files', { value: [new File(['{}'], 'late.json')] });
    input.dispatchEvent(new Event('change'));
    expect(harness.load).not.toHaveBeenCalled();
  });
  it('handles unavailable WebGL at construction without enabling load or camera actions', () => {
    mounts.push(
      mountMapTable(document, () => {
        throw new Error('WebGL disabled');
      }),
    );
    expect(get('load-status').textContent).toContain('WebGL disabled');
    expect((get('saved-map') as HTMLInputElement).disabled).toBe(true);
    expect((get('oblique') as HTMLButtonElement).disabled).toBe(true);
  });
});
