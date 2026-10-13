import { describe, expect, it } from 'vitest';
import { holdTheBridgeFarStart } from './scenario.testkit.js';
import {
  EXCEED_MAX_M,
  EventRegistry,
  HALT_SHORT_MAX,
  advanceTo,
  createState,
  issueOrder,
  loadScenario,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  shapeIntents,
  viewFor,
  type EngineState,
  type GameState,
  type Interpretation,
  type OrderIntent,
  type Trait,
} from './index.js';

const bounds = { width: 4_000_000, height: 4_000_000 };
const from = pointMm(0, 0);
const move: OrderIntent[] = [{ kind: 'move', to: pointMm(1000, 0) }];
const dest = (r: { intents: OrderIntent[] }) => (r.intents[0] as { to: { x: number } }).to.x;
const unitWith = (personality: Trait[]) => ({ center: from, personality });
const halt = (amount: number, intentStated = false): Interpretation => ({
  action: 'halt_short',
  amount,
  intentStated,
});
const exceed = (amount: number, intentStated = false): Interpretation => ({
  action: 'exceed',
  amount,
  intentStated,
});

describe('shapeIntents', () => {
  it('lets a cautious commander halt short, by no more than the limit', () => {
    const r = shapeIntents(unitWith(['cautious']), move, halt(0.2), 0, bounds);
    expect(dest(r)).toBe(800_000);
    expect(r.deviation).toEqual({ action: 'halt_short', metres: 200 });
    expect(dest(shapeIntents(unitWith(['cautious']), move, halt(0.9), 0, bounds))).toBe(
      1_000_000 * (1 - HALT_SHORT_MAX),
    );
  });

  it('lets an aggressive or initiative commander exceed, by no more than the limit', () => {
    for (const t of ['aggressive', 'initiative'] as const) {
      expect(dest(shapeIntents(unitWith([t]), move, exceed(100), 0, bounds))).toBe(1_100_000);
      expect(dest(shapeIntents(unitWith([t]), move, exceed(9999), 0, bounds))).toBe(
        1_000_000 + EXCEED_MAX_M * 1000,
      );
    }
  });

  it('ignores a deviation the traits do not allow, and a literal commander always', () => {
    expect(shapeIntents(unitWith(['aggressive']), move, halt(0.2), 0, bounds).intents).toBe(move);
    expect(shapeIntents(unitWith(['cautious']), move, exceed(100), 0, bounds).intents).toBe(move);
    expect(shapeIntents(unitWith([]), move, exceed(100), 0, bounds).intents).toBe(move);
    expect(
      shapeIntents(unitWith(['literal', 'aggressive']), move, exceed(100), 0, bounds).intents,
    ).toBe(move);
  });

  it('is rolled on the dice, and rarer and smaller when the order states its intent', () => {
    const u = unitWith(['aggressive']);
    expect(shapeIntents(u, move, exceed(100), 0.7, bounds).intents).toBe(move);
    expect(shapeIntents(u, move, exceed(100, true), 0.5, bounds).intents).toBe(move);
    expect(dest(shapeIntents(u, move, exceed(400, true), 0.1, bounds))).toBe(1_100_000);
    expect(dest(shapeIntents(unitWith(['cautious']), move, halt(0.4, true), 0.1, bounds))).toBe(
      900_000,
    );
  });

  it('keeps the destination on the map and refuses nonsense amounts', () => {
    const edge = { width: 1_050_000, height: 1_000_000 };
    expect(dest(shapeIntents(unitWith(['aggressive']), move, exceed(400), 0, edge))).toBe(
      1_050_000,
    );
    for (const amount of [NaN, -5, Infinity]) {
      const r = shapeIntents(unitWith(['aggressive']), move, exceed(amount), 0, bounds);
      expect(r.intents).toBe(move);
    }
  });
});

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** The same order to blue-1 with the commander given `personality`; where its march ends up. */
function run(personality: Trait[], interpretation?: Interpretation, seed = 1) {
  const g = { ...loadScenario(holdTheBridgeFarStart), seed };
  g.units = structuredClone(g.units);
  const u = g.units.find((x) => x.id === 'blue-1')!;
  u.personality = personality;
  let s: EngineState<GameState> = createState(g.seed, g, 0);
  s = issueOrder(s, {
    id: 'o1',
    side: 'blue',
    to: 'blue-1',
    issuedAt: 0,
    text: 'March to the ridge',
    intents: [{ kind: 'move', to: pointMm(1850, 1650) }],
    ...(interpretation ? { interpretation } : {}),
  });
  const r = advanceTo(s, 6 * 60 * 60_000, registry());
  const unit = r.state.world.units.find((x) => x.id === 'blue-1')!;
  return {
    y: unit.center.y,
    events: r.emitted.map((e) => e.type),
    world: r.state.world,
    rng: r.state.rng,
  };
}

describe('the same order, different commanders', () => {
  it('ends in different valid places', () => {
    // The first seed whose die falls under the deviation chance for the stated-nothing order.
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((n) =>
      run(['aggressive'], exceed(300), n).events.includes('order_interpreted'),
    )!;
    expect(seed).toBeDefined();
    const plain = run(['literal'], exceed(300), seed);
    const cautious = run(['cautious'], halt(0.3), seed);
    const bold = run(['aggressive'], exceed(300), seed);
    // Blue marches north (y falls): the cautious one stops short, the bold one goes past.
    expect(cautious.y).toBeGreaterThan(plain.y);
    expect(bold.y).toBeLessThan(plain.y);
    expect(plain.events).not.toContain('order_interpreted');
    // The run is reproducible from the seed.
    const roll = run(['aggressive'], exceed(300), seed);
    expect(roll.y).toBe(bold.y);
  });

  it('draws one die whatever the traits, so later rolls do not depend on them', () => {
    const a = run(['literal'], exceed(300)).rng;
    const b = run(['aggressive'], exceed(300)).rng;
    expect(a).toEqual(b);
  });

  it('never shows the traits in a side view', () => {
    const w = run(['initiative'], exceed(300)).world;
    const json = JSON.stringify([viewFor(w, 'blue'), viewFor(w, 'red')]);
    expect(json).not.toContain('personality');
    expect(json).not.toContain('initiative');
  });
});
