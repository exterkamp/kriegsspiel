import { ATTACK_INTENT_EVENT, COMBAT_CHECK_EVENT, canReach } from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import { schedule } from './queue.js';
import {
  MS_PER_MINUTE,
  tileAt,
  type GameState,
  type Intent,
  type MapGrid,
  type Point,
  type Terrain,
  type Unit,
  type UnitKind,
} from './types.js';

/**
 * Cost to enter a tile, in half-units so every time stays an integer
 * (road 0.5, open 1, wood 3). `null` means impassable. A bridge is the only
 * way over the river and costs the same as open ground.
 */
const TERRAIN_COST_HALVES: Record<Terrain, number | null> = {
  road: 1,
  open: 2,
  bridge: 2,
  wood: 6,
  river: null,
};

/**
 * Game milliseconds to cross one open-ground tile (cost 1). A tile is taken as
 * 100 paces: infantry 1 tile/min (about the 1824 route-march ruler of 200
 * paces per 2-minute move), cavalry 3 tiles/min (trot), artillery 2/3 tile/min.
 * Even values keep half-cost steps integral.
 */
export const MS_PER_TILE: Record<UnitKind, number> = {
  infantry: MS_PER_MINUTE,
  cavalry: MS_PER_MINUTE / 3,
  artillery: (MS_PER_MINUTE * 3) / 2,
};

/** Cost in half-units to enter `p`, or `null` if it is off the map or impassable. */
export function enterCost(map: MapGrid, p: Point): number | null {
  const t = tileAt(map, p);
  return t === undefined ? null : TERRAIN_COST_HALVES[t];
}

/** Game ms for a unit of `kind` to enter `p`, or `null` if it cannot. */
export function stepDuration(map: MapGrid, p: Point, kind: UnitKind): number | null {
  const c = enterCost(map, p);
  return c === null ? null : (c * MS_PER_TILE[kind]) / 2;
}

export interface Path {
  /** Tiles from `from` to `to` inclusive. */
  tiles: Point[];
  /** Total cost in half-units. */
  cost: number;
}

const NEIGHBOURS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * A* over the 4-connected grid with terrain costs. Deterministic: ties on
 * f are broken by smaller h, then by tile index. Returns null if `to` cannot
 * be reached (or either end is impassable or off the map).
 */
export function findPath(map: MapGrid, from: Point, to: Point): Path | null {
  if (enterCost(map, from) === null || enterCost(map, to) === null) return null;
  const idx = (p: Point) => p.y * map.width + p.x;
  const h = (p: Point) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y); // min step cost is 1 half-unit
  const g = new Map<number, number>([[idx(from), 0]]);
  const prev = new Map<number, number>();
  const closed = new Set<number>();
  const open: Array<{ f: number; h: number; i: number }> = [
    { f: h(from), h: h(from), i: idx(from) },
  ];
  const less = (a: (typeof open)[number], b: (typeof open)[number]) =>
    a.f - b.f || a.h - b.h || a.i - b.i;

  while (open.length > 0) {
    // Pop the minimum (maps are small, so a scan beats a heap for clarity).
    let best = 0;
    for (let k = 1; k < open.length; k++) if (less(open[k]!, open[best]!) < 0) best = k;
    const cur = open.splice(best, 1)[0]!;
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    const cx = cur.i % map.width;
    const cy = (cur.i - cx) / map.width;
    if (cx === to.x && cy === to.y) {
      const tiles: Point[] = [];
      for (let i: number | undefined = cur.i; i !== undefined; i = prev.get(i)) {
        const x = i % map.width;
        tiles.push({ x, y: (i - x) / map.width });
      }
      return { tiles: tiles.reverse(), cost: g.get(cur.i)! };
    }
    for (const d of NEIGHBOURS) {
      const n = { x: cx + d.x, y: cy + d.y };
      const c = enterCost(map, n);
      if (c === null) continue;
      const ni = idx(n);
      if (closed.has(ni)) continue;
      const ng = g.get(cur.i)! + c;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        prev.set(ni, cur.i);
        open.push({ f: ng + h(n), h: h(n), i: ni });
      }
    }
  }
  return null;
}

