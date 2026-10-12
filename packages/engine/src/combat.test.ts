import { describe, expect, it } from 'vitest';
import {
  BREAK_MORALE,
  CHARGE_M,
  LONG_RANGE_FACTOR,
  MELEE_FACTOR,
  inMelee,
  rangeFactor,
  COMBAT_TICK_MS,
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  canReach,
  createState,
  holdTheBridge,
  issueAttack,
  issueMove,
  loadScenario,
  pointMm,
  positionAt,
  registerCombat,
  registerMovement,
  serialize,
  startGame,
  type EmittedEvent,
  type EngineState,
  type GameState,
} from './index.js';
import { RALLY_EVENT } from './contact.js';
import { schedule } from './queue.js';
import { BATTLE_CLOSE_MS, forceBroken, evaluateVictory } from './combat.js';
import { viewFor } from './index.js';
import type { BattleRuling } from './types.js';
import { polygonCentroid } from './geometry.js';
import { river, wood } from './scenario.testkit.js';

type RawUnit = {
  id: string;
  side: 'blue' | 'red';
  kind?: 'infantry' | 'cavalry' | 'artillery';
  x: number;
  y: number;
  strength?: number;
  morale?: number;
  facingDeg?: number;
  formation?: 'line' | 'square';
};

/** Tile (x, y) of the old 100 m grid as the point at its centre, in mm. */
const T = (x: number, y: number) => pointMm(x * 100 + 50, y * 100 + 50);

/**
 * A 1000 x 500 m open field with the bridge (the objective) at tile (5,2) and a wood at
 * tile (7,1). Units are placed by tile (the centre of a 100 m square), which keeps the
 * numbers readable; `river` adds a river along x = 350 m that only the bridge side avoids.
 */
function field(
  rawUnits: RawUnit[],
  opts: { holdMinutes?: number; seed?: number; river?: boolean } = {},
) {
  const raw = {
    id: 'test',
    name: 'Test',
    seed: opts.seed ?? 7,
    map: {
      width: 1000,
      height: 500,
      features: [
        { id: 'bridge', kind: 'bridge', at: { x: 550, y: 250 }, radius: 40 },
        wood('wood', 700, 100, 800, 200),
        ...(opts.river ? [river('river', 100, [350, 0], [350, 500])] : []),
      ],
    },
    sides: [
      { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 5, y: 5 } },
      { id: 'red', name: 'Red', controller: 'scripted', hq: { x: 5, y: 495 } },
    ],
    units: rawUnits.map(({ x, y, ...u }) => ({
      name: u.id,
      kind: 'infantry',
      strength: 600,
      morale: 80,
      facingDeg: 0,
      ...u,
      at: { x: x * 100 + 50, y: y * 100 + 50 },
    })),
    victory: {
      objective: [
        [520, 220],
        [580, 220],
        [580, 280],
        [520, 280],
      ],
      defender: 'blue',
      attacker: 'red',
      holdMinutes: opts.holdMinutes ?? 180,
    },
  };
  const g = loadScenario(raw);
  return startGame(createState(g.seed, g, 0));
}

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  return r;
}

function run(state: EngineState<GameState>, minutes: number) {
  return advanceTo(state, state.time + minutes * MS_PER_MINUTE, registry());
}

const ofType = (events: EmittedEvent[], type: string) => events.filter((e) => e.type === type);
const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;

/** Two battalions facing off within infantry range, away from the objective. */
const duel: RawUnit[] = [
  { id: 'blue-1', side: 'blue', x: 1, y: 4 },
  { id: 'red-1', side: 'red', x: 2, y: 4 },
];

describe('contact and combat ticks', () => {
  it('does nothing while units are out of range', () => {
    const { state, emitted } = run(
      field([
        { id: 'blue-1', side: 'blue', x: 0, y: 4 },
        { id: 'red-1', side: 'red', x: 3, y: 4 },
      ]),
      30,
    );
    expect(emitted).toEqual([]);
    expect(state.world.combatActive).toBe(false);
  });

  it('starts at contact and then ticks every 2 game minutes', () => {
    const { emitted } = run(field(duel), 9);
    expect(ofType(emitted, 'contact.begin')).toHaveLength(1);
    const times = [...new Set(ofType(emitted, 'combat.fire').map((e) => e.time))];
    expect(times).toEqual([1, 2, 3, 4].map((n) => n * COMBAT_TICK_MS));
    // Both sides fire each tick.
    expect(ofType(emitted, 'combat.fire')).toHaveLength(8);
  });

  it('starts when a marching unit comes into range', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4 },
      { id: 'red-1', side: 'red', x: 4, y: 4 },
    ]);
    s = issueMove(s, 'red-1', T(2, 4));
    const { emitted } = run(s, 10);
    const begin = ofType(emitted, 'contact.begin')[0]!;
    expect(begin.time).toBe(2 * MS_PER_MINUTE); // two tiles in, distance 2
    expect(ofType(emitted, 'combat.fire')[0]!.time).toBe(2 * MS_PER_MINUTE + COMBAT_TICK_MS);
  });

  it('records each shot in a structured event', () => {
    const { emitted } = run(field(duel), 2);
    const fire = ofType(emitted, 'combat.fire')[0]!;
    expect(fire.payload).toEqual({
      attacker: 'blue-1',
      target: 'red-1',
      distance: 100,
      cover: 1,
      aspect: 'flank', // everyone in `field` faces north; the shot comes from the east
      melee: false,
      die: expect.any(Number),
      casualties: expect.any(Number),
      factors: expect.objectContaining({ aspect: 1.5, rout: 1, ammo: 1 }),
      targetStrength: expect.any(Number),
      targetMorale: expect.any(Number),
    });
  });

  it('takes fractional casualties and loses morale with them', () => {
    const { state } = run(field(duel), 2);
    const red = unit(state, 'red-1');
    expect(red.strength).toBeLessThan(600);
    expect(red.strength).toBeGreaterThan(560);
    expect(Number.isInteger(red.strength)).toBe(false);
    expect(red.morale).toBeLessThan(80);
  });

  it('gives targets in wood cover', () => {
    const { emitted } = run(
      field([
        { id: 'blue-1', side: 'blue', x: 7, y: 1 },
        { id: 'red-1', side: 'red', x: 7, y: 3 },
      ]),
      2,
    );
    const at = (target: string) =>
      ofType(emitted, 'combat.fire').find(
        (e) => (e.payload as { target: string }).target === target,
      )!;
    expect((at('blue-1').payload as { cover: number }).cover).toBe(0.5);
    expect((at('red-1').payload as { cover: number }).cover).toBe(1);
  });

  it('stops ticking when contact is lost, and restarts later', () => {
    let s = field(duel);
    s = issueMove(s, 'red-1', T(8, 4), MS_PER_MINUTE); // marches away after the first minute
    const a = run(s, 20);
    expect(ofType(a.emitted, 'contact.end')).toHaveLength(1);
    expect(a.state.world.combatActive).toBe(false);
    expect(a.state.queue.some((e) => e.type === 'combat.tick')).toBe(false);
  });
});

