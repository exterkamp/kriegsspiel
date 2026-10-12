import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  advanceTo,
  createState,
  issueOrder,
  loadScenario,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  viewFor,
  viewForRole,
  type GameState,
  type Order,
} from './index.js';
import { holdTheBridgeFarStart } from './scenario.testkit.js';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

const dest = pointMm(2050, 2050);
const signed = (to: string, side: 'blue' | 'red' = 'blue'): Order => ({
  id: `o-${to}`,
  side,
  to,
  issuedAt: 0,
  text: 'advance',
  intents: [{ kind: 'move', to: dest }],
});

function sent() {
  const g = loadScenario(holdTheBridgeFarStart);
  // The courier sets out when the issue event fires.
  return advanceTo(issueOrder(createState(g.seed, g, 0), signed('blue-1')), 1, registry()).state;
}

/** Puts a blue and a red unit mid-march (blue via a leg end) so both sides have a route. */
function marching(world: GameState): GameState {
  const mid = pointMm(1000, 1000);
  return {
    ...world,
    units: world.units.map((u) => {
      if (u.id !== 'blue-1' && u.id !== 'red-1') return u;
      return {
        ...u,
        status: 'active' as const,
        intent: { kind: 'move' as const, to: dest, startedAt: 0 },
        leg: { from: u.center, to: mid, startedAt: 0, arriveAt: 1000 },
      };
    }),
  };
}

describe('orderRoutes in a side view (#203)', () => {
  it('shows the sender an order in flight, from its unit to the destination', () => {
    const s = sent();
    const unit = s.world.units.find((u) => u.id === 'blue-1')!;
    const routes = viewFor(s.world, 'blue', 1).orderRoutes;
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ id: 'o-blue-1', unitId: 'blue-1', kind: 'order' });
    expect(routes[0]!.points).toHaveLength(2);
    expect(routes[0]!.points[0]).toEqual({ x: unit.center.x / 1000, y: unit.center.y / 1000 });
  });

  it("never carries the other side's orders or routes (fog leak test)", () => {
    const s = sent();
    expect(viewFor(s.world, 'red', 1).orderRoutes).toEqual([]);
    // Both sides have a unit marching, so neither list is empty and a cross-side leak can show.
    const w = marching(s.world);
    const blue = viewFor(w, 'blue', 1).orderRoutes;
    const red = viewFor(w, 'red', 1).orderRoutes;
    expect(blue.map((o) => o.id).sort()).toEqual(['o-blue-1', 'route-blue-1']);
    expect(red.map((o) => o.id)).toEqual(['route-red-1']);
    expect(JSON.stringify(red)).not.toContain('blue-1');
    expect(JSON.stringify(blue)).not.toContain('red-1');
  });

  it('shows a marching own unit as its leg end then its destination, dropping repeats', () => {
    const w = marching(sent().world);
    const mid = pointMm(1000, 1000);
    const routes = viewFor(w, 'blue', 1).orderRoutes.filter((o) => o.kind === 'route');
    expect(routes).toHaveLength(1);
    const u = w.units.find((x) => x.id === 'blue-1')!;
    expect(routes[0]!.points).toEqual([
      { x: u.center.x / 1000, y: u.center.y / 1000 },
      { x: mid.x / 1000, y: mid.y / 1000 },
      { x: dest.x / 1000, y: dest.y / 1000 },
    ]);
    // A leg that ends on the destination adds no second point there.
    const w2 = {
      ...w,
      units: w.units.map((x) => (x.id === 'blue-1' ? { ...x, leg: { ...x.leg!, to: dest } } : x)),
    };
    const r2 = viewFor(w2, 'blue', 1).orderRoutes.find((o) => o.kind === 'route')!;
    expect(r2.points).toHaveLength(2);
  });

  it('cuts routes to the units a subordinate commands and hides them from intelligence', () => {
    const s = sent();
    const other = viewFor(s.world, 'blue', 1).ownUnits.find((u) => u.id !== 'blue-1')!.id;
    const sub = (id: string) =>
      viewForRole(s.world, 'blue', { role: 'subordinate', units: [id] }, 1).orderRoutes;
    expect(sub(other)).toEqual([]);
    expect(sub('blue-1')).toHaveLength(1);
    expect(viewForRole(s.world, 'blue', { role: 'intelligence' }, 1).orderRoutes).toEqual([]);
  });
});
