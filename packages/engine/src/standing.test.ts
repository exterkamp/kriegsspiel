import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_MINUTE,
  advanceTo,
  createState,
  issueOrder,
  pointMm,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  startVisibility,
  type EngineState,
  type GameState,
  type Order,
  type OrderIntent,
  type Point,
  type Trigger,
} from './index.js';
import { miniWorld, wood } from './scenario.testkit.js';

const P = (x: number, y: number): Point => pointMm(x, y);
const DEST = P(300, 700);

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** Blue `b` near its HQ; red `r` 500 m east of it (in sight, out of gun range). */
function start(
  opts: { features?: ReturnType<typeof wood>[]; redX?: number; redStrength?: number } = {},
): EngineState<GameState> {
  const w = miniWorld({
    ...(opts.features ? { features: opts.features } : {}),
    units: [
      { id: 'b', side: 'blue', x: 300, y: 300 },
      {
        id: 'r',
        side: 'red',
        x: opts.redX ?? 800,
        y: 300,
        ...(opts.redStrength ? { strength: opts.redStrength } : {}),
      },
    ],
  });
  return startVisibility(createState(w.seed, w, 0));
}

function order(intents: OrderIntent[], id = 'o1', from?: string): Order {
  return { id, side: 'blue', to: 'b', issuedAt: 0, text: 'x', intents, ...(from ? { from } : {}) };
}

const unit = (s: EngineState<GameState>, id: string) => s.world.units.find((u) => u.id === id)!;
const MOVE: OrderIntent = { kind: 'move', to: DEST };
const AREA: Point[] = [P(700, 200), P(900, 200), P(900, 400), P(700, 400)];

/** Issue at `at`, advance to `to`; return the state and everything emitted. */
function run(s: EngineState<GameState>, orders: Array<[Order, number]>, to: number) {
  let cur = s;
  for (const [o, at] of orders) cur = issueOrder(cur, o, at);
  return advanceTo(cur, to, registry());
}

const fired = (e: { type: string }[]) => e.filter((x) => x.type === 'standing_fired');