describe('determinism', () => {
  const battle = () => {
    let s = field(
      [
        { id: 'blue-1', side: 'blue', x: 0, y: 4 },
        { id: 'blue-2', side: 'blue', kind: 'artillery', x: 1, y: 3 },
        { id: 'red-1', side: 'red', x: 3, y: 4 },
        { id: 'red-2', side: 'red', kind: 'cavalry', x: 3, y: 2 },
      ],
      { seed: 99 },
    );
    s = issueAttack(s, 'red-1', 'blue-1');
    s = issueAttack(s, 'red-2', 'blue-2');
    return s;
  };

  it('same seed gives the same battle', () => {
    const a = run(battle(), 60);
    const b = run(battle(), 60);
    expect(a.emitted).toEqual(b.emitted);
    expect(serialize(a.state)).toBe(serialize(b.state));
  });

  it('a different seed gives a different battle', () => {
    const other = field(
      [
        { id: 'blue-1', side: 'blue', x: 1, y: 4 },
        { id: 'red-1', side: 'red', x: 2, y: 4 },
      ],
      { seed: 1 },
    );
    const a = run(field(duel, { seed: 2 }), 20);
    const b = run(other, 20);
    expect(a.emitted).not.toEqual(b.emitted);
  });

  it('is the same however the clock is chunked, and never mutates its input', () => {
    const start = battle();
    const frozen = serialize(start);
    const whole = run(start, 60);
    expect(serialize(start)).toBe(frozen);
    let s = start;
    const emitted: EmittedEvent[] = [];
    for (let m = 1; m <= 60; m++) {
      const r = advanceTo(s, m * MS_PER_MINUTE, registry());
      s = r.state;
      emitted.push(...r.emitted);
    }
    expect(emitted).toEqual(whole.emitted);
    expect(serialize(s)).toBe(serialize(whole.state));
  });
});

describe('attack orders', () => {
  it('closes on the target and fights it', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4 },
      { id: 'red-1', side: 'red', x: 6, y: 4 },
    ]);
    s = issueAttack(s, 'red-1', 'blue-1');
    const { state, emitted } = run(s, 12);
    expect(unit(state, 'red-1').center).toEqual(T(2, 4)); // stops at infantry range
    expect(ofType(emitted, 'contact.begin')).toHaveLength(1);
    expect(unit(state, 'blue-1').strength).toBeLessThan(600);
  });

  it('chases a target that moves', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4 },
      { id: 'red-1', side: 'red', x: 9, y: 4 },
    ]);
    s = issueMove(s, 'blue-1', T(1, 0));
    s = issueAttack(s, 'red-1', 'blue-1');
    const { state } = run(s, 12);
    expect(unit(state, 'red-1').center.y).toBeLessThan(T(0, 4).y);
  });

  it('follows a target that walks away after contact was made', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4 },
      { id: 'red-1', side: 'red', x: 6, y: 4 },
    ]);
    s = issueAttack(s, 'red-1', 'blue-1');
    const stopped = run(s, 12);
    expect(unit(stopped.state, 'red-1').center).toEqual(T(2, 4));
    expect(ofType(stopped.emitted, 'contact.begin')).toHaveLength(1);
    // Blue now marches off; red must give chase and keep up.
    const moved = run(issueMove(stopped.state, 'blue-1', T(0, 0)), 5);
    expect(unit(moved.state, 'red-1').center.y).toBeLessThan(T(0, 4).y);
    expect(unit(moved.state, 'red-1').intent.kind).toBe('attack');
    // It keeps up: still in reach of blue at the end, and still firing.
    expect(canReach(unit(moved.state, 'red-1'), unit(moved.state, 'blue-1'))).toBe(true);
    expect(ofType(moved.emitted, 'combat.fire').length).toBeGreaterThan(0);
  });

  it('gives up on a target it cannot path to instead of looping', () => {
    // A river along x = 350 m splits the map; the bridge is on the east bank, so nothing crosses.
    let s = field(
      [
        { id: 'blue-1', side: 'blue', x: 4, y: 2 },
        { id: 'red-1', side: 'red', x: 2, y: 2 },
      ],
      { river: true },
    );
    s = issueAttack(s, 'red-1', 'blue-1');
    const first = run(s, 1);
    expect(unit(first.state, 'red-1').intent.kind).toBe('attack');
    // Blue walks off; red cannot follow (no path), so it must stop trying and the run must end.
    const { state, emitted } = run(issueMove(first.state, 'blue-1', T(9, 0)), 10);
    expect(unit(state, 'blue-1').center).toEqual(T(9, 0));
    expect(unit(state, 'red-1').intent.kind).toBe('idle');
    expect(ofType(emitted, 'unit.moveBlocked').length).toBeGreaterThan(0);
  });

  it('rejects bad orders without side effects', () => {
    let s = field(duel);
    s = issueAttack(s, 'ghost', 'red-1');
    s = issueAttack(s, 'blue-1', 'ghost');
    s = issueAttack(s, 'blue-1', 'blue-1');
    const { emitted } = run(s, 1);
    expect(
      ofType(emitted, 'order.rejected').map((e) => (e.payload as { reason: string }).reason),
    ).toEqual(['unknown unit', 'unknown target', 'target is friendly']);
  });
});

describe('fire', () => {
  it('a shaken shooter does less damage than a steady one on the same die', () => {
    const firstShot = (morale: number) => {
      const { emitted } = run(
        field([
          { id: 'blue-1', side: 'blue', x: 1, y: 4 },
          { id: 'red-1', side: 'red', x: 2, y: 4, morale },
        ]),
        3,
      );
      return ofType(emitted, 'combat.fire').find(
        (e) => (e.payload as { attacker: string }).attacker === 'red-1',
      )!.payload as { die: number; casualties: number };
    };
    const steady = firstShot(100);
    const shaken = firstShot(30);
    expect(shaken.die).toBe(steady.die);
    expect(shaken.casualties).toBeLessThan(steady.casualties);
    // 0.5 + morale / 200: 0.65 against 1.0.
    expect(shaken.casualties / steady.casualties).toBeCloseTo(0.65, 1);
  });
});

