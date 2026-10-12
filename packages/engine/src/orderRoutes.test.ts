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
    // Once delivered the blue unit marches; red still learns nothing of it.
    const t = 90 * 60_000;
    const later = advanceTo(s, t, registry()).state;
    const blue = viewFor(later.world, 'blue', t).orderRoutes;
    expect(blue.every((o) => o.unitId.startsWith('blue'))).toBe(true);
    const red = viewFor(later.world, 'red', t).orderRoutes;
    expect(red.every((o) => o.unitId.startsWith('red'))).toBe(true);
    expect(JSON.stringify(red)).not.toContain('blue-1');
  });

  it('shows a marching own unit as a route and drops the order once it is delivered', () => {
    const s = sent();
    const g = advanceTo(s, 20 * 60_000, registry()).state;
    const u = g.world.units.find((x) => x.id === 'blue-1')!;
    const routes = viewFor(g.world, 'blue', g.time).orderRoutes.filter(
      (o) => o.unitId === 'blue-1',
    );
    if (u.intent.kind === 'move') {
      expect(routes.map((o) => o.kind)).toEqual(['route']);
      expect(routes[0]!.points.at(-1)).toEqual({ x: dest.x / 1000, y: dest.y / 1000 });
    } else {
      expect(routes).toEqual([]);
    }
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
