import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  Rng,
  advanceTo,
  createState,
  deserialize,
  schedule,
  seedRng,
  serialize,
  type EngineState,
  type NewEvent,
} from './index.js';

interface World {
  log: string[];
  total: number;
}

/** Registry exercising rng use, rescheduling, same-time events and emits. */
function makeRegistry(): EventRegistry<World> {
  return new EventRegistry<World>()
    .register('roll', (w, ev, rng) => {
      const d = rng.die(6);
      return {
        world: { log: [...w.log, `roll@${ev.time}#${ev.seq}=${d}`], total: w.total + d },
        schedule: d >= 5 ? [{ type: 'roll', time: ev.time + d }] : [],
        emit: [{ type: 'rolled', payload: d }],
      };
    })
    .register('mark', (w, ev) => ({
      world: { ...w, log: [...w.log, `mark@${ev.time}#${ev.seq}`] },
      schedule: [{ type: 'mark2', time: ev.time }],
    }))
    .register('mark2', (w, ev) => ({
      world: { ...w, log: [...w.log, `mark2@${ev.time}#${ev.seq}`] },
    }));
}

function randomEvents(rng: Rng): NewEvent[] {
  const n = rng.int(0, 15);
  return Array.from({ length: n }, () => ({
    type: rng.next() < 0.7 ? 'roll' : 'mark',
    time: rng.int(0, 60),
  }));
}

function start(seed: number, events: NewEvent[]): EngineState<World> {
  return schedule(createState<World>(seed, { log: [], total: 0 }), events);
}

describe('Rng', () => {
  it('is deterministic and restorable', () => {
    const a = new Rng(seedRng(42));
    a.next();
    a.next();
    const b = new Rng(a.getState());
    expect([a.next(), a.next(), a.int(1, 100)]).toEqual([b.next(), b.next(), b.int(1, 100)]);
  });

  it('stays in range', () => {
    const r = new Rng(seedRng(1));
    for (let i = 0; i < 1000; i++) {
      const d = r.die(6);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('different seeds differ', () => {
    expect(new Rng(seedRng(1)).next()).not.toBe(new Rng(seedRng(2)).next());
  });
});

describe('event ordering', () => {
  it('fires by time, then by insertion sequence', () => {
    const reg = new EventRegistry<World>().register('x', (w, ev) => ({
      world: { ...w, log: [...w.log, String(ev.payload)] },
    }));
    const s = schedule(createState<World>(1, { log: [], total: 0 }), [
      { type: 'x', time: 10, payload: 'c' },
      { type: 'x', time: 5, payload: 'a' },
      { type: 'x', time: 10, payload: 'd' },
      { type: 'x', time: 5, payload: 'b' },
    ]);
    expect(advanceTo(s, 20, reg).state.world.log).toEqual(['a', 'b', 'c', 'd']);
  });

  it('runs events scheduled for the same instant within the same call', () => {
    const s = start(1, [{ type: 'mark', time: 3 }]);
    const { state } = advanceTo(s, 3, makeRegistry());
    expect(state.world.log).toEqual(['mark@3#0', 'mark2@3#1']);
  });

  it('leaves later events queued and sets the clock', () => {
    const s = start(1, [{ type: 'mark', time: 50 }]);
    const { state } = advanceTo(s, 10, makeRegistry());
    expect(state.time).toBe(10);
    expect(state.queue).toHaveLength(1);
  });

  it('rejects scheduling in the past, backwards advance and unknown types', () => {
    const s = advanceTo(start(1, []), 10, makeRegistry()).state;
    expect(() => schedule(s, [{ type: 'mark', time: 9 }])).toThrow();
    expect(() => advanceTo(s, 5, makeRegistry())).toThrow();
    expect(() => advanceTo(schedule(s, [{ type: 'nope', time: 11 }]), 12, makeRegistry())).toThrow(
      /no handler/,
    );
  });

  it('does not mutate the input state', () => {
    const s = start(7, [{ type: 'roll', time: 1 }]);
    const before = serialize(s);
    advanceTo(s, 100, makeRegistry());
    expect(serialize(s)).toBe(before);
  });
});

describe('determinism properties', () => {
  it('chunked advance equals single advance (random cases)', () => {
    const gen = new Rng(seedRng(2024));
    for (let i = 0; i < 200; i++) {
      const seed = gen.int(0, 1_000_000);
      const events = randomEvents(gen);
      const cuts = Array.from({ length: gen.int(1, 5) }, () => gen.int(0, 200)).sort(
        (a, b) => a - b,
      );
      const end = cuts[cuts.length - 1]!;

      const whole = advanceTo(start(seed, events), end, makeRegistry());

      let s = start(seed, events);
      const emitted = [];
      for (const c of cuts) {
        const r = advanceTo(s, c, makeRegistry());
        s = r.state;
        emitted.push(...r.emitted);
      }
      expect(s).toEqual(whole.state);
      expect(emitted).toEqual(whole.emitted);
    }
  });

  it('same state and inputs give identical results', () => {
    const a = advanceTo(start(5, [{ type: 'roll', time: 0 }]), 500, makeRegistry());
    const b = advanceTo(start(5, [{ type: 'roll', time: 0 }]), 500, makeRegistry());
    expect(a).toEqual(b);
  });
});

describe('serialisation', () => {
  it('can be saved mid-run and resumed identically', () => {
    const gen = new Rng(seedRng(99));
    for (let i = 0; i < 50; i++) {
      const seed = gen.int(0, 1_000_000);
      const events = randomEvents(gen);
      const mid = gen.int(0, 80);

      const straight = advanceTo(start(seed, events), 300, makeRegistry());

      const first = advanceTo(start(seed, events), mid, makeRegistry());
      const restored = deserialize<World>(serialize(first.state));
      expect(restored).toEqual(first.state);
      const rest = advanceTo(restored, 300, makeRegistry());

      expect(rest.state).toEqual(straight.state);
      expect([...first.emitted, ...rest.emitted]).toEqual(straight.emitted);
    }
  });
});
