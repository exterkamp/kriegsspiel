// @vitest-environment jsdom
import { createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapPreview } from './preview.js';
import type { PreviewAsset } from './asset.js';

// This tests viewport selection against parsed assets, not Canvas2D/browser rendering.
vi.mock('./renderer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./renderer.js')>();
  return {
    ...original,
    MapRenderer: class {
      constructor(readonly asset: PreviewAsset) {}
      render() {}
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
