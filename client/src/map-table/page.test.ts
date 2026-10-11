// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadState } from './loader.js';
import { PreviewApplyError, TableScene } from '../table/FixtureTableScene.js';

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
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class Renderer {
    capabilities = { maxTextureSize: 4096, getMaxAnisotropy: () => 4 };
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
import * as THREE from 'three';
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
  const create = vi.fn<
    (canvas: HTMLCanvasElement, onUnavailable: (error: PreviewApplyError) => void) => TableScene
  >(() => table as unknown as TableScene);
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
  vi.resetAllMocks();
});
afterEach(() => {
  mounts.splice(0).forEach((m) => m.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('standalone empty page and controls', () => {
  it('starts empty, allows file selection, resets input for equal-file reapply and shows certification progress/cancel', () => {
    const { create, table } = setup();
    expect(create).toHaveBeenCalledWith(get('map-canvas'), expect.any(Function));
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

  it('suspends persisted navigation repeatedly and resumes the accepted map and listeners before eventual terminal teardown', () => {
    const { table, create, mount } = setup();
    harness.listener!({ phase: 'ready', message: 'Map loaded.', displayed, available: true });
    harness.cancel.mockImplementation(() =>
      harness.listener!({
        phase: 'cancelled',
        message: 'Load cancelled.',
        displayed,
        available: true,
      }),
    );
    const input = get('saved-map');
    Object.defineProperty(input, 'files', { value: [new File(['{}'], 'replacement.json')] });
    for (let visit = 1; visit <= 3; visit++) {
      harness.listener!({
        phase: 'validating',
        message: 'Pending load',
        displayed,
        available: true,
      });
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      expect(table.stop).toHaveBeenCalledTimes(visit);
      expect(harness.cancel).toHaveBeenCalledTimes(visit);
      expect(harness.dispose).not.toHaveBeenCalled();
      expect(table.dispose).not.toHaveBeenCalled();
      expect(harness.disconnect).not.toHaveBeenCalled();
      expect(get('displayed-identity').textContent).toBe(displayed.sourceKey);
      expect(get('load-progress').hidden).toBe(true);
      input.dispatchEvent(new Event('change'));
      expect(harness.load).toHaveBeenCalledTimes(visit - 1);
      window.dispatchEvent(new Event('resize'));
      expect(table.resize).toHaveBeenCalledTimes(visit - 1);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(table.resize).toHaveBeenCalledTimes(visit);
      expect(table.start).toHaveBeenCalledTimes(visit + 1);
      expect(create).toHaveBeenCalledOnce();
      input.dispatchEvent(new Event('change'));
      expect(harness.load).toHaveBeenCalledTimes(visit);
      click('oblique');
      expect(table.snapOblique).toHaveBeenCalledTimes(visit);
      // A duplicate pageshow must not start another loop.
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(table.start).toHaveBeenCalledTimes(visit + 1);
    }
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(table.dispose).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.disconnect).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    input.dispatchEvent(new Event('change'));
    click('oblique');
    mount.dispose();
    expect(table.start).toHaveBeenCalledTimes(4);
    expect(harness.load).toHaveBeenCalledTimes(3);
    expect(table.snapOblique).toHaveBeenCalledTimes(3);
    expect(table.dispose).toHaveBeenCalledOnce();
  });

  it('retains the actual preview texture, source and settled camera through repeated persisted page events', () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(9);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    let table!: TableScene;
    const mount = mountMapTable(document, (canvas, onPreviewUnavailable) => {
      table = new TableScene(canvas, { mode: 'public-map-preview', onPreviewUnavailable });
      return table;
    });
    mounts.push(mount);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 300;
    sourceCanvas.height = 100;
    table.applyPreviewRaster({
      canvas: sourceCanvas,
      sourceKey: displayed.sourceKey,
      widthM: 15000,
      heightM: 5000,
      contentWidthPx: 300,
      contentHeightPx: 100,
    });
    harness.listener!({ phase: 'ready', message: 'Map loaded.', displayed, available: true });
    table.snapOblique();
    table.panTo({ x: 2500, y: 1750 });
    const paper = table.scene.getObjectByName('map-artwork') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshStandardMaterial
    >;
    const texture = paper.material.map!;
    const position = table.camera.position.clone(),
      target = table.controls.target.clone();
    const disposed = vi.spyOn(texture, 'dispose');
    const fit = vi.spyOn(table, 'snapTopDown');
    for (let visit = 0; visit < 3; visit++) {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(table.scene.getObjectByName('map-artwork')).toBe(paper);
      expect(paper.material.map).toBe(texture);
      expect(texture.image).toBe(sourceCanvas);
      expect(table.camera.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(table.controls.target).toEqual(target);
      expect(get('displayed-identity').textContent).toBe(displayed.sourceKey);
      expect(disposed).not.toHaveBeenCalled();
      expect(fit).not.toHaveBeenCalled();
    }
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(disposed).toHaveBeenCalledOnce();
    expect(table.scene.children).toHaveLength(0);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    mount.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(table.scene.children).toHaveLength(0);
  });
  it('does not revive a suspended page after explicit terminal disposal', () => {
    const { table, mount } = setup();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    mount.dispose();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(table.start).toHaveBeenCalledOnce();
    expect(table.resize).not.toHaveBeenCalled();
    expect(table.dispose).toHaveBeenCalledOnce();
    expect(harness.cancel).toHaveBeenCalledOnce();
  });
  it('replaces ready status with unavailable on a later frame failure and never resumes or reports after disposal', () => {
    const { table, create, mount } = setup();
    harness.listener!({ phase: 'ready', message: 'Map loaded.', displayed, available: true });
    harness.unavailable.mockImplementation((message) =>
      harness.listener!({ phase: 'failed', message, displayed, available: false }),
    );
    const report = create.mock.calls[0]![1];
    report(new PreviewApplyError('later frame failed', 'unavailable'));
    expect(get('load-status').textContent).toContain('later frame failed');
    expect(get('load-status').textContent).not.toContain('Map loaded');
    expect(get('retained-display').textContent).toContain('historical');
    expect((get('fit') as HTMLButtonElement).disabled).toBe(true);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(table.start).toHaveBeenCalledOnce();
    mount.dispose();
    report(new PreviewApplyError('late report', 'unavailable'));
    expect(harness.unavailable).toHaveBeenCalledOnce();
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
