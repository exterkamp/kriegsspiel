/**
 * Applying an umpire's turn (D39, story 11.5). In a turn-mode game the umpire proposes where
 * every unit stands at the turn's end and what became of it; the engine checks the proposal
 * against the hard limits, corrects what breaks them (each correction is a `TurnRuling`) and
 * applies the result in one `umpire.turn` event at the turn's end. The LLM never writes state.
 *
 * The proposal is the `TurnProposal` zod schema in `@kriegsspiel/protocol`; the engine depends on
 * no package, so it mirrors that shape here (metres and compass degrees, absolute values).
 */
import { COMBAT_CHECK_EVENT, RALLY_EVENT, distanceMm } from './contact.js';
import { RALLY_RULES } from './combatRules.js';
import { turnVictory } from './combat.js';
import type { EngineState, EventRegistry, Json, NewEvent } from './events.js';
import { metres, mm } from './geometry.js';
import type { Dial } from './judgment.js';
import { MOVE_INTENT_EVENT, positionAt } from './movement.js';
import { overlapsBeyondTolerance, proposedArrangement, validatePlacement } from './placement.js';
import { schedule } from './queue.js';
import { ROAD_CLASS_COST } from './terrain.js';
import { FORMATION_RULES, unitTypeOf } from './unitTypes.js';
import { canSee, coarseFacing, contactReport, fileReport, sizeEstimate } from './visibility.js';
import { FORCED_PACE_FACTOR } from './fatigue.js';
import { recordInJournal } from './journal.js';
import type {
  Contact,
  Formation,
  GameState,
  GameTime,
  Intent,
  Point,
  Report,
  SideId,
  TurnFlag,
  TurnRuling,
  Unit,
  UnitStatus,
} from './types.js';

export const TURN_EVENT = 'umpire.turn';
/** A paper from the umpire's staff to every side about the turn itself (D39, 11.9): see `issueTurnNotice`. */
export const TURN_NOTICE_EVENT = 'turn.notice';
/** Who signs a `notice`. */
export const TURN_NOTICE_FROM = "The umpire's staff";

/** Under `standard`, an outcome further than this from the projection's end position must say why. */
export const DEPARTURE_TOLERANCE_M = 100;
/** ... or with losses differing from the projection's by more than this share of its start strength. */
export const DEPARTURE_LOSS_SHARE = 0.05;

export type TurnOrderResult = 'carried-out' | 'partly' | 'misread' | 'refused' | 'not-arrived';

/** One unit at the turn's end, as the umpire proposes it (mirrors `UnitOutcome` in the protocol). */
export interface TurnUnitOutcome {
  unitId: string;
  x: number;
  y: number;
  facingDeg: number;
  formation: Formation;
  shape?: [number, number][];
  strength: number;
  morale: number;
  fatigue?: number;
  ammo?: number;
  status: 'active' | 'broken' | 'destroyed' | 'captured';
  continuing: { kind: 'idle' } | { kind: 'hold' } | { kind: 'move'; x: number; y: number };
  orders: { orderId: string; result: TurnOrderResult }[];
  account: string;
  departure?: string;
  rollIds?: string[];
}

export interface TurnObservation {
  side: string;
  unitId: string;
  by: string;
  when: 'start' | 'end';
}

export interface TurnRollRequest {
  id: string;
  why: string;
  chance: number;
}

export interface TurnRoll extends TurnRollRequest {
  roll: number;
  success: boolean;
}

export interface TurnProposal {
  turn: number;
  units: TurnUnitOutcome[];
  observations: TurnObservation[];
  rolls?: TurnRollRequest[];
  summary: string;
  /** Rulings the umpire sets as precedent for the rest of the game (11.8); kept in its journal. */
  precedents?: string[];
}

/** Where a turn's order stood at the turn's end: `deliveredAt` is absent if it had not arrived. */
export interface TurnOrderStatus {
  orderId: string;
  unitId: string;
  deliveredAt?: GameTime;
}

/** What the validator needs besides the world and the proposal. All of it is replayable. */
export interface TurnContext {
  turn: Pick<TurnFlag, 'n' | 'startMs' | 'endMs'>;
  dial: Dial;
  /**
   * The engine's projection of the turn (11.4): its units at `endMs`. It sets the ceilings an
   * outcome may not pass (ammunition, losses out of reach) and, under `standard`, the outcome a
   * departure must explain. Without it the start-of-turn values stand in.
   */
  projection?: Unit[];
  /** Every order sent to a unit so far, with whether it had arrived. Absent: orders unchecked. */
  orders?: TurnOrderStatus[];
  /** The rolls the engine made for this turn on the umpire's dice (11.7, `turnDice.ts`). */
  rolls?: TurnRoll[];
}

