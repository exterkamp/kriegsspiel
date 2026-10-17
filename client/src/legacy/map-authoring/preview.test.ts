// @vitest-environment jsdom
import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPreview } from './preview.js';
import type { PreviewAsset } from './asset.js';
import { PERIOD_MAP_STYLE } from './map-style.js';

// This tests viewport selection against parsed assets, not Canvas2D/browser rendering.
const rendered = vi.hoisted(() => ({ incompleteFrames: 0, styles: [] as unknown[] }));
vi.mock('./renderer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./renderer.js')>();
  return {
    ...original,
    MapRenderer: class {
      constructor(
        readonly asset: PreviewAsset,
        style?: unknown,
      ) {
        rendered.styles.push(style);
      }
      render() {
        return rendered.incompleteFrames-- > 0;
      }
    },
  };
});

function multiSiteAsset() {
  const asset = createReferenceAsset();
  asset.settings.settlements.farmCount = 1;
  asset.settings.settlements.farmPopulation = 4;
  asset.layers.sites.push({
    id: 'site:farm:0000',
    kind: 'farm',
    name: 'North farm',
    anchor: [20, 20],
    rotationDeg: 0,
    placementArea: {
      outer: [
        [5, 5],
        [35, 5],
        [35, 25],
        [5, 25],
        [5, 5],
      ],
      holes: [],
    },
    occupiedFootprint: null,
    population: { requested: 4, assigned: 0, unassigned: 4 },
    entrances: [],
  });
  return asset;
}

describe('stable site detail selection', () => {
  let preview: MapPreview;
  let canvas: HTMLCanvasElement;
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
    canvas = document.createElement('canvas');
    Object.defineProperties(canvas, {
      clientWidth: { value: 1000 },
      clientHeight: { value: 600 },
    });
    vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    preview = new MapPreview(canvas);
  });
  afterEach(() => {
    preview.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('selects either site by ID at different east/south coordinates without mutating geometry', () => {
    const input = multiSiteAsset();
    const before = structuredClone(input);
    const loaded = preview.loadAsset(input);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const snapshot = JSON.stringify(loaded.asset);
    expect(preview.center()).toEqual([75, 75]);
    expect(preview.fitSite('site:farm:0000')).toBe(true);
    expect(preview.center()).toEqual([expect.closeTo(20, 9), expect.closeTo(15, 9)]);
    expect(preview.fitSite('site:village:0000')).toBe(true);
    expect(preview.center()).toEqual([expect.closeTo(120, 9), expect.closeTo(70, 9)]);
    // Array order cannot turn the selected ID into "the first site".
    input.layers.sites.reverse();
    expect(preview.loadAsset(input).ok).toBe(true);
    expect(preview.fitSite('site:village:0000')).toBe(true);
    expect(preview.center()).toEqual([expect.closeTo(120, 9), expect.closeTo(70, 9)]);
    expect(JSON.stringify(loaded.asset)).toBe(snapshot);
    input.layers.sites.reverse();
    expect(input).toEqual(before);
    preview.fit();
    expect(preview.center()).toEqual([75, 75]);
  });

  it('draws in the period style and keeps drawing while base tiles are still being made', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    rendered.styles.length = 0;
    expect(preview.loadAsset(multiSiteAsset()).ok).toBe(true);
    expect(rendered.styles).toEqual([PERIOD_MAP_STYLE]);
    expect(callbacks).toHaveLength(1);
    rendered.incompleteFrames = 2;
    callbacks[0]!(16);
    callbacks[1]!(32);
    callbacks[2]!(48);
    // Two incomplete frames each asked for one more; the complete third asked for none.
    expect(callbacks).toHaveLength(3);
  });

  it('returns false before loading or for missing IDs and preserves the view for recovery', () => {
    expect(preview.fitSite('site:missing')).toBe(false);
    expect(preview.center()).toBeUndefined();
    expect(preview.loadAsset(multiSiteAsset()).ok).toBe(true);
    preview.fitSite('site:farm:0000');
    const center = preview.center();
    expect(preview.fitSite('site:missing')).toBe(false);
    expect(preview.fitSite('')).toBe(false);
    expect(preview.center()).toEqual(center);
    expect(preview.fitSite('site:village:0000')).toBe(true);
    expect(preview.center()).toEqual([expect.closeTo(120, 9), expect.closeTo(70, 9)]);
  });
  it('observes bounded frozen frame timings without exposing or mutating assets', () => {
    preview.dispose();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const frames: unknown[] = [];
    preview = new MapPreview(
      canvas,
      () => {},
      (frame) => frames.push(frame),
    );
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(112)
      .mockReturnValueOnce(118)
      .mockReturnValueOnce(125);
    const input = multiSiteAsset(),
      before = structuredClone(input);
    const loaded = preview.loadAsset(input);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const snapshot = JSON.stringify(loaded.asset);
    preview.fitSite('site:farm:0000');
    expect(callbacks).toHaveLength(1);
    callbacks[0]!(120);
    expect(frames).toEqual([
      {
        rafTimestampMs: 120,
        requestToStartMs: 10,
        drawMs: 6,
        workMs: 15,
        requestToEndMs: 25,
        width: 1000,
        height: 600,
        dpr: 1,
      },
    ]);
    expect(Object.isFrozen(frames[0])).toBe(true);
    expect(Reflect.set(frames[0] as object, 'width', 1)).toBe(false);
    expect(now).toHaveBeenCalledTimes(5);
    expect(input).toEqual(before);
    expect(JSON.stringify(loaded.asset)).toBe(snapshot);
  });
  it('does not read measurement clocks when the optional observer is absent', () => {
    let draw!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      draw = callback;
      return 1;
    });
    const now = vi.spyOn(performance, 'now');
    expect(preview.loadAsset(multiSiteAsset()).ok).toBe(true);
    draw(100);
    expect(now).not.toHaveBeenCalled();
  });
});

