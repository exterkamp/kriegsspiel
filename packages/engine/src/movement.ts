import { ATTACK_INTENT_EVENT, COMBAT_CHECK_EVENT, canReach } from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import { distance } from './geometry.js';
import { schedule } from './queue.js';
import { segmentCost, segmentPassable, terrainAt } from './terrain.js';
import {
  MS_PER_MINUTE,
  type GameState,
  type Intent,
  type Point,
  type TerrainMap,
  type Unit,
  type UnitKind,
} from './types.js';

/**
 * Game milliseconds to march one metre of cost-1 ground. Infantry cover 100 m a minute
 * (about the 1824 route-march ruler of 200 paces per 2-minute move), cavalry 300 m
 * (trot), artillery 66.7 m. Whole numbers keep times integral.
 */
export const MS_PER_METRE: Record<UnitKind, number> = {
  infantry: MS_PER_MINUTE / 100,
  cavalry: MS_PER_MINUTE / 300,
  artillery: (MS_PER_MINUTE * 3) / 200,
};

/**
 * Route planning is a stopgap until movement is reworked for continuous space (see
 * docs/decisions.md D15): A* over a private lattice of this pitch, with the lattice
 * start and goal joined by straight legs. The lattice is not part of the model: paths
 * are lists of free points and can be any shape.
 */
const ROUTE_PITCH_MM = 100_000;

/**
 * A march is stepped at most this far at a time (100 m), so contact, the objective and an
 * attacker's range are checked at least that often along a long straight leg.
 */
export const MAX_STEP_MM = 100_000;

/** Split legs longer than `MAX_STEP_MM` into equal collinear steps. */
function stepped(waypoints: Point[]): Point[] {
  const out: Point[] = [waypoints[0]!];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    const n = Math.max(1, Math.ceil(distance(a, b) / MAX_STEP_MM));
    for (let k = 1; k < n; k++) {
      out.push({
        x: Math.round(a.x + ((b.x - a.x) * k) / n),
        y: Math.round(a.y + ((b.y - a.y) * k) / n),
      });
    }
    out.push(b);
  }
  return out;
}

/** A route as free points, `from` first and `to` last, and its cost in mm weighted by ground. */
export interface Path {
  waypoints: Point[];
  cost: number;
}

/** Game ms for a unit of `kind` to march from `a` to `b` in a straight line, or null if blocked. */
export function legDuration(map: TerrainMap, a: Point, b: Point, kind: UnitKind): number | null {
  if (!segmentPassable(map, a, b)) return null;
  return Math.round((segmentCost(map, a, b) / 1000) * MS_PER_METRE[kind]);
}

/** Game ms to march `waypoints` in turn (the first is where the unit already stands). */
export function pathDuration(map: TerrainMap, waypoints: Point[], kind: UnitKind): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += legDuration(map, waypoints[i - 1] as Point, waypoints[i] as Point, kind) ?? Infinity;
  }
  return total;
}

function passable(map: TerrainMap, p: Point): boolean {
  return terrainAt(map, p)?.attrs.passable === true;
}

/** Cheapest ground multiplier on the map, so the A* heuristic never overestimates. */
function cheapest(map: TerrainMap): number {
  let c = 1;
  for (const f of map.features) if (f.attrs.passable) c = Math.min(c, f.attrs.moveCost);
  return c;
}

/**
 * Plan a route from `from` to `to` over passable ground, preferring cheap ground (roads) over
 * short ground (woods). Deterministic: ties on f are broken by smaller h, then by node
 * index. Returns null if either end is impassable or off the map, or no route exists.
 */
export function findPath(map: TerrainMap, from: Point, to: Point): Path | null {
  if (!passable(map, from) || !passable(map, to)) return null;
  if (from.x === to.x && from.y === to.y) return { waypoints: [{ ...from }], cost: 0 };

  const cols = Math.ceil(map.width / ROUTE_PITCH_MM);
  const rows = Math.ceil(map.height / ROUTE_PITCH_MM);
  // Nodes: 0 is `from`, 1 is `to`, then lattice cells row by row.
  const cellNode = (c: number, r: number) => 2 + r * cols + c;
  const centre = (c: number, r: number): Point => ({
    x: Math.round(
      c * ROUTE_PITCH_MM + Math.min(ROUTE_PITCH_MM, map.width - c * ROUTE_PITCH_MM) / 2,
    ),
    y: Math.round(
      r * ROUTE_PITCH_MM + Math.min(ROUTE_PITCH_MM, map.height - r * ROUTE_PITCH_MM) / 2,
    ),
  });
  const point = (n: number): Point =>
    n === 0 ? from : n === 1 ? to : centre((n - 2) % cols, Math.floor((n - 2) / cols));
  const okCell = new Map<number, boolean>();
  const cellOk = (n: number) => {
    let v = okCell.get(n);
    if (v === undefined) {
      v = passable(map, point(n));
      okCell.set(n, v);
    }
    return v;
  };
  const cellOf = (p: Point) => ({
    c: Math.min(cols - 1, Math.floor(p.x / ROUTE_PITCH_MM)),
    r: Math.min(rows - 1, Math.floor(p.y / ROUTE_PITCH_MM)),
  });
  const around = (p: Point): number[] => {
    const { c, r } = cellOf(p);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && cellOk(cellNode(cc, rr))) {
          out.push(cellNode(cc, rr));
        }
      }
    }
    return out;
  };
  const toCells = around(to);

  const neighbours = (n: number): number[] => {
    if (n === 0) return [1, ...around(from)];
    if (n === 1) return [];
    const c = (n - 2) % cols;
    const r = Math.floor((n - 2) / cols);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && cellOk(cellNode(cc, rr))) {
          out.push(cellNode(cc, rr));
        }
      }
    }
    if (toCells.includes(n)) out.push(1);
    return out;
  };

  const minCost = cheapest(map);
  const h = (n: number) => distance(point(n), to) * minCost;
  const g = new Map<number, number>([[0, 0]]);
  const prev = new Map<number, number>();
  const closed = new Set<number>();
  const open: Array<{ f: number; h: number; n: number }> = [{ f: h(0), h: h(0), n: 0 }];
  const less = (a: (typeof open)[number], b: (typeof open)[number]) =>
    a.f - b.f || a.h - b.h || a.n - b.n;

  while (open.length > 0) {
    // Pop the minimum (maps are small, so a scan beats a heap for clarity).
    let best = 0;
    for (let k = 1; k < open.length; k++) if (less(open[k]!, open[best]!) < 0) best = k;
    const cur = open.splice(best, 1)[0]!;
    if (closed.has(cur.n)) continue;
    closed.add(cur.n);
    if (cur.n === 1) {
      const chain: number[] = [];
      for (let n: number | undefined = 1; n !== undefined; n = prev.get(n)) chain.push(n);
      return smooth(map, chain.reverse().map(point), g.get(1)!);
    }
    for (const m of neighbours(cur.n)) {
      if (closed.has(m)) continue;
      const a = point(cur.n);
      const b = point(m);
      if (!segmentPassable(map, a, b)) continue;
      const ng = g.get(cur.n)! + segmentCost(map, a, b);
      if (ng < (g.get(m) ?? Infinity)) {
        g.set(m, ng);
        prev.set(m, cur.n);
        open.push({ f: ng + h(m), h: h(m), n: m });
      }
    }
  }
  return null;
}