/** A unit's outcome after the checks, in engine units. */
export interface AppliedOutcome {
  unitId: string;
  center: Point;
  facing: number;
  formation: Formation;
  footprint: Unit['footprint'];
  shape?: Point[];
  strength: number;
  morale: number;
  fatigue: number;
  ammo: number;
  status: UnitStatus;
  /** Set when the unit broke this turn: rally tries start from the turn's end. */
  broke: boolean;
  /** Set when a broken unit rallied this turn. */
  rallied: boolean;
  intent: Intent;
  orders: { orderId: string; result: TurnOrderResult }[];
}

/** A correction before it is filed (the handler gives it its id and time). */
export type TurnCorrection = Omit<TurnRuling, 'id' | 'time' | 'rationale' | 'narrative'> & {
  /** False for a record that changes no outcome (a capture stored as destroyed). */
  clamp: boolean;
};

export interface TurnValidation {
  /** Set when the proposal cannot be applied at all (the wrong turn); the turn falls back. */
  fatal?: string;
  /** Every correction, in words, for the one resend to the umpire. Empty when nothing was wrong. */
  problems: string[];
  /** One per unit not destroyed at the turn's start, in unit-id order. */
  outcomes: AppliedOutcome[];
  /** The observations that stand. */
  observations: TurnObservation[];
  corrections: TurnCorrection[];
  /** Units with at least one clamp, and units the proposal had to cover (for the fallback rule). */
  clampedUnits: number;
  units: number;
}

/** The internal form of an outcome: engine units, before the limits. */
interface Want {
  center: Point;
  facing: number;
  formation: Formation;
  shape?: Point[];
  strength: number;
  morale: number;
  fatigue?: number;
  ammo?: number;
  status: TurnUnitOutcome['status'];
  continuing: TurnUnitOutcome['continuing'];
  orders: TurnUnitOutcome['orders'];
  departure?: string;
  rollIds?: string[];
}

const rad = (d: number) => (d * Math.PI) / 180;
const m = (millimetres: number) => Math.round(metres(millimetres) * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: number | undefined, fallback: number) =>
  v !== undefined && Number.isFinite(v) ? v : fallback;

function fromWire(o: TurnUnitOutcome): Want {
  return {
    center: { x: mm(o.x), y: mm(o.y) },
    facing: rad(o.facingDeg),
    formation: o.formation,
    ...(o.shape && o.shape.length > 0
      ? { shape: o.shape.map(([x, y]) => ({ x: mm(x), y: mm(y) })) }
      : {}),
    strength: o.strength,
    morale: o.morale,
    ...(o.fatigue !== undefined ? { fatigue: o.fatigue } : {}),
    ...(o.ammo !== undefined ? { ammo: o.ammo } : {}),
    status: o.status,
    continuing: o.continuing,
    orders: o.orders,
    ...(o.departure !== undefined ? { departure: o.departure } : {}),
    ...(o.rollIds !== undefined ? { rollIds: o.rollIds } : {}),
  };
}

/** What a unit's state says about it, as an outcome: the projection's, or the start of the turn's. */
function fromUnit(u: Unit, at: Point, orders: TurnUnitOutcome['orders'] = []): Want {
  const status: Want['status'] =
    u.status === 'destroyed' ? 'destroyed' : u.status === 'withdrawn' ? 'broken' : 'active';
  const continuing: Want['continuing'] =
    u.intent.kind === 'hold'
      ? { kind: 'hold' }
      : u.intent.kind === 'move'
        ? { kind: 'move', x: metres(u.intent.to.x), y: metres(u.intent.to.y) }
        : { kind: 'idle' };
  return {
    center: { ...at },
    facing: u.facing,
    formation: u.formation,
    ...(u.shape ? { shape: u.shape.map((p) => ({ ...p })) } : {}),
    strength: u.strength,
    morale: u.morale,
    fatigue: u.fatigue,
    ammo: u.ammo,
    status,
    continuing,
    orders,
  };
}

/** The furthest an enemy could get in `turnMs`: forced pace, its fastest formation, on a highway. */
function marchReachMm(u: Unit, turnMs: number): number {
  const fastest = Math.max(...Object.values(FORMATION_RULES).map((r) => r.moveFactor));
  const road = Math.min(...Object.values(ROAD_CLASS_COST));
  const metresPerMinute =
    (unitTypeOf(u).marchMetresPerMinute * fastest * FORCED_PACE_FACTOR) / road;
  return mm((metresPerMinute * turnMs) / 60_000);
}

/**
 * Check an umpire's turn proposal against the hard limits (D39, "Validation and clamps") and
 * return what may be applied. Pure and deterministic: `world` is the state at the turn's start
 * (or the held world at its end, which is the same for every unit), and nothing is edited in
 * place. Units are checked in unit-id order.
 */