describe('morale and withdrawal', () => {
  it('a unit whose morale falls below the break point withdraws home and stops fighting', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 100, morale: 30 },
      { id: 'red-1', side: 'red', x: 2, y: 4 },
      { id: 'red-2', side: 'red', x: 9, y: 0 },
      { id: 'blue-2', side: 'blue', x: 9, y: 4 },
    ]);
    // Blue stands away from where it started, so withdrawing means walking.
    s = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) => (u.id === 'blue-1' ? { ...u, home: T(0, 4) } : u)),
      },
    };
    const { state, emitted } = run(s, 10);
    const broken = ofType(emitted, 'unit.broken');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.time).toBe(COMBAT_TICK_MS);
    const blue = unit(state, 'blue-1');
    expect(blue.status).toBe('withdrawn');
    expect(blue.morale).toBeLessThan(BREAK_MORALE);
    expect(blue.center).toEqual(T(0, 4));
    // It does not shoot once it has broken (the enemy may still fire on it as it runs).
    expect(
      ofType(emitted, 'combat.fire').filter(
        (e) => e.time > COMBAT_TICK_MS && (e.payload as { attacker: string }).attacker === 'blue-1',
      ),
    ).toEqual([]);
  });

  it('refuses orders for a withdrawn unit', () => {
    const base = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 100, morale: 30 },
      { id: 'red-1', side: 'red', x: 2, y: 4 },
      { id: 'red-2', side: 'red', x: 9, y: 0 },
      { id: 'blue-2', side: 'blue', x: 9, y: 4 },
    ]);
    const { state } = run(base, 3);
    const { emitted } = run(issueMove(state, 'blue-1', T(4, 4)), 1);
    expect(ofType(emitted, 'order.rejected')).toHaveLength(1);
  });
});

describe('victory conditions', () => {
  it('attacker takes the objective', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
    ]);
    s = issueMove(s, 'red-1', T(5, 2));
    const { state, emitted } = run(s, 30);
    expect(ofType(emitted, 'game.end')).toEqual([
      {
        time: 12 * MS_PER_MINUTE,
        type: 'game.end',
        payload: { winner: 'red', reason: 'objective-taken' },
      },
    ]);
    expect(state.world.outcome).toEqual({
      winner: 'red',
      reason: 'objective-taken',
      time: 12 * MS_PER_MINUTE,
    });
  });

  it('does not give the objective for arriving: it must be held 10 minutes', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
    ]);
    s = issueMove(s, 'red-1', T(5, 2));
    const nearly = run(s, 11);
    expect(nearly.state.world.outcome).toBeNull();
    expect(nearly.state.world.heldSince).toBe(2 * MS_PER_MINUTE);
    expect(run(s, 12).state.world.outcome).toMatchObject({ reason: 'objective-taken' });
  });

  it('starts the hold again when the attacker leaves the objective', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
    ]);
    s = issueMove(s, 'red-1', T(5, 2));
    s = run(s, 6).state;
    expect(s.world.heldSince).toBe(2 * MS_PER_MINUTE);
    s = run(issueMove(s, 'red-1', T(3, 2)), 3).state;
    expect(s.world.heldSince).toBeNull();
    s = issueMove(s, 'red-1', T(5, 2));
    const back = run(s, 5);
    expect(back.state.world.outcome).toBeNull();
    expect(back.state.world.heldSince).not.toBeNull();
  });

  it('stops every unit where it stands when the game ends, and nothing moves after', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
      { id: 'red-2', side: 'red', kind: 'artillery', x: 1, y: 4 },
    ]);
    s = issueMove(s, 'red-1', T(5, 2));
    s = issueMove(s, 'red-2', T(9, 0)); // a slow gun on a long leg: still marching when red-1 wins
    // The same march with red-1 left idle, so the game does not end: where red-2 is at minute 12.
    const noWin = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
      { id: 'red-2', side: 'red', kind: 'artillery', x: 1, y: 4 },
    ]);
    const marching = run(issueMove(noWin, 'red-2', T(9, 0)), 12).state;
    expect(unit(marching, 'red-2').leg).toBeTruthy();
    const end = run(s, 30);
    const outcome = end.state.world.outcome!;
    expect(outcome).toMatchObject({ reason: 'objective-taken', time: 12 * MS_PER_MINUTE });
    // red-2 was mid-leg at minute 12, so it is frozen where it was then, not at its destination.
    const red2 = unit(end.state, 'red-2');
    const expected = positionAt(marching.world.map, unit(marching, 'red-2'), outcome.time);
    expect(red2.center).toEqual(expected);
    expect(red2.center).not.toEqual(T(9, 0));
    expect(end.state.world.units.every((u) => u.intent.kind === 'idle' && !u.leg)).toBe(true);
    const frozen = end.state.world.units.map((u) => [u.id, u.center, u.intent]);
    const later = run(issueMove(end.state, 'red-2', T(9, 4)), 60);
    expect(later.state.world.units.map((u) => [u.id, u.center, u.intent])).toEqual(frozen);
    expect(later.emitted).toEqual([]);
  });

  it('defender wins by keeping the attacker off the objective until the time is up', () => {
    const s = field(
      [
        { id: 'blue-1', side: 'blue', x: 0, y: 4 },
        { id: 'red-1', side: 'red', x: 9, y: 4 },
      ],
      { holdMinutes: 60 },
    );
    const early = run(s, 59);
    expect(ofType(early.emitted, 'game.end')).toEqual([]);
    const { emitted, state } = run(early.state, 1);
    expect(ofType(emitted, 'game.end')[0]!.payload).toEqual({
      winner: 'blue',
      reason: 'objective-held',
    });
    expect(state.world.outcome?.time).toBe(60 * MS_PER_MINUTE);
  });

  it('attacker taking the objective beats the clock', () => {
    let s = field(
      [
        { id: 'blue-1', side: 'blue', x: 9, y: 4 },
        { id: 'red-1', side: 'red', x: 4, y: 2 },
      ],
      { holdMinutes: 1 },
    );
    s = issueMove(s, 'red-1', T(5, 2));
    const { emitted } = run(s, 5);
    // Red steps on at exactly 1 minute; the deadline was queued earlier, so it wins the tie.
    expect(ofType(emitted, 'game.end')).toHaveLength(1);
  });

  it('a side is eliminated', () => {
    const { emitted, state } = run(
      field([
        { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 3 },
        { id: 'red-1', side: 'red', x: 2, y: 4 },
      ]),
      10,
    );
    expect(unit(state, 'blue-1').status).toBe('destroyed');
    expect(ofType(emitted, 'unit.destroyed')).toHaveLength(1);
    expect(ofType(emitted, 'game.end')[0]!.payload).toEqual({
      winner: 'red',
      reason: 'defence-broken',
    });
  });

  it('a side withdraws', () => {
    const { emitted } = run(
      field([
        { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 100, morale: 30 },
        { id: 'red-1', side: 'red', x: 2, y: 4 },
      ]),
      10,
    );
    expect(ofType(emitted, 'game.end')[0]!.payload).toEqual({
      winner: 'red',
      reason: 'defence-broken',
    });
  });

  it('a side already past its hold time fires the deadline at once instead of throwing', () => {
    const g = loadScenario(holdTheBridge);
    const late = createState(g.seed, g, g.victory.holdMs + MS_PER_MINUTE);
    const { emitted } = run(startGame(late), 1);
    expect(ofType(emitted, 'game.end')[0]!.payload).toEqual({
      winner: g.victory.defender,
      reason: 'objective-held',
    });
  });

  it('when both sides are out together, nobody wins and the reason is the weaker one', () => {
    const base = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 0 },
      { id: 'red-1', side: 'red', x: 9, y: 4 },
    ]).world;
    const set = (blue: 'destroyed' | 'withdrawn', red: 'destroyed' | 'withdrawn'): GameState => ({
      ...base,
      units: base.units.map((u) => ({ ...u, status: u.side === 'blue' ? blue : red })),
    });
    expect(evaluateVictory(set('destroyed', 'destroyed'), 5)).toEqual({
      winner: null,
      reason: 'eliminated',
      time: 5,
    });
    expect(evaluateVictory(set('destroyed', 'withdrawn'), 5)).toEqual({
      winner: null,
      reason: 'withdrawn',
      time: 5,
    });
    expect(evaluateVictory(set('withdrawn', 'withdrawn'), 5)).toMatchObject({
      winner: null,
      reason: 'withdrawn',
    });
    expect(evaluateVictory(base, 5)).toBeNull();
  });

  it('ends the game once: later events do nothing', () => {
    const { state } = run(
      field([
        { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 3 },
        { id: 'red-1', side: 'red', x: 2, y: 4 },
      ]),
      10,
    );
    const later = run(state, 300);
    expect(ofType(later.emitted, 'game.end')).toEqual([]);
    expect(later.state.world.outcome).toEqual(state.world.outcome);
  });
});

