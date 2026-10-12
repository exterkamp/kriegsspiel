import { TestBed } from '@angular/core/testing';
import { fixtureView } from '@legacy/table/fixture';
import { initialState } from '@legacy/net/state';
import { describe, expect, it } from 'vitest';
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
});