describe('at (timed intents)', () => {
  const at = (gameTime: number): OrderIntent => ({ kind: 'at', gameTime, then: [MOVE] });

  it('does nothing until its time, then acts', () => {
    const t = 30 * MS_PER_MINUTE;
    const early = run(start(), [[order([at(t)]), 0]], t - 1);
    expect(unit(early.state, 'b').intent).toEqual({ kind: 'idle' });
    expect(unit(early.state, 'b').standing).toHaveLength(1);
    const late = advanceTo(early.state, t, registry());
    expect(unit(late.state, 'b').intent.kind).toBe('move');
    expect(unit(late.state, 'b').standing).toBeUndefined();
    expect(fired(late.emitted)).toHaveLength(1);
  });

  it('fires on delivery when its time has already passed', () => {
    const r = run(start(), [[order([at(1)]), 0]], 60 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toHaveLength(1);
    expect(unit(r.state, 'b').center).toEqual(DEST); // marched to the `then` destination
  });

  it('fires only once', () => {
    const t = 20 * MS_PER_MINUTE;
    const r = run(start(), [[order([at(t)]), 0]], 3 * t);
    expect(fired(r.emitted)).toHaveLength(1);
  });

  it('leaves the unit alone while the order is the only intent', () => {
    const r = run(start(), [[order([at(40 * MS_PER_MINUTE)]), 0]], 20 * MS_PER_MINUTE);
    expect(unit(r.state, 'b').intent).toEqual({ kind: 'idle' });
  });

  it('runs an immediate intent now and the timed one later', () => {
    const t = 40 * MS_PER_MINUTE;
    const hold: OrderIntent = { kind: 'hold', at: P(300, 300) };
    const r = run(
      start(),
      [[order([MOVE, { kind: 'at', gameTime: t, then: [hold] }]), 0]],
      30 * MS_PER_MINUTE,
    );
    expect(unit(r.state, 'b').center).toEqual(DEST);
    const r2 = advanceTo(r.state, t + 30 * MS_PER_MINUTE, registry());
    expect(unit(r2.state, 'b').center).toEqual(P(300, 300));
    expect(unit(r2.state, 'b').intent).toEqual({ kind: 'hold', at: P(300, 300) });
  });
});

describe('when: timeReached', () => {
  it('behaves like at', () => {
    const t = 25 * MS_PER_MINUTE;
    const trigger: Trigger = { kind: 'timeReached', gameTime: t };
    const r = run(start(), [[order([{ kind: 'when', trigger, then: [MOVE] }]), 0]], t);
    expect(unit(r.state, 'b').intent.kind).toBe('move');
  });
});

describe('when: enemySighted', () => {
  const when: OrderIntent = {
    kind: 'when',
    trigger: { kind: 'enemySighted', area: AREA },
    then: [MOVE],
  };

  it('fires when the unit sees an enemy in the area', () => {
    const r = run(start(), [[order([when]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toHaveLength(1);
    expect(unit(r.state, 'b').center).toEqual(DEST); // marched to the `then` destination
  });

  it('does not fire for an enemy outside the area', () => {
    const r = run(start({ redX: 1000 }), [[order([when]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toEqual([]);
    expect(unit(r.state, 'b').intent).toEqual({ kind: 'idle' });
  });

  it('does not react to an enemy it cannot see (hidden in a wood)', () => {
    // Red stands in the area but inside a wood, 500 m away: beyond the 200 m covered range.
    const r = run(
      start({ features: [wood('w', 700, 200, 900, 400)] }),
      [[order([when]), 0]],
      30 * MS_PER_MINUTE,
    );
    expect(fired(r.emitted)).toEqual([]);
    expect(unit(r.state, 'b').standing).toHaveLength(1);
  });

  it('does not react to an enemy beyond sight range', () => {
    const far: OrderIntent = {
      kind: 'when',
      trigger: {
        kind: 'enemySighted',
        area: [P(1600, 200), P(1800, 200), P(1800, 400), P(1600, 400)],
      },
      then: [MOVE],
    };
    const r = run(start({ redX: 1700 }), [[order([far]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toEqual([]);
  });

  it('does not use what another unit of its side sees', () => {
    // A second blue unit sees red; b itself is too far away.
    const w = miniWorld({
      units: [
        { id: 'b', side: 'blue', x: 300, y: 1500 },
        { id: 'scout', side: 'blue', x: 600, y: 300 },
        { id: 'r', side: 'red', x: 800, y: 300 },
      ],
    });
    const s = startVisibility(createState(w.seed, w, 0));
    const r = run(s, [[order([when]), 0]], 30 * MS_PER_MINUTE);
    expect(r.state.world.intel.blue.inSight).toContain('r');
    expect(fired(r.emitted)).toEqual([]);
  });
});

describe('when: strengthBelow', () => {
  const when = (strength: number): OrderIntent => ({
    kind: 'when',
    trigger: { kind: 'strengthBelow', strength },
    then: [MOVE],
  });

  it('does not fire while the unit is stronger', () => {
    const r = run(start(), [[order([when(400)]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toEqual([]);
  });

  it('fires once the unit is below the threshold', () => {
    const r = run(start(), [[order([when(500)]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toHaveLength(1);
    expect(unit(r.state, 'b').center).toEqual(DEST); // marched to the `then` destination
  });

  it('fires when casualties take the unit under, at the next scan', () => {
    const s = start();
    const wounded: EngineState<GameState> = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) => (u.id === 'b' ? { ...u, strength: 300 } : u)),
      },
    };
    const r = run(wounded, [[order([when(350)]), 0]], 30 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toHaveLength(1);
  });
});

describe('when: orderReceived', () => {
  const when = (from: string): OrderIntent => ({
    kind: 'when',
    trigger: { kind: 'orderReceived', from },
    then: [MOVE],
  });
  const hold: OrderIntent = { kind: 'hold', at: P(300, 300) };

  it('fires when an order from that sender arrives', () => {
    const r = run(
      start(),
      [
        [order([when('gen-a')], 'o1'), 0],
        [order([hold], 'o2', 'gen-a'), 5 * MS_PER_MINUTE],
      ],
      60 * MS_PER_MINUTE,
    );
    expect(fired(r.emitted)).toHaveLength(1);
    // The standing order overrides the arriving one.
    expect(unit(r.state, 'b').center).toEqual(DEST);
  });

  it('ignores orders from anyone else', () => {
    const r = run(
      start(),
      [
        [order([when('gen-a')], 'o1'), 0],
        [order([hold], 'o2', 'gen-b'), 5 * MS_PER_MINUTE],
        [order([hold], 'o3'), 6 * MS_PER_MINUTE],
      ],
      60 * MS_PER_MINUTE,
    );
    expect(fired(r.emitted)).toEqual([]);
    expect(unit(r.state, 'b').standing).toHaveLength(1);
  });

  it('is not set off by the order that carries it', () => {
    const r = run(start(), [[order([when('hq')]), 0]], 60 * MS_PER_MINUTE);
    expect(fired(r.emitted)).toEqual([]);
    expect(unit(r.state, 'b').standing).toHaveLength(1);
  });

  it("a later order from 'hq' sets off an hq trigger", () => {
    const r = run(
      start(),
      [
        [order([when('hq')], 'o1'), 0],
        [order([hold], 'o2'), 5 * MS_PER_MINUTE],
      ],
      60 * MS_PER_MINUTE,
    );
    expect(fired(r.emitted)).toHaveLength(1);
  });
});

describe('standing orders and the engine rules', () => {
  const t = 25 * MS_PER_MINUTE;
  const intents: OrderIntent[] = [
    { kind: 'when', trigger: { kind: 'enemySighted', area: AREA }, then: [MOVE] },
    { kind: 'at', gameTime: t, then: [{ kind: 'hold', at: P(300, 300) }] },
  ];

  it('advancing in chunks gives the same state and events as in one go', () => {
    const s = issueOrder(start(), order(intents), 0);
    const whole = advanceTo(s, 60 * MS_PER_MINUTE, registry());
    let cur = s;
    const emitted: unknown[] = [];
    for (let m = 1; m <= 60; m++) {
      const r = advanceTo(cur, m * MS_PER_MINUTE, registry());
      cur = r.state;
      emitted.push(...r.emitted);
    }
    expect(cur).toEqual(whole.state);
    expect(emitted).toEqual(whole.emitted);
  });

  it('survives a snapshot round trip mid-wait', () => {
    const s = issueOrder(start({ redX: 1000 }), order(intents), 0);
    const mid = advanceTo(s, 10 * MS_PER_MINUTE, registry()).state;
    const copy = JSON.parse(JSON.stringify(mid)) as EngineState<GameState>;
    expect(advanceTo(copy, 40 * MS_PER_MINUTE, registry())).toEqual(
      advanceTo(mid, 40 * MS_PER_MINUTE, registry()),
    );
  });

  it('a destroyed unit does not act on a standing order', () => {
    const s = issueOrder(start(), order(intents), 0);
    const dead: EngineState<GameState> = {
      ...s,
      world: {
        ...s.world,
        units: s.world.units.map((u) =>
          u.id === 'b' ? { ...u, strength: 0, status: 'destroyed' } : u,
        ),
      },
    };
    const r = advanceTo(dead, 60 * MS_PER_MINUTE, registry());
    expect(fired(r.emitted)).toEqual([]);
  });
});
