import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  COMBAT_TICK_MS,
  EventRegistry,
  MS_PER_MINUTE,
  RALLY_RULES,
  STANDING_EVENT,
  TURN_EVENT,
  advanceTo,
  beginTurn,
  createState,
  issueAttack,
  issueMove,
  issueOrder,
  issuePlacement,
  issueTurn,
  metres,
  overlapsBeyondTolerance,
  positionAt,
  registerCombat,
  registerMovement,
  registerOrders,
  registerPlacement,
  registerTurn,
  registerVisibility,
  startGame,
  startVisibility,
  validateProposal,
  viewFor,
  type EngineState,
  type AppliedOutcome,
  type GameState,
  type TurnContext,
  type TurnProposal,
  type TurnRuling,
  type TurnUnitOutcome,
  type Unit,
} from './index.js';
import { bridge, miniWorld, river, wood } from './scenario.testkit.js';
import { violations } from './invariants.testkit.js';
import { RALLY_EVENT } from './contact.js';
import { schedule } from './queue.js';

const TURN_MS = 20 * MS_PER_MINUTE;
const T0 = 0;
const T1 = TURN_MS;
const ctx = (over: Partial<TurnContext> = {}): TurnContext => ({
  turn: { n: 1, startMs: T0, endMs: T1 },
  dial: 'free',
  ...over,
});

/** Blue `a` and `b` side by side north of a river; red `c` far east; a wood in the middle. */
const world = (): GameState => {
  const w = miniWorld({
    width: 6000,
    height: 4000,
    features: [
      river('rv', 100, [0, 2000], [6000, 2000]),
      bridge('b', 3000, 2000, 110),
      wood('wd', 2500, 300, 3500, 900),
    ],
    units: [
      { id: 'a', x: 1000, y: 600 },
      { id: 'b', x: 1300, y: 600 },
      { id: 'c', side: 'red', x: 5000, y: 600 },
    ],
  });
  // Far from the time limit, so no turn here ends the game unless a test says so.
  return { ...w, victory: { ...w.victory, holdMs: 10 * 60 * MS_PER_MINUTE } };
};

const unit = (w: GameState, id: string) => w.units.find((u) => u.id === id)!;

/** The outcome that says "nothing happened" for `u`. */
function still(u: Unit): TurnUnitOutcome {
  return {
    unitId: u.id,
    x: metres(u.center.x),
    y: metres(u.center.y),
    facingDeg: (u.facing * 180) / Math.PI,
    formation: u.formation,
    strength: u.strength,
    morale: u.morale,
    status: u.status === 'withdrawn' ? 'broken' : 'active',
    continuing: { kind: 'idle' },
    orders: [],
    account: 'Stood fast.',
  };
}

function proposal(
  w: GameState,
  patch: Record<string, Partial<TurnUnitOutcome>> = {},
  rest: Partial<TurnProposal> = {},
): TurnProposal {
  return {
    turn: 1,
    units: w.units
      .filter((u) => u.status !== 'destroyed')
      .map((u) => ({ ...still(u), ...(patch[u.id] ?? {}) })),
    observations: [],
    summary: 'A quiet turn.',
    ...rest,
  };
}

function registry(): EventRegistry<GameState> {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerPlacement(r);
  registerVisibility(r);
  registerTurn(r);
  return r;
}

/** Start the game, hold turn 1 under the umpire, queue the proposal and advance to its end. */
function play(w: GameState, p: TurnProposal, c: TurnContext = ctx()) {
  let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
  s = beginTurn(s, { ...c.turn, adjudicator: 'umpire' });
  s = issueTurn(s, { proposal: p, context: c });
  return advanceTo(s, T1, registry());
}

/** The unit as an outcome leaves it on the ground, for overlap checks. */
function standing(w: GameState, o: AppliedOutcome): Unit {
  const u = unit(w, o.unitId);
  const placed: Unit = { ...u, center: o.center, facing: o.facing, formation: o.formation };
  placed.footprint = o.footprint;
  if (o.shape) placed.shape = o.shape;
  else delete placed.shape;
  return placed;
}

/** Every pair of friends whose outcomes overlap beyond the tolerance. */
function friendlyOverlaps(w: GameState, outcomes: AppliedOutcome[]): string[] {
  const on = outcomes.filter((o) => o.status !== 'destroyed').map((o) => standing(w, o));
  const bad: string[] = [];
  for (const [i, a] of on.entries()) {
    for (const b of on.slice(i + 1)) {
      if (a.side === b.side && overlapsBeyondTolerance(a, b)) bad.push(`${a.id}/${b.id}`);
    }
  }
  return bad;
}

const turnRulings = (w: GameState) =>
  w.rulings.filter((r): r is TurnRuling => 'kind' in r && r.kind === 'turn');

