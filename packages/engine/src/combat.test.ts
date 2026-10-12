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
  registerCombat,
  registerMovement,
  serialize,
  startGame,
  type EmittedEvent,
  type EngineState,
  type GameState,
} from './index.js';
import { evaluateVictory } from './combat.js';
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
    // No more shooting once it has broken.
    expect(ofType(emitted, 'combat.fire').filter((e) => e.time > COMBAT_TICK_MS)).toEqual([]);
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
      { id: 'red-2', side: 'red', x: 0, y: 4 },
    ]);
    s = issueMove(s, 'red-1', T(5, 2));
    s = issueMove(s, 'red-2', T(8, 0)); // still marching when red-1 wins
    const end = run(s, 30);
    expect(end.state.world.outcome).toMatchObject({ reason: 'objective-taken' });
    const frozen = end.state.world.units.map((u) => [u.id, u.center, u.intent]);
    expect(end.state.world.units.every((u) => u.intent.kind === 'idle' && !u.leg)).toBe(true);
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
      reason: 'eliminated',
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
    expect(ofType(emitted, 'game.end')[0]!.payload).toEqual({ winner: 'red', reason: 'withdrawn' });
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
    expect(a.state.world.outcome).toMatchObject({ winner: 'blue', reason: 'objective-held' });
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
