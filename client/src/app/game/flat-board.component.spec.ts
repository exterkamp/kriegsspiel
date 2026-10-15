import { TestBed } from '@angular/core/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { fixtureMap, fixtureView } from '@legacy/table/fixture';
import { initialState, type ClientState } from '@legacy/net/state';
import type { BaseMap } from '@legacy/table/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowAt } from '@kriegsspiel/protocol';
import { GLIDE_MS } from '@legacy/table/glide';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { FlatBoardComponent } from './flat-board.component';
import { MarksService } from './marks.service';
import { TableService } from './table.service';

function configuredGame(state: ClientState, terrain: BaseMap | undefined) {
  const s = signal(state);
  const map = signal(terrain);
  const fake = {
    state: s.asReadonly(),
    view: computed(() => s().view),
    map: map.asReadonly(),
    sides: () => [],
    putMark: vi.fn(() => true),
    deleteMark: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: GameService, useValue: fake }],
  });
  return { state: s, map, fake };
}

/** The existing behavior cases deliberately use the offline fixture, supplied by their game fake. */
function stubGame(state: ClientState) {
  return configuredGame(state, fixtureMap).state;
}

function alternate(): BaseMap {
  return {
    width: 8000,
    height: 3000,
    features: [
      {
        id: 'east-wood',
        kind: 'wood',
        layer: -2,
        geometry: {
          shape: 'polygon',
          points: [
            { x: 6000.001, y: 300.001 },
            { x: 7300.001, y: 350.001 },
            { x: 7250.001, y: 900.001 },
          ],
        },
      },
      {
        id: 'river',
        kind: 'river',
        layer: 0,
        geometry: {
          shape: 'polyline',
          points: [
            { x: 0.001, y: 1500.001 },
            { x: 8000, y: 1500.001 },
          ],
          width: 0.001,
        },
      },
      {
        id: 'bridge',
        kind: 'bridge',
        layer: 4,
        geometry: { shape: 'point', at: { x: 6050.001, y: 1500.001 }, radius: 0.001 },
      },
    ],
  };
}

