// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({
  preset: vi.fn(),
  runtime: vi.fn(),
  draws: 0,
  onFinal: null as (() => void) | null,
  pauseFinal: false,
  releaseFinal: null as (() => void) | null,
}));
vi.mock('./runtime/index.js', () => ({ createAuthoringRuntime: hooks.runtime }));
vi.mock('./preview.js', () => ({
  MapPreview: class {
    constructor(
      _canvas: unknown,
      private changed: (state: unknown) => void,
      private observed: (frame: unknown) => void,
    ) {}
    private draw() {
      const index = ++hooks.draws;
      const deliver = () => {
        if (index === 91) hooks.onFinal?.();
        this.changed({ view: { width: 1440, height: 900, scale: 1, offset: [0, 0] } });
        this.observed({
          rafTimestampMs: index * 16,
          requestToStartMs: 1,
          drawMs: 1,
          workMs: 2,
          requestToEndMs: 3,
          width: 1440,
          height: 900,
          dpr: 1,
        });
      };
      if (index === 91 && hooks.pauseFinal) hooks.releaseFinal = deliver;
      else queueMicrotask(deliver);
    }
    loadAsset(asset: unknown) {
      this.draw();
      return { ok: true, asset };
    }
    fit() {
      this.draw();
    }
    zoom() {
      this.draw();
    }
    setHighContrast() {}
    dispose() {}
  },
}));
vi.mock('@kriegsspiel/maps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kriegsspiel/maps')>()),
  battlefieldPreset: hooks.preset,
}));
import { createReferenceAsset } from '@kriegsspiel/maps';
import { benchmarkBounds, durationStats, mountBenchmark } from './benchmark.js';

describe('benchmark arithmetic (analytical samples, not measured performance)', () => {
  it('uses nearest-rank p95, retains outliers and leaves the input samples unchanged', () => {
    const samples = Object.freeze([100, 4, 1, 2, 3]);
    expect(durationStats(samples)).toEqual({
      count: 5,
      minMs: 1,
      meanMs: 22,
      p50Ms: 3,
      p95Ms: 100,
      maxMs: 100,
    });
    expect(durationStats(Array.from({ length: 20 }, (_, i) => i + 1)).p95Ms).toBe(19);
    expect(samples).toEqual([100, 4, 1, 2, 3]);
    expect(() => durationStats([])).toThrow(RangeError);
    expect(() => durationStats([NaN])).toThrow(RangeError);
    expect(() => durationStats([-1])).toThrow(RangeError);
  });
  it('repeats the deterministic translated detail trajectory in metre coordinates with 1440/900 aspect', () => {
    const input = Object.freeze({ minX: 1000, minY: 2000, maxX: 11000, maxY: 7000 });
    const start = benchmarkBounds(input, 0),
      opposite = benchmarkBounds(input, 60);
    expect(start).toEqual(benchmarkBounds(input, 120));
    expect(start.maxX - start.minX).toBe(4000);
    expect((start.maxX - start.minX) / (start.maxY - start.minY)).toBe(1440 / 900);
    expect((opposite.maxX + opposite.minX) / 2 - (start.maxX + start.minX) / 2).toBe(3000);
    expect((opposite.maxY + opposite.minY) / 2 - (start.maxY + start.minY) / 2).toBe(-1500);
    expect(input).toEqual({ minX: 1000, minY: 2000, maxX: 11000, maxY: 7000 });
  });
});