export function validateProposal(
  world: GameState,
  proposal: TurnProposal,
  ctx: TurnContext,
): TurnValidation {
  const { n, startMs, endMs } = ctx.turn;
  const turnMs = endMs - startMs;
  const problems: string[] = [];
  const corrections: TurnCorrection[] = [];
  const note = (
    unitId: string,
    field: string,
    proposed: Json,
    applied: Json,
    reason: string,
    isClamp = true,
  ) => {
    corrections.push({
      kind: 'turn',
      turn: n,
      unitId,
      field,
      proposed,
      applied,
      reason,
      clamp: isClamp,
    });
    if (isClamp) problems.push(`${unitId}: ${reason}`);
  };
  const empty = (fatal: string): TurnValidation => ({
    fatal,
    problems: [fatal],
    outcomes: [],
    observations: [],
    corrections: [],
    clampedUnits: 0,
    units: 0,
  });
  if (proposal.turn !== n) return empty(`the proposal is for turn ${proposal.turn}, not turn ${n}`);
  if (!(turnMs > 0)) return empty('the turn has no length');

  const byId = new Map(world.units.map((u) => [u.id, u]));
  const live = world.units
    .filter((u) => u.status !== 'destroyed')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const startAt = new Map(live.map((u) => [u.id, positionAt(world.map, u, startMs)]));
  const projected = new Map((ctx.projection ?? []).map((u) => [u.id, u]));
  // Where the projection has each unit at the turn's end: one still on a leg is part-way along it.
  const projAt = new Map(
    (ctx.projection ?? []).map((u) => [u.id, positionAt(world.map, u, endMs)]),
  );

  // Which outcome speaks for which unit.
  const wants = new Map<string, Want>();
  for (const o of proposal.units) {
    const u = byId.get(o.unitId);
    if (!u) {
      problems.push(`${o.unitId}: no such unit`);
      continue;
    }
    if (u.status === 'destroyed') {
      note(o.unitId, 'outcome', o.status, null, 'the unit was destroyed before the turn');
      continue;
    }
    if (wants.has(o.unitId)) {
      note(o.unitId, 'outcome', 'repeated', 'first', 'more than one outcome; the first stands');
      continue;
    }
    wants.set(o.unitId, fromWire(o));
  }
  for (const u of live) {
    if (wants.has(u.id)) continue;
    const p = projected.get(u.id);
    wants.set(u.id, p ? fromUnit(p, projAt.get(u.id)!) : fromUnit(u, startAt.get(u.id)!));
    note(u.id, 'outcome', null, p ? 'projected' : 'unchanged', 'no outcome was given for the unit');
  }

  // Under `standard`, a departure from the projection must say why, or the projection stands.
  if (ctx.dial === 'standard' && ctx.projection) {
    for (const u of live) {
      const w = wants.get(u.id)!;
      const p = projected.get(u.id);
      if (!p || (w.departure ?? '').trim() !== '') continue;
      const projStatus = fromUnit(p, projAt.get(u.id)!).status;
      const far = distanceMm(w.center, projAt.get(u.id)!) > mm(DEPARTURE_TOLERANCE_M);
      const losses =
        Math.abs(w.strength - p.strength) > DEPARTURE_LOSS_SHARE * Math.max(1, u.strength);
      const status = (w.status === 'captured' ? 'destroyed' : w.status) !== projStatus;
      if (far || losses || status) {
        wants.set(u.id, { ...fromUnit(p, projAt.get(u.id)!, w.orders) });
        note(
          u.id,
          'departure',
          { x: m(w.center.x), y: m(w.center.y), strength: w.strength, status: w.status },
          'projected',
          'departs from the projection with no reason given; the projection stands',
        );
      }
    }
  }

  // Status first, as proposed: who is gone needs no place on the ground.
  const gone = (w: Want) =>
    w.status === 'destroyed' || w.status === 'captured' || !(w.strength > 0);

  // March over the ground: each end position from the turn's start, with every other unit at its
  // proposed end, and only friendly overlap counting.
  const ends = new Map<string, Unit>();
  for (const u of live) {
    const w = wants.get(u.id)!;
    if (gone(w)) {
      ends.set(u.id, { ...u, center: startAt.get(u.id)!, status: 'destroyed' });
      continue;
    }
    const a = proposedArrangement(u, w);
    ends.set(u.id, 'wanted' in a ? a.wanted : { ...u, center: startAt.get(u.id)! });
  }
  const placed = new Map<string, Unit>();
  const atStart = new Set<string>();
  const startArrangement = (u: Unit): Unit => ({ ...u, center: startAt.get(u.id)! });
  for (const u of live) {
    const w = wants.get(u.id)!;
    if (gone(w)) {
      placed.set(u.id, startArrangement(u));
      continue;
    }
    const scratch: GameState = {
      ...world,
      time: startMs,
      units: world.units.map((x) => (x.id === u.id ? x : (ends.get(x.id) ?? x))),
    };
    const verdict = validatePlacement(
      scratch,
      {
        unitId: u.id,
        center: w.center,
        facing: w.facing,
        formation: w.formation,
        ...(w.shape ? { shape: w.shape } : {}),
        elapsedMs: turnMs,
      },
      { allowWithdrawn: true, overlapWith: 'friendly' },
    );
    const proposed = { x: m(w.center.x), y: m(w.center.y) };
    if (verdict.verdict === 'reject') {
      placed.set(u.id, startArrangement(u));
      atStart.add(u.id);
      const s = startAt.get(u.id)!;
      note(
        u.id,
        'position',
        proposed,
        { x: m(s.x), y: m(s.y) },
        `refused: ${verdict.reasons.join('; ')}`,
      );
      continue;
    }
    const p = verdict.placement;
    const next: Unit = { ...u, ...p };
    if (!p.shape) delete next.shape;
    placed.set(u.id, next);
    if (verdict.verdict === 'clamp') {
      note(
        u.id,
        'position',
        proposed,
        { x: m(p.center.x), y: m(p.center.y) },
        `clamped to the reachable point: ${verdict.reasons.join('; ')}`,
      );
    }
  }
  // No two friends may end overlapping, and the march checks above saw each friend at its
  // proposed end, not at its clamped one. So once status is settled (below), every pair that still
  // overlaps is settled: the one that moved goes back where it started (the later in unit-id order
  // if both moved), until stable. `stays` says which units stand on the ground at the end.
  const settle = (stays: (id: string) => boolean): Set<string> => {
    const moved = new Set<string>();
    let changed: boolean;
    do {
      changed = false;
      for (const [i, a] of live.entries()) {
        for (const b of live.slice(i + 1)) {
          if (a.side !== b.side || !stays(a.id) || !stays(b.id)) continue;
          const pa = placed.get(a.id)!;
          const pb = placed.get(b.id)!;
          if (!overlapsBeyondTolerance(pa, pb)) continue;
          const v = !atStart.has(b.id) ? b : !atStart.has(a.id) ? a : undefined;
          if (!v) continue; // both where they started: the turn's start allowed it
          const keep = v === b ? a : b;
          const there = placed.get(v.id)!;
          placed.set(v.id, startArrangement(v));
          atStart.add(v.id);
          moved.add(v.id);
          const s = startAt.get(v.id)!;
          note(
            v.id,
            'position',
            { x: m(there.center.x), y: m(there.center.y) },
            { x: m(s.x), y: m(s.y) },
            `put back where it started: its end position overlaps ${keep.id}`,
          );
          changed = true;
        }
      }
    } while (changed);
    return moved;
  };
  // Units the proposal marks gone are already at the start; the out-of-reach rule may bring one
  // back, so they count in the settle once their status is known.
  for (const u of live) if (gone(wants.get(u.id)!)) atStart.add(u.id);

  // Who could have been hit: some enemy within its reach plus its march, at either end.
  const reachable = (u: Unit) =>
    live.some((e) => {
      if (e.side === u.side) return false;
      const reach = mm(unitTypeOf(e).rangeM) + marchReachMm(e, turnMs);
      const near = (a: Point, b: Point) => distanceMm(a, b) <= reach;
      return (
        near(startAt.get(u.id)!, startAt.get(e.id)!) ||
        near(placed.get(u.id)!.center, placed.get(e.id)!.center)
      );
    });

  const outcomes: AppliedOutcome[] = [];
  for (const u of live) {
    const w = wants.get(u.id)!;
    const p = projected.get(u.id);
    const where = placed.get(u.id)!;

    // Strength: no unit gains men, none falls below none, and none loses men out of reach.
    let strength = finite(w.strength, u.strength);
    if (strength > u.strength) {
      note(u.id, 'strength', w.strength, u.strength, 'a unit gains no men in a turn');
      strength = u.strength;
    } else if (strength < 0) {
      note(u.id, 'strength', w.strength, 0, 'strength cannot fall below nothing');
      strength = 0;
    }
    let status: Want['status'] = w.status;
    const inReach = reachable(u);
    if (!inReach) {
      const floor = p ? Math.min(u.strength, p.strength) : u.strength;
      if (strength < floor) {
        note(
          u.id,
          'strength',
          strength,
          floor,
          'no enemy could reach it this turn: no combat loss',
        );
        strength = floor;
      }
      if (status === 'destroyed' || status === 'captured') {
        const back = p
          ? fromUnit(p, projAt.get(u.id)!).status
          : u.status === 'withdrawn'
            ? 'broken'
            : 'active';
        if (back !== 'destroyed') {
          note(u.id, 'status', status, back, 'no enemy could reach it this turn');
          status = back;
        }
      }
    }
    if (strength <= 0 && status !== 'destroyed' && status !== 'captured') {
      note(u.id, 'status', status, 'destroyed', 'a unit with no men left is destroyed');
      status = 'destroyed';
    }
    if (status === 'captured') {
      note(u.id, 'status', 'captured', 'destroyed', 'captured: stored as destroyed', false);
    }

    // Morale, fatigue and ammunition stay in 0..100; ammunition rises only by supply.
    const bounded = (field: string, v: number, hi = 100) => {
      const c = clamp(v, 0, hi);
      if (c !== v) {
        note(
          u.id,
          field,
          v,
          c,
          hi < 100 && v > hi ? `${field} rises only by supply, to ${hi}` : `${field} is 0..100`,
        );
      }
      return c;
    };
    const morale = bounded('morale', finite(w.morale, u.morale));
    const fatigue = bounded('fatigue', finite(w.fatigue, p?.fatigue ?? u.fatigue));
    const ammoCeiling = Math.min(100, p?.ammo ?? u.ammo);
    const ammo = bounded('ammo', finite(w.ammo, p?.ammo ?? u.ammo), ammoCeiling);

    // Status: destroyed and captured are final; broken is stored withdrawn; a rally needs a roll.
    let engineStatus: UnitStatus =
      status === 'destroyed' || status === 'captured'
        ? 'destroyed'
        : status === 'broken'
          ? 'withdrawn'
          : 'active';
    let rallied = false;
    if (u.status === 'withdrawn' && engineStatus === 'active') {
      const standing = (e: Unit) => {
        const we = wants.get(e.id)!;
        return we.status === 'active' && we.strength > 0;
      };
      // The projection's own rally already rests on an engine die.
      const projected = p?.status === 'active';
      const why = rallyRefused(
        world,
        u,
        w,
        where,
        strength,
        placed,
        live,
        standing,
        ctx,
        projected,
      );
      if (why) {
        note(u.id, 'status', 'active', 'broken', `no rally: ${why}`);
        engineStatus = 'withdrawn';
      } else {
        rallied = true;
      }
    }
    const broke = u.status === 'active' && engineStatus === 'withdrawn';

    // Orders: one the unit had not received by the turn's end is `not-arrived`, and only then.
    const orders: AppliedOutcome['orders'] = [];
    for (const o of w.orders) {
      if (!ctx.orders) {
        orders.push(o);
        continue;
      }
      const s = ctx.orders.find((x) => x.orderId === o.orderId);
      if (!s || s.unitId !== u.id) {
        note(u.id, 'orders', o.orderId, null, `order ${o.orderId} was not sent to this unit`);
        continue;
      }
      const arrived = s.deliveredAt !== undefined && s.deliveredAt <= endMs;
      if (!arrived && o.result !== 'not-arrived') {
        note(u.id, 'orders', o.result, 'not-arrived', `order ${o.orderId} had not arrived`);
        orders.push({ orderId: o.orderId, result: 'not-arrived' });
      } else if (arrived && o.result === 'not-arrived') {
        note(u.id, 'orders', o.result, 'refused', `order ${o.orderId} had arrived: not acted on`);
        orders.push({ orderId: o.orderId, result: 'refused' });
      } else {
        orders.push(o);
      }
    }

    const dead = engineStatus === 'destroyed';
    // The engine keeps no men on a destroyed unit; the captured are lost to their side too.
    if (dead) strength = 0;
    const center = dead ? startAt.get(u.id)! : where.center;
    const intent: Intent = dead
      ? { kind: 'idle' }
      : w.continuing.kind === 'hold'
        ? { kind: 'hold', at: { ...center } }
        : w.continuing.kind === 'move'
          ? { kind: 'move', to: { x: mm(w.continuing.x), y: mm(w.continuing.y) }, startedAt: endMs }
          : { kind: 'idle' };
    outcomes.push({
      unitId: u.id,
      center: { ...center },
      facing: dead ? u.facing : where.facing,
      formation: dead ? u.formation : where.formation,
      footprint: dead ? u.footprint : where.footprint,
      ...(!dead && where.shape ? { shape: where.shape } : {}),
      strength,
      morale,
      fatigue,
      ammo,
      status: engineStatus,
      broke,
      rallied,
      intent,
      orders,
    });
  }

  // Settle with every unit still on the ground, a revived one included (a friend may have marched
  // onto its start). Reach and rally were judged at the end positions as marched.
  const standsAfter = new Set(
    outcomes.filter((o) => o.status !== 'destroyed').map((o) => o.unitId),
  );
  const putBack = settle((id) => standsAfter.has(id));
  for (const [i, o] of outcomes.entries()) {
    if (!putBack.has(o.unitId)) continue;
    const where = placed.get(o.unitId)!;
    const next: AppliedOutcome = {
      ...o,
      center: { ...where.center },
      facing: where.facing,
      formation: where.formation,
      footprint: where.footprint,
      intent: o.intent.kind === 'hold' ? { kind: 'hold', at: { ...where.center } } : o.intent,
    };
    if (where.shape) next.shape = where.shape;
    else delete next.shape;
    outcomes[i] = next;
  }

  // Observations: the side's own unit sees the enemy at the end the observation names.
  const applied: GameState = { ...world, time: endMs, units: appliedUnits(world, outcomes, endMs) };
  const started: GameState = {
    ...world,
    time: startMs,
    units: world.units.map((u) => (startAt.has(u.id) ? { ...u, center: startAt.get(u.id)! } : u)),
  };
  const observations: TurnObservation[] = [];
  const seenKeys = new Set<string>();
  for (const o of proposal.observations) {
    const w = o.when === 'start' ? started : applied;
    const by = w.units.find((u) => u.id === o.by);
    const target = w.units.find((u) => u.id === o.unitId);
    const key = `${o.side}|${o.by}|${o.unitId}|${o.when}`;
    let why: string | undefined;
    if (!w.sides.some((s) => s.id === o.side)) why = `no side ${o.side}`;
    else if (!by || by.side !== o.side) why = `${o.by} is not a unit of ${o.side}`;
    else if (!target || target.side === o.side) why = `${o.unitId} is not an enemy of ${o.side}`;
    else if (by.status === 'destroyed') why = `${o.by} was destroyed`;
    else if (target.status === 'destroyed') why = `${o.unitId} was gone`;
    else if (!canSee(w, by, target)) {
      why = `${o.by} could not see ${o.unitId} at the turn's ${o.when}`;
    } else if (seenKeys.has(key)) continue;
    if (why) {
      note(o.by, 'observation', { ...o } as unknown as Json, null, `observation dropped: ${why}`);
      continue;
    }
    seenKeys.add(key);
    observations.push({ ...o });
  }

  // The fallback counts units whose own outcome was clamped (D39): not dropped observations, and
  // not outcomes for units that were gone before the turn.
  const liveIds = new Set(live.map((u) => u.id));
  const clampedUnits = new Set(
    corrections
      .filter((c) => c.clamp && c.field !== 'observation' && liveIds.has(c.unitId))
      .map((c) => c.unitId),
  ).size;
  return { problems, outcomes, observations, corrections, clampedUnits, units: live.length };
}