describe('validateProposal', () => {
  it('accepts a proposal inside every limit and changes nothing in place', () => {
    const w = world();
    const before = JSON.stringify(w);
    const v = validateProposal(w, proposal(w, { a: { x: 1500, y: 900 } }), ctx());
    expect(v.fatal).toBeUndefined();
    expect(v.problems).toEqual([]);
    expect(v.corrections).toEqual([]);
    expect(v.outcomes.find((o) => o.unitId === 'a')!.center).toEqual({ x: 1_500_000, y: 900_000 });
    expect(JSON.stringify(w)).toBe(before);
  });

  it('clamps a move farther than the unit can march in the turn to the reachable point', () => {
    const w = world();
    // 4 km across open ground in 20 minutes is beyond infantry.
    const v = validateProposal(w, proposal(w, { a: { x: 1000, y: 1400 }, b: {} }), ctx());
    const near = validateProposal(w, proposal(w, { a: { x: 5000, y: 1400 } }), ctx());
    expect(v.corrections).toEqual([]);
    const a = near.outcomes.find((o) => o.unitId === 'a')!;
    const from = unit(w, 'a').center;
    const moved = Math.hypot(a.center.x - from.x, a.center.y - from.y);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(4_000_000);
    expect(near.corrections).toMatchObject([
      { unitId: 'a', field: 'position', proposed: { x: 5000, y: 1400 }, clamp: true },
    ]);
    expect(near.corrections[0]!.reason).toMatch(/clamped to the reachable point: too far/);
    expect(near.problems[0]).toMatch(/^a: clamped/);
  });

  it('refuses an end position on impassable ground and keeps the unit where it started', () => {
    const w = world();
    const v = validateProposal(w, proposal(w, { a: { x: 1000, y: 2000 } }), ctx());
    expect(v.outcomes.find((o) => o.unitId === 'a')!.center).toEqual(unit(w, 'a').center);
    expect(v.corrections[0]).toMatchObject({ unitId: 'a', field: 'position' });
    expect(v.corrections[0]!.reason).toMatch(/refused: .*impassable/);
  });

  it('counts overlap with a friendly end position only, not with the enemy', () => {
    const w = world();
    // `a` onto where `b` stays: friendly overlap.
    const onFriend = validateProposal(w, proposal(w, { a: { x: 1300, y: 600 } }), ctx());
    expect(onFriend.corrections[0]!.reason).toMatch(/overlaps unit "b"/);
    // `a` onto where `b` stood, `b` moving away: no overlap at the turn's end.
    const swapped = validateProposal(
      w,
      proposal(w, { a: { x: 1300, y: 600 }, b: { x: 1600, y: 600 } }),
      ctx(),
    );
    expect(swapped.corrections).toEqual([]);
    // Red `c` met in melee by `b`: opposing units may overlap.
    const near = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 900, y: 500 },
      ],
    });
    const melee = validateProposal(near, proposal(near, { a: { x: 890, y: 500 } }), ctx());
    expect(melee.corrections).toEqual([]);
  });

  it('puts back a friend whose end position overlaps a unit that could not move', () => {
    const w = world();
    // `a` is refused (river) and stays; `b` wanted `a`'s old spot, so it goes back too.
    const v = validateProposal(
      w,
      proposal(w, { a: { x: 1000, y: 2000 }, b: { x: 1000, y: 600 } }),
      ctx(),
    );
    expect(v.outcomes.find((o) => o.unitId === 'b')!.center).toEqual(unit(w, 'b').center);
    expect(v.corrections.map((c) => [c.unitId, c.field])).toEqual([
      ['a', 'position'],
      ['b', 'position'],
    ]);
    expect(v.corrections[1]!.reason).toMatch(/put back .* overlaps a/);
    // The other way round: `b` is refused, `a` wanted `b`'s old spot.
    const w2 = validateProposal(
      w,
      proposal(w, { a: { x: 1300, y: 600 }, b: { x: 1300, y: 2000 } }),
      ctx(),
    );
    expect(w2.outcomes.find((o) => o.unitId === 'a')!.center).toEqual(unit(w, 'a').center);
    expect(w2.corrections.at(-1)).toMatchObject({ unitId: 'a', field: 'position' });
    expect(w2.corrections.at(-1)!.reason).toMatch(/put back .* overlaps b/);
  });

  it('clamps losses above strength and strength that rises; none left is destroyed', () => {
    const w = world();
    const c = unit(w, 'c');
    // Bring the red unit into reach so losses are possible.
    const near = {
      ...w,
      units: w.units.map((u) =>
        u.id === 'c' ? { ...c, center: { x: 1_600_000, y: 600_000 } } : u,
      ),
    };
    const v = validateProposal(
      near,
      proposal(near, { a: { strength: 900 }, b: { strength: -50 } }),
      ctx(),
    );
    const a = v.outcomes.find((o) => o.unitId === 'a')!;
    const b = v.outcomes.find((o) => o.unitId === 'b')!;
    expect(a.strength).toBe(unit(w, 'a').strength);
    expect(b.strength).toBe(0);
    expect(b.status).toBe('destroyed');
    expect(v.corrections.map((x) => [x.unitId, x.field])).toEqual([
      ['a', 'strength'],
      ['b', 'strength'],
      ['b', 'status'],
    ]);
  });

  it('allows no combat loss to a unit no enemy could reach in the turn', () => {
    const w = miniWorld({
      width: 30_000,
      height: 4000,
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 29_000, y: 500 },
      ],
    });
    const v = validateProposal(
      w,
      proposal(w, { a: { strength: 300, status: 'destroyed' } }),
      ctx(),
    );
    const a = v.outcomes.find((o) => o.unitId === 'a')!;
    expect(a.strength).toBe(unit(w, 'a').strength);
    expect(a.status).toBe('active');
    expect(v.corrections[0]!.reason).toMatch(/no enemy could reach it/);
    // The projection's own loss (attrition the engine worked out) is the floor instead.
    const projected = w.units.map((u) => (u.id === 'a' ? { ...u, strength: 420 } : u));
    const p = validateProposal(
      w,
      proposal(w, { a: { strength: 300 } }),
      ctx({ projection: projected }),
    );
    expect(p.outcomes.find((o) => o.unitId === 'a')!.strength).toBe(420);
  });

  it('keeps morale, fatigue and ammunition in 0..100 and ammunition from rising', () => {
    const w = world();
    const v = validateProposal(
      w,
      proposal(w, {
        a: { morale: 150, fatigue: -3, ammo: 100 },
        b: { morale: -10 },
      }),
      ctx(),
    );
    const a = v.outcomes.find((o) => o.unitId === 'a')!;
    expect([a.morale, a.fatigue]).toEqual([100, 0]);
    expect(a.ammo).toBe(unit(w, 'a').ammo);
    expect(v.outcomes.find((o) => o.unitId === 'b')!.morale).toBe(0);
    const projected = w.units.map((u) => (u.id === 'a' ? { ...u, ammo: 90 } : u));
    const lowAmmo = { ...w, units: w.units.map((u) => (u.id === 'a' ? { ...u, ammo: 50 } : u)) };
    const resupplied = validateProposal(
      lowAmmo,
      proposal(lowAmmo, { a: { ammo: 95 } }),
      ctx({ projection: projected }),
    );
    expect(resupplied.outcomes.find((o) => o.unitId === 'a')!.ammo).toBe(90);
  });

  it('refuses to bring back a destroyed unit', () => {
    const w = world();
    const dead = {
      ...w,
      units: w.units.map((u) =>
        u.id === 'b' ? { ...u, status: 'destroyed' as const, strength: 0 } : u,
      ),
    };
    const p = proposal(w); // still lists `b` as active
    const v = validateProposal(dead, p, ctx());
    expect(v.outcomes.map((o) => o.unitId)).toEqual(['a', 'c']);
    expect(v.corrections).toMatchObject([{ unitId: 'b', field: 'outcome', applied: null }]);
  });

  it('stores broken as withdrawn and captured as destroyed', () => {
    const w = world();
    const c = unit(w, 'c');
    const near = {
      ...w,
      units: w.units.map((u) =>
        u.id === 'c' ? { ...c, center: { x: 1_700_000, y: 600_000 } } : u,
      ),
    };
    const v = validateProposal(
      near,
      proposal(near, { a: { status: 'broken' }, b: { status: 'captured' } }),
      ctx(),
    );
    expect(v.outcomes.find((o) => o.unitId === 'a')).toMatchObject({
      status: 'withdrawn',
      broke: true,
    });
    expect(v.outcomes.find((o) => o.unitId === 'b')).toMatchObject({
      status: 'destroyed',
      strength: 0,
    });
    expect(v.corrections).toMatchObject([
      { unitId: 'b', field: 'status', applied: 'destroyed', clamp: false },
    ]);
    expect(v.problems).toEqual([]);
    expect(v.clampedUnits).toBe(0);
  });

  it('lets a broken unit rally only on a roll and under the rally rules', () => {
    const w = world();
    const broken = {
      ...w,
      startStrength: { a: 437, b: 437, c: 437 },
      units: w.units.map((u) =>
        u.id === 'a' ? { ...u, status: 'withdrawn' as const, brokenAt: 0 } : u,
      ),
    };
    const roll = { id: 'r1', why: 'rally', chance: 0.5, roll: 0.2, success: true };
    const noRoll = validateProposal(broken, proposal(broken, { a: { status: 'active' } }), ctx());
    expect(noRoll.outcomes.find((o) => o.unitId === 'a')!.status).toBe('withdrawn');
    expect(noRoll.corrections[0]!.reason).toMatch(/a rally must rest on a roll/);
    const ok = validateProposal(
      broken,
      proposal(broken, { a: { status: 'active', rollIds: ['r1'] } }),
      ctx({ rolls: [roll] }),
    );
    expect(ok.outcomes.find((o) => o.unitId === 'a')).toMatchObject({
      status: 'active',
      rallied: true,
    });
    // Too late: past the give-up time.
    const late = {
      ...broken,
      units: broken.units.map((u) =>
        u.id === 'a' ? { ...u, brokenAt: -RALLY_RULES.giveUpMs } : u,
      ),
    };
    const tooLate = validateProposal(
      late,
      proposal(late, { a: { status: 'active', rollIds: ['r1'] } }),
      ctx({ rolls: [roll] }),
    );
    expect(tooLate.outcomes.find((o) => o.unitId === 'a')!.status).toBe('withdrawn');
  });

  it('drops an observation of an enemy the side could not see', () => {
    const w = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'b', x: 500, y: 1500 },
        { id: 'c', side: 'red', x: 2500, y: 500 },
      ],
    });
    const v = validateProposal(
      w,
      proposal(
        w,
        { c: { x: 1000, y: 500 } },
        {
          observations: [
            // `c` is 2 km from `a` at the start, 500 m at the end.
            { side: 'blue', unitId: 'c', by: 'a', when: 'start' },
            { side: 'blue', unitId: 'c', by: 'a', when: 'end' },
            // `b` is too far at either end.
            { side: 'blue', unitId: 'c', by: 'b', when: 'end' },
            // Not blue's own unit, and not an enemy.
            { side: 'blue', unitId: 'a', by: 'c', when: 'end' },
            { side: 'blue', unitId: 'b', by: 'a', when: 'end' },
          ],
        },
      ),
      ctx(),
    );
    expect(v.observations).toEqual([{ side: 'blue', unitId: 'c', by: 'a', when: 'end' }]);
    expect(v.corrections.filter((c) => c.field === 'observation').map((c) => c.reason)).toEqual([
      "observation dropped: a could not see c at the turn's start",
      "observation dropped: b could not see c at the turn's end",
      'observation dropped: c is not a unit of blue',
      'observation dropped: b is not an enemy of blue',
    ]);
  });

  it('keeps an observation the engine agrees with, at the end it names', () => {
    const w = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 1000, y: 500 },
      ],
    });
    const v = validateProposal(
      w,
      proposal(w, {}, { observations: [{ side: 'blue', unitId: 'c', by: 'a', when: 'start' }] }),
      ctx(),
    );
    expect(v.observations).toEqual([{ side: 'blue', unitId: 'c', by: 'a', when: 'start' }]);
    expect(v.corrections).toEqual([]);
  });

  it('marks an order the unit had not received as not-arrived, and only then', () => {
    const w = world();
    const orders = [
      { orderId: 'o1', unitId: 'a', deliveredAt: 5 * MS_PER_MINUTE },
      { orderId: 'o2', unitId: 'a' },
      { orderId: 'o3', unitId: 'b', deliveredAt: 0 },
    ];
    const v = validateProposal(
      w,
      proposal(w, {
        a: {
          orders: [
            { orderId: 'o1', result: 'not-arrived' },
            { orderId: 'o2', result: 'carried-out' },
            { orderId: 'o3', result: 'carried-out' },
          ],
        },
      }),
      ctx({ orders }),
    );
    expect(v.outcomes.find((o) => o.unitId === 'a')!.orders).toEqual([
      { orderId: 'o1', result: 'refused' },
      { orderId: 'o2', result: 'not-arrived' },
    ]);
    expect(v.corrections.map((c) => c.field)).toEqual(['orders', 'orders', 'orders']);
  });

  it('under standard, holds an unexplained departure from the projection to the projection', () => {
    const w = world();
    const projected = w.units.map((u) =>
      u.id === 'a' ? { ...u, center: { x: 1_200_000, y: 700_000 } } : u,
    );
    const p = proposal(w, { a: { x: 1600, y: 900 } });
    const std = validateProposal(w, p, ctx({ dial: 'standard', projection: projected }));
    expect(std.outcomes.find((o) => o.unitId === 'a')!.center).toEqual({
      x: 1_200_000,
      y: 700_000,
    });
    expect(std.corrections[0]).toMatchObject({ unitId: 'a', field: 'departure' });
    const why = proposal(w, { a: { x: 1600, y: 900, departure: 'The colonel pushed on.' } });
    const explained = validateProposal(w, why, ctx({ dial: 'standard', projection: projected }));
    expect(explained.corrections).toEqual([]);
    expect(
      validateProposal(w, p, ctx({ dial: 'free', projection: projected })).corrections,
    ).toEqual([]);
  });

  it('fills in a missing unit and drops an unknown or repeated one', () => {
    const w = world();
    const p = proposal(w);
    const v = validateProposal(
      w,
      { ...p, units: [p.units[0]!, p.units[0]!, { ...p.units[1]!, unitId: 'zz' }, p.units[2]!] },
      ctx(),
    );
    expect(v.outcomes.map((o) => o.unitId)).toEqual(['a', 'b', 'c']);
    expect(v.problems.join('\n')).toMatch(/zz: no such unit/);
    expect(v.problems.join('\n')).toMatch(/a: more than one outcome/);
    expect(v.problems.join('\n')).toMatch(/b: no outcome was given/);
  });

  it('never leaves two clamped friends on the same ground', () => {
    // Two converging marches, both too far: each is clamped towards the other.
    const w = miniWorld({
      width: 9000,
      height: 3000,
      units: [
        { id: 'a', x: 1000, y: 1000 },
        { id: 'b', x: 5000, y: 1000 },
        { id: 'c', side: 'red', x: 8500, y: 2500 },
      ],
    });
    const v = validateProposal(
      w,
      proposal(w, { a: { x: 7000, y: 1000 }, b: { x: 300, y: 1000 } }),
      ctx(),
    );
    expect(friendlyOverlaps(w, v.outcomes)).toEqual([]);
    // `a` keeps its clamped march; `b`, later in unit-id order, goes back where it started.
    expect(v.outcomes.find((o) => o.unitId === 'a')!.center.x).toBeGreaterThan(1_000_000);
    expect(v.outcomes.find((o) => o.unitId === 'b')!.center).toEqual(unit(w, 'b').center);
    expect(v.corrections.at(-1)).toMatchObject({ unitId: 'b', field: 'position' });
    expect(v.corrections.at(-1)!.reason).toMatch(/put back where it started: .* overlaps a/);
  });

  it('puts back a friend that marched onto a unit the out-of-reach rule kept alive', () => {
    const w = miniWorld({
      width: 30_000,
      height: 4000,
      units: [
        { id: 'a', x: 1000, y: 1000 },
        { id: 'b', x: 1500, y: 1000 },
        { id: 'c', side: 'red', x: 29_000, y: 1000 },
      ],
    });
    // `a` is proposed destroyed with no enemy in reach, and `b` onto `a`'s spot.
    const v = validateProposal(
      w,
      proposal(w, { a: { status: 'destroyed', strength: 0 }, b: { x: 1000, y: 1000 } }),
      ctx(),
    );
    expect(v.outcomes.find((o) => o.unitId === 'a')).toMatchObject({
      status: 'active',
      center: unit(w, 'a').center,
    });
    expect(v.outcomes.find((o) => o.unitId === 'b')!.center).toEqual(unit(w, 'b').center);
    expect(friendlyOverlaps(w, v.outcomes)).toEqual([]);
    expect(
      v.corrections.some((c) => c.unitId === 'b' && /put back .* overlaps a/.test(c.reason)),
    ).toBe(true);
  });

  it('reads the projection at the turn end for a unit still on the march', () => {
    const w = world();
    const a = unit(w, 'a');
    // In the projection `a` is part-way along a leg at the turn's end; `center` is still its start.
    const to = { x: 2_000_000, y: 600_000 };
    const marching: Unit = {
      ...a,
      intent: { kind: 'move', to, startedAt: T0 },
      leg: { from: a.center, to, startedAt: T0, arriveAt: 3 * T1 },
    };
    const projected = w.units.map((u) => (u.id === 'a' ? marching : u));
    const at = positionAt(w.map, marching, T1);
    expect(at.x).toBeGreaterThan(a.center.x);
    // A unit with no outcome takes the projection's position at the turn's end.
    const p = proposal(w);
    const missing = { ...p, units: p.units.filter((o) => o.unitId !== 'a') };
    const filled = validateProposal(w, missing, ctx({ projection: projected }));
    expect(filled.outcomes.find((o) => o.unitId === 'a')!.center).toEqual(at);
    // Under `standard`, proposing exactly that point is no departure.
    const there = proposal(w, { a: { x: metres(at.x), y: metres(at.y) } });
    const std = validateProposal(w, there, ctx({ dial: 'standard', projection: projected }));
    expect(std.corrections).toEqual([]);
  });

  it('drops an end observation of an enemy destroyed in the turn', () => {
    const w = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 1000, y: 500 },
      ],
    });
    const v = validateProposal(
      w,
      proposal(
        w,
        { c: { status: 'destroyed', strength: 0 } },
        { observations: [{ side: 'blue', unitId: 'c', by: 'a', when: 'end' }] },
      ),
      ctx(),
    );
    expect(v.observations).toEqual([]);
    expect(v.corrections.map((c) => c.reason)).toEqual(['observation dropped: c was gone']);
  });

  it('counts only clamped unit outcomes toward the fallback', () => {
    const w = world();
    const dead = {
      ...w,
      units: w.units.map((u) =>
        u.id === 'b' ? { ...u, status: 'destroyed' as const, strength: 0 } : u,
      ),
    };
    // A stale outcome for `b` (destroyed before the turn), a sighting `a` could not make and one
    // by a unit that does not exist: all dropped, none a clamped unit.
    const v = validateProposal(
      dead,
      proposal(
        w,
        {},
        {
          observations: [
            { side: 'blue', unitId: 'c', by: 'a', when: 'end' },
            { side: 'blue', unitId: 'c', by: 'zz', when: 'end' },
          ],
        },
      ),
      ctx(),
    );
    expect(v.corrections.map((c) => c.field)).toEqual(['outcome', 'observation', 'observation']);
    expect(v.clampedUnits).toBe(0);
    expect(v.units).toBe(2);
  });

  it("lets a broken unit rally on the projection's own roll", () => {
    const w = world();
    const broken = {
      ...w,
      startStrength: { a: 437, b: 437, c: 437 },
      units: w.units.map((u) =>
        u.id === 'a' ? { ...u, status: 'withdrawn' as const, brokenAt: 0 } : u,
      ),
    };
    // The engine rallied `a` in the projection; the umpire leaves `a` to it.
    const projected = broken.units.map((u) =>
      u.id === 'a' ? { ...u, status: 'active' as const } : u,
    );
    const p = proposal(broken);
    const left = { ...p, units: p.units.filter((o) => o.unitId !== 'a') };
    const v = validateProposal(broken, left, ctx({ projection: projected }));
    expect(v.outcomes.find((o) => o.unitId === 'a')).toMatchObject({
      status: 'active',
      rallied: true,
    });
    expect(v.corrections.map((c) => c.reason)).toEqual(['no outcome was given for the unit']);
  });

  it('refuses a proposal for another turn', () => {
    const w = world();
    const v = validateProposal(w, { ...proposal(w), turn: 2 }, ctx());
    expect(v.fatal).toMatch(/turn 2, not turn 1/);
    expect(v.outcomes).toEqual([]);
  });
});