describe('Hold the Bridge', () => {
  it('plays out to a result, the same way every time', () => {
    const play = () => {
      const g = loadScenario(holdTheBridge);
      let s = startGame(createState(g.seed, g, 0));
      const goal = polygonCentroid(g.victory.objective);
      for (const id of ['red-1', 'red-2']) s = issueMove(s, id, goal);
      for (const id of ['blue-1', 'blue-2', 'blue-3']) s = issueMove(s, id, goal);
      return run(s, 200);
    };
    const a = play();
    expect(a.state.world.outcome).toMatchObject({ winner: 'blue', reason: 'attack-broken' });
    expect(a.state.world.rulings).toHaveLength(1);
    expect(ofType(a.emitted, 'game.end')).toHaveLength(1);
    expect(ofType(a.emitted, 'combat.fire').length).toBeGreaterThan(0);
    expect(a.emitted).toEqual(play().emitted);
  });
});

/** The first volley's shots, keyed `attacker>target`, from a field started by `rawUnits`. */
function firstVolley(s: EngineState<GameState>) {
  const { emitted } = run(s, 2);
  return Object.fromEntries(
    ofType(emitted, 'combat.fire').map((e) => {
      const p = e.payload as { attacker: string; target: string; casualties: number };
      return [`${p.attacker}>${p.target}`, e.payload as Record<string, unknown> & typeof p];
    }),
  );
}

/** Move a unit to a point given in metres, without the loader's overlap check. */
function place(s: EngineState<GameState>, id: string, x: number, y: number) {
  return {
    ...s,
    world: {
      ...s.world,
      units: s.world.units.map((u) => (u.id === id ? { ...u, center: pointMm(x, y) } : u)),
    },
  };
}

describe('fire by range', () => {
  const facing = { blue: 90, red: 270 }; // face each other, so no flank bonus either way
  const at = (gapTiles: number) =>
    field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4, facingDeg: facing.blue },
      { id: 'red-1', side: 'red', x: gapTiles, y: 4, facingDeg: facing.red },
    ]);

  it('falls off linearly from point-blank to the edge of range', () => {
    const near = { kind: 'infantry', type: 'line_infantry', center: { x: 0, y: 0 } } as never;
    expect(rangeFactor(near, { center: { x: 0, y: 0 } } as never)).toBe(1);
    expect(rangeFactor(near, { center: { x: 200_000, y: 0 } } as never)).toBe(LONG_RANGE_FACTOR);
    expect(rangeFactor(near, { center: { x: 100_000, y: 0 } } as never)).toBeCloseTo(0.625);
    // Past maximum range it does not go below the floor (it cannot fire at all there).
    expect(rangeFactor(near, { center: { x: 900_000, y: 0 } } as never)).toBe(LONG_RANGE_FACTOR);
  });

  it('costs a target more casualties the closer the shooter stands', () => {
    const close = firstVolley(at(1))['blue-1>red-1']!;
    const far = firstVolley(at(2))['blue-1>red-1']!;
    expect(close.die).toBe(far.die); // same seed, same roll: only the range differs
    expect(close.casualties / far.casualties).toBeCloseTo(0.625 / 0.25, 1);
  });

  it('hits a routed unit three times as hard as one standing', () => {
    const standing = firstVolley(at(1))['blue-1>red-1']!;
    // A second red unit stays active, far off, so the routed one's side has not simply left the field.
    const fleeing = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4, facingDeg: facing.blue },
      { id: 'red-1', side: 'red', x: 1, y: 4, facingDeg: facing.red },
      { id: 'red-2', side: 'red', x: 9, y: 0 },
    ]);
    const routedWorld = {
      ...fleeing,
      world: {
        ...fleeing.world,
        units: fleeing.world.units.map((u) =>
          u.id === 'red-1' ? { ...u, status: 'withdrawn' as const, brokenAt: 0 } : u,
        ),
      },
    };
    const run2 = firstVolley(routedWorld)['blue-1>red-1']!;
    expect(run2.die).toBe(standing.die);
    expect(run2.casualties / standing.casualties).toBeCloseTo(3, 1);
  });

  it('reports the distance in metres', () => {
    expect(firstVolley(at(2))['blue-1>red-1']!.distance).toBe(200);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = run(at(1), 20);
    expect(run(at(1), 20).emitted).toEqual(a.emitted);
    const other = run(field(duel, { seed: 8 }), 20);
    expect(other.emitted).not.toEqual(run(field(duel, { seed: 7 }), 20).emitted);
  });
});

