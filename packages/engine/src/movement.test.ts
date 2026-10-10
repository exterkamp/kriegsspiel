import { describe, expect, it } from 'vitest';
import {
  EventRegistry,
  MS_PER_MINUTE,
  MS_PER_TILE,
  advanceTo,
  createState,
  findPath,
  holdTheBridge,
  issueHalt,
  issueMove,
  loadScenario,
  pathDuration,
  registerCombat,
  registerMovement,
  serialize,
  stepDuration,
  tileAt,
  type GameState,
  type MapGrid,
  type Terrain,
} from './index.js';

function grid(rows: string[]): MapGrid {
  const legend: Record<string, Terrain> = {
    '.': 'open',
    W: 'wood',
    '~': 'river',
    B: 'bridge',
    '=': 'road',
  };
  return {
    width: rows[0]!.length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => legend[c]!)),
  };
}

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  return r;
}

function game() {
  const g = loadScenario(holdTheBridge);
  return createState(g.seed, g, 0);
}

describe('findPath', () => {
  it('prefers a longer road over a shorter wood crossing', () => {
    const map = grid(['=======', '.WWWWW.', '=======']);
    const p = findPath(map, { x: 0, y: 0 }, { x: 6, y: 2 })!;
    expect(p.tiles.every((t) => tileAt(map, t) !== 'wood')).toBe(true);
    // One open step, 7 road steps (half-units: 2 + 7).
    expect(p.cost).toBe(9);
  });

  it('goes through wood when that is cheaper than going around', () => {
    const map = grid(['.W.']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })!.cost).toBe(6 + 2);
    const wide = grid(['.W.', '...']);
    expect(findPath(wide, { x: 0, y: 0 }, { x: 2, y: 0 })!.cost).toBe(8); // tie: never worse
  });

  it('never crosses the river except at the bridge', () => {
    const map = grid(['..B..', '~~B~~', '..B..']);
    const p = findPath(map, { x: 0, y: 0 }, { x: 0, y: 2 })!;
    expect(p.tiles.every((t) => tileAt(map, t) !== 'river')).toBe(true);
    expect(p.tiles.some((t) => tileAt(map, t) === 'bridge')).toBe(true);
  });

  it('returns null when the river blocks every route or the target is impassable', () => {
    const map = grid(['..', '~~', '..']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 0, y: 2 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it('crosses the real scenario map only over the bridge', () => {
    const g = loadScenario(holdTheBridge);
    const p = findPath(g.map, { x: 18, y: 24 }, { x: 19, y: 4 })!;
    const crossing = p.tiles.filter((t) => t.y === 14 || t.y === 15);
    expect(crossing.every((t) => tileAt(g.map, t) === 'bridge')).toBe(true);
    expect(crossing).toHaveLength(2);
  });

  it('is deterministic', () => {
    const g = loadScenario(holdTheBridge);
    expect(findPath(g.map, { x: 0, y: 0 }, { x: 39, y: 29 })).toEqual(
      findPath(g.map, { x: 0, y: 0 }, { x: 39, y: 29 }),
    );
  });
});

describe('movement events', () => {
  const unit = (s: ReturnType<typeof game>, id: string) => s.world.units.find((u) => u.id === id)!;

  it('arrives exactly when the march rate says', () => {
    // blue-1 (infantry) at (18,24) to the road at (20,24): open, then road... compute from path.
    const s0 = game();
    const g = s0.world;
    const to = { x: 20, y: 24 };
    const expected = 1.5 * MS_PER_MINUTE; // one open tile (1 min) then one road tile (0.5)
    expect(pathDuration(g.map, findPath(g.map, { x: 18, y: 24 }, to)!.tiles, 'infantry')).toBe(
      expected,
    );
    const s1 = issueMove(s0, 'blue-1', to);

    const early = advanceTo(s1, expected - 1, registry());
    expect(early.emitted).toEqual([]);
    expect(unit(early.state, 'blue-1').position).not.toEqual(to);

    const done = advanceTo(early.state, expected, registry());
    expect(done.emitted).toEqual([
      { time: expected, type: 'unit.arrived', payload: { unitId: 'blue-1', at: [20, 24] } },
    ]);
    expect(unit(done.state, 'blue-1').position).toEqual(to);
    expect(unit(done.state, 'blue-1').intent).toEqual({ kind: 'idle' });
  });

  it('infantry cross one open tile in MS_PER_TILE, a road tile in half, wood in triple', () => {
    const map = grid(['.=.W']);
    expect(stepDuration(map, { x: 0, y: 0 }, 'infantry')).toBe(MS_PER_TILE.infantry);
    expect(stepDuration(map, { x: 1, y: 0 }, 'infantry')).toBe(MS_PER_TILE.infantry / 2);
    expect(stepDuration(map, { x: 3, y: 0 }, 'infantry')).toBe(MS_PER_TILE.infantry * 3);
    expect(MS_PER_TILE.infantry).toBe(MS_PER_MINUTE);
    expect(stepDuration(map, { x: 0, y: 0 }, 'cavalry')!).toBeLessThan(MS_PER_TILE.infantry);
  });

  it('cavalry are faster than infantry over the same ground', () => {
    const run = (id: string, from: number) => {
      const s = issueMove(game(), id, { x: from, y: 20 });
      const t = pathDuration(
        s.world.map,
        findPath(s.world.map, unit(s, id).position, { x: from, y: 20 })!.tiles,
        unit(s, id).kind,
      );
      return t;
    };
    expect(run('blue-3', 20)).toBeLessThan(run('blue-1', 20));
  });

  it('moves one tile at a time, as scheduled events', () => {
    const s1 = issueMove(game(), 'blue-1', { x: 18, y: 20 });
    const r = advanceTo(s1, 2 * MS_PER_MINUTE, registry());
    expect(unit(r.state, 'blue-1').position).toEqual({ x: 18, y: 22 });
    expect(r.state.queue).toHaveLength(1);
  });

  it('a new intent interrupts a march; stale steps do nothing', () => {
    const s1 = issueMove(game(), 'blue-1', { x: 20, y: 10 });
    const mid = advanceTo(s1, 2.5 * MS_PER_MINUTE, registry());
    const stopped = unit(mid.state, 'blue-1').position;
    expect(stopped).not.toEqual({ x: 18, y: 24 });
    expect(mid.state.queue).toHaveLength(1);

    const halted = advanceTo(issueHalt(mid.state, 'blue-1'), 60 * MS_PER_MINUTE, registry());
    expect(unit(halted.state, 'blue-1').position).toEqual(stopped);
    expect(halted.emitted).toEqual([]);
    expect(halted.state.queue).toEqual([]);

    const redirected = advanceTo(
      issueMove(mid.state, 'blue-1', { x: 16, y: 24 }),
      60 * MS_PER_MINUTE,
      registry(),
    );
    expect(unit(redirected.state, 'blue-1').position).toEqual({ x: 16, y: 24 });
    expect(redirected.emitted.map((e) => e.type)).toEqual(['unit.arrived']);
  });

  it('reports an unreachable destination and stays put', () => {
    const r = advanceTo(issueMove(game(), 'blue-1', { x: 5, y: 14 }), 0, registry());
    expect(r.emitted.map((e) => e.type)).toEqual(['unit.moveBlocked']);
    expect(unit(r.state, 'blue-1').position).toEqual({ x: 18, y: 24 });
  });

  it('a rejected order does not stop a march already under way', () => {
    const s = advanceTo(
      issueMove(game(), 'blue-1', { x: 18, y: 20 }),
      1.5 * MS_PER_MINUTE,
      registry(),
    );
    const r = advanceTo(
      issueMove(s.state, 'blue-1', { x: 5, y: 14 }),
      10 * MS_PER_MINUTE,
      registry(),
    );
    expect(r.emitted.map((e) => e.type)).toEqual(['unit.moveBlocked', 'unit.arrived']);
    expect(unit(r.state, 'blue-1').position).toEqual({ x: 18, y: 20 });
  });

  it('re-issuing a move to the same destination kills the old step chain', () => {
    const to = { x: 18, y: 20 };
    const first = advanceTo(issueMove(game(), 'blue-1', to), 1.5 * MS_PER_MINUTE, registry());
    const again = advanceTo(issueMove(first.state, 'blue-1', to), first.state.time, registry());
    // The old step event is still queued but stale, plus the new order's first step.
    expect(again.state.queue).toHaveLength(2);
    const done = advanceTo(again.state, 60 * MS_PER_MINUTE, registry());
    // Replanned from (18,23) at 1.5 min: three open tiles, so 4.5 min. The stale
    // old chain would have arrived at 4 min.
    expect(done.emitted.map((e) => [e.time, e.type])).toEqual([
      [4.5 * MS_PER_MINUTE, 'unit.arrived'],
    ]);
    expect(unit(done.state, 'blue-1').position).toEqual(to);
    expect(done.state.queue).toEqual([]);
  });

  it('orders for an unknown unit are rejected without wedging the queue', () => {
    const s = issueHalt(issueMove(game(), 'nobody', { x: 1, y: 1 }), 'ghost');
    const r = advanceTo(issueMove(s, 'blue-1', { x: 18, y: 23 }), 5 * MS_PER_MINUTE, registry());
    expect(r.emitted.map((e) => e.type)).toEqual([
      'order.rejected',
      'order.rejected',
      'unit.arrived',
    ]);
    expect(r.state.queue).toEqual([]);
  });

  it('red can cross the bridge and reach the objective', () => {
    const r = advanceTo(
      issueMove(game(), 'red-1', { x: 20, y: 14 }),
      200 * MS_PER_MINUTE,
      registry(),
    );
    expect(unit(r.state, 'red-1').position).toEqual({ x: 20, y: 14 });
  });

  it('gives the same result however the clock is chunked, and does not mutate input', () => {
    const s = issueMove(issueMove(game(), 'blue-1', { x: 20, y: 5 }), 'red-3', { x: 20, y: 20 });
    const before = serialize(s);
    const whole = advanceTo(s, 90 * MS_PER_MINUTE, registry());
    let chunked = s;
    const emitted = [];
    for (let t = 7000; ; t += 7000) {
      const r = advanceTo(chunked, Math.min(t, 90 * MS_PER_MINUTE), registry());
      chunked = r.state;
      emitted.push(...r.emitted);
      if (t >= 90 * MS_PER_MINUTE) break;
    }
    expect(serialize(chunked)).toBe(serialize(whole.state));
    expect(emitted).toEqual(whole.emitted);
    expect(serialize(s)).toBe(before);
  });

  it('survives a JSON snapshot mid-march', () => {
    const s = issueMove(game(), 'blue-1', { x: 20, y: 5 });
    const mid = advanceTo(s, 5 * MS_PER_MINUTE, registry()).state;
    const resumed = JSON.parse(JSON.stringify(mid)) as typeof mid;
    expect(serialize(advanceTo(resumed, 60 * MS_PER_MINUTE, registry()).state)).toBe(
      serialize(advanceTo(mid, 60 * MS_PER_MINUTE, registry()).state),
    );
  });
});
