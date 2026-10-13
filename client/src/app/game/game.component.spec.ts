import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WindowAt } from '@kriegsspiel/protocol';
import { GLIDE_MS } from '@legacy/table/glide';
import type { ClientState } from '@legacy/net/state';
import { DeskStore } from '../desk/desk.store';
import { GameComponent } from './game.component';
import { GameService } from './game.service';
import { MarksService } from './marks.service';
import { TABLE_SCENE_FACTORY, TableService } from './table.service';

beforeEach(() => {
  // jsdom has no canvas; the table scene's label textures cope with a missing 2D context.
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** jsdom has no WebGL, so the table scene is a fake that records what the host asks of it. */
function fakeScene() {
  return {
    start: vi.fn(),
    dispose: vi.fn(),
    apply: vi.fn(),
    resize: vi.fn(),
    setDesk: vi.fn(),
    setGlide: vi.fn(),
    setOverlays: vi.fn(),
    setMarks: vi.fn(),
    panTo: vi.fn(),
    snapTopDown: vi.fn(),
    snapOblique: vi.fn(),
    pickAt: vi.fn(() => ({ type: 'none' })),
    controls: { mouseButtons: { LEFT: 0 as number | null }, touches: { ONE: 0 as number | null } },
  };
}

async function open() {
  const scene = fakeScene();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: TABLE_SCENE_FACTORY, useValue: () => scene },
    ],
  });
  const f = TestBed.createComponent(GameComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, scene };
}

