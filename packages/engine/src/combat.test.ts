import { describe, expect, it } from 'vitest';
import {
  BREAK_MORALE,
  COMBAT_TICK_MS,
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  holdTheBridge,
  issueAttack,
  issueMove,
  loadScenario,
  registerCombat,
  registerMovement,
  serialize,
  startGame,
  type EmittedEvent,
  type EngineState,
  type GameState,
} from './index.js';
import { evaluateVictory } from './combat.js';

type RawUnit = {
  id: string;
  side: 'blue' | 'red';
  kind?: 'infantry' | 'cavalry' | 'artillery';
  x: number;
  y: number;
  strength?: number;
  morale?: number;
};

/** 10x5 open field with the bridge (the objective) at (5,2) and a wood tile at (7,1). */
function field(
  rawUnits: RawUnit[],
  opts: { holdMinutes?: number; seed?: number; rows?: string[] } = {},
) {
  const rows = opts.rows ?? ['..........', '.......W..', '.....B....', '..........', '..........'];
  const raw = {
    id: 'test',
    name: 'Test',
    seed: opts.seed ?? 7,
    map: { legend: { '.': 'open', W: 'wood', B: 'bridge', R: 'river' }, rows },
    sides: [
      { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 0, y: 0 } },
      { id: 'red', name: 'Red', controller: 'scripted', hq: { x: 0, y: 0 } },
    ],
    units: rawUnits.map((u) => ({
      name: u.id,
      kind: 'infantry',
      strength: 600,
      morale: 80,
      facing: 'N',
      ...u,
    })),
    victory: {
      objective: { x: 5, y: 2 },
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
    s = issueMove(s, 'red-1', { x: 2, y: 4 });
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
      distance: 1,
      cover: 1,
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
    expect((at('blue-1').payload as { cover: number }).cover).toBe(0.6);
    expect((at('red-1').payload as { cover: number }).cover).toBe(1);
  });

  it('stops ticking when contact is lost, and restarts later', () => {
    let s = field(duel);
    s = issueMove(s, 'red-1', { x: 8, y: 4 }, MS_PER_MINUTE); // marches away after the first minute
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
    expect(unit(state, 'red-1').position.x).toBe(2); // stops at infantry range
    expect(ofType(emitted, 'contact.begin')).toHaveLength(1);
    expect(unit(state, 'blue-1').strength).toBeLessThan(600);
  });

  it('chases a target that moves', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 1, y: 4 },
      { id: 'red-1', side: 'red', x: 9, y: 4 },
    ]);
    s = issueMove(s, 'blue-1', { x: 1, y: 0 });
    s = issueAttack(s, 'red-1', 'blue-1');
    const { state } = run(s, 12);
    expect(unit(state, 'red-1').position.y).toBeLessThan(4);
  });

  it('follows a target that walks away after contact was made', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 0, y: 4 },
      { id: 'red-1', side: 'red', x: 6, y: 4 },
    ]);
    s = issueAttack(s, 'red-1', 'blue-1');
    const stopped = run(s, 12);
    expect(unit(stopped.state, 'red-1').position).toEqual({ x: 2, y: 4 });
    expect(ofType(stopped.emitted, 'contact.begin')).toHaveLength(1);
    // Blue now marches off; red must give chase and catch it up again.
    const moved = run(issueMove(stopped.state, 'blue-1', { x: 0, y: 0 }), 5);
    expect(unit(moved.state, 'red-1').position.y).toBeLessThan(4);
    expect(unit(moved.state, 'red-1').intent.kind).toBe('attack');
    expect(ofType(moved.emitted, 'contact.end').length).toBeGreaterThan(0);
    expect(ofType(moved.emitted, 'contact.begin').length).toBeGreaterThan(0);
  });

  it('gives up on a target it cannot path to instead of looping', () => {
    // A river column at x=3 splits the map; nothing crosses it.
    const rows = ['...R......', '...R......', '...R.B....', '...R......', '...R......'];
    let s = field(
      [
        { id: 'blue-1', side: 'blue', x: 4, y: 2 },
        { id: 'red-1', side: 'red', x: 2, y: 2 },
      ],
      { rows },
    );
    s = issueAttack(s, 'red-1', 'blue-1');
    const first = run(s, 1);
    expect(unit(first.state, 'red-1').intent.kind).toBe('attack');
    // Blue walks off; red cannot follow (no path), so it must stop trying and the run must end.
    const { state, emitted } = run(issueMove(first.state, 'blue-1', { x: 9, y: 0 }), 10);
    expect(unit(state, 'blue-1').position).toEqual({ x: 9, y: 0 });
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
        units: s.world.units.map((u) => (u.id === 'blue-1' ? { ...u, home: { x: 0, y: 4 } } : u)),
      },
    };
    const { state, emitted } = run(s, 10);
    const broken = ofType(emitted, 'unit.broken');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.time).toBe(COMBAT_TICK_MS);
    const blue = unit(state, 'blue-1');
    expect(blue.status).toBe('withdrawn');
    expect(blue.morale).toBeLessThan(BREAK_MORALE);
    expect(blue.position).toEqual({ x: 0, y: 4 });
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
    const { emitted } = run(issueMove(state, 'blue-1', { x: 4, y: 4 }), 1);
    expect(ofType(emitted, 'order.rejected')).toHaveLength(1);
  });
});

describe('victory conditions', () => {
  it('attacker takes the objective', () => {
    let s = field([
      { id: 'blue-1', side: 'blue', x: 9, y: 4 },
      { id: 'red-1', side: 'red', x: 3, y: 2 },
    ]);
    s = issueMove(s, 'red-1', { x: 5, y: 2 });
    const { state, emitted } = run(s, 30);
    expect(ofType(emitted, 'game.end')).toEqual([
      {
        time: 2 * MS_PER_MINUTE,
        type: 'game.end',
        payload: { winner: 'red', reason: 'objective-taken' },
      },
    ]);
    expect(state.world.outcome).toEqual({
      winner: 'red',
      reason: 'objective-taken',
      time: 2 * MS_PER_MINUTE,
    });
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
    s = issueMove(s, 'red-1', { x: 5, y: 2 });
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
      for (const id of ['red-1', 'red-2']) s = issueMove(s, id, g.victory.objective);
      for (const id of ['blue-1', 'blue-2', 'blue-3']) s = issueMove(s, id, g.victory.objective);
      return run(s, 200);
    };
    const a = play();
    expect(a.state.world.outcome).toMatchObject({ winner: 'blue', reason: 'objective-held' });
    expect(ofType(a.emitted, 'game.end')).toHaveLength(1);
    expect(ofType(a.emitted, 'combat.fire').length).toBeGreaterThan(0);
    expect(a.emitted).toEqual(play().emitted);
  });
});
