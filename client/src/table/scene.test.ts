// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    constructor(readonly params: unknown) {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { fixtureFacings, fixtureMap, fixtureView } from './fixture.js';
import { FACING_ANGLE, fitDistance } from './framing.js';
import { tilePx } from './mapTexture.js';
import { buildSceneState } from './sceneState.js';
import { TableScene } from './TableScene.js';
import { FACINGS, TERRAINS } from './types.js';

const state = buildSceneState(fixtureView, fixtureMap, fixtureFacings);
const make = (): TableScene => new TableScene(document.createElement('canvas'));
const count = (t: TableScene): number => t.pieceCount;
const resources = (t: TableScene): string =>
  JSON.stringify([
    t.scene.children.length,
    t.scene.children[t.scene.children.length - 1]?.children.length,
  ]);

describe('TableScene.apply', () => {
  it('is idempotent for equal states', () => {
    const t = make();
    t.apply(state);
    const before = [count(t), resources(t)];
    for (let i = 0; i < 20; i++) t.apply(state);
    expect([count(t), resources(t)]).toEqual(before);
    expect(count(t)).toBe(state.own.length + state.ghosts.length);
  });

  it('moves, removes and re-adds pieces', () => {
    const t = make();
    t.apply(state);
    const first = state.own[0]!;
    t.apply({
      ...state,
      own: [{ ...first, position: { x: first.position.x + 3, y: first.position.y } }],
      ghosts: [],
    });
    expect(count(t)).toBe(1);
    t.apply(state);
    expect(count(t)).toBe(state.own.length + state.ghosts.length);
  });

  it('rebuilds the map when the grid changes', () => {
    const t = make();
    t.apply(state);
    const mesh = t.scene.children.find((c) => (c as { isMesh?: boolean }).isMesh);
    t.apply({ ...state, map: { ...state.map, tiles: state.map.tiles.map(() => 'wood' as const) } });
    expect(t.scene.children.find((c) => (c as { isMesh?: boolean }).isMesh)).not.toBe(mesh);
  });

  it('start is guarded and dispose stops the loop', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    const t = make();
    t.start();
    t.start();
    expect(raf).toHaveBeenCalledTimes(1);
    t.dispose();
    t.start();
    expect(raf).toHaveBeenCalledTimes(2);
    t.dispose();
    raf.mockRestore();
  });
});

describe('framing', () => {
  it('pins the facing table', () => {
    expect(Object.keys(FACING_ANGLE)).toEqual([...FACINGS]);
    expect(FACING_ANGLE.N).toBe(0);
    expect(FACING_ANGLE.E).toBeCloseTo(-Math.PI / 2);
    expect(FACING_ANGLE.S).toBeCloseTo(Math.PI);
    expect(FACING_ANGLE.W).toBeCloseTo(Math.PI / 2);
  });

  it('fits the width on portrait screens and the height on landscape ones', () => {
    const landscape = fitDistance(40, 16, 45, 16 / 9);
    const portrait = fitDistance(40, 16, 45, 0.5);
    expect(portrait).toBeGreaterThan(landscape * 2);
    const halfV = Math.tan((45 * Math.PI) / 360);
    expect(portrait * halfV * 0.5).toBeGreaterThanOrEqual(20);
  });
});

describe('map texture and types', () => {
  it('caps texture size for large maps', () => {
    expect(tilePx({ width: 40, height: 16, tiles: [] })).toBe(24);
    const px = tilePx({ width: 200, height: 200, tiles: [] });
    expect(px * 200).toBeLessThanOrEqual(4096);
  });

  it('pins the terrain list', () => {
    expect([...TERRAINS]).toEqual(['open', 'wood', 'river', 'bridge', 'road']);
  });
});
