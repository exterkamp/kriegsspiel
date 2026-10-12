import { describe, expect, it } from 'vitest';
import { Dispatch, SideView } from '@kriegsspiel/protocol';
import {
  EventRegistry,
  advanceTo,
  createState,
  holdTheBridgeFarStart,
  issueOrder,
  loadScenario,
  pointMm,
  registerOrders,
  type GameState,
  type ViewDocument,
} from '@kriegsspiel/engine';
import { documentToDispatch, sideViewOf } from './sideView.js';

describe('documentToDispatch', () => {
  const doc: ViewDocument = {
    id: 'red-d1',
    kind: 'capturedDispatch',
    capturedAt: 600_000,
    deliveredAt: 1_200_000,
    ageMs: 600_000,
    issuedAt: 0,
    addressedTo: '1st Battalion',
    location: { x: 1950, y: 2700 },
    place: 'near the road',
    text: 'Advance at once.',
  };

  it('shows a captured enemy dispatch as an intelligence paper with the enemy wording', () => {
    const d = documentToDispatch(doc);
    expect(() => Dispatch.parse(d)).not.toThrow();
    expect(d).toMatchObject({
      category: 'intelligence',
      writtenAtGame: 0,
      receivedAtGame: 1_200_000,
      location: doc.location,
    });
    expect(d.text).toContain('"Advance at once."');
    expect(d.text).toContain('1st Battalion');
  });
});

describe('sideViewOf orderRoutes (#203)', () => {
  const clock = { gameMsAtAnchor: 1, wallMsAtAnchor: 0, rate: 1, status: 'running' } as const;
  const sent = () => {
    const g = loadScenario(holdTheBridgeFarStart);
    const reg = new EventRegistry<GameState>();
    registerOrders(reg);
    const order = {
      id: 'o1',
      side: 'blue' as const,
      to: 'blue-1',
      issuedAt: 0,
      text: 'advance',
      intents: [{ kind: 'move' as const, to: pointMm(2050, 2050) }],
    };
    return advanceTo(issueOrder(createState(g.seed, g, 0), order), 1, reg).state;
  };

  it('sends the sender its own order in flight, valid on the wire', () => {
    const view = SideView.parse(sideViewOf(sent(), 'blue', clock));
    expect(view.orderRoutes?.map((o) => [o.id, o.unitId, o.kind])).toEqual([
      ['o1', 'blue-1', 'order'],
    ]);
  });

  it('sends the other side nothing of it', () => {
    const view = sideViewOf(sent(), 'red', clock);
    expect(view.orderRoutes).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('o1');
  });

  it('sends a marching unit its own route and the other side nothing of it', () => {
    const s = sent();
    const to = pointMm(2050, 2050);
    const world = {
      ...s.world,
      units: s.world.units.map((u) =>
        u.id === 'blue-1' || u.id === 'red-1'
          ? { ...u, intent: { kind: 'move' as const, to, startedAt: 0 } }
          : u,
      ),
    };
    const state = { ...s, world };
    const blue = SideView.parse(sideViewOf(state, 'blue', clock));
    const red = SideView.parse(sideViewOf(state, 'red', clock));
    expect(blue.orderRoutes?.map((o) => o.id).sort()).toEqual(['o1', 'route-blue-1']);
    expect(red.orderRoutes?.map((o) => o.id)).toEqual(['route-red-1']);
    expect(JSON.stringify(red.orderRoutes)).not.toContain('blue-1');
  });
});
