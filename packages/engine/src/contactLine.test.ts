import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_MINUTE,
  RULES_VERSION,
  advanceTo,
  courierPass,
  createState,
  distance,
  engineTurnStart,
  holdTheBridge,
  inMelee,
  issueAttack,
  issueMove,
  loadScenario,
  mm,
  overlapsBeyondTolerance,
  pointMm,
  positionAt,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  startGame,
  unitTypeOf,
  validateProposal,
  type EngineState,
  type GameState,
  type Order,
  type TurnContext,
  type TurnProposal,
  type TurnUnitOutcome,
  type Unit,
} from './index.js';
import { bearingTo, footprintGap } from './contact.js';
import { miniWorld } from './scenario.testkit.js';

const MIN = MS_PER_MINUTE;

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}
const reg = registry();

const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;

/** A scenario world at the current rules: the contact line is rules 5 (#446). */
const current = (w: GameState): GameState => ({ ...w, rules: RULES_VERSION });

/** Blue battalion at (500,1000) facing east; red battalion at (500,500) facing it. */
function headOn() {
  const w = current(
    miniWorld({
      units: [
        {
          id: 'blue-1',
          side: 'blue',
          x: 500,
          y: 1000,
          type: 'line_infantry',
          strength: 600,
          facingDeg: 90,
        },
        {
          id: 'red-1',
          side: 'red',
          x: 500,
          y: 500,
          type: 'line_infantry',
          strength: 600,
          facingDeg: 180,
        },
      ],
    }),
  );
  return startGame(createState(w.seed, w, 0));
}