/** Why a broken unit may not rally this turn (D39, `RALLY_RULES`), or undefined if it may. */
function rallyRefused(
  world: GameState,
  u: Unit,
  w: Want,
  where: Unit,
  strength: number,
  placed: Map<string, Unit>,
  live: Unit[],
  standing: (e: Unit) => boolean,
  ctx: TurnContext,
  projectedRally: boolean,
): string | undefined {
  const rolls = ctx.rolls ?? [];
  const cited = !!w.rollIds?.length && w.rollIds.every((id) => rolls.some((r) => r.id === id));
  if (!cited && !projectedRally) {
    return 'a rally must rest on a roll';
  }
  const start = world.startStrength?.[u.id] ?? u.strength;
  if (strength < RALLY_RULES.minStrengthShare * start) return 'too few men left';
  if (u.brokenAt === undefined || ctx.turn.endMs - u.brokenAt > RALLY_RULES.giveUpMs) {
    return 'too long since it broke';
  }
  const pressed = live.some(
    (e) =>
      e.side !== u.side &&
      standing(e) &&
      distanceMm(where.center, placed.get(e.id)!.center) <= mm(RALLY_RULES.enemyClearM),
  );
  return pressed ? 'an enemy is too close' : undefined;
}

/** The world's units with the outcomes set, as `umpire.turn` leaves them. */
function appliedUnits(world: GameState, outcomes: AppliedOutcome[], endMs: GameTime): Unit[] {
  const byId = new Map(outcomes.map((o) => [o.unitId, o]));
  return world.units.map((u) => {
    const o = byId.get(u.id);
    if (!o) return u;
    const next: Unit = {
      ...u,
      center: { ...o.center },
      facing: o.facing,
      formation: o.formation,
      footprint: o.footprint,
      strength: o.strength,
      morale: o.morale,
      fatigue: o.fatigue,
      ammo: o.ammo,
      status: o.status,
      intent: o.intent,
    };
    if (o.shape) next.shape = o.shape;
    else delete next.shape;
    delete next.leg;
    if (o.broke) next.brokenAt = endMs;
    else if (o.status !== 'withdrawn') delete next.brokenAt;
    return next;
  });
}

