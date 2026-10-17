import { heldTurn } from './held.js';
import {
  ATTACK_INTENT_EVENT,
  COMBAT_CHECK_EVENT,
  bearingTo,
  canReach,
  closesToMelee,
  crossingPoint,
  hasClosed,
  pursuable,
} from './contact.js';
import type { EngineState, EventRegistry, HandlerResult, Json, NewEvent } from './events.js';
import { distance, mm } from './geometry.js';
import { FATIGUE_PER_MARCH_MINUTE, type Pace } from './fatigue.js';
import { schedule } from './queue.js';
import { noteWear } from './supply.js';
import { MS_PER_MINUTE, contactLine } from './types.js';
import { defaultFootprint } from './formation.js';
import { findPath, legCost } from './navigation.js';
import { profileAlong } from './terrain.js';
import { msPerMetreOf, unitTypeOf } from './unitTypes.js';
import {
  type Formation,
  type GameState,
  type GameTime,
  type Intent,
  type Leg,
  type Point,
  type TerrainMap,
  type Unit,
  type UnitKind,
} from './types.js';

/**
 * Game milliseconds to march one metre of cost-1 ground, for each arm's default type in its
 * base formation. A unit's own pace comes from its type and formation (`msPerMetreOf`).
 */
export const MS_PER_METRE: Record<UnitKind, number> = {
  infantry: msPerMetreOf('infantry'),
  cavalry: msPerMetreOf('cavalry'),
  artillery: msPerMetreOf('artillery'),
};

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

/** Who marches: a unit (its type and formation set the pace) or a bare arm (base pace). */
export type Mover = Pick<Unit, 'type' | 'kind' | 'formation'> | UnitKind;

/** Game ms for `mover` to march from `a` to `b` in a straight line, or null if blocked. */
export function legDuration(map: TerrainMap, a: Point, b: Point, mover: Mover): number | null {
  const cost = legCost(map, a, b);
  return cost === null ? null : Math.round((cost / 1000) * msPerMetreOf(mover));
}

/**
 * Where a unit of `kind` is `elapsed` game ms after leaving `a` for `b`: it walks each stretch
 * of ground at that ground's rate, so it is part way along a wood when a wood is slow.
 */
export function positionAlong(
  map: TerrainMap,
  a: Point,
  b: Point,
  mover: Mover | { msPerMetre: number },
  elapsed: number,
): Point {
  const rate =
    typeof mover === 'object' && 'msPerMetre' in mover ? mover.msPerMetre : msPerMetreOf(mover);
  let left = (Math.max(0, elapsed) / rate) * 1000; // cost-mm still to spend
  for (const piece of profileAlong(map, a, b)) {
    const cost = piece.length * piece.attrs.moveCost;
    if (left < cost) {
      const t = piece.t0 + (piece.t1 - piece.t0) * (left / cost);
      return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) };
    }
    left -= cost;
  }
  return { ...b };
}

/** Where the unit stands at `time`: part way along its current leg if it is marching one. */
export function positionAt(map: TerrainMap, unit: Unit, time: GameTime): Point {
  const leg = unit.leg;
  if (!leg || !marchTarget(unit.intent) || time <= leg.startedAt) return unit.center;
  // `center` only advances when the step event fires, so at the arrival instant (an order can
  // sort ahead of that event) the leg's end is where the unit stands.
  if (time >= leg.arriveAt) return leg.to;
  // The leg is walked at the rate it was timed with, however pace or fatigue have moved since.
  const mover = leg.msPerMetre === undefined ? unit : { msPerMetre: leg.msPerMetre };
  return positionAlong(map, leg.from, leg.to, mover, time - leg.startedAt);
}

/** Game ms to march `waypoints` in turn (the first is where the unit already stands). */
export function pathDuration(map: TerrainMap, waypoints: Point[], mover: Mover): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += legDuration(map, waypoints[i - 1] as Point, waypoints[i] as Point, mover) ?? Infinity;
  }
  return total;
}

/**
 * Game ms the default type of each arm stands still to change formation (column to line and
 * back, going into square). A unit's own time is its type's `formationChangeMs`.
 */
export const FORMATION_CHANGE_MS: Record<UnitKind, number> = {
  infantry: unitTypeOf('infantry').formationChangeMs,
  cavalry: unitTypeOf('cavalry').formationChangeMs,
  artillery: unitTypeOf('artillery').formationChangeMs,
};