describe('GameComponent', () => {
  it('lays out the table, HUD, marks bar and desk over the fixture board offline', async () => {
    const { el } = await open();
    expect(el.querySelectorAll('canvas')).toHaveLength(1);
    expect(el.querySelector('#hud')).not.toBeNull();
    expect(el.querySelector('#marks')).not.toBeNull();
    expect(el.querySelector('nav[aria-label=Desk]')).not.toBeNull();
    expect(el.querySelector('#sides')).toBeNull();
  });

  it('keeps one table scene while the desk views change, and dollies to the desk', async () => {
    const { f, el, scene } = await open();
    const table = TestBed.inject(TableService);
    const desk = TestBed.inject(DeskStore);
    expect(table.scene()).toBe(scene);
    const canvas = el.querySelector('canvas');
    scene.setDesk.mockClear();
    desk.activeView.set('journal');
    await f.whenStable();
    desk.activeView.set('roster');
    await f.whenStable();
    desk.activeView.set('table');
    await f.whenStable();
    expect(scene.setDesk.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(table.scene()).toBe(scene);
    expect(el.querySelector('canvas')).toBe(canvas);
    expect(el.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('disposes the scene and stops the connection when the route goes away', async () => {
    const { f, scene } = await open();
    const table = TestBed.inject(TableService);
    const disconnect = vi.spyOn(TestBed.inject(GameService), 'disconnect');
    f.destroy();
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    expect(table.scene()).toBeUndefined();
  });

  it('pans the table to a place the desk asked to show, then clears the request', async () => {
    const { f, scene } = await open();
    TestBed.inject(DeskStore).showOnTable.set({ x: 5, y: 6 });
    await f.whenStable();
    expect(scene.panTo).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(TestBed.inject(DeskStore).showOnTable()).toBeUndefined();
  });

  it('draws the marks on the table and gives the drawing tools the left button', async () => {
    const { f, scene } = await open();
    const marks = TestBed.inject(MarksService);
    scene.setMarks.mockClear();
    marks.setTool('pin');
    marks.selectedId.set('x');
    await f.whenStable();
    expect(scene.setMarks).toHaveBeenCalled();
    expect(scene.controls.mouseButtons.LEFT).toBeNull();
    marks.setTool('view');
    await f.whenStable();
    expect(scene.controls.mouseButtons.LEFT).not.toBeNull();
  });

  it('cancels the mark gesture when the canvas gets a pointercancel', async () => {
    const { el } = await open();
    const cancel = vi.spyOn(TestBed.inject(MarksService), 'pointerCancel');
    el.querySelector('canvas')!.dispatchEvent(new Event('pointercancel'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('offers the hot-seat switch for a hot-seat game', async () => {
    window.history.replaceState(null, '', '/?game=g1&side=red');
    vi.stubGlobal(
      'WebSocket',
      class {
        close() {}
        send() {}
        addEventListener() {}
      },
    );
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            id: 'g1',
            sessionType: 'hot_seat',
            sides: [{ side: 'blue' }, { side: 'red' }],
          }),
          { status: 200 },
        ),
    );
    const { f, el } = await open();
    await vi.waitFor(() => expect(el.querySelector('#sides')).not.toBeNull());
    await f.whenStable();
    const labels = [...el.querySelectorAll('#sides button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Switch to blue', 'Playing red']);
  });
});

describe('GameComponent without WebGL (#259)', () => {
  it('shows how to fix it and keeps the desk', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: TABLE_SCENE_FACTORY,
          useValue: () => {
            throw new Error('Error creating WebGL context.');
          },
        },
      ],
    });
    const f = TestBed.createComponent(GameComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('ks-webgl-fallback')?.textContent).toContain('hardware acceleration');
    expect(el.querySelector('ks-webgl-fallback li')).not.toBeNull();
    expect(el.querySelector('nav[aria-label=Desk]')).not.toBeNull();
    expect(TestBed.inject(TableService).scene()).toBeUndefined();
    // A flat board stands in for the table; camera buttons that do nothing are gone and no error text leaks (#343).
    expect(el.querySelector('ks-webgl-fallback ks-flat-board svg')).not.toBeNull();
    expect(el.querySelector('#top')).toBeNull();
    expect(el.querySelector('#obl')).toBeNull();
    expect(el.querySelector('#pick')?.textContent).not.toMatch(/WebGL/);
  });

  it('disposes a half-built scene when start() throws', async () => {
    const dispose = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: TABLE_SCENE_FACTORY,
          useValue: () => ({
            start: () => {
              throw new Error('Error creating WebGL context.');
            },
            dispose,
          }),
        },
      ],
    });
    const f = TestBed.createComponent(GameComponent);
    await f.whenStable();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.querySelector('ks-webgl-fallback')).not.toBeNull();
    expect(TestBed.inject(TableService).scene()).toBeUndefined();
  });

  describe('gliding pieces (D39)', () => {
    const setState = (p: Partial<ClientState>) =>
      (
        TestBed.inject(GameService) as unknown as {
          _state: { update(f: (s: ClientState) => ClientState): void };
        }
      )._state.update((s) => ({ ...s, ...p }));
    const reducedMotion = (on: boolean) =>
      vi.stubGlobal(
        'matchMedia',
        vi.fn((q: string) => ({
          matches: on && q.includes('reduce'),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
    const frame = {
      gameMs: 0,
      units: [],
      beliefs: {
        blue: { visibleEnemies: [], lastKnownContacts: [] },
        red: { visibleEnemies: [], lastKnownContacts: [] },
      },
      events: [],
      rulings: [],
    } as unknown as WindowAt;
    /** Each `apply` with the glide set just before it. */
    const glides = (scene: ReturnType<typeof fakeScene>) =>
      scene.apply.mock.invocationCallOrder.map((at) => {
        const before = scene.setGlide.mock.invocationCallOrder.filter((g) => g < at).length - 1;
        return scene.setGlide.mock.calls[before]![0] as number;
      });

    it('sets a real-time game down at once, as before', async () => {
      reducedMotion(false);
      const { f, scene } = await open();
      setState({ view: { ...TestBed.inject(GameService).state().view!, atGame: 1 } });
      await f.whenStable();
      expect(scene.apply).toHaveBeenCalled();
      expect(glides(scene).every((g) => g === 0)).toBe(true);
    });

    it('glides a turn-mode game to its new places', async () => {
      reducedMotion(false);
      const { f, scene } = await open();
      setState({
        turnMode: true,
        view: { ...TestBed.inject(GameService).state().view!, atGame: 1 },
      });
      await f.whenStable();
      expect(glides(scene).at(-1)).toBe(GLIDE_MS);
    });

    it('does not glide for a player who asks for reduced motion', async () => {
      reducedMotion(true);
      const { f, scene } = await open();
      setState({
        turnMode: true,
        view: { ...TestBed.inject(GameService).state().view!, atGame: 1 },
      });
      await f.whenStable();
      expect(glides(scene).every((g) => g === 0)).toBe(true);
    });

    it("sets the umpire's window down at once, and the way back from it", async () => {
      reducedMotion(false);
      const { f, scene } = await open();
      setState({ turnMode: true });
      const desk = TestBed.inject(DeskStore);
      desk.windowFrame.set(frame);
      await f.whenStable();
      expect(glides(scene).at(-1)).toBe(0);
      desk.windowFrame.set(undefined);
      await f.whenStable();
      expect(glides(scene).at(-1)).toBe(0);
      // The next turn glides again.
      setState({ view: { ...TestBed.inject(GameService).state().view!, atGame: 2 } });
      await f.whenStable();
      expect(glides(scene).at(-1)).toBe(GLIDE_MS);
    });
  });
});
