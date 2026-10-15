import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { WindowAt } from '@kriegsspiel/protocol';
import { initialState, type ClientState } from '@legacy/net/state';
import { fixtureMap, fixtureView } from '@legacy/table/fixture';
import { GLIDE_MS } from '@legacy/table/glide';
import { pickFromRay } from '@legacy/table/picking';
import type { BaseMap, SceneState } from '@legacy/table/types';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { MarksService } from './marks.service';
import { TableHostComponent } from './table-host.component';
import { TABLE_SCENE_FACTORY, TableService } from './table.service';

function alternate(): BaseMap {
  return {
    width: 8000,
    height: 3000,
    features: [
      {
        id: 'river',
        kind: 'river',
        layer: 1,
        geometry: {
          shape: 'polyline',
          points: [
            { x: 0.001, y: 1500.001 },
            { x: 8000, y: 1500.001 },
          ],
          width: 200,
        },
      },
      {
        id: 'bridge',
        kind: 'bridge',
        layer: 2,
        geometry: { shape: 'point', at: { x: 6050.001, y: 1500.001 }, radius: 110 },
      },
    ],
  };
}

/** No renderer is constructed in jsdom. Real ray/map/piece picking still uses the applied SceneState. */
function fakeScene() {
  let applied: SceneState | undefined;
  return {
    start: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    setDesk: vi.fn(),
    setGlide: vi.fn(),
    setOverlays: vi.fn(),
    setMarks: vi.fn(),
    panTo: vi.fn(),
    apply: vi.fn((state: SceneState) => {
      applied = state;
    }),
    pickAt: vi.fn((x: number, y: number) =>
      applied
        ? pickFromRay(
            applied,
            new THREE.Ray(
              new THREE.Vector3(x - applied.map.width / 2, 1000, y - applied.map.height / 2),
              new THREE.Vector3(0, -1, 0),
            ),
          )
        : { type: 'none' as const },
    ),
    controls: { mouseButtons: { LEFT: 0 as number | null }, touches: { ONE: 0 as number | null } },
  };
}

function setup(terrain: BaseMap | undefined = fixtureMap) {
  const map = signal<BaseMap | undefined>(terrain);
  const state = signal<ClientState>({ ...initialState, view: fixtureView });
  const game = {
    map: map.asReadonly(),
    state: state.asReadonly(),
    view: computed(() => state().view),
    sides: () => [],
    putMark: vi.fn(() => true),
    deleteMark: vi.fn(),
  };
  const scenes: ReturnType<typeof fakeScene>[] = [];
  const factory = vi.fn(() => {
    const scene = fakeScene();
    scenes.push(scene);
    return scene;
  });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: GameService, useValue: game },
      { provide: TABLE_SCENE_FACTORY, useValue: factory },
    ],
  });
  const fixture = TestBed.createComponent(TableHostComponent);
  const el = fixture.nativeElement as HTMLElement;
  const table = TestBed.inject(TableService);
  const marks = TestBed.inject(MarksService);
  const desk = TestBed.inject(DeskStore);
  return { map, state, game, scenes, factory, fixture, el, table, marks, desk };
}