describe('facing and flanking', () => {
  // Red stands east of blue and shoots at it; blue's facing decides which side red hits.
  const volley = (blueFacingDeg: number, formation?: 'line' | 'square') =>
    firstVolley(
      field([
        { id: 'blue-1', side: 'blue', x: 1, y: 4, facingDeg: blueFacingDeg, formation },
        { id: 'red-1', side: 'red', x: 2, y: 4, facingDeg: 270 },
      ]),
    )['red-1>blue-1']!;

  it('hits the front, flank and rear by the angle to the target facing', () => {
    expect(volley(90).aspect).toBe('front');
    expect(volley(0).aspect).toBe('flank');
    expect(volley(180).aspect).toBe('flank');
    expect(volley(270).aspect).toBe('rear');
    expect(volley(90 - 40).aspect).toBe('front');
    expect(volley(90 - 50).aspect).toBe('flank');
    expect(volley(90 + 140).aspect).toBe('rear');
  });

  it('gives flank and rear bonuses', () => {
    const front = volley(90);
    expect(front.die).toBe(volley(270).die);
    expect(volley(0).casualties / front.casualties).toBeCloseTo(1.5, 1);
    expect(volley(270).casualties / front.casualties).toBeCloseTo(2, 1);
  });

  it('has no flanks on a square', () => {
    expect(volley(270, 'square').aspect).toBe('front');
  });

  it('turns a unit that fires to face its target', () => {
    const { state } = run(field(duel), 2);
    expect(unit(state, 'blue-1').facing).toBeCloseTo(Math.PI / 2); // red is due east
    expect(unit(state, 'red-1').facing).toBeCloseTo(-Math.PI / 2); // blue is due west
  });

  it('does not let a unit that was hit from the flank return the favour with its front bonus', () => {
    // Both start facing north; after the first volley both face each other, so tick two is frontal.
    const { emitted } = run(field(duel), 4);
    const shots = ofType(emitted, 'combat.fire').map((e) => e.payload as { aspect: string });
    expect(shots.map((p) => p.aspect)).toEqual(['flank', 'flank', 'front', 'front']);
  });
});

describe('melee', () => {
  const pair = (kind: 'infantry' | 'cavalry' = 'infantry') =>
    field([
      { id: 'blue-1', side: 'blue', kind, x: 1, y: 4, facingDeg: 90, strength: 100 },
      { id: 'red-1', side: 'red', x: 2, y: 4, facingDeg: 270, strength: 100 },
    ]);

  it('is footprint contact, not a distance between centres', () => {
    // 100 men in line are about 38 m wide and 3.2 m deep. Face to face, they touch when the
    // centres are one depth apart.
    const s = place(pair(), 'red-1', 150 + 8, 450);
    const [a, b] = [unit(s, 'blue-1'), unit(s, 'red-1')];
    expect(inMelee(a, b)).toBe(false);
    expect(inMelee(a, unit(place(s, 'red-1', 150 + 3, 450), 'red-1'))).toBe(true);
    expect(inMelee(a, unit(place(s, 'red-1', 150 + 12, 450), 'red-1'))).toBe(false);
    expect(inMelee(a, unit(place(s, 'red-1', 150 + 50, 450), 'red-1'))).toBe(false);
  });

  it('is a cavalry charge inside the charge distance', () => {
    const s = pair('cavalry');
    const inside = unit(place(s, 'red-1', 150 + CHARGE_M - 1, 450), 'red-1');
    const outside = unit(place(s, 'red-1', 150 + CHARGE_M + 5, 450), 'red-1');
    const cav = unit(s, 'blue-1');
    expect(inMelee(cav, inside)).toBe(true);
    expect(inMelee(cav, outside)).toBe(false);
    // Infantry get no charge.
    const inf = unit(pair(), 'blue-1');
    expect(inMelee(inf, inside)).toBe(false);
  });

  it('hits harder than fire and ignores range falloff', () => {
    const fire = firstVolley(place(pair(), 'red-1', 150 + 20, 450))['blue-1>red-1']!;
    const melee = firstVolley(place(pair(), 'red-1', 150 + 3, 450))['blue-1>red-1']!;
    expect(fire.melee).toBe(false);
    expect(melee.melee).toBe(true);
    expect(melee.die).toBe(fire.die);
    expect(melee.casualties / fire.casualties).toBeCloseTo(
      MELEE_FACTOR /
        rangeFactor(
          unit(place(pair(), 'red-1', 170, 450), 'blue-1'),
          unit(place(pair(), 'red-1', 170, 450), 'red-1'),
        ),
      1,
    );
  });
});

describe('objective area', () => {
  // The default field's objective is the 60 m square centred on (550, 250).
  const holder = (x: number, y: number) => {
    const s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 0, y: 0 },
    ]);
    return { ...place(s, 'red-1', x, y).world, heldSince: 0 };
  };
  const TAKEN = 10 * MS_PER_MINUTE;

  it('is held by a unit whose centre is inside the area, corners included', () => {
    expect(evaluateVictory(holder(550, 250), TAKEN)).toMatchObject({ winner: 'red' });
    expect(evaluateVictory(holder(579, 221), TAKEN)).toMatchObject({ winner: 'red' });
    expect(evaluateVictory(holder(580, 280), TAKEN)).toMatchObject({ winner: 'red' });
  });

  it('is not taken before the hold time is up, and not at all if it was never started', () => {
    expect(evaluateVictory(holder(550, 250), TAKEN - 1)).toBeNull();
    expect(evaluateVictory({ ...holder(550, 250), heldSince: null }, TAKEN)).toBeNull();
  });

  it('is not held from outside the area, even a few metres off', () => {
    expect(evaluateVictory(holder(585, 250), TAKEN)).toBeNull();
    expect(evaluateVictory(holder(550, 215), TAKEN)).toBeNull();
  });

  it('is not round: the same distance from the centre can be in or out', () => {
    // 36 m from the centre along the diagonal is in the square's corner region; 36 m east is out.
    expect(evaluateVictory(holder(550 + 29, 250 + 29), TAKEN)).toMatchObject({ winner: 'red' });
    expect(evaluateVictory(holder(550 + 36, 250), TAKEN)).toBeNull();
  });

  it('does not count the defender holding it jointly with the attacker', () => {
    const w = holder(550, 250);
    const both = {
      ...w,
      units: w.units.map((u) => (u.id === 'blue-1' ? { ...u, center: pointMm(560, 250) } : u)),
    };
    expect(evaluateVictory(both, TAKEN)).toBeNull();
  });
});