function pointer(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

const view = {
  ...fixtureView,
  orderRoutes: [
    {
      id: 'o1',
      unitId: fixtureView.ownUnits[0]!.id,
      kind: 'order' as const,
      points: [
        { x: 1000, y: 2000 },
        { x: 2050, y: 1000 },
      ],
    },
    {
      id: 'route-1',
      unitId: fixtureView.ownUnits[0]!.id,
      kind: 'route' as const,
      points: [
        { x: 1000, y: 2000 },
        { x: 2050, y: 1600 },
        { x: 2050, y: 1000 },
      ],
    },
  ],
};

async function open() {
  stubGame({ ...initialState, view });
  const f = TestBed.createComponent(FlatBoardComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, marks: TestBed.inject(MarksService) };
}

describe('FlatBoardComponent (#343)', () => {
  it('draws checked asymmetric native geometry exactly, in supplied painter order, without legacy rounding/caps', async () => {
    const map = alternate();
    configuredGame({ ...initialState, view }, map);
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 8000 3000');
    expect(el.querySelector('.ground')?.getAttribute('width')).toBe('8000');
    expect([...el.querySelectorAll('.feature')].map((node) => node.tagName)).toEqual([
      'polygon',
      'polyline',
      'circle',
    ]);
    expect(el.querySelector('polygon.wood')?.getAttribute('points')).toBe(
      '6000.001,300.001 7300.001,350.001 7250.001,900.001',
    );
    const river = el.querySelector('polyline.river')!;
    expect(river.getAttribute('points')).toBe('0.001,1500.001 8000,1500.001');
    expect(river.getAttribute('stroke-width')).toBe('0.001');
    expect(getComputedStyle(river).strokeLinecap).toBe('round');
    const bridge = el.querySelector('circle.bridge')!;
    expect(['cx', 'cy', 'r'].map((attr) => bridge.getAttribute(attr))).toEqual([
      '6050.001',
      '1500.001',
      '0.001',
    ]);
    expect(el.querySelector('svg')?.style.fontSize).toBe(`${8000 / 60}px`);
  });

  it('renders nothing and cannot pick old live/window state when the map is absent', async () => {
    const g = configuredGame({ ...initialState, view }, undefined);
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('#board-summary')).toBeNull();
    TestBed.inject(DeskStore).windowFrame.set({
      gameMs: 0,
      units: [],
      beliefs: {},
      events: [],
      rulings: [],
    } as unknown as WindowAt);
    await f.whenStable();
    expect(el.querySelector('svg')).toBeNull();
    expect(g.fake.putMark).not.toHaveBeenCalled();
  });

  it('picks in the actual letterboxed dimensions with the native piece tolerance, not fixture extent', async () => {
    const first = fixtureView.ownUnits[0]!;
    const g = configuredGame(
      {
        ...initialState,
        view: {
          ...view,
          ownUnits: [
            { ...first, position: { x: 6000, y: 1500 }, footprint: { frontage: 10, depth: 10 } },
          ],
          visibleEnemies: [],
          lastKnownContacts: [],
        },
      },
      alternate(),
    );
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const svg = (f.nativeElement as HTMLElement).querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    pointer(svg, 'pointerdown', 604, 300);
    pointer(svg, 'pointerup', 604, 300);
    expect(JSON.parse(TestBed.inject(TableService).status())).toEqual({
      type: 'piece',
      pieceKind: 'own',
      id: first.id,
      coord: { x: 6040, y: 1500 },
    });
    const marks = TestBed.inject(MarksService);
    marks.setTool('pin');
    pointer(svg, 'pointerdown', 600, 149);
    pointer(svg, 'pointerup', 600, 149);
    expect(g.fake.putMark).not.toHaveBeenCalled();
    pointer(svg, 'pointerdown', 700, 300);
    pointer(svg, 'pointerup', 700, 300);
    expect(g.fake.putMark).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pin', at: { x: 7000, y: 1500 } }),
    );
  });

  it('rejects events from an old SVG before rendering same-ID geometry replacement, then uses the new board', async () => {
    const map = alternate();
    const g = configuredGame({ ...initialState, view }, map);
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const oldSvg = el.querySelector('svg')!;
    oldSvg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const marks = TestBed.inject(MarksService);
    marks.setTool('pin');
    pointer(oldSvg, 'pointerdown', 600, 300);
    expect(marks.draft()).toMatchObject({ at: { x: 6000, y: 1500 } });
    const next = alternate();
    next.features[2]!.geometry = {
      shape: 'point',
      at: { x: 6050.002, y: 1500.002 },
      radius: 1.001,
    };
    g.map.set(next);
    expect(marks.draft()).toBeUndefined();
    pointer(oldSvg, 'pointerup', 600, 300);
    pointer(oldSvg, 'pointerdown', 600, 300);
    expect(marks.draft()).toBeUndefined();
    expect(g.fake.putMark).not.toHaveBeenCalled();
    await f.whenStable();
    const newSvg = el.querySelector('svg')!;
    expect(newSvg).not.toBe(oldSvg);
    expect(oldSvg.isConnected).toBe(false);
    expect(el.querySelector('circle.bridge')?.getAttribute('cx')).toBe('6050.002');
    newSvg.getBoundingClientRect = oldSvg.getBoundingClientRect;
    pointer(newSvg, 'pointerdown', 600, 300);
    pointer(newSvg, 'pointerup', 600, 300);
    expect(g.fake.putMark).toHaveBeenCalledTimes(1);
    g.map.set(undefined);
    pointer(newSvg, 'pointerdown', 600, 300);
    pointer(newSvg, 'pointerup', 600, 300);
    await f.whenStable();
    expect(el.querySelector('svg')).toBeNull();
    expect(g.fake.putMark).toHaveBeenCalledTimes(1);
  });

  it('uses checked dimensions and positions for the umpire window and its text alternative', async () => {
    configuredGame({ ...initialState, view }, alternate());
    const first = fixtureView.ownUnits[0]!;
    const desk = TestBed.inject(DeskStore);
    desk.windowFrame.set({
      gameMs: 0,
      units: [{ ...first, side: 'blue', position: { x: 6000, y: 1500 } }],
      beliefs: {
        blue: { visibleEnemies: [], lastKnownContacts: [] },
        red: { visibleEnemies: [], lastKnownContacts: [] },
      },
      events: [],
      rulings: [],
    } as unknown as WindowAt);
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('#board-summary')?.textContent).toContain(
      'east, 6000 m east and 1500 m south',
    );
    const points = el
      .querySelector('polygon.piece.own')!
      .getAttribute('points')!
      .split(' ')
      .map((point) => point.split(',').map(Number));
    expect(points.reduce((sum, point) => sum + point[0]!, 0) / 4).toBe(6000);
    expect(points.reduce((sum, point) => sum + point[1]!, 0) / 4).toBe(1500);
  });

  it('cancels an unfinished mark when its board is destroyed', async () => {
    const g = configuredGame({ ...initialState, view }, alternate());
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const svg = (f.nativeElement as HTMLElement).querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const marks = TestBed.inject(MarksService);
    marks.setTool('pin');
    pointer(svg, 'pointerdown', 600, 300);
    expect(marks.draft()).toBeDefined();
    f.destroy();
    expect(marks.draft()).toBeUndefined();
    marks.pointerUp(
      { pickAt: () => ({ type: 'point', coord: { x: 6000, y: 1500 } }) },
      { clientX: 600, clientY: 300, pointerId: 1, button: 0 },
    );
    expect(g.fake.putMark).not.toHaveBeenCalled();
  });
  it('draws the map, own units, known enemy, order arrow and a dotted route', async () => {
    const { el } = await open();
    expect(el.querySelector('polyline.river')).not.toBeNull();
    expect(getComputedStyle(el.querySelector('polyline.river')!).strokeLinecap).toBe('butt');
    expect(el.querySelector('circle.bridge')).not.toBeNull();
    expect(el.querySelectorAll('polygon.wood').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('polygon.piece.own')).toHaveLength(fixtureView.ownUnits.length);
    expect(el.querySelector('polyline.order')).not.toBeNull();
    expect(el.querySelectorAll('polyline.route').length).toBeGreaterThan(1);
    expect(el.querySelector('circle.route-end')).not.toBeNull();
    expect(el.textContent).toContain(fixtureView.ownUnits[0]!.name);
  });

  it('hides the order arrows and the planned routes with their own toggles', async () => {
    const { f, el, marks } = await open();
    marks.overlays.update((o) => ({ ...o, routes: false }));
    await f.whenStable();
    expect(el.querySelector('polyline.route')).toBeNull();
    expect(el.querySelector('circle.route-end')).toBeNull();
    expect(el.querySelector('polyline.order')).not.toBeNull();
    marks.overlays.update((o) => ({ ...o, routes: true, orders: false }));
    await f.whenStable();
    expect(el.querySelector('polyline.order')).toBeNull();
    expect(el.querySelector('polyline.route')).not.toBeNull();
  });

  it('draws an own courier with the order arrows and hides it with them (#196)', async () => {
    stubGame({
      ...initialState,
      view: {
        ...view,
        couriers: [
          {
            id: 'o1',
            unitId: fixtureView.ownUnits[0]!.id,
            position: { x: 1500, y: 1500 },
            to: { x: 2050, y: 1000 },
            arriveAtGame: fixtureView.atGame + 120_000,
          },
        ],
      },
    });
    const f = TestBed.createComponent(FlatBoardComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-courier="o1"]')?.textContent).toContain('Courier, 2 min');
    TestBed.inject(MarksService).overlays.update((o) => ({ ...o, orders: false }));
    await f.whenStable();
    expect(el.querySelector('[data-courier="o1"]')).toBeNull();
  });

  it('keeps tags of units standing together from overlapping', async () => {
    const { el } = await open();
    const ys = [...el.querySelectorAll('text.tag:not(.enemy)')].map((t) => t.getAttribute('y'));
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('lets the pin tool pick a place on the board', async () => {
    const { f, el, marks } = await open();
    const svg = el.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    marks.setTool('pin');
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }));
    await f.whenStable();
    expect(marks.draft()).toMatchObject({ kind: 'pin', at: { x: 2000, y: 1500 } });
  });

  describe('gliding pieces (D39)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    /** Fakes the frame clock: `now` is what `performance.now` answers, `advance` runs the frames asked for. */
    function clock() {
      let now = 1000;
      let id = 0;
      // Angular's scheduler asks for frames too, so they are kept by id.
      const frames = new Map<number, FrameRequestCallback>();
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames.set(++id, cb);
        return id;
      });
      vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      );
      return {
        advance: (ms: number) => {
          now += ms;
          const due = [...frames.values()];
          frames.clear();
          for (const cb of due) cb(now);
        },
      };
    }

    const first = fixtureView.ownUnits[0]!;
    const moved = {
      ...view,
      atGame: view.atGame + 1,
      ownUnits: view.ownUnits.map((u) =>
        u.id === first.id ? { ...u, position: { x: u.position.x + 600, y: u.position.y } } : u,
      ),
    };

    async function board(turnMode: boolean) {
      const c = clock();
      const s = stubGame({ ...initialState, view, ...(turnMode ? { turnMode: true } : {}) });
      const f = TestBed.createComponent(FlatBoardComponent);
      await f.whenStable();
      const el = f.nativeElement as HTMLElement;
      const piece = () => el.querySelector('polygon.piece.own')!.getAttribute('points');
      return { c, s, f, piece, before: piece() };
    }

    it('sets a real-time piece down at its new place at once', async () => {
      const b = await board(false);
      b.s.update((x) => ({ ...x, view: moved }));
      await b.f.whenStable();
      expect(b.piece()).not.toBe(b.before);
      // Nothing is left to animate.
      b.c.advance(GLIDE_MS);
      const after = b.piece();
      await b.f.whenStable();
      expect(b.piece()).toBe(after);
    });

    it('glides a turn-mode piece from its old place to its new one', async () => {
      const rt = await board(false);
      rt.s.update((x) => ({ ...x, view: moved }));
      await rt.f.whenStable();
      const target = rt.piece();
      TestBed.resetTestingModule();
      vi.restoreAllMocks();

      const b = await board(true);
      b.s.update((x) => ({ ...x, view: moved }));
      await b.f.whenStable();
      expect(b.piece()).toBe(b.before);
      b.c.advance(GLIDE_MS / 2);
      await b.f.whenStable();
      expect(b.piece()).not.toBe(b.before);
      expect(b.piece()).not.toBe(target);
      b.c.advance(GLIDE_MS);
      await b.f.whenStable();
      expect(b.piece()).toBe(target);
    });

    it("sets the way back from the umpire's window down at once", async () => {
      const b = await board(true);
      const desk = TestBed.inject(DeskStore);
      const frame = {
        gameMs: 0,
        units: [{ ...first, side: 'blue', position: { x: 10, y: 10 } }],
        beliefs: {
          blue: { visibleEnemies: [], lastKnownContacts: [] },
          red: { visibleEnemies: [], lastKnownContacts: [] },
        },
        events: [],
        rulings: [],
      } as unknown as WindowAt;
      desk.windowFrame.set(frame);
      await b.f.whenStable();
      expect(b.piece()).not.toBe(b.before);
      desk.windowFrame.set(undefined);
      await b.f.whenStable();
      expect(b.piece()).toBe(b.before);
    });

    it('sets a new map lifetime down immediately instead of gliding from old-map positions', async () => {
      clock();
      const g = configuredGame({ ...initialState, view, turnMode: true }, fixtureMap);
      const f = TestBed.createComponent(FlatBoardComponent);
      await f.whenStable();
      g.state.update((state) => ({ ...state, view: moved }));
      g.map.set(alternate());
      await f.whenStable();
      const points = (f.nativeElement as HTMLElement)
        .querySelector('polygon.piece.own')!
        .getAttribute('points')!
        .split(' ')
        .map((point) => point.split(',').map(Number));
      expect(points.reduce((sum, point) => sum + point[0]!, 0) / 4).toBe(
        moved.ownUnits[0]!.position.x,
      );
    });
  });
});