export const MOVE_INTENT_EVENT = 'intent.move';
export const FORMATION_INTENT_EVENT = 'intent.formation';
export const FORMATION_DONE_EVENT = 'formation.done';
export const HALT_INTENT_EVENT = 'intent.halt';
export const MOVE_STEP_EVENT = 'move.step';

/** Queue an order for `unitId` to move to `to` at `pace`, firing at `time` (default: now). */
export function issueMove(
  state: EngineState<GameState>,
  unitId: string,
  to: Point,
  time = state.time,
  pace: Pace = 'march',
): EngineState<GameState> {
  return schedule(state, [
    { time, type: MOVE_INTENT_EVENT, payload: { unitId, to: [to.x, to.y], pace } },
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

/** Queue an order for `unitId` to change formation, firing at `time` (default: now). */
export function issueFormation(
  state: EngineState<GameState>,
  unitId: string,
  formation: Formation,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [{ time, type: FORMATION_INTENT_EVENT, payload: { unitId, formation } }]);
}

interface MovePayload {
  unitId: string;
  to: [number, number];
  pace?: Pace;
}

interface StepPayload {
  unitId: string;
  startedAt: number;
  to: [number, number];
  /** Flat x,y pairs (mm): the point just left, then the waypoints still to reach, nearest first. */
  path: number[];
  /**
   * The contact line cut this march short (#446): the point, already in `path` as a
   * waypoint, where the march stops in contact unless the enemy has gone by then.
   */
  halt?: [number, number];
}

/** Apply `patch` to a unit; a patched field set to undefined is removed (snapshots stay lean). */
export function updateUnit(world: GameState, unitId: string, patch: Partial<Unit>, time: number) {
  return {
    ...world,
    time,
    units: world.units.map((u) => {
      if (u.id !== unitId) return u;
      const next = { ...u, ...patch };
      for (const k of Object.keys(patch) as Array<keyof Unit>)
        if (next[k] === undefined) delete next[k];
      return next;
    }),
  };
}

/** The step event that ends the leg `p.path` starts with, and the leg itself. */
function nextLeg(
  map: TerrainMap,
  mover: Mover,
  now: number,
  p: StepPayload,
): { event: NewEvent; leg: Leg } {
  const from = { x: p.path[0]!, y: p.path[1]! }; // the point just left
  const to = { x: p.path[2]!, y: p.path[3]! };
  const arriveAt = now + legDuration(map, from, to, mover)!;
  return {
    event: { time: arriveAt, type: MOVE_STEP_EVENT, payload: p as unknown as Json },
    leg: { from, to, startedAt: now, arriveAt, msPerMetre: msPerMetreOf(mover) },
  };
}

interface ContactStop {
  /** Where the march stops: a point on the step, or the step's start when stopping at once. */
  at: Point;
  /** The enemy whose line stops the march. */
  foe: Unit;
  /** The unit is already inside the line and the step closes further: it stops where it stands. */
  immediate: boolean;
}

/**
 * The contact line of a plain march (#446): the first point along `from` → `to` where the
 * marching `unit` would come closer than its type's contact distance to an active enemy,
 * or undefined when the step stays clear of every enemy. A unit already inside an enemy's
 * line is only stopped when the step closes further: marching away is always allowed.
 * Withdrawing, routing and attacking units do not use this; their handlers exempt them.
 */
function contactStop(
  world: GameState,
  unit: Unit,
  from: Point,
  to: Point,
  time: number,
): ContactStop | undefined {
  if (!contactLine(world)) return undefined; // games logged before rules 5 replay as played
  if (unit.status !== 'active') return undefined; // a routing unit rides home unhindered
  const radius = mm(unitTypeOf(unit).contactM);
  let best: (ContactStop & { t: number }) | undefined;
  for (const foe of world.units) {
    if (foe.id === unit.id || foe.side === unit.side || foe.status !== 'active') continue;
    const c = positionAt(world.map, foe, time);
    const d0 = distance(from, c);
    if (d0 <= radius) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const along = Math.min(1, Math.max(0, ((c.x - from.x) * dx + (c.y - from.y) * dy) / len2));
      if (along <= 0) continue;
      const closest = { x: from.x + dx * along, y: from.y + dy * along };
      if (distance(closest, c) < d0 - 1 && (!best || best.t > 0)) {
        best = { at: from, foe, immediate: true, t: 0 };
      }
      continue;
    }
    const at = crossingPoint(from, to, c, radius);
    if (!at) continue;
    const t = distance(from, at) / Math.max(1, distance(from, to));
    if (!best || t < best.t) best = { at, foe, immediate: false, t };
  }
  return best && { at: best.at, foe: best.foe, immediate: best.immediate };
}

/** The nearest active enemy within the contact distance of `at`, if any. */
function foeInContact(world: GameState, unit: Unit, at: Point, time: number): Unit | undefined {
  const limit = mm(unitTypeOf(unit).contactM) + 1000; // 1 m slack for the rounded halt point
  let best: Unit | undefined;
  let bestD = Infinity;
  for (const foe of world.units) {
    if (foe.id === unit.id || foe.side === unit.side || foe.status !== 'active') continue;
    const d = distance(at, positionAt(world.map, foe, time));
    if (d <= limit && d < bestD) {
      best = foe;
      bestD = d;
    }
  }
  return best;
}

/**
 * End a march at the contact line (#446): the unit stands at `at`, turns to face the enemy
 * it met, and is in contact. A march that was to end in a hold holds there instead.
 */
function stopAtContact(
  world: GameState,
  unit: Unit,
  at: Point,
  foe: Unit,
  time: number,
  thenHold: boolean,
): HandlerResult<GameState> {
  const intent: Intent = thenHold ? { kind: 'hold', at } : { kind: 'idle' };
  return {
    world: updateUnit(
      world,
      unit.id,
      {
        center: at,
        intent,
        leg: undefined,
        pace: unit.pace,
        facing: bearingTo(at, positionAt(world.map, foe, time)),
      },
      time,
    ),
    schedule: [{ time, type: COMBAT_CHECK_EVENT }],
  };
}

/**
 * What the contact line does to one step of a plain march (#446): when a step ends at a
 * planned halt point, or the next leg would cross an enemy's line, contact decides the
 * step and this returns its whole result; otherwise undefined and the march goes on.
 * `unit` is the marching unit as updated for the step, standing at `center`.
 */
function contactStep(
  world: GameState,
  unit: Unit,
  intent: Intent,
  center: Point,
  rest: number[],
  p: StepPayload,
  time: number,
  check: NewEvent,
): HandlerResult<GameState> | undefined {
  const thenHold = intent.kind === 'move' && intent.thenHold === true;
  if (p.halt && p.halt[0] === center.x && p.halt[1] === center.y) {
    const foe = foeInContact(world, unit, center, time);
    if (foe) return stopAtContact(world, unit, center, foe, time, thenHold);
    // The enemy has gone: march on, with the spent halt point dropped from the payload.
    const clean: StepPayload = { unitId: p.unitId, startedAt: p.startedAt, to: p.to, path: rest };
    const { event, leg } = nextLeg(world.map, unit, time, clean);
    return {
      world: updateUnit(world, p.unitId, { center, leg }, time),
      schedule: [check, event],
    };
  }
  if (rest.length < 4) return undefined;
  const next = { x: rest[2]!, y: rest[3]! };
  const stop = contactStop(world, unit, center, next, time);
  if (!stop) return undefined;
  if (stop.immediate) return stopAtContact(world, unit, center, stop.foe, time, thenHold);
  const payload: StepPayload = {
    ...p,
    path: [center.x, center.y, stop.at.x, stop.at.y, ...rest.slice(2)],
    halt: [stop.at.x, stop.at.y],
  };
  const { event, leg } = nextLeg(world.map, unit, time, payload);
  return {
    world: updateUnit(world, p.unitId, { center, leg }, time),
    schedule: [check, event],
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
  pace: Pace = 'march',
): HandlerResult<GameState> {
  const to: [number, number] = [dest.x, dest.y];
  // A unit on the march is stopped where it has got to, not at the last waypoint it passed.
  // Found before the new pace is set: the leg under way was timed with the old one.
  const here = positionAt(world.map, unit, time);
  unit = { ...unit, pace }; // a new march sets its own pace; the leg below is timed with it
  const path = findPath(world.map, here, dest, { width: unit.footprint.frontage });
  if (!path) {
    // `tooWide` tells the umpire a narrower formation (a column) would get through.
    const tooWide = findPath(world.map, here, dest) !== null;
    return {
      world: updateUnit(world, unit.id, {}, time),
      emit: [
        {
          type: 'unit.moveBlocked',
          payload: { unitId: unit.id, to, ...(tooWide ? { tooWide: true } : {}) },
        },
      ],
    };
  }
  if (path.waypoints.length === 1) {
    if (how === 'attack' && attackTarget) {
      const intent: Intent = { kind: 'attack', target: attackTarget, to: dest, startedAt: time };
      return {
        world: updateUnit(world, unit.id, { intent, center: here, leg: undefined, pace }, time),
      };
    }
    const intent: Intent = how === 'hold' ? { kind: 'hold', at: dest } : { kind: 'idle' };
    return {
      world: updateUnit(world, unit.id, { intent, center: here, leg: undefined, pace }, time),
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
  if (how === 'move' || how === 'hold') {
    // A plain march stops at the contact line (#446), starting with its first leg: an
    // enemy already closing gets faced where the unit stands, a line ahead cuts the
    // first leg short at the crossing point.
    const first = { x: step.path[2]!, y: step.path[3]! };
    const stop = contactStop(world, unit, here, first, time);
    if (stop?.immediate) return stopAtContact(world, unit, here, stop.foe, time, how === 'hold');
    if (stop) {
      step.halt = [stop.at.x, stop.at.y];
      step.path = [here.x, here.y, stop.at.x, stop.at.y, ...step.path.slice(2)];
    }
  }
  const { event, leg } = nextLeg(world.map, unit, time, step);
  return {
    world: updateUnit(world, unit.id, { intent, center: here, leg, pace }, time),
    schedule: [event],
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
    if (world.outcome) return { world }; // the game is over: nothing moves
    if (heldTurn(world, ev.time)) return { world }; // an umpire turn: units are held
    const { unitId, to, pace } = ev.payload as unknown as MovePayload;
    const unit = world.units.find((u) => u.id === unitId);
    if (!unit) return rejectUnknown(world, unitId);
    if (unit.status !== 'active') return rejectOrder(world, unitId, 'unit not active');
    return beginMarch(world, unit, { x: to[0], y: to[1] }, ev.time, 'move', undefined, pace);
  });

  registry.register(HALT_INTENT_EVENT, (world, ev) => {
    if (world.outcome) return { world }; // the game is over: nothing moves
    if (heldTurn(world, ev.time)) return { world }; // an umpire turn: units are held
    const { unitId } = ev.payload as unknown as { unitId: string };
    if (!world.units.some((u) => u.id === unitId)) return rejectUnknown(world, unitId);
    const unit = world.units.find((u) => u.id === unitId)!;
    const center = positionAt(world.map, unit, ev.time);
    return {
      world: updateUnit(
        world,
        unitId,
        { intent: { kind: 'idle' }, center, leg: undefined },
        ev.time,
      ),
    };
  });

  registry.register(FORMATION_INTENT_EVENT, (world, ev) => {
    if (world.outcome) return { world }; // the game is over: nothing moves
    if (heldTurn(world, ev.time)) return { world }; // an umpire turn: units are held
    const { unitId, formation } = ev.payload as unknown as {
      unitId: string;
      formation: Formation;
    };
    const unit = world.units.find((u) => u.id === unitId);
    if (!unit) return rejectUnknown(world, unitId);
    if (unit.status !== 'active') return rejectOrder(world, unitId, 'unit not active');
    if (!unitTypeOf(unit).formations.includes(formation)) {
      return rejectOrder(world, unitId, `${unitTypeOf(unit).name} cannot form ${formation}`);
    }
    if (unit.formation === formation) {
      if (unit.intent.kind !== 'reform')
        return rejectOrder(world, unitId, 'already in that formation');
      // Ordered back to the formation it is still in: stand down where it is, no second reform.
      return { world: updateUnit(world, unitId, { intent: { kind: 'idle' } }, ev.time) };
    }
    // The unit stops where it has got to and stands still while it re-forms.
    const center = positionAt(world.map, unit, ev.time);
    const intent: Intent = { kind: 'reform', formation, startedAt: ev.time };
    return {
      world: updateUnit(world, unitId, { intent, center, leg: undefined }, ev.time),
      schedule: [
        {
          time: ev.time + unitTypeOf(unit).formationChangeMs,
          type: FORMATION_DONE_EVENT,
          payload: { unitId, formation, startedAt: ev.time },
        },
      ],
    };
  });

  registry.register(FORMATION_DONE_EVENT, (world, ev) => {
    if (world.outcome) return { world }; // the game is over: nothing moves
    if (heldTurn(world, ev.time)) return { world }; // an umpire turn: units are held
    const p = ev.payload as unknown as { unitId: string; formation: Formation; startedAt: number };
    const unit = world.units.find((u) => u.id === p.unitId);
    const i = unit?.intent;
    if (!unit || i?.kind !== 'reform' || i.startedAt !== p.startedAt) return { world }; // superseded
    const next: Partial<Unit> = {
      formation: p.formation,
      footprint: defaultFootprint(unitTypeOf(unit), p.formation, unit.strength),
      shape: undefined, // a loose arrangement does not survive a change of formation
      intent: { kind: 'idle' },
    };
    return {
      world: updateUnit(world, p.unitId, next, ev.time),
      emit: [{ type: 'unit.reformed', payload: { unitId: p.unitId, formation: p.formation } }],
    };
  });

  registry.register(MOVE_STEP_EVENT, (world, ev) => {
    if (world.outcome) return { world }; // the game is over: nothing moves
    if (heldTurn(world, ev.time)) return { world }; // an umpire turn: units are held
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
    // The men are tired by the ground they have just covered, more so at a forced pace.
    const marched = unit.leg ? ev.time - unit.leg.startedAt : 0;
    const tired: Unit = {
      ...unit,
      fatigue: Math.min(
        100,
        Math.round(
          (unit.fatigue + (FATIGUE_PER_MARCH_MINUTE[unit.pace] * marched) / MS_PER_MINUTE) * 100,
        ) / 100,
      ),
    };
    world = { ...world, units: world.units.map((u) => (u.id === unit.id ? tired : u)) };
    world = noteWear(world, unit, tired, ev.time);
    // Every step may start or end a contact, or put a unit on the objective.
    const check: NewEvent = { time: ev.time, type: COMBAT_CHECK_EVENT };
    if (i.kind === 'move') {
      // A plain march halts at the contact line instead of marching into the enemy (#446).
      const contact = contactStep(world, tired, i, center, rest, p, ev.time, check);
      if (contact) return contact;
    }
    if (i.kind === 'attack') {
      const foe = world.units.find((u) => u.id === i.target);
      if (!foe || !pursuable(foe, ev.time)) {
        return {
          world: updateUnit(
            world,
            p.unitId,
            { center, intent: { kind: 'idle' }, leg: undefined },
            ev.time,
          ),
          schedule: [check],
        };
      }
      const arrived = rest.length === 2;
      // Under rules 5 a charge closes to melee before it counts as closed (#446); the
      // melee line within a rounding step (whole-mm points) counts too, or the shortened
      // leg below would shrink to no length at all. Before rules 5, reach was enough.
      const closed = contactLine(world)
        ? hasClosed({ ...unit, center }, foe) ||
          (closesToMelee(unit) &&
            distance(center, positionAt(world.map, foe, ev.time)) <=
              mm(unitTypeOf(unit).chargeM!) + 1)
        : canReach({ ...unit, center }, foe);
      if (closed) {
        // Closed far enough: stop here. A type with a charge distance closes to melee
        // first (#446); any other attacker stops once its target is in reach. `to`
        // becomes the stopping point, so the unit counts as stopped and `combat.check`
        // re-plans it if the foe later moves out of closing distance.
        return {
          world: updateUnit(
            world,
            p.unitId,
            { center, intent: { ...i, to: center }, leg: undefined },
            ev.time,
          ),
          schedule: [check],
        };
      }
      if (contactLine(world) && closesToMelee(unit) && rest.length >= 4) {
        // A charge does not ride through its target: the next leg ends on the melee
        // line, where the stop above takes over (#446).
        const next = { x: rest[2]!, y: rest[3]! };
        const chargeAt = crossingPoint(
          center,
          next,
          positionAt(world.map, foe, ev.time),
          mm(unitTypeOf(unit).chargeM!),
        );
        if (chargeAt && (chargeAt.x !== center.x || chargeAt.y !== center.y)) {
          const shortened: StepPayload = {
            ...p,
            path: [center.x, center.y, chargeAt.x, chargeAt.y, ...rest.slice(2)],
          };
          const { event, leg } = nextLeg(world.map, tired, ev.time, shortened);
          return {
            world: updateUnit(world, p.unitId, { center, leg }, ev.time),
            schedule: [check, event],
          };
        }
      }
      if (arrived) {
        // The foe moved on; plan a fresh march toward where it is now.
        return {
          world: updateUnit(world, p.unitId, { center, leg: undefined }, ev.time),
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
        world: updateUnit(world, p.unitId, { center, intent, leg: undefined }, ev.time),
        emit: [{ type: 'unit.arrived', payload: { unitId: p.unitId, at: p.to } }],
        schedule: [check],
      };
    }
    const { event, leg } = nextLeg(world.map, tired, ev.time, { ...p, path: rest });
    return {
      world: updateUnit(world, p.unitId, { center, leg }, ev.time),
      schedule: [check, event],
    };
  });
}