describe('a decided battle (#315)', () => {
  /** A field with Red's units spread far from Blue's, then `edit` applied to the units. */
  function quiet(edit: (u: GameState['units'][number]) => GameState['units'][number]) {
    const s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4 },
      { id: 'red-1', side: 'red', x: 9, y: 0 },
      { id: 'red-2', side: 'red', x: 8, y: 0 },
    ]);
    return { ...s, world: { ...s.world, units: s.world.units.map(edit) } };
  }
  const routed = (u: GameState['units'][number]) => ({
    ...u,
    status: 'withdrawn' as const,
    brokenAt: 0,
  });

  it('declares a broken attack, tells both sides, and closes the game after the pursuit', () => {
    const s = quiet((u) =>
      u.id === 'red-1' ? routed(u) : u.id === 'red-2' ? { ...u, strength: 90, morale: 50 } : u,
    );
    expect(forceBroken(s.world, 'red')).toBe(true);
    expect(forceBroken(s.world, 'blue')).toBe(false);
    const early = run(s, 5);
    expect(early.state.world.outcome).toBeNull();
    const rulings = early.state.world.rulings as BattleRuling[];
    expect(rulings).toHaveLength(1);
    expect(rulings[0]).toMatchObject({ kind: 'battle', winner: 'blue', loser: 'red' });
    expect(ofType(early.emitted, 'umpire.ruling')).toHaveLength(1);
    // Both sides hear it, in the same words, with no figure in them.
    for (const side of ['blue', 'red'] as const) {
      const note = viewFor(early.state.world, side, early.state.time).reports.find(
        (r) => r.kind === 'battle',
      );
      expect(note?.text).toBe(rulings[0]!.narrative);
      expect(note?.text).not.toMatch(/\d/);
    }
    const end = run(early.state, BATTLE_CLOSE_MS / MS_PER_MINUTE);
    expect(end.state.world.outcome).toMatchObject({ winner: 'blue', reason: 'attack-broken' });
    expect(ofType(end.emitted, 'game.end')).toHaveLength(1);
  });

  it('declares a broken defence as a win for the attacker', () => {
    const s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 40 },
      { id: 'blue-2', side: 'blue', x: 1, y: 3 },
      { id: 'red-1', side: 'red', x: 9, y: 0 },
    ]);
    const w = {
      ...s.world,
      units: s.world.units.map((u) => (u.id === 'blue-2' ? routed(u) : u)),
    };
    const { state } = run({ ...s, world: w }, 2);
    expect((state.world.rulings[0] as BattleRuling).reason).toBe('defence-broken');
    expect(state.world.battle?.winner).toBe('red');
  });

  it('does not declare while the force still has its strength, or before anyone has broken', () => {
    const fresh = quiet((u) => u);
    expect(run(fresh, 30).state.world.rulings).toHaveLength(0);
    const hurt = quiet((u) => (u.id === 'red-2' ? { ...u, strength: 30, morale: 30 } : u));
    // Nothing has broken or been destroyed yet: a thin line is still a line.
    expect(forceBroken(hurt.world, 'red')).toBe(false);
    const oneGone = quiet((u) => (u.id === 'red-1' ? routed(u) : u));
    expect(forceBroken(oneGone.world, 'red')).toBe(false);
  });

  it('needs a lost unit as well as a low share: a tired line that is all still fighting is not broken', () => {
    const tired = quiet((u) => (u.side === 'red' ? { ...u, strength: 60, morale: 40 } : u));
    // Every red unit is active, but the morale-weighted share is far under a quarter.
    expect(
      tired.world.units.filter((u) => u.side === 'red').every((u) => u.status === 'active'),
    ).toBe(true);
    expect(forceBroken(tired.world, 'red')).toBe(false);
    const oneRouted = {
      ...tired,
      world: {
        ...tired.world,
        units: tired.world.units.map((u) => (u.id === 'red-1' ? routed(u) : u)),
      },
    };
    expect(forceBroken(oneRouted.world, 'red')).toBe(true);
    const oneDestroyed = {
      ...tired,
      world: {
        ...tired.world,
        units: tired.world.units.map((u) =>
          u.id === 'red-1' ? { ...u, status: 'destroyed' as const } : u,
        ),
      },
    };
    expect(forceBroken(oneDestroyed.world, 'red')).toBe(true);
  });

  it('sends free cavalry after a unit that breaks, and rides it down', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 100, morale: 30 },
      { id: 'red-1', side: 'red', x: 2, y: 4 },
      { id: 'red-3', side: 'red', kind: 'cavalry', x: 4, y: 3, strength: 300 },
      { id: 'blue-2', side: 'blue', x: 9, y: 4 },
    ]);
    s = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) => (u.id === 'blue-1' ? { ...u, home: T(0, 0) } : u)),
      },
    };
    const { state, emitted } = run(s, 40);
    const broke = ofType(emitted, 'unit.broken').find(
      (e) => (e.payload as { unitId: string }).unitId === 'blue-1',
    )!;
    const after = ofType(emitted, 'combat.fire').filter(
      (e) =>
        e.time > broke.time &&
        (e.payload as { target: string; attacker: string }).target === 'blue-1' &&
        (e.payload as { attacker: string }).attacker === 'red-3',
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((e) => (e.payload as { melee: boolean }).melee)).toBe(true);
    expect(unit(state, 'blue-1').status).toBe('destroyed');
    expect(ofType(emitted, 'unit.destroyed').length).toBeGreaterThan(0);
    // The side that lost it is told.
    const blueView = viewFor(state.world, 'blue', state.time);
    expect(blueView.reports.some((r) => r.kind === 'unitLost')).toBe(true);
  });
});