describe('umpire.turn', () => {
  it('holds the world through the turn and applies the outcome at its end', () => {
    const w = world();
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    // An order issued in the held turn moves nothing.
    s = issueMove(s, 'b', { x: 2_000_000, y: 600_000 });
    const p = proposal(w, {
      a: { x: 1500, y: 900, continuing: { kind: 'move', x: 2000, y: 900 } },
      b: { continuing: { kind: 'hold' } },
    });
    s = issueTurn(s, { proposal: p, context: ctx() });
    const mid = advanceTo(s, T1 - 1, registry()).state.world;
    expect(unit(mid, 'a').center).toEqual(unit(w, 'a').center);
    expect(positionAt(mid.map, unit(mid, 'b'), T1 - 1)).toEqual(unit(w, 'b').center);
    const { state, emitted } = advanceTo(s, T1, registry());
    const end = state.world;
    expect(unit(end, 'a').center).toEqual({ x: 1_500_000, y: 900_000 });
    expect(unit(end, 'a').intent).toEqual({
      kind: 'move',
      to: { x: 2_000_000, y: 900_000 },
      startedAt: T1,
    });
    expect(unit(end, 'b').intent).toEqual({ kind: 'hold', at: unit(w, 'b').center });
    expect(unit(end, 'a').leg).toBeUndefined();
    // The flag stays until the next turn begins, so nothing else at the turn's end moves the world.
    expect(end.turn).toEqual({ n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    expect(emitted.find((e) => e.type === TURN_EVENT)?.payload).toEqual({
      turn: 1,
      rulings: [],
      clamped: 0,
    });
  });

  it('fights no combat in a held turn, and delivers orders without adopting them', () => {
    const base = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 700, y: 500 },
      ],
    });
    const w = { ...base, victory: { ...base.victory, holdMs: 10 * 60 * MS_PER_MINUTE } };
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    s = issueOrder(s, {
      id: 'o1',
      side: 'blue',
      to: 'a',
      issuedAt: 0,
      text: 'Hold where you are.',
      intents: [{ kind: 'move', to: { x: 600_000, y: 900_000 } }],
    });
    const held = advanceTo(s, T1 - 1, registry());
    expect(unit(held.state.world, 'a')).toMatchObject({ strength: 437, intent: { kind: 'idle' } });
    expect(unit(held.state.world, 'c').strength).toBe(437);
    expect(held.emitted.some((e) => e.type === 'order_delivered')).toBe(true);
    expect(held.emitted.some((e) => e.type === 'contact.begin')).toBe(false);
    expect(held.state.world.intel.blue.contacts).toEqual([]);
  });

  it('fires no standing order in a held turn, and keeps it for after the turn', () => {
    const w = world();
    const T20 = 20 * MS_PER_MINUTE;
    const T40 = 40 * MS_PER_MINUTE;
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = issueOrder(s, {
      id: 'o1',
      side: 'blue',
      to: 'a',
      issuedAt: 0,
      text: 'At half past, advance east.',
      intents: [
        {
          kind: 'at',
          gameTime: 30 * MS_PER_MINUTE,
          then: [{ kind: 'move', to: { x: 3_000_000, y: 600_000 } }],
        },
      ],
    });
    s = advanceTo(s, T20, registry()).state;
    const before = unit(s.world, 'a');
    expect(before.standing?.map((x) => x.trigger)).toEqual([
      { kind: 'timeReached', gameTime: 30 * MS_PER_MINUTE },
    ]);
    const c2 = ctx({ turn: { n: 2, startMs: T20, endMs: T40 } });
    s = beginTurn(s, { ...c2.turn, adjudicator: 'umpire' });
    s = issueTurn(s, { proposal: { ...proposal(s.world), turn: 2 }, context: c2 });
    const mid = advanceTo(s, T40 - 1, registry()).state;
    const a = unit(mid.world, 'a');
    expect(a.standing).toEqual(before.standing);
    expect(a.intent).toEqual(before.intent);
    expect(a.leg).toBeUndefined();
    expect(mid.queue.some((e) => e.type === STANDING_EVENT && e.time === T40 + 1)).toBe(true);
    // If the next turn is the engine's, the order fires just past the held turn.
    let after = advanceTo(s, T40, registry()).state;
    after = beginTurn(after, { n: 3, startMs: T40, endMs: T40 + T1, adjudicator: 'engine' });
    const fired = unit(advanceTo(after, T40 + 1, registry()).state.world, 'a');
    expect(fired.standing ?? []).toEqual([]);
    expect(fired.intent).toMatchObject({ kind: 'move', to: { x: 3_000_000, y: 600_000 } });
  });

  it('rolls no rally in a held turn but keeps the chain while the unit can still rally', () => {
    const w = world();
    const broken = {
      ...w,
      startStrength: { a: 437, b: 437, c: 437 },
      units: w.units.map((u) =>
        u.id === 'a' ? { ...u, status: 'withdrawn' as const, brokenAt: 0 } : u,
      ),
    };
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, broken, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    // A try for `a` (still broken) and a stale one for `b` (never broke) inside the turn.
    const at = 5 * MS_PER_MINUTE;
    s = schedule(s, [
      { time: at, type: RALLY_EVENT, payload: { unitId: 'a' } },
      { time: at, type: RALLY_EVENT, payload: { unitId: 'b' } },
    ]);
    const mid = advanceTo(s, at, registry()).state;
    expect(unit(mid.world, 'a')).toMatchObject({ status: 'withdrawn', brokenAt: 0 });
    expect(mid.rng).toEqual(s.rng);
    const tries = mid.queue
      .filter((e) => e.type === RALLY_EVENT)
      .map((e) => [(e.payload as { unitId: string }).unitId, e.time]);
    expect(tries).toEqual([['a', at + RALLY_RULES.retryMs]]);
  });

  it('runs no supply tick in a held turn', () => {
    const w = world();
    const tired = {
      ...w,
      units: w.units.map((u) => (u.id === 'a' ? { ...u, fatigue: 60, morale: 50, ammo: 40 } : u)),
    };
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, tired, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    // The first supply tick (at 10 minutes) falls inside the turn.
    const mid = advanceTo(s, T1 - 1, registry()).state;
    expect(unit(mid.world, 'a')).toMatchObject({ fatigue: 60, morale: 50, ammo: 40 });
    expect(mid.queue.some((e) => e.type === 'supply.tick' && e.time > T1 - 1)).toBe(true);
  });

  it('adopts no attack in a held turn', () => {
    const w = world();
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    s = issueAttack(s, 'a', 'c', MS_PER_MINUTE);
    const mid = advanceTo(s, T1 - 1, registry());
    expect(unit(mid.state.world, 'a').intent).toEqual({ kind: 'idle' });
    expect(unit(mid.state.world, 'a').leg).toBeUndefined();
  });

  it("re-checks contact just past the turn when the next turn is the engine's", () => {
    // `a` and `c` end the turn in contact, and nobody moves.
    const base = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 700, y: 500 },
      ],
    });
    const w = { ...base, victory: { ...base.victory, holdMs: 10 * 60 * MS_PER_MINUTE } };
    const ended = play(w, proposal(w)).state;
    expect(ended.world.combatActive).toBe(false);
    const next = beginTurn(ended, { n: 2, startMs: T1, endMs: 2 * T1, adjudicator: 'engine' });
    const { state, emitted } = advanceTo(next, T1 + COMBAT_TICK_MS, registry());
    expect(emitted.some((e) => e.type === 'contact.begin')).toBe(true);
    expect(state.world.combatActive).toBe(true);
    // A held next turn ignores it.
    const heldNext = beginTurn(ended, { n: 2, startMs: T1, endMs: 2 * T1, adjudicator: 'umpire' });
    const held = advanceTo(heldNext, T1 + COMBAT_TICK_MS, registry());
    expect(held.emitted.some((e) => e.type === 'contact.begin')).toBe(false);
  });

  it("sets off a march the umpire left under way when the next turn is the engine's", () => {
    const w = world();
    const p = proposal(w, { a: { continuing: { kind: 'move', x: 2000, y: 600 } } });
    const ended = play(w, p).state;
    const next = beginTurn(ended, { n: 2, startMs: T1, endMs: 2 * T1, adjudicator: 'engine' });
    const marched = advanceTo(next, T1 + 5 * MS_PER_MINUTE, registry()).state;
    const a = unit(marched.world, 'a');
    expect(positionAt(marched.world.map, a, marched.time).x).toBeGreaterThan(1_000_000);
    // A held next turn leaves it where the umpire put it.
    const heldNext = beginTurn(ended, { n: 2, startMs: T1, endMs: 2 * T1, adjudicator: 'umpire' });
    const held = advanceTo(heldNext, T1 + 5 * MS_PER_MINUTE, registry()).state;
    expect(positionAt(held.world.map, unit(held.world, 'a'), held.time)).toEqual(
      unit(w, 'a').center,
    );
  });

  it('applies no umpire placement in a held turn', () => {
    const w = world();
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = beginTurn(s, { n: 1, startMs: T0, endMs: T1, adjudicator: 'umpire' });
    s = issuePlacement(
      s,
      {
        proposal: { unitId: 'a', center: { x: 1_100_000, y: 700_000 }, elapsedMs: TURN_MS },
        rationale: 'r',
        narrative: 'n',
      },
      MS_PER_MINUTE,
    );
    const mid = advanceTo(s, T1 - 1, registry()).state.world;
    expect(unit(mid, 'a').center).toEqual(unit(w, 'a').center);
    expect(mid.rulings).toEqual([]);
  });

  it('records one ruling per correction, with the reason', () => {
    const w = world();
    const end = play(w, proposal(w, { a: { morale: 140 } })).state.world;
    expect(turnRulings(end)).toMatchObject([
      {
        kind: 'turn',
        turn: 1,
        unitId: 'a',
        field: 'morale',
        proposed: 140,
        applied: 100,
        time: T1,
      },
    ]);
    expect(unit(end, 'a').morale).toBe(100);
  });

  it('writes the observations that stand into intel at the end they name', () => {
    const w = miniWorld({
      units: [
        { id: 'a', x: 500, y: 500 },
        { id: 'c', side: 'red', x: 1000, y: 500 },
      ],
    });
    const p = proposal(
      w,
      { c: { x: 1050, y: 500 } },
      {
        observations: [
          { side: 'blue', unitId: 'c', by: 'a', when: 'start' },
          { side: 'red', unitId: 'a', by: 'c', when: 'end' },
        ],
      },
    );
    const end = play(w, p).state.world;
    const blue = end.intel.blue.contacts.find((c) => c.id === 'c')!;
    const red = end.intel.red.contacts.find((c) => c.id === 'a')!;
    expect([blue.position, red.position]).toEqual([
      { x: 1_000_000, y: 500_000 },
      { x: 500_000, y: 500_000 },
    ]);
    expect(red.seenAt).toBe(T1);
    expect(end.intel.red.inSight).toEqual(['a']);
  });

  it('starts the rally chain for a unit that broke in the turn', () => {
    const w = world();
    const c = unit(w, 'c');
    const near = {
      ...w,
      units: w.units.map((u) =>
        u.id === 'c' ? { ...c, center: { x: 1_700_000, y: 600_000 } } : u,
      ),
    };
    const { state } = play(near, proposal(near, { a: { status: 'broken', morale: 10 } }));
    expect(unit(state.world, 'a')).toMatchObject({ status: 'withdrawn', brokenAt: T1 });
    expect(
      state.queue.some(
        (e) =>
          e.type === 'combat.rally' &&
          e.time === T1 + RALLY_RULES.firstTryMs &&
          (e.payload as { unitId: string }).unitId === 'a',
      ),
    ).toBe(true);
  });

  it('checks victory once at the turn end, the time limit included', () => {
    // A 10-minute limit: the turn ending at it ends the game, held for the defender.
    const base = world();
    const w = { ...base, victory: { ...base.victory, holdMs: 10 * MS_PER_MINUTE } };
    const c10 = ctx({ turn: { n: 1, startMs: 0, endMs: 10 * MS_PER_MINUTE } });
    let s: EngineState<GameState> = startGame(startVisibility(createState(w.seed, w, 0)));
    s = beginTurn(s, { ...c10.turn, adjudicator: 'umpire' });
    s = issueTurn(s, { proposal: proposal(w), context: c10 });
    const end = advanceTo(s, 10 * MS_PER_MINUTE, registry()).state.world;
    expect(end.outcome).toMatchObject({
      winner: 'blue',
      reason: 'objective-held',
      time: 10 * MS_PER_MINUTE,
    });
  });

  it('throws on a proposal for another turn rather than apply it', () => {
    const w = world();
    expect(() => play(w, { ...proposal(w), turn: 3 })).toThrow(/turn 3, not turn 1/);
  });

  it('is deterministic and replays from the logged proposal', () => {
    const w = world();
    const p = proposal(w, { a: { x: 5000, y: 1400, morale: 120 }, c: { x: 4000, y: 700 } });
    const once = play(w, p);
    const logged = JSON.parse(JSON.stringify(p)) as TurnProposal;
    const again = play(world(), logged);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(once.state));
    expect(again.emitted).toEqual(once.emitted);
  });

  it('leaves the world valid whatever the umpire proposes', () => {
    const w = world();
    const ids = new Set(w.units.map((u) => u.id));
    const outcome = fc.record({
      x: fc.double({ min: -1000, max: 7000, noNaN: true }),
      y: fc.double({ min: -1000, max: 5000, noNaN: true }),
      facingDeg: fc.double({ min: -720, max: 720, noNaN: true }),
      formation: fc.constantFrom('line', 'column', 'square', 'skirmish', 'loose' as const),
      strength: fc.double({ min: -500, max: 2000, noNaN: true }),
      morale: fc.double({ min: -200, max: 300, noNaN: true }),
      fatigue: fc.option(fc.double({ min: -200, max: 300, noNaN: true }), { nil: undefined }),
      ammo: fc.option(fc.double({ min: -200, max: 300, noNaN: true }), { nil: undefined }),
      status: fc.constantFrom('active', 'broken', 'destroyed', 'captured' as const),
    });
    fc.assert(
      fc.property(fc.tuple(outcome, outcome, outcome), fc.boolean(), ([oa, ob, oc], see) => {
        const patch: Record<string, Partial<TurnUnitOutcome>> = {};
        for (const [id, o] of [
          ['a', oa],
          ['b', ob],
          ['c', oc],
        ] as const) {
          const { fatigue, ammo, ...rest } = o;
          patch[id] = {
            ...rest,
            ...(fatigue !== undefined ? { fatigue } : {}),
            ...(ammo !== undefined ? { ammo } : {}),
          } as Partial<TurnUnitOutcome>;
        }
        const p = proposal(w, patch, {
          observations: see ? [{ side: 'blue', unitId: 'c', by: 'a', when: 'end' }] : [],
        });
        const { state } = play(w, p);
        const bad = violations(w, state.world, T1, ids);
        expect(bad).toEqual([]);
        // No two friends end on the same ground.
        const on = state.world.units.filter((u) => u.status !== 'destroyed');
        for (const [i, x] of on.entries()) {
          for (const y of on.slice(i + 1)) {
            if (x.side === y.side) expect(overlapsBeyondTolerance(x, y)).toBe(false);
          }
        }
        for (const u of state.world.units) {
          if (u.status === 'destroyed') continue;
          const from = unit(w, u.id).center;
          // March limit: no infantry covers more than ~4 km of open ground in 20 minutes.
          expect(Math.hypot(u.center.x - from.x, u.center.y - from.y)).toBeLessThan(4_000_000);
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("umpire.turn and the umpire's journal (11.8)", () => {
  const SECRET = 'JOURNAL-CANARY';
  it('records the turn’s note and precedents from the proposal, and no side sees them', () => {
    const w = world();
    const p = proposal(
      w,
      {},
      {
        summary: `Blue’s line held ${SECRET} the river. Red waits for its guns.`,
        precedents: [`Cavalry cannot cross the river except at the bridge ${SECRET}.`],
      },
    );
    const { state, emitted } = play(w, p);
    expect(state.world.journal).toEqual({
      notes: [{ turn: 1, note: `Blue’s line held ${SECRET} the river. Red waits for its guns.` }],
      precedents: [
        { turn: 1, ruling: `Cavalry cannot cross the river except at the bridge ${SECRET}.` },
      ],
    });
    // Master state only: not in the emitted events (the window shows those after the game), nor
    // in any side's view.
    expect(JSON.stringify(emitted)).not.toContain(SECRET);
    for (const side of state.world.sides) {
      expect(JSON.stringify(viewFor(state.world, side.id, T1))).not.toContain(SECRET);
    }
  });
});