// Synthetic RAF/asset doubles below test interruption lifecycle only. They do not
// exercise real composition or publish performance evidence.
describe('benchmark run interruption lifecycle', () => {
  let harness: ReturnType<typeof mountBenchmark>;
  let visibility: DocumentVisibilityState;
  let queries: EventTarget[];
  let cancel: ReturnType<typeof vi.fn>;
  let savedWidth: number;
  beforeEach(() => {
    hooks.draws = 0;
    hooks.onFinal = null;
    hooks.pauseFinal = false;
    hooks.releaseFinal = null;
    visibility = 'visible';
    queries = [];
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.stubGlobal('matchMedia', () => {
      const events = new EventTarget();
      queries.push(events);
      return events;
    });
    const asset = createReferenceAsset();
    hooks.preset.mockImplementation(() => ({
      seed: 17,
      settings: structuredClone(asset.settings),
      overrides: [],
    }));
    const state = {
      status: 'idle',
      requestId: null as number | null,
      lastValidatedAsset: null as typeof asset | null,
    };
    const listeners = new Set<() => void>();
    cancel = vi.fn(() => {
      state.status = 'cancelled';
      listeners.forEach((listener) => listener());
    });
    hooks.runtime.mockReturnValue({
      exportFiles: null,
      controller: {
        state,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        generate: () => {
          state.status = 'ready';
          state.requestId = 1;
          state.lastValidatedAsset = asset;
          return 1;
        },
        cancel,
      },
      dispose: () => {
        state.status = 'disposed';
        listeners.clear();
      },
    });
    const root = document.createElement('main');
    document.body.replaceChildren(root);
    harness = mountBenchmark(root);
    const canvas = document.getElementById('benchmark-canvas')!;
    Object.defineProperties(canvas, { clientWidth: { value: 1440 }, clientHeight: { value: 900 } });
    (document.getElementById('benchmark-machine') as HTMLInputElement).value =
      'TEST DOUBLE · not a machine benchmark';
    (document.getElementById('benchmark-frames') as HTMLInputElement).value = '60';
    savedWidth = window.innerWidth;
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: savedWidth });
    harness.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function drain() {
    for (let i = 0; i < 400; i++) await Promise.resolve();
  }
  function start() {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  function result() {
    return JSON.parse(document.getElementById('benchmark-result')!.textContent!);
  }
  it.each(['visibility', 'resize', 'focus', 'blur', 'DPR', 'restore'] as const)(
    'latches %s interruption during the final wait even when original values return',
    async (event) => {
      hooks.pauseFinal = true;
      start();
      await drain();
      expect(hooks.releaseFinal).not.toBeNull();
      if (event === 'visibility') {
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (event === 'DPR') queries[0]!.dispatchEvent(new Event('change'));
      else window.dispatchEvent(new Event(event === 'restore' ? 'pageshow' : event));
      hooks.releaseFinal!();
      await drain();
      expect(result().status).toBe('failed');
      expect(document.getElementById('benchmark-status')!.textContent).not.toContain(
        'Completed diagnostic',
      );
      expect(cancel).toHaveBeenCalled();
    },
  );
  it('rechecks scalar environment changes after the final frame even without an event', async () => {
    hooks.onFinal = () =>
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: savedWidth + 1 });
    start();
    await drain();
    expect(result().status).toBe('failed');
    expect(result().error).toContain('viewport');
  });
  it('cleans listeners after success so old DPR/window events cannot cancel a finished run', async () => {
    start();
    await drain();
    expect(result().status).toBe('completed-diagnostic');
    const calls = cancel.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('blur'));
    queries[0]!.dispatchEvent(new Event('change'));
    expect(cancel).toHaveBeenCalledTimes(calls);
    expect(result().status).toBe('completed-diagnostic');
  });
  it('cleans listeners on cancellation/error and a later retry can complete', async () => {
    hooks.pauseFinal = true;
    start();
    await drain();
    (document.getElementById('benchmark-cancel') as HTMLButtonElement).click();
    await drain();
    expect(result().status).toBe('failed');
    const calls = cancel.mock.calls.length;
    queries[0]!.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('focus'));
    expect(cancel).toHaveBeenCalledTimes(calls);
    hooks.draws = 0;
    hooks.pauseFinal = false;
    hooks.releaseFinal = null;
    start();
    await drain();
    expect(result().status).toBe('completed-diagnostic');
    expect(queries).toHaveLength(2);
  });
});