describe('battle visibility (#320)', () => {
  const reportsOf = (s: EngineState<GameState>, side: 'blue' | 'red') =>
    viewFor(s.world, side, s.time).reports;

  it('tells each side its own units are engaged, before any ruling, and not twice in a row', () => {
    const { state } = run(field(duel), 6);
    for (const side of ['blue', 'red'] as const) {
      const engaged = reportsOf(state, side).filter((r) => r.kind === 'engaged');
      expect(engaged).toHaveLength(1);
      expect(engaged[0]!.from).toBe(side === 'blue' ? 'blue-1' : 'red-1');
      expect(engaged[0]!.text).toContain('engaged');
      expect(engaged[0]!.observedAt).toBe(COMBAT_TICK_MS);
    }
  });

  /** `duel`, with blue-1 worn down to `strength` of the 600 it started with and `morale` set. */
  const worn = (strength: number, morale: number) => {
    const s = field(duel);
    return {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) => (u.id === 'blue-1' ? { ...u, strength, morale } : u)),
      },
    };
  };

  it('reports heavy losses once, when a unit that holds drops below half its starting strength', () => {
    const s = worn(305, 100);
    expect(s.world.startStrength?.['blue-1']).toBe(600);
    const first = run(s, 2);
    const u1 = unit(first.state, 'blue-1');
    expect(u1.strength).toBeLessThan(300);
    expect(u1.strength).toBeGreaterThan(0);
    expect(u1.status).toBe('active');
    const heavy = (st: EngineState<GameState>) =>
      st.world.intel.blue.reports.filter((r) => r.kind === 'heavyLosses');
    expect(heavy(first.state)).toHaveLength(1);
    expect(heavy(first.state)[0]!.from).toBe('blue-1');
    expect(first.state.world.intel.red.reports.some((r) => r.kind === 'heavyLosses')).toBe(false);
    // Already below half: later ticks do not say it again.
    const later = run(first.state, 4);
    expect(unit(later.state, 'blue-1').status).toBe('active');
    expect(heavy(later.state)).toHaveLength(1);
  });

  it('files the heavy-losses report as well as the broke report for a unit that broke in the same tick', () => {
    const { state } = run(worn(305, 1), 2);
    expect(unit(state, 'blue-1').strength).toBeLessThan(300);
    expect(unit(state, 'blue-1').status).toBe('withdrawn');
    const kinds = state.world.intel.blue.reports.map((r) => r.kind);
    expect(kinds).toContain('broke');
    expect(kinds.filter((k) => k === 'heavyLosses')).toHaveLength(1);
  });

  it('says engaged again only after the repeat window', () => {
    const { state } = run(field(duel), 25);
    const times = state.world.intel.blue.reports
      .filter((r) => r.kind === 'engaged')
      .map((r) => r.observedAt);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(10 * MS_PER_MINUTE);
    }
  });

  it('reports a break when the unit goes', () => {
    const s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4, strength: 100, morale: 30 },
      { id: 'red-1', side: 'red', x: 2, y: 4 },
      { id: 'red-2', side: 'red', x: 9, y: 0 },
      { id: 'blue-2', side: 'blue', x: 9, y: 4 },
    ]);
    const { state } = run(s, 10);
    const kinds = reportsOf(state, 'blue').map((r) => r.kind);
    expect(kinds).toContain('engaged');
    expect(kinds).toContain('broke');
    const broke = reportsOf(state, 'blue').find((r) => r.kind === 'broke')!;
    expect(broke.text).toMatch(/broken and is falling back/);
    expect(broke.observedAt).toBe(COMBAT_TICK_MS);
    // Red's units did not break, so Red is told nothing of Blue's break.
    expect(reportsOf(state, 'red').some((r) => r.kind === 'broke')).toBe(false);
  });

  it('leaks no figure or unit of the other side into any report', () => {
    const { state } = run(field(duel), 12);
    for (const side of ['blue', 'red'] as const) {
      const other = side === 'blue' ? 'red' : 'blue';
      for (const r of reportsOf(state, side).filter((x) => x.kind !== 'contact')) {
        expect(r.text).not.toContain(other);
      }
    }
  });

  it('words the ruling without "on at" and from the field, and says who was wiped out', () => {
    const s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4 },
      { id: 'red-1', side: 'red', x: 9, y: 0, strength: 1 },
    ]);
    const w = {
      ...s.world,
      units: s.world.units.map((u) =>
        u.id === 'red-1' ? { ...u, status: 'destroyed' as const, strength: 0 } : u,
      ),
    };
    const { state } = run({ ...s, world: w }, 2);
    const ruling = state.world.rulings[0] as BattleRuling;
    expect(ruling.narrative).toMatch(/^Red's attack (at|near|in|\d+ m) /);
    expect(ruling.narrative).not.toMatch(/ on (at|near|in) /);
    expect(state.world.outcome).toMatchObject({ winner: 'blue', loserOut: 'eliminated' });
    const note = reportsOf(state, 'blue').find((r) => r.kind === 'battle')!;
    expect(note.from).not.toBe('Umpire');
    expect(note.text).toBe(ruling.narrative);
  });
});