/** Mark the world as resolving turn `turn` (D39). Under the umpire, the turn is held. */
export function beginTurn(state: EngineState<GameState>, turn: TurnFlag): EngineState<GameState> {
  return { ...state, world: { ...state.world, turn: { ...turn } } };
}

/** What `umpire.turn` carries: the proposal as logged, and everything the validator needs. */
export interface TurnPayload {
  proposal: TurnProposal;
  context: TurnContext;
}

/**
 * Queue the umpire's turn to be applied at the turn's end. The event carries the whole raw
 * proposal and its context, so replaying the log validates and applies it again with no model.
 */
export function issueTurn(
  state: EngineState<GameState>,
  payload: TurnPayload,
): EngineState<GameState> {
  return schedule(state, [
    { time: payload.context.turn.endMs, type: TURN_EVENT, payload: payload as unknown as Json },
  ]);
}

function contactOf(target: Unit, at: Point, time: GameTime): Contact {
  return {
    id: target.id,
    position: { ...at },
    seenAt: time,
    facing: coarseFacing(target.facing),
    sizeEstimate: sizeEstimate(target.strength),
  };
}

/**
 * Each side's papers on an umpire turn (D39, 11.9, #405), filed at the turn's end and handed in
 * at once, in unit-id order: one `turn` report from each of its units that came through (where it
 * stands, what became of its orders, what it lost), a `unitLost` from headquarters for each one
 * destroyed or taken, and a `contact` for each enemy its units saw at the end that it did not
 * have in sight before, from the first of its units that saw it. Built from the applied outcome
 * only; the umpire's words (`account`) are added by the server when it narrates them, never here.
 */