describe('the contact line (#446)', () => {
  it('a battalion marching through an enemy battalion halts at the contact distance, facing it', () => {
    let s = headOn();
    s = issueMove(s, 'blue-1', pointMm(500, 100));
    const r = advanceTo(s, 6 * MIN, reg);
    const blue = unit(r.state, 'blue-1');
    const red = unit(r.state, 'red-1');
    // It stopped: no leg, no march intent, and it never reached its destination.
    expect(blue.leg).toBeUndefined();
    expect(blue.intent.kind).toBe('idle');
    expect(blue.center).not.toEqual(pointMm(500, 100));
    // It halted on the contact line for its type, still on its own side of the enemy.
    const contact = mm(unitTypeOf(blue).contactM);
    expect(Math.abs(distance(blue.center, red.center) - contact)).toBeLessThan(mm(2));
    expect(blue.center.y).toBeGreaterThan(red.center.y);
    // It faces the enemy it met.
    expect(Math.abs(blue.facing - bearingTo(blue.center, red.center))).toBeLessThan(1e-6);
    // And the two are in contact: combat has begun between them.
    expect(r.emitted.some((e) => e.type === 'contact.begin')).toBe(true);
  });

  it('a unit already inside the line may march away from the enemy', () => {
    const w = current(
      miniWorld({
        units: [
          { id: 'blue-1', side: 'blue', x: 500, y: 600, type: 'line_infantry', strength: 600 },
          {
            id: 'red-1',
            side: 'red',
            x: 500,
            y: 500,
            type: 'line_infantry',
            strength: 600,
            facingDeg: 180,
          },
        ],
      }),
    );
    let s = startGame(createState(w.seed, w, 0));
    s = issueMove(s, 'blue-1', pointMm(500, 1400));
    const r = advanceTo(s, 12 * MIN, reg);
    const blue = unit(r.state, 'blue-1');
    expect(blue.center).toEqual(pointMm(500, 1400));
    expect(blue.intent.kind).toBe('idle');
  });

  it('a march that passes wide of an enemy is not halted', () => {
    const w = current(
      miniWorld({
        units: [
          { id: 'blue-1', side: 'blue', x: 300, y: 1000, type: 'line_infantry', strength: 600 },
          {
            id: 'red-1',
            side: 'red',
            x: 500,
            y: 500,
            type: 'line_infantry',
            strength: 600,
            facingDeg: 180,
          },
        ],
      }),
    );
    let s = startGame(createState(w.seed, w, 0));
    s = issueMove(s, 'blue-1', pointMm(300, 100));
    const r = advanceTo(s, 12 * MIN, reg);
    expect(unit(r.state, 'blue-1').center).toEqual(pointMm(300, 100));
  });

  it('cavalry with a charge order closes to melee, past its firing range', () => {
    const w = current(
      miniWorld({
        units: [
          { id: 'blue-cav', side: 'blue', x: 500, y: 1200, type: 'cavalry', strength: 200 },
          {
            id: 'red-1',
            side: 'red',
            x: 500,
            y: 700,
            type: 'line_infantry',
            strength: 600,
            facingDeg: 180,
          },
        ],
      }),
    );
    let s = startGame(createState(w.seed, w, 0));
    s = issueAttack(s, 'blue-cav', 'red-1');
    const r = advanceTo(s, 4 * MIN, reg);
    const cav = unit(r.state, 'blue-cav');
    const red = unit(r.state, 'red-1');
    expect(cav.intent.kind).toBe('attack');
    expect(cav.leg).toBeUndefined();
    expect(distance(cav.center, red.center)).toBeLessThan(mm(unitTypeOf(cav).rangeM));
    expect(inMelee(cav, red)).toBe(true);
    expect(footprintGap(cav, red)).toBeGreaterThan(0);
  });

  it('an umpire turn never settles opposing footprints on top of each other', () => {
    const w = current(
      miniWorld({
        width: 6000,
        height: 4000,
        units: [
          { id: 'a', x: 1000, y: 600 },
          { id: 'c', side: 'red', x: 1300, y: 600 },
        ],
      }),
    );
    const world: GameState = { ...w, victory: { ...w.victory, holdMs: 10 * 60 * MIN } };
    const still = (u: Unit): TurnUnitOutcome => ({
      unitId: u.id,
      x: u.center.x / 1000,
      y: u.center.y / 1000,
      facingDeg: (u.facing * 180) / Math.PI,
      formation: u.formation,
      strength: u.strength,
      morale: u.morale,
      status: 'active',
      continuing: { kind: 'idle' },
      orders: [],
      account: 'Stood fast.',
    });
    // The umpire marches blue `a` east, straight onto red `c`'s ground.
    const proposal: TurnProposal = {
      turn: 1,
      units: world.units.map((u) =>
        u.id === 'a' ? { ...still(u), x: 1290, account: 'Marched east.' } : still(u),
      ),
      observations: [],
      summary: 'Blue advances.',
    };
    const ctx: TurnContext = { turn: { n: 1, startMs: 0, endMs: 20 * MIN }, dial: 'free' };
    const res = validateProposal(world, proposal, ctx);
    const a = res.outcomes.find((o) => o.unitId === 'a')!;
    const c = res.outcomes.find((o) => o.unitId === 'c')!;
    // The mover was put back where it started, with the reason recorded.
    expect(a.center).toEqual(pointMm(1000, 600));
    expect(res.corrections.some((x) => x.unitId === 'a' && /overlaps/.test(x.reason))).toBe(true);
    const au = world.units.find((u) => u.id === 'a')!;
    const cu = world.units.find((u) => u.id === 'c')!;
    expect(
      overlapsBeyondTolerance(
        { ...au, center: a.center, facing: a.facing, footprint: a.footprint },
        { ...cu, center: c.center, facing: c.facing, footprint: c.footprint },
      ),
    ).toBe(false);
  });

  it('no opposing footprints overlap at any turn end in a Hold the Bridge turn game', () => {
    const g = current(loadScenario(holdTheBridge));
    let s = createState(g.seed, g, 0);
    const orders: Order[] = [
      {
        id: 'r1',
        side: 'red',
        to: 'red-1',
        issuedAt: 0,
        text: 'March to the bridge and take it.',
        intents: [{ kind: 'move', to: pointMm(2050, 1500) }],
      },
      {
        id: 'r2',
        side: 'red',
        to: 'red-2',
        issuedAt: 0,
        text: 'March to the bridge and take it.',
        intents: [{ kind: 'move', to: pointMm(2050, 1500) }],
      },
    ];
    let closest = Infinity;
    for (let n = 1; n <= 3; n++) {
      const turn = { n, startMs: (n - 1) * 20 * MIN, endMs: n * 20 * MIN };
      const pass = courierPass(s, n === 1 ? orders : [], turn, reg);
      const r = advanceTo(engineTurnStart(s, n === 1 ? orders : [], pass, turn), turn.endMs, reg);
      s = r.state;
      const at = s.world.units.map((u) => ({
        ...u,
        center: positionAt(s.world.map, u, turn.endMs),
      }));
      for (const a of at) {
        for (const b of at) {
          if (a.side === b.side || a.id >= b.id) continue;
          expect(overlapsBeyondTolerance(a, b)).toBe(false);
          closest = Math.min(closest, distance(a.center, b.center));
        }
      }
    }
    // The armies really met: some opposing pair ended a turn within 250 m.
    expect(closest).toBeLessThan(mm(250));
  });
});
