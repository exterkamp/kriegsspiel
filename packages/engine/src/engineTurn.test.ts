import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  courierPass,
  createState,
  engineTurnStart,
  loadScenario,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  type EmittedEvent,
  type EngineState,
  type GameState,
  type Order,
  type TurnCourier,
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
const reg = registry();

const ORDER: Order = {
  id: 'o1',
  side: 'blue',
  to: 'blue-1',
  issuedAt: 0,
  text: 'Advance to the crossroads at once.',
  intents: [{ kind: 'move', to: pointMm(2050, 2050) }],
};

/** Red's hussars sit on blue's courier route to blue-1, so some rides are taken. */
function start(seed: number): EngineState<GameState> {
  const g = loadScenario(holdTheBridgeFarStart);
  const world: GameState = {
    ...g,
    seed,
    units: g.units.map((u) => (u.id === 'red-3' ? { ...u, center: pointMm(1950, 2700) } : u)),
  };
  return createState(seed, world, 0);
}

/** What the ordinary handlers did with each ride, read from what they emitted. */
function rides(emitted: EmittedEvent[]): Map<string, Partial<TurnCourier>> {
  const out = new Map<string, Partial<TurnCourier>>();
  for (const e of emitted) {
    const p = e.payload as { orderId?: string; reason?: string; by?: string };
    if (!p?.orderId || out.has(p.orderId)) continue;
    if (e.type === 'order_delivered') out.set(p.orderId, { outcome: 'delivered', atMs: e.time });
    if (e.type === 'courier_intercepted') {
      out.set(p.orderId, { outcome: 'intercepted', atMs: e.time, by: p.by! });
    }
    if (e.type === 'order_failed' && p.reason === 'courier lost') {
      out.set(p.orderId, { outcome: 'lost', atMs: e.time });
    }
  }
  return out;
}

const garbledIds = (emitted: EmittedEvent[]) =>
  emitted
    .filter((e) => e.type === 'order_garbled')
    .map((e) => (e.payload as { orderId: string }).orderId);

describe('the courier pass and forced rides (D39, 11.4)', () => {
  it('rolls each ride once; the engine turn then rides it to the same outcome with no roll', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s0 = start(seed);
      const before = JSON.stringify(s0);
      const turn = { n: 1, startMs: 0, endMs: 30 * MS_PER_MINUTE };
      const pass = courierPass(s0, [ORDER], turn, reg);
      expect(JSON.stringify(s0)).toBe(before);
      // Deterministic: the same state gives the same pass.
      expect(courierPass(s0, [ORDER], turn, reg)).toEqual(pass);

      const run = advanceTo(engineTurnStart(s0, [ORDER], pass, turn), turn.endMs, reg);
      const c = pass.couriers[0]!;
      seen.add(c.outcome);
      const got = rides(run.emitted).get('o1');
      if (c.outcome === 'riding') expect(got).toBeUndefined();
      else
        expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({ by: undefined, ...got });
      expect(garbledIds(run.emitted).includes('o1')).toBe(
        c.outcome === 'delivered' && c.garbled === true,
      );
      // The captor's document is filed as the pass had it.
      if (c.outcome === 'intercepted') {
        expect(run.state.world.intel.red.documents.map((d) => d.capturedAt)).toEqual([c.atMs]);
      }
    }
    // The hussars on the road take some rides and let others through.
    expect(seen.has('intercepted')).toBe(true);
    expect(seen.has('delivered')).toBe(true);
  });

  it('continues a ride still on the road at the turn end into the next turn', () => {
    let checked = 0;
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      let s = start(seed);
      const t1 = { n: 1, startMs: 0, endMs: 30_000 };
      const p1 = courierPass(s, [ORDER], t1, reg);
      if (p1.couriers[0]!.outcome !== 'riding') continue;
      expect(p1.couriers[0]!.dueMs).toBeGreaterThan(t1.endMs);
      s = advanceTo(engineTurnStart(s, [ORDER], p1, t1), t1.endMs, reg).state;
      expect(s.world.couriers.map((c) => c.forced)).toEqual([{ untilMs: t1.endMs }]);

      const t2 = { n: 2, startMs: t1.endMs, endMs: 40 * MS_PER_MINUTE };
      const p2 = courierPass(s, [], t2, reg);
      expect(p2.couriers.map((c) => c.orderId)).toEqual(['o1']);
      const run = advanceTo(engineTurnStart(s, [], p2, t2), t2.endMs, reg);
      const c = p2.couriers[0]!;
      const got = rides(run.emitted).get('o1');
      expect({ outcome: c.outcome, atMs: c.atMs, by: c.by }).toEqual({ by: undefined, ...got });
      outcomes.add(c.outcome);
      checked++;
    }
    expect(checked).toBe(20);
    // Taken and delivered in the second turn alike: its checks were rolled by that turn's pass.
    expect([...outcomes].sort()).toEqual(['delivered', 'intercepted']);
  });

  it('sends an order the rules could not read: it rides and is delivered, and the unit carries on', () => {
    const s0 = start(3);
    const order: Order = { ...ORDER, id: 'o2', intents: [], textOnly: true };
    const turn = { n: 1, startMs: 0, endMs: 40 * MS_PER_MINUTE };
    const g = loadScenario(holdTheBridgeFarStart);
    const world: GameState = { ...g, seed: 3 };
    const quiet = createState(3, world, 0);
    const pass = courierPass(quiet, [order], turn, reg);
    expect(pass.couriers[0]).toMatchObject({ orderId: 'o2', outcome: 'delivered' });
    const run = advanceTo(engineTurnStart(quiet, [order], pass, turn), turn.endMs, reg);
    expect(run.emitted.map((e) => e.type)).toContain('order_delivered');
    const unit = (s: EngineState<GameState>) => s.world.units.find((u) => u.id === 'blue-1')!;
    expect(unit(run.state).intent).toEqual(unit(quiet).intent);
    // Without the flag an order with no intents is refused, as in real time.
    const refused = courierPass(s0, [{ ...ORDER, id: 'o3', intents: [] }], turn, reg);
    expect(refused.couriers[0]).toMatchObject({
      outcome: 'failed',
      reason: 'order has no intents',
    });
  });
});