function turnReports(
  before: GameState,
  after: GameState,
  check: TurnValidation,
  startMs: GameTime,
  endMs: GameTime,
  n: number,
): GameState {
  let world = after;
  const startOf = new Map(before.units.map((u) => [u.id, u]));
  const startAt = new Map(before.units.map((u) => [u.id, positionAt(before.map, u, startMs)]));
  for (const side of world.sides) {
    for (const o of check.outcomes) {
      const u = world.units.find((x) => x.id === o.unitId);
      const was = startOf.get(o.unitId);
      if (!u || !was || u.side !== side.id) continue;
      if (u.status === 'destroyed') {
        world = fileReport(world, 'unitLost', u, endMs, 0);
        continue;
      }
      const at = startAt.get(u.id) ?? was.center;
      const prefix = `${side.id}-`;
      const facts: NonNullable<Report['turn']> = {
        n,
        lost: Math.max(0, Math.round(was.strength - u.strength)),
        movedM: Math.round(metres(distanceMm(at, u.center))),
        ...(o.broke ? { broke: true as const } : {}),
        ...(o.rallied ? { rallied: true as const } : {}),
        orders: o.orders.map((r) => ({
          ...(r.orderId.startsWith(prefix) ? { ref: r.orderId.slice(prefix.length) } : {}),
          result: r.result,
        })),
      };
      world = fileReport(world, 'turn', u, endMs, 0, { turn: facts });
    }
    const wasInSight = new Set(before.intel[side.id].inSight);
    const reported = new Set<string>();
    for (const o of check.observations) {
      if (o.side !== side.id || o.when !== 'end' || wasInSight.has(o.unitId)) continue;
      if (reported.has(o.unitId)) continue;
      const observer = world.units.find((x) => x.id === o.by);
      const target = world.units.find((x) => x.id === o.unitId);
      if (!observer || !target || target.status === 'destroyed') continue;
      reported.add(o.unitId);
      const reports = world.intel[side.id].reports;
      const report = contactReport(
        world,
        `${side.id}-r${reports.length + 1}`,
        observer,
        target,
        endMs,
        endMs,
      );
      world = {
        ...world,
        intel: {
          ...world.intel,
          [side.id]: { ...world.intel[side.id], reports: [...reports, report] },
        },
      };
    }
  }
  return world;
}