function pointer(canvas: HTMLCanvasElement, type: string, x = 1000, y = 1000): void {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('checked map lifetime in TableHostComponent', () => {
  it('does not construct or expose a scene while loading, then applies the checked map before starting', async () => {
    const b = setup();
    b.map.set(undefined);
    await b.fixture.whenStable();
    const canvas = b.el.querySelector('canvas')!;
    expect(canvas.hidden).toBe(true);
    expect(b.factory).not.toHaveBeenCalled();
    expect(b.table.scene()).toBeUndefined();
    expect(b.el.querySelector('ks-webgl-fallback')).toBeNull();
    const down = vi.spyOn(b.marks, 'pointerDown');
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointerup');
    expect(down).not.toHaveBeenCalled();
    b.desk.showOnTable.set({ x: 500, y: 600 });
    await b.fixture.whenStable();
    expect(b.desk.showOnTable()).toBeUndefined();
    const map = alternate();
    b.map.set(map);
    await b.fixture.whenStable();
    expect(b.factory).toHaveBeenCalledTimes(1);
    const scene = b.scenes[0]!;
    expect(scene.apply.mock.calls[0]![0].map).toBe(map);
    expect(scene.apply.mock.invocationCallOrder[0]!).toBeLessThan(
      scene.start.mock.invocationCallOrder[0]!,
    );
    expect(scene.apply.mock.calls[0]![0].map.features[1]!.geometry).toEqual({
      shape: 'point',
      at: { x: 6050.001, y: 1500.001 },
      radius: 110,
    });
    expect(scene.start).toHaveBeenCalledTimes(1);
    expect(canvas.hidden).toBe(false);
    expect(scene.panTo).not.toHaveBeenCalled();
    expect(b.table.scene()).toBe(scene);
  });

  it('keeps one scene across ordinary view/desk updates, and clears pieces when the view disappears', async () => {
    const map = alternate();
    const b = setup(map);
    await b.fixture.whenStable();
    const scene = b.scenes[0]!;
    const first = fixtureView.ownUnits[0]!;
    b.state.update((state) => ({
      ...state,
      view: {
        ...fixtureView,
        atGame: 100,
        ownUnits: [{ ...first, position: { x: 6000, y: 1500 } }],
      },
    }));
    await b.fixture.whenStable();
    expect(scene.apply.mock.lastCall![0].own[0]!.position).toEqual({ x: 6000, y: 1500 });
    expect(scene.apply.mock.lastCall![0].map).toBe(map);
    scene.setDesk.mockClear();
    b.desk.activeView.set('journal');
    await b.fixture.whenStable();
    b.desk.activeView.set('roster');
    await b.fixture.whenStable();
    b.desk.activeView.set('table');
    await b.fixture.whenStable();
    expect(scene.setDesk.mock.calls).toEqual([
      [true, 600],
      [false, 600],
    ]);
    expect(b.factory).toHaveBeenCalledTimes(1);
    expect(scene.dispose).not.toHaveBeenCalled();
    b.state.update((state) => ({ ...state, view: undefined }));
    await b.fixture.whenStable();
    expect(scene.apply.mock.lastCall![0]).toEqual({ side: '', map, own: [], ghosts: [] });
  });

  it('blocks stale pointer events immediately on map loss, then disposes all old scene resources', async () => {
    const b = setup(alternate());
    await b.fixture.whenStable();
    const old = b.scenes[0]!;
    const canvas = b.el.querySelector('canvas')!;
    b.marks.setTool('pin');
    pointer(canvas, 'pointerdown', 6000, 1500);
    expect(b.marks.draft()).toMatchObject({ at: { x: 6000, y: 1500 } });
    old.pickAt.mockClear();
    b.map.set(undefined);
    expect(b.table.scene()).toBeUndefined();
    pointer(canvas, 'pointermove', 6001, 1500);
    pointer(canvas, 'pointerup', 6001, 1500);
    pointer(canvas, 'pointerdown', 6001, 1500);
    expect(old.pickAt).not.toHaveBeenCalled();
    expect(b.game.putMark).not.toHaveBeenCalled();
    expect(b.marks.draft()).toBeUndefined();
    await b.fixture.whenStable();
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(b.table.scene()).toBeUndefined();
    expect(canvas.hidden).toBe(true);
    b.state.update((state) => ({ ...state, view: { ...fixtureView, atGame: 400 } }));
    await b.fixture.whenStable();
    expect(b.factory).toHaveBeenCalledTimes(1);
  });

  it('replaces a scene once for changed same-ID geometry and preserves desk/overlay/tool state without old glides', async () => {
    const b = setup(alternate());
    await b.fixture.whenStable();
    const old = b.scenes[0]!;
    const canvas = b.el.querySelector('canvas')!;
    b.desk.activeView.set('journal');
    b.marks.overlays.set({ orders: false, routes: false, lastKnown: false });
    b.marks.setTool('pin');
    b.state.update((state) => ({ ...state, turnMode: true }));
    await b.fixture.whenStable();
    const next = alternate();
    next.features[1]!.geometry = { shape: 'point', at: { x: 6050.002, y: 1500.002 }, radius: 111 };
    b.map.set(next);
    expect(b.table.scene()).toBeUndefined();
    old.pickAt.mockClear();
    pointer(canvas, 'pointerdown');
    expect(old.pickAt).not.toHaveBeenCalled();
    await b.fixture.whenStable();
    expect(b.factory).toHaveBeenCalledTimes(2);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    const current = b.scenes[1]!;
    expect(current.apply.mock.lastCall![0].map).toBe(next);
    expect(current.setGlide.mock.calls.every(([ms]) => ms === 0)).toBe(true);
    expect(current.setDesk).toHaveBeenCalledWith(true, 0);
    expect(current.setOverlays).toHaveBeenCalledWith({
      orders: false,
      routes: false,
      lastKnown: false,
    });
    expect(b.el.querySelector('canvas')).toBe(canvas);
    expect(b.table.scene()).toBe(current);
    b.fixture.destroy();
    expect(current.dispose).toHaveBeenCalledTimes(1);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(b.table.scene()).toBeUndefined();
  });

  it('uses the applied asymmetric map for real ray picking outside the fixture extent', async () => {
    const b = setup(alternate());
    await b.fixture.whenStable();
    const canvas = b.el.querySelector('canvas')!;
    b.marks.setTool('pin');
    pointer(canvas, 'pointerdown', 7000, 2000);
    pointer(canvas, 'pointerup', 7000, 2000);
    expect(b.game.putMark).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pin', at: { x: 7000, y: 2000 } }),
    );
    pointer(canvas, 'pointerdown', 8001, 2000);
    pointer(canvas, 'pointerup', 8001, 2000);
    expect(b.game.putMark).toHaveBeenCalledTimes(1);
  });

  it('uses checked terrain for window frames, preserves read-only picking and resumes turn glides after returning', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const map = alternate();
    const b = setup(map);
    await b.fixture.whenStable();
    const scene = b.scenes[0]!;
    b.state.update((state) => ({ ...state, turnMode: true }));
    await b.fixture.whenStable();
    expect(scene.setGlide.mock.lastCall).toEqual([GLIDE_MS]);
    const unit = { ...fixtureView.ownUnits[0]!, side: 'blue', position: { x: 6000, y: 1500 } };
    b.desk.windowFrame.set({
      gameMs: 0,
      units: [unit],
      beliefs: {
        blue: { visibleEnemies: [], lastKnownContacts: [] },
        red: { visibleEnemies: [], lastKnownContacts: [] },
      },
      events: [],
      rulings: [],
    } as unknown as WindowAt);
    await b.fixture.whenStable();
    expect(scene.apply.mock.lastCall![0].map).toBe(map);
    expect(scene.apply.mock.lastCall![0].own.map((piece) => piece.position)).toEqual([
      { x: 6000, y: 1500 },
    ]);
    expect(scene.setGlide.mock.lastCall).toEqual([0]);
    const canvas = b.el.querySelector('canvas')!;
    pointer(canvas, 'pointermove', 6000, 1500);
    expect(b.desk.windowHover()).toBe(unit.id);
    b.marks.setTool('pin');
    pointer(canvas, 'pointerdown', 6000, 1500);
    pointer(canvas, 'pointerup', 6000, 1500);
    expect(b.game.putMark).not.toHaveBeenCalled();
    b.desk.windowFrame.set(undefined);
    await b.fixture.whenStable();
    expect(scene.setGlide.mock.lastCall).toEqual([0]);
    b.state.update((state) => ({ ...state, view: { ...fixtureView, atGame: 900 } }));
    await b.fixture.whenStable();
    expect(scene.setGlide.mock.lastCall).toEqual([GLIDE_MS]);
    expect(b.factory).toHaveBeenCalledTimes(1);
  });

  it('honors reduced motion for turn updates and desk movement', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const b = setup(alternate());
    await b.fixture.whenStable();
    b.state.update((state) => ({
      ...state,
      turnMode: true,
      view: { ...fixtureView, atGame: 100 },
    }));
    b.desk.activeView.set('journal');
    await b.fixture.whenStable();
    expect(b.scenes[0]!.setGlide.mock.calls.every(([ms]) => ms === 0)).toBe(true);
    expect(b.scenes[0]!.setDesk).toHaveBeenCalledWith(true, 0);
  });

  it('disposes a scene whose start fails and shows the actual-map fallback; a new map can retry', async () => {
    const b = setup(alternate());
    const broken = fakeScene();
    broken.start.mockImplementation(() => {
      throw new Error('WebGL unavailable');
    });
    b.factory.mockImplementationOnce(() => broken);
    await b.fixture.whenStable();
    expect(broken.apply).toHaveBeenCalled();
    expect(broken.start).toHaveBeenCalledTimes(1);
    expect(broken.dispose).toHaveBeenCalledTimes(1);
    expect(b.table.scene()).toBeUndefined();
    expect(b.el.querySelector('ks-webgl-fallback svg')?.getAttribute('viewBox')).toBe(
      '0 0 8000 3000',
    );
    b.state.update((state) => ({ ...state, view: { ...fixtureView, atGame: 100 } }));
    await b.fixture.whenStable();
    expect(b.factory).toHaveBeenCalledTimes(1);
    b.map.set(undefined);
    await b.fixture.whenStable();
    expect(b.el.querySelector('ks-webgl-fallback')).toBeNull();
    b.map.set(alternate());
    await b.fixture.whenStable();
    expect(b.factory).toHaveBeenCalledTimes(2);
    expect(b.table.scene()).toBe(b.scenes[0]);
    expect(b.el.querySelector('ks-webgl-fallback')).toBeNull();
  });

  it('does not create a renderer if destroyed before the initial render callback', () => {
    const b = setup(alternate());
    b.fixture.destroy();
    expect(b.factory).not.toHaveBeenCalled();
    expect(b.table.scene()).toBeUndefined();
  });

  it('cancels a gesture at scene destruction without sending its final mark', async () => {
    const b = setup(alternate());
    await b.fixture.whenStable();
    const scene = b.scenes[0]!;
    b.marks.setTool('pin');
    pointer(b.el.querySelector('canvas')!, 'pointerdown', 7000, 2000);
    expect(b.marks.draft()).toBeDefined();
    b.fixture.destroy();
    expect(b.marks.draft()).toBeUndefined();
    b.marks.pointerUp(scene, { clientX: 7000, clientY: 2000, pointerId: 1, button: 0 });
    expect(b.game.putMark).not.toHaveBeenCalled();
    expect(scene.dispose).toHaveBeenCalledTimes(1);
  });
});