describe('transactional preview construction and retirement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function canvas() {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 7),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
    return canvas;
  }
  it('aborts all installed canvas listener signals when observer construction throws', () => {
    const c = canvas(),
      signals: AbortSignal[] = [];
    const add = c.addEventListener.bind(c);
    vi.spyOn(c, 'addEventListener').mockImplementation((name, listener, options) => {
      if (options && typeof options === 'object' && options.signal) signals.push(options.signal);
      add(name, listener, options);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          throw new Error('observer construction');
        }
      },
    );
    expect(() => new MapPreview(c)).toThrow('observer construction');
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('disconnects an acquired observer if observe throws and preserves the construction error', () => {
    const c = canvas(),
      disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          throw new Error('observe failure');
        }
        disconnect = disconnect;
      },
    );
    expect(() => new MapPreview(c)).toThrow('observe failure');
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('retires observer and canvas signals after partial display registration failure', () => {
    const c = canvas(),
      disconnect = vi.fn(),
      add = window.addEventListener.bind(window),
      remove = vi.spyOn(window, 'removeEventListener');
    const signal: AbortSignal[] = [];
    vi.spyOn(c, 'addEventListener').mockImplementation((_name, _listener, options) => {
      if (options && typeof options === 'object' && options.signal) signal.push(options.signal);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener, options) => {
      add(name, listener, options);
      if (name === 'pageshow') throw new Error('partial display registration');
    });
    expect(() => new MapPreview(c)).toThrow('partial display registration');
    expect(disconnect).toHaveBeenCalledOnce();
    expect(signal.every((value) => value.aborted)).toBe(true);
    expect(remove.mock.calls.map(([name]) => name)).toContain('resize');
    expect(remove.mock.calls.map(([name]) => name)).toContain('pageshow');
  });
  it('attempts independent leaves once even when display release and observer cleanup throw', () => {
    const c = canvas(),
      disconnect = vi.fn(() => {
        throw new Error('disconnect');
      });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const preview = new MapPreview(c);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'removeEventListener').mockImplementation((name, listener, options) => {
      remove(name, listener, options);
      if (name === 'pagehide') throw new Error('remove failure');
    });
    expect(() => preview.dispose()).not.toThrow();
    preview.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it('does not resurrect retired frames through an already queued observer or RAF callback', () => {
    const c = canvas();
    let resize!: ResizeObserverCallback, frame!: FrameRequestCallback;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 7;
      }),
    );
    const changed = vi.fn(),
      preview = new MapPreview(c, changed);
    expect(preview.loadAsset(createReferenceAsset()).ok).toBe(true);
    preview.dispose();
    resize([], {} as ResizeObserver);
    frame(100);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });
});
