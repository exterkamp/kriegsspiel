import { TestBed } from '@angular/core/testing';
import { fixtureView } from '@legacy/table/fixture';
import { initialState } from '@legacy/net/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowAt } from '@kriegsspiel/protocol';
import { GLIDE_MS } from '@legacy/table/glide';
import { DeskStore } from '../desk/desk.store';
import { stubGame } from '../desk/testing';
import { FlatBoardComponent } from './flat-board.component';
import { MarksService } from './marks.service';

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
  it('draws the map, own units, known enemy, order arrow and a dotted route', async () => {
    const { el } = await open();
    expect(el.querySelector('polyline.river')).not.toBeNull();
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
  });
});