/** Game ms to walk `path` as a unit of `kind` (the first tile is where it already stands). */
export function pathDuration(map: MapGrid, path: Point[], kind: UnitKind): number {
  let total = 0;
  for (const p of path.slice(1)) total += stepDuration(map, p, kind) ?? Infinity;
  return total;
}

export const MOVE_INTENT_EVENT = 'intent.move';
export const HALT_INTENT_EVENT = 'intent.halt';
export const MOVE_STEP_EVENT = 'move.step';

/** Queue an order for `unitId` to move to `to`, firing at `time` (default: now). */
export function issueMove(
  state: EngineState<GameState>,
  unitId: string,
  to: Point,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [
    { time, type: MOVE_INTENT_EVENT, payload: { unitId, to: [to.x, to.y] } },
  ]);
}

/** Queue an order for `unitId` to stop where it is, firing at `time` (default: now). */
export function issueHalt(
  state: EngineState<GameState>,
  unitId: string,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [{ time, type: HALT_INTENT_EVENT, payload: { unitId } }]);
}

interface MovePayload {
  unitId: string;
  to: [number, number];
}

interface StepPayload {
  unitId: string;
  startedAt: number;
  to: [number, number];
  /** Flat x,y pairs of the tiles still to enter, nearest first. */
  path: number[];
}

function updateUnit(world: GameState, unitId: string, patch: Partial<Unit>, time: number) {
  return {
    ...world,
    time,
    units: world.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)),
  };
}

function scheduleStep(map: MapGrid, kind: UnitKind, now: number, p: StepPayload): NewEvent {
  const next = { x: p.path[2]!, y: p.path[3]! }; // path[0..1] is the tile just left
  return {
    time: now + stepDuration(map, next, kind)!,
    type: MOVE_STEP_EVENT,
    payload: p as unknown as Json,
  };
}

/** An order for a unit that does not exist is rejected, so one bad id cannot wedge the queue. */
function rejectUnknown(world: GameState, unitId: string) {
  return rejectOrder(world, unitId, 'unknown unit');
}

export function rejectOrder(world: GameState, unitId: string, reason: string) {
  return { world, emit: [{ type: 'order.rejected', payload: { unitId, reason } }] };
}

/** The destination a march intent is heading for, or undefined if the intent is not a march. */
function marchTarget(i: Intent): Point | undefined {
  return i.kind === 'move' || i.kind === 'attack'
    ? i.to
    : i.kind === 'withdraw'
      ? i.toward
      : undefined;
}

/**
 * Start `unit` marching to `dest` at `time`, as a plain move, a withdrawal, a move that
 * ends in a hold, or (with `attackTarget`) an attack march that the combat code takes
 * over once the target is in reach. Shared by move orders, attack orders and delivered
 * courier orders. An unreachable destination is reported and leaves any march under way alone.
 */
export function beginMarch(
  world: GameState,
  unit: Unit,
  dest: Point,
  time: number,
  how: 'move' | 'withdraw' | 'hold' | 'attack' = 'move',
  attackTarget?: string,
): HandlerResult<GameState> {
  const to: [number, number] = [dest.x, dest.y];
  const path = findPath(world.map, unit.position, dest);
  if (!path) {
    return {
      world: updateUnit(world, unit.id, {}, time),
      emit: [{ type: 'unit.moveBlocked', payload: { unitId: unit.id, to } }],
    };
  }
  if (path.tiles.length === 1) {
    if (how === 'attack' && attackTarget) {
      const intent: Intent = { kind: 'attack', target: attackTarget, to: dest, startedAt: time };
      return { world: updateUnit(world, unit.id, { intent }, time) };
    }
    const intent: Intent = how === 'hold' ? { kind: 'hold', at: dest } : { kind: 'idle' };
    return {
      world: updateUnit(world, unit.id, { intent }, time),
      emit: [{ type: 'unit.arrived', payload: { unitId: unit.id, at: to } }],
    };
  }
  const intent: Intent =
    how === 'attack' && attackTarget
      ? { kind: 'attack', target: attackTarget, to: dest, startedAt: time }
      : how === 'withdraw'
        ? { kind: 'withdraw', toward: dest, startedAt: time }
        : how === 'hold'
          ? { kind: 'move', to: dest, startedAt: time, thenHold: true }
          : { kind: 'move', to: dest, startedAt: time };
  const step: StepPayload = {
    unitId: unit.id,
    startedAt: time,
    to,
    path: path.tiles.flatMap((t) => [t.x, t.y]),
  };
  return {
    world: updateUnit(world, unit.id, { intent }, time),
    schedule: [scheduleStep(world.map, unit.kind, time, step)],
  };
}