describe('combat v2: determinism and invariants', () => {
  const fight = (seed: number, minutes = 40) =>
    run(
      field(
        [
          { id: 'blue-1', side: 'blue', x: 1, y: 4 },
          { id: 'red-1', side: 'red', x: 2, y: 4 },
          { id: 'red-2', side: 'red', x: 2, y: 3, kind: 'cavalry', strength: 200 },
        ],
        { seed },
      ),
      minutes,
    );

  it('is deterministic given a seed, events included', () => {
    const a = fight(11);
    const b = fight(11);
    expect(serialize(a.state)).toEqual(serialize(b.state));
    expect(a.emitted).toEqual(b.emitted);
    expect(serialize(fight(12).state)).not.toEqual(serialize(a.state));
  });

  it('never lets strength go negative or come back, and keeps morale in range', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { state, emitted } = fight(seed);
      const lastStrength = new Map<string, number>();
      for (const e of ofType(emitted, 'combat.fire')) {
        const p = e.payload as { target: string; targetStrength: number; targetMorale: number };
        expect(p.targetStrength).toBeGreaterThanOrEqual(0);
        expect(p.targetMorale).toBeGreaterThanOrEqual(0);
        expect(p.targetMorale).toBeLessThanOrEqual(100);
        const before = lastStrength.get(p.target);
        if (before !== undefined) expect(p.targetStrength).toBeLessThanOrEqual(before);
        lastStrength.set(p.target, p.targetStrength);
      }
      for (const u of state.world.units) {
        expect(u.strength).toBeGreaterThanOrEqual(0);
        expect(u.strength).toBeLessThanOrEqual(state.world.startStrength![u.id]!);
        if (u.status === 'destroyed') expect(u.strength).toBe(0);
      }
    }
  });

  it('logs the factors of a shot', () => {
    const { emitted } = fight(3, 2);
    for (const e of ofType(emitted, 'combat.fire')) {
      const p = e.payload as { die: number; factors: Record<string, number> };
      expect(Object.keys(p.factors).sort()).toEqual(
        [
          'aspect',
          'ammo',
          'fireRate',
          'formation',
          'morale',
          'range',
          'rout',
          'vulnerability',
        ].sort(),
      );
      expect(p.die).toBeGreaterThanOrEqual(1);
      expect(p.die).toBeLessThanOrEqual(6);
    }
  });
});

describe('combat v2: morale checks', () => {
  it('rolls two dice for a unit that lost men and logs the result', () => {
    const { emitted } = run(field(duel), 6);
    const checks = ofType(emitted, 'combat.morale');
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      const p = c.payload as { roll: number; needed: number; passed: boolean; lossPercent: number };
      expect(p.roll).toBeGreaterThanOrEqual(2);
      expect(p.roll).toBeLessThanOrEqual(12);
      expect(p.passed).toBe(p.roll <= p.needed);
      expect(p.lossPercent).toBeGreaterThanOrEqual(4);
    }
  });

  it('shakes a unit hit in the rear more than one hit in front', () => {
    const lossOf = (facingDeg: number) => {
      const { state } = run(
        field([
          { id: 'blue-1', side: 'blue', x: 1, y: 4, facingDeg, morale: 100 },
          { id: 'red-1', side: 'red', x: 2, y: 4, facingDeg: 270 },
        ]),
        2,
      );
      const u = unit(state, 'blue-1');
      return { strength: 600 - u.strength, morale: 100 - u.morale };
    };
    // Red stands east of Blue: Blue facing east takes it in the front, facing west in the rear.
    const front = lossOf(90);
    const rear = lossOf(270);
    expect(rear.strength).toBeGreaterThan(front.strength);
    expect(rear.morale / rear.strength).toBeGreaterThan(front.morale / front.strength);
  });
});

describe('combat v2: rally', () => {
  /** Red's 1st battalion broke at minute 0 and runs; Red's cavalry stands by. */
  function broken(seed: number, enemyX = 9) {
    let s = field(
      [
        { id: 'blue-1', side: 'blue', x: enemyX, y: 0 },
        { id: 'red-1', side: 'red', x: 0, y: 4, strength: 600 },
        { id: 'red-2', side: 'red', x: 1, y: 3, kind: 'cavalry', strength: 300 },
      ],
      { seed },
    );
    s = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) =>
          u.id === 'red-1'
            ? { ...u, status: 'withdrawn' as const, brokenAt: 0, morale: 20, strength: 300 }
            : u,
        ),
      },
    };
    return schedule(s, [
      { time: 6 * MS_PER_MINUTE, type: RALLY_EVENT, payload: { unitId: 'red-1' } },
    ]);
  }

  it('lets a broken unit with no enemy near come back, shaken, for most seeds', () => {
    let rallied = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { state, emitted } = run(broken(seed), 30);
      if (ofType(emitted, 'unit.rallied').length === 0) continue;
      rallied++;
      const u = unit(state, 'red-1');
      expect(u.status).toBe('active');
      expect(u.brokenAt).toBeUndefined();
      expect(u.intent).toEqual({ kind: 'idle' });
      expect(u.morale).toBe(40);
      expect(u.strength).toBe(300); // rallying restores no men
    }
    expect(rallied).toBeGreaterThan(30);
  });

  it('does not rally with an enemy close by', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, emitted } = run(broken(seed, 1), 8);
      expect(ofType(emitted, 'unit.rallied')).toEqual([]);
      expect(unit(state, 'red-1').status).toBe('withdrawn');
    }
  });

  it('does not rally a unit that has lost too much', () => {
    let s = broken(5);
    s = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) => (u.id === 'red-1' ? { ...u, strength: 100 } : u)),
      },
    };
    const { emitted } = run(s, 30);
    expect(ofType(emitted, 'unit.rallied')).toEqual([]);
  });
});

describe('combat v2: balance smoke test', () => {
  /** Blue (west) against Red (east), 1000 seeds; who has the field after 30 minutes. */
  function winRates(blue: Partial<RawUnit>, red: Partial<RawUnit>, seeds = 1000) {
    let blueWins = 0;
    let redWins = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { state } = run(
        field(
          [
            { id: 'blue-1', side: 'blue', x: 1, y: 4, facingDeg: 90, ...blue },
            { id: 'red-1', side: 'red', x: 2, y: 4, facingDeg: 270, ...red },
          ],
          { seed },
        ),
        30,
      );
      const power = (id: string) => {
        const u = unit(state, id);
        if (u.status === 'destroyed') return 0;
        return u.status === 'withdrawn' ? 0.01 * u.strength : u.strength;
      };
      const b = power('blue-1');
      const r = power('red-1');
      if (b > r) blueWins++;
      else if (r > b) redWins++;
    }
    return { blue: blueWins / seeds, red: redWins / seeds };
  }

  it('an even fight is close to even', () => {
    const { blue, red } = winRates({}, {});
    expect(blue).toBeGreaterThan(0.4);
    expect(blue).toBeLessThan(0.6);
    expect(blue + red).toBeGreaterThan(0.99);
  });

  it('a battalion with 10% fewer men to face usually wins, and one against half its size nearly always', () => {
    expect(winRates({}, { strength: 300 }).blue).toBeGreaterThan(0.95);
    const edge = winRates({}, { strength: 540 }).blue;
    expect(edge).toBeGreaterThan(0.7);
  });

  it('a unit shot in the flank by an equal one loses more often than not', () => {
    // Blue faces north, so Red's fire from the east is a flank shot; Red faces Blue.
    expect(winRates({ facingDeg: 0 }, {}).red).toBeGreaterThan(0.6);
  });
});