/**
 * Drop waypoints that a straight leg can skip without costing more, so routes are free
 * lines rather than lattice staircases.
 */
function smooth(map: TerrainMap, pts: Point[], total: number): Path {
  const legs = [0];
  for (let i = 1; i < pts.length; i++) {
    legs.push(legs[i - 1]! + segmentCost(map, pts[i - 1]!, pts[i]!));
  }
  const out: Point[] = [pts[0]!];
  let cost = 0;
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      if (
        segmentPassable(map, pts[i]!, pts[j]!) &&
        segmentCost(map, pts[i]!, pts[j]!) <= legs[j]! - legs[i]!
      ) {
        break;
      }
    }
    cost += j === i + 1 ? legs[j]! - legs[i]! : segmentCost(map, pts[i]!, pts[j]!);
    out.push({ ...pts[j]! });
    i = j;
  }
  return { waypoints: out, cost: Math.min(cost, total) };
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
  /** Flat x,y pairs (mm): the point just left, then the waypoints still to reach, nearest first. */
  path: number[];
}

function updateUnit(world: GameState, unitId: string, patch: Partial<Unit>, time: number) {
  return {
    ...world,
    time,
    units: world.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)),
  };
}

function scheduleStep(map: TerrainMap, kind: UnitKind, now: number, p: StepPayload): NewEvent {
  const prev = { x: p.path[0]!, y: p.path[1]! }; // the point just left
  const next = { x: p.path[2]!, y: p.path[3]! };
  return {
    time: now + legDuration(map, prev, next, kind)!,
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
  const path = findPath(world.map, unit.center, dest);
  if (!path) {
    return {
      world: updateUnit(world, unit.id, {}, time),
      emit: [{ type: 'unit.moveBlocked', payload: { unitId: unit.id, to } }],
    };
  }
  if (path.waypoints.length === 1) {
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
    path: stepped(path.waypoints).flatMap((t) => [t.x, t.y]),
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
 * plans a route from where the unit stands now and schedules one step event per
 * leg, each firing when the unit reaches the end of that leg. A newer intent
 * makes the old order's pending steps stale, and they do nothing when they fire.
 * An interrupted unit stays at the last waypoint it reached. An order that
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
    const center = { x: p.path[2]!, y: p.path[3]! };
    const rest = p.path.slice(2);
    // Every step may start or end a contact, or put a unit on the objective.
    const check: NewEvent = { time: ev.time, type: COMBAT_CHECK_EVENT };
    if (i.kind === 'attack') {
      const foe = world.units.find((u) => u.id === i.target);
      if (!foe || foe.status !== 'active') {
        return {
          world: updateUnit(world, p.unitId, { center, intent: { kind: 'idle' } }, ev.time),
          schedule: [check],
        };
      }
      const arrived = rest.length === 2;
      if (canReach({ ...unit, center }, foe)) {
        // In reach: stop here. `to` becomes the stopping point, so the unit counts as
        // stopped and `combat.check` re-plans it if the foe later walks out of reach.
        return {
          world: updateUnit(world, p.unitId, { center, intent: { ...i, to: center } }, ev.time),
          schedule: [check],
        };
      }
      if (arrived) {
        // The foe moved on; plan a fresh march toward where it is now.
        return {
          world: updateUnit(world, p.unitId, { center }, ev.time),
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
        i.kind === 'move' && i.thenHold ? { kind: 'hold', at: center } : { kind: 'idle' };
      return {
        world: updateUnit(world, p.unitId, { center, intent }, ev.time),
        emit: [{ type: 'unit.arrived', payload: { unitId: p.unitId, at: p.to } }],
        schedule: [check],
      };
    }
    return {
      world: updateUnit(world, p.unitId, { center }, ev.time),
      schedule: [check, scheduleStep(world.map, unit.kind, ev.time, { ...p, path: rest })],
    };
  });
}