/** Plan a march for `unit` to `dest`; with `attackTarget` the intent becomes `attack`. */
export function startMarch(
  world: GameState,
  unit: Unit,
  dest: Point,
  time: number,
  attackTarget?: string,
): HandlerResult<GameState> {
  return attackTarget
    ? beginMarch(world, unit, dest, time, 'attack', attackTarget)
    : beginMarch(world, unit, dest, time, 'move');
}

/**
 * Register the movement handlers. Movement is event-driven: a move order
 * plans a path from where the unit stands now and schedules one step event per
 * tile, each firing when the unit finishes entering that tile. A newer intent
 * makes the old order's pending steps stale, and they do nothing when they fire.
 * An interrupted unit stays on the last tile it completed. An order that
 * cannot be carried out (unknown unit, unreachable destination) is reported
 * and changes nothing else.
 */
export function registerMovement(registry: EventRegistry<GameState>): void {
  registry.register(MOVE_INTENT_EVENT, (world, ev) => {
    const { unitId, to } = ev.payload as unknown as MovePayload;
    const unit = world.units.find((u) => u.id === unitId);
    if (!unit) return rejectUnknown(world, unitId);
    if (unit.status !== 'active') return rejectOrder(world, unitId, 'unit not active');
    return beginMarch(world, unit, { x: to[0], y: to[1] }, ev.time);
  });

  registry.register(HALT_INTENT_EVENT, (world, ev) => {
    const { unitId } = ev.payload as unknown as { unitId: string };
    if (!world.units.some((u) => u.id === unitId)) return rejectUnknown(world, unitId);
    return { world: updateUnit(world, unitId, { intent: { kind: 'idle' } }, ev.time) };
  });

  registry.register(MOVE_STEP_EVENT, (world, ev) => {
    const p = ev.payload as unknown as StepPayload;
    const unit = world.units.find((u) => u.id === p.unitId);
    const i = unit?.intent;
    const target = i && marchTarget(i);
    if (
      !unit ||
      !i ||
      !target ||
      (i.kind !== 'move' && i.kind !== 'withdraw' && i.kind !== 'attack') ||
      i.startedAt !== p.startedAt ||
      target.x !== p.to[0] ||
      target.y !== p.to[1]
    ) {
      return { world }; // superseded by a newer intent
    }
    const position = { x: p.path[2]!, y: p.path[3]! };
    const rest = p.path.slice(2);
    // Every step may start or end a contact, or put a unit on the objective.
    const check: NewEvent = { time: ev.time, type: COMBAT_CHECK_EVENT };
    if (i.kind === 'attack') {
      const foe = world.units.find((u) => u.id === i.target);
      if (!foe || foe.status !== 'active') {
        return {
          world: updateUnit(world, p.unitId, { position, intent: { kind: 'idle' } }, ev.time),
          schedule: [check],
        };
      }
      const arrived = rest.length === 2;
      if (canReach({ ...unit, position }, foe)) {
        return { world: updateUnit(world, p.unitId, { position }, ev.time), schedule: [check] };
      }
      if (arrived) {
        // The foe moved on; plan a fresh march toward where it is now.
        return {
          world: updateUnit(world, p.unitId, { position }, ev.time),
          schedule: [
            check,
            {
              time: ev.time,
              type: ATTACK_INTENT_EVENT,
              payload: { unitId: p.unitId, target: i.target },
            },
          ],
        };
      }
    } else if (rest.length === 2) {
      const intent: Intent =
        i.kind === 'move' && i.thenHold ? { kind: 'hold', at: position } : { kind: 'idle' };
      return {
        world: updateUnit(world, p.unitId, { position, intent }, ev.time),
        emit: [{ type: 'unit.arrived', payload: { unitId: p.unitId, at: p.to } }],
        schedule: [check],
      };
    }
    return {
      world: updateUnit(world, p.unitId, { position }, ev.time),
      schedule: [check, scheduleStep(world.map, unit.kind, ev.time, { ...p, path: rest })],
    };
  });
}