/**
 * Queue a `notice` to every side at `time`, from the umpire's staff, in `text` (D39, 11.9): the
 * in-fiction word that a turn the umpire could not decide was resolved by the tables. Pure.
 */
export function issueTurnNotice(
  state: EngineState<GameState>,
  time: GameTime,
  text: string,
): EngineState<GameState> {
  return schedule(state, [{ time, type: TURN_NOTICE_EVENT, payload: { text } }]);
}

/**
 * Register `umpire.turn`. At the turn's end it validates the proposal (the same check the
 * pipeline ran) and applies it in one step: each unit's outcome, its standing intent, the end of
 * every march leg, the sightings that stood, a `TurnRuling` per correction, rally tries for units
 * that broke, and one victory check. A proposal for the wrong turn throws: the pipeline falls
 * back before issuing one, so meeting one here means the log and the world disagree.
 */
export function registerTurn(registry: EventRegistry<GameState>): void {
  registry.register(TURN_NOTICE_EVENT, (w, ev) => {
    const text = (ev.payload as { text?: unknown } | undefined)?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error(`${TURN_NOTICE_EVENT}: no text`);
    }
    // Nothing is written after the game (#438).
    if (w.outcome) return { world: w };
    let world = w;
    for (const side of w.sides) {
      const reports = world.intel[side.id].reports;
      const at = side.hq ?? world.units.find((u) => u.side === side.id)?.center ?? { x: 0, y: 0 };
      const report: Report = {
        id: `${side.id}-r${reports.length + 1}`,
        kind: 'notice',
        observedAt: ev.time,
        deliverAt: ev.time,
        from: TURN_NOTICE_FROM,
        location: { ...at },
        place: '',
        uncertainty: 0,
        confidence: 'high',
        text,
      };
      world = {
        ...world,
        intel: {
          ...world.intel,
          [side.id]: { ...world.intel[side.id], reports: [...reports, report] },
        },
      };
    }
    return { world };
  });

  registry.register(TURN_EVENT, (w, ev) => {
    if (w.outcome) return { world: w };
    const { proposal, context } = ev.payload as unknown as TurnPayload;
    const check = validateProposal(w, proposal, context);
    if (check.fatal) throw new Error(`${TURN_EVENT}: ${check.fatal}`);
    const { n, startMs, endMs } = context.turn;
    let world: GameState = { ...w, time: ev.time, units: appliedUnits(w, check.outcomes, endMs) };

    // Sightings, at the end each was valid for; a later one is not overwritten by an earlier.
    const startPos = new Map(w.units.map((u) => [u.id, positionAt(w.map, u, startMs)]));
    const ordered = [...check.observations].sort((a, b) =>
      a.when === b.when ? 0 : a.when === 'start' ? -1 : 1,
    );
    const intel = { ...world.intel };
    for (const o of ordered) {
      const side = o.side as SideId;
      const target = (o.when === 'start' ? w : world).units.find((u) => u.id === o.unitId)!;
      const at = o.when === 'start' ? startPos.get(o.unitId)! : target.center;
      const seenAt = o.when === 'start' ? startMs : endMs;
      const mine = intel[side];
      const old = mine.contacts.find((c) => c.id === o.unitId);
      if (old && old.seenAt > seenAt) continue;
      const contacts = [
        ...mine.contacts.filter((c) => c.id !== o.unitId),
        contactOf(target, at, seenAt),
      ].sort((a, b) => (a.id < b.id ? -1 : 1));
      intel[side] = { ...mine, contacts };
    }
    // The next scan reports only enemies newly in sight after the turn.
    for (const s of world.sides) {
      const inSight = [
        ...new Set(
          check.observations
            .filter((o) => o.side === s.id && o.when === 'end')
            .map((o) => o.unitId),
        ),
      ].sort();
      intel[s.id] = { ...intel[s.id], inSight };
    }
    world = { ...world, intel };
    world = turnReports(w, world, check, startMs, endMs, n);

    const rulings: TurnRuling[] = check.corrections.map((c, i) => {
      return {
        kind: 'turn',
        turn: c.turn,
        unitId: c.unitId,
        field: c.field,
        proposed: c.proposed,
        applied: c.applied,
        reason: c.reason,
        id: `ruling-${world.rulings.length + i + 1}`,
        time: endMs,
        rationale: c.reason,
        narrative: `The umpire's turn ${n} was corrected for ${c.unitId} (${c.field}): ${c.reason}.`,
      };
    });
    // The turn flag stays until the next turn begins, so the scan and the other handlers at
    // this same instant leave the applied outcome as it is.
    // The umpire's journal (11.8): this turn's note and precedents, from the logged proposal, so
    // replay rebuilds it. Master state; it is not in the emitted payload, which the window shows.
    const journal = recordInJournal(
      w.journal,
      n,
      typeof proposal.summary === 'string' ? proposal.summary : '',
      Array.isArray(proposal.precedents)
        ? proposal.precedents.filter((p): p is string => typeof p === 'string')
        : [],
    );
    world = { ...world, rulings: [...world.rulings, ...rulings], combatActive: false, journal };

    // Just past the held instant: a march the umpire left under way sets off, and combat is
    // checked for units still in contact. Both matter only if the next turn is the engine's (rigid
    // or fallback); a held next turn ignores them.
    const next: NewEvent[] = [{ time: endMs + 1, type: COMBAT_CHECK_EVENT }];
    for (const o of check.outcomes) {
      if (o.broke) {
        next.push({
          time: endMs + RALLY_RULES.firstTryMs,
          type: RALLY_EVENT,
          payload: { unitId: o.unitId },
        });
      }
      if (o.status === 'active' && o.intent.kind === 'move') {
        const to: [number, number] = [o.intent.to.x, o.intent.to.y];
        next.push({ time: endMs + 1, type: MOVE_INTENT_EVENT, payload: { unitId: o.unitId, to } });
      }
    }
    const emit: Array<{ type: string; payload?: Json }> = [
      {
        type: 'umpire.turn',
        payload: {
          turn: n,
          rulings: rulings.map((r) => r.id),
          clamped: check.clampedUnits,
          // The umpire's dice (11.7), for the admin view and the record; master state only.
          ...(context.rolls?.length ? { rolls: context.rolls as unknown as Json } : {}),
        },
      },
    ];
    const victory = turnVictory(world, endMs);
    return {
      world: victory.world,
      schedule: [...next, ...(victory.schedule ?? [])],
      emit: [...emit, ...(victory.emit ?? [])],
    };
  });
}
