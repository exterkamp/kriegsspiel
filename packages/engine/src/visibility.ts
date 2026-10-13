import { heldTurn, reachesHqAt } from './held.js';
import type { EventRegistry, NewEvent } from './events.js';
import { schedule } from './queue.js';
import type { EngineState } from './events.js';
import { courierPosition, destinationOf } from './courier.js';
import { findPath } from './navigation.js';
import { distance, metres } from './geometry.js';
import { describePlace } from './place.js';
import { fieldNote, type NoteSender } from './fieldNotes.js';
import { evaluateStanding } from './standing.js';
import { unitTypeOf } from './unitTypes.js';
import { BLOCKS_SIGHT, profileAlong, terrainAt } from './terrain.js';
import {
  MS_PER_MINUTE,
  type CapturedDocument,
  type Contact,
  type Formation,
  type GameState,
  type GameTime,
  type Height,
  type Point,
  type Report,
  type SideId,
  type Unit,
  type UnitKind,
} from './types.js';

/** Lengths in a view are metres; master state is integer mm. */
const viewPoint = (p: Point): Point => ({ x: metres(p.x), y: metres(p.y) });
const viewFootprint = (u: Unit) => ({
  frontage: metres(u.footprint.frontage),
  depth: metres(u.footprint.depth),
});

/**
 * What a watcher can judge of an enemy's footprint: to the nearest 10 m. A footprint follows
 * from the formation and strength, so an exact one would give the strength away.
 */
export const coarseMetres = (m: number) => Math.max(10, Math.round(m / 10) * 10);
const coarse = (mmLen: number) => coarseMetres(metres(mmLen));
const viewEnemyFootprint = (u: Unit) => ({
  frontage: coarse(u.footprint.frontage),
  depth: coarse(u.footprint.depth),
});

/** Sight range in mm of each arm's default type; a unit's own comes from its type. */
export const SIGHT_RANGE_MM: Record<UnitKind, number> = {
  infantry: unitTypeOf('infantry').sightRangeM * 1000,
  cavalry: unitTypeOf('cavalry').sightRangeM * 1000,
  artillery: unitTypeOf('artillery').sightRangeM * 1000,
};

/** A unit standing in or looking out of a wood sees and is seen only this close (200 m). */
const COVERED_RANGE_MM = 200_000;

/**
 * Partial concealment (0 < concealment < 1: marsh, scrub, orchards). Each metre of the line of
 * sight that crosses such ground counts as `1 + concealment * PARTIAL_PENALTY` metres of
 * distance, and a unit standing in it counts as `1 / (1 - concealment)` times as far away to
 * every watcher (it is hidden *inside*, not only behind). Concealment 1 is not partial: it
 * blocks the line and limits sight to `COVERED_RANGE_MM`. These numbers are placeholders, not
 * from the 1824 rulebook (docs/rules.md, "Sight and cover").
 */
export const PARTIAL_PENALTY = 4;

/** How far, in mm, a contact's possible position spreads per minute of age (100 m). */
export const UNCERTAINTY_MM_PER_MINUTE = 100_000;

/** A sighting report is good to a tenth of the range, but never tighter than 20 m. */
const MIN_REPORT_UNCERTAINTY_MM = 20_000;

/**
 * Whether a last-known contact has aged out (#110). Its uncertainty radius grows 100 m a
 * minute and is capped at the map's longer side; once the uncapped radius would pass that
 * cap, the sighting no longer says where the enemy might be, only that it once was there.
 */
export function contactAgedOut(world: GameState, c: Contact, now: GameTime): boolean {
  const capMm = Math.max(world.map.width, world.map.height);
  return Math.ceil((now - c.seenAt) / MS_PER_MINUTE) * UNCERTAINTY_MM_PER_MINUTE > capMm;
}

/** The public trait of the unit that sent `r`, for its note's manner (#419). */
function senderOf(state: GameState, side: SideId, r: Report): NoteSender {
  const u = state.units.find((x) => x.side === side && x.name === r.from);
  return u?.trait === undefined ? {} : { trait: u.trait };
}

/**
 * True when a lost-courier report's unit had a report of its own reach HQ, about something after its
 * orders were due, by the time the lost-courier report did. Fixed once delivered, so the text does
 * not change between readings.
 */
function heardFromSince(reports: Report[], r: Report): boolean {
  if (r.kind !== 'courierLost' || r.orderDueAt === undefined) return false;
  const due = r.orderDueAt;
  return reports.some(
    (o) =>
      o.from === r.from &&
      o.kind !== 'courierLost' &&
      o.kind !== 'unitLost' &&
      o.observedAt >= due &&
      o.deliverAt <= r.deliverAt,
  );
}

/** Whether a delivered report has told this side that enemy `unitId` is destroyed (#110). */
function destructionDelivered(reports: Report[], unitId: string, now: GameTime): boolean {
  return reports.some((r) => r.kind === 'destroyed' && r.subject === unitId && r.deliverAt <= now);
}

/** How often (game time) the engine rescans who sees whom. */
export const SCAN_INTERVAL_MS = MS_PER_MINUTE;

/** A unit in the fight sends word by the nearest rider: shorter than the courier from afar. */
export const FIELD_REPORT_DELAY_MS = 3 * MS_PER_MINUTE;
/** Courier time for a report to reach HQ. */
export const COURIER_DELAY_MS = 10 * MS_PER_MINUTE;

/** An acknowledgement rides a shorter way back than a sighting: the unit is already on the road to HQ. */
export const ACK_DELAY_MS = 2 * MS_PER_MINUTE;

export const SCAN_EVENT = 'intel.scan';
export const REPORT_EVENT = 'intel.report';
const REPORT_KINDS: Array<Report['kind']> = ['unitLost', 'orderDelivered', 'lowAmmo', 'exhausted'];

function concealedAt(world: GameState, p: Point): boolean {
  return (terrainAt(world.map, p)?.attrs.concealment ?? 0) >= BLOCKS_SIGHT;
}

const HEIGHT_RANK: Record<Height, number> = { low: -1, flat: 0, rise: 1, high: 2 };

function rankAt(world: GameState, p: Point): number {
  return HEIGHT_RANK[terrainAt(world.map, p)?.attrs.height ?? 'flat'];
}

/** Sight range in mm for a unit (or an arm's default type), after the weather hook. */
export function sightRangeMm(
  world: GameState,
  who: Pick<Unit, 'type' | 'kind'> | UnitKind,
): number {
  return unitTypeOf(who).sightRangeM * 1000 * (world.sightFactor ?? 1);
}

/** Round a bearing to the nearest eighth of a turn, in [0, 2 pi): all a watcher can judge. */
export const coarseFacing = (f: number): number => {
  const step = Math.PI / 4;
  const n = ((Math.round(f / step) % 8) + 8) % 8;
  return n * step;
};

/**
 * Whether `observer` can see `target`: within sight range (unit kind and weather), and on
 * the straight line between them no sight-blocking ground (a wood, a building) and no ground
 * higher than both of them (a ridge). A unit in or looking from a wood or building sees and
 * is seen only within 200 m. Partly concealing ground (marsh, scrub) lengthens the effective
 * distance (`perceivedDistance`). Facing does not matter yet.
 */
export function canSee(world: GameState, observer: Unit, target: Unit): boolean {
  const a = observer.center;
  const b = target.center;
  const dist = distance(a, b);
  if (dist > sightRangeMm(world, observer)) return false;
  if (concealedAt(world, a) || concealedAt(world, b)) return dist <= COVERED_RANGE_MM;
  // Walk the line from a canonical endpoint so sight is symmetric.
  const [p, q] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
  // Only rise/high ground can block, so low-lying observers still see across flat ground.
  const eye = Math.max(0, rankAt(world, a), rankAt(world, b));
  const pieces = profileAlong(world.map, p, q).filter((piece) => piece.length > 0);
  if (
    pieces.some(
      (piece) => piece.attrs.concealment >= BLOCKS_SIGHT || HEIGHT_RANK[piece.attrs.height] > eye,
    )
  ) {
    return false;
  }
  return perceivedDistance(world, a, b, pieces) <= sightRangeMm(world, observer);
}

/**
 * The distance as sight feels it: the true distance lengthened by partial concealment along
 * the line and by each end standing in partly concealing ground. Symmetric in `a` and `b`.
 */
function perceivedDistance(
  world: GameState,
  a: Point,
  b: Point,
  pieces: ReadonlyArray<{ length: number; attrs: { concealment: number } }>,
): number {
  let d = distance(a, b);
  for (const piece of pieces) d += piece.length * piece.attrs.concealment * PARTIAL_PENALTY;
  for (const end of [a, b]) {
    const c = terrainAt(world.map, end)?.attrs.concealment ?? 0;
    if (c > 0 && c < BLOCKS_SIGHT) d /= 1 - c;
  }
  return d;
}

function visibleTo(world: GameState, side: SideId): Unit[] {
  const mine = world.units.filter((u) => u.side === side && u.strength > 0);
  return world.units.filter(
    (u) => u.side !== side && u.strength > 0 && mine.some((m) => canSee(world, m, u)),
  );
}

/** A coarse description. Never the real number. */
export function sizeEstimate(strength: number): string {
  if (strength < 300) return 'a small detachment';
  if (strength < 800) return 'about a battalion';
  if (strength < 2000) return 'about a brigade';
  return 'a large force';
}

export interface ViewUnit {
  id: string;
  name: string;
  commander?: string;
  trait?: string;
  kind: UnitKind;
  /** Centre of the footprint, in metres. */
  position: Point;
  /** Compass bearing in radians (0 north, growing clockwise). */
  facing: number;
  formation: Formation;
  /** Metres. */
  footprint: { frontage: number; depth: number };
  /** Loose-formation sub-positions as metre offsets in the unit's own frame, if it has any. */
  shape?: Point[];
  strength: number;
  morale: number;
  /** 0 fresh .. 100 spent. */
  fatigue: number;
  /** 0..100: share of its ammunition left. */
  ammo: number;
}

/**
 * One of the side's own orders or planned routes, as a polyline in metres (start first).
 * `order`: a dispatch still riding to its unit, from the unit to the destination it names.
 * `route`: where an own unit is marching now. Only the side's own units and orders appear.
 */
export interface ViewOrderRoute {
  id: string;
  unitId: string;
  kind: 'order' | 'route';
  points: Point[];
}

/** An enemy unit in sight now. What a watcher can make out: where, which way, and about how big a patch of ground (footprint to the nearest 10 m). */
export interface ViewEnemy {
  id: string;
  position: Point;
  facing: number;
  formation: Formation;
  footprint: { frontage: number; depth: number };
  shape?: Point[];
  sizeEstimate: string;
}

/** An enemy unit seen earlier, not in sight now. */
export interface ViewContact {
  id: string;
  /** Where it was when seen, not where it is. Metres. */
  position: Point;
  /** Which way it faced when seen, to the nearest eighth of a turn. A guess once it has moved. */
  facing: number;
  seenAt: GameTime;
  ageMs: number;
  /** Radius in metres it may have moved since (grows with age). */
  uncertaintyRadius: number;
  sizeEstimate: string;
}

/** One of the side's own couriers riding, where it is now by the plan HQ sent it on. Never an enemy's. */
export interface ViewCourier {
  /** The order it carries. */
  id: string;
  unitId: string;
  /** Metres. */
  position: Point;
  /** Metres: the unit it rides to, where the unit was when the ride was planned. */
  to: Point;
  /** When HQ expects it to arrive (game time). It is the plan, not a promise. */
  arriveAt: GameTime;
}

export interface ViewReport {
  id: string;
  kind: Report['kind'];
  observedAt: GameTime;
  deliveredAt: GameTime;
  /** Game ms since the thing happened. */
  ageMs: number;
  from: string;
  /** Metres. */
  location: Point;
  /** Plain-language place, such as "near the mill, east of the road". */
  place: string;
  /** Metres: the report puts the thing within this radius of `location`. */
  uncertaintyRadius: number;
  sizeEstimate?: string;
  confidence: Report['confidence'];
  text: string;
}

/** An enemy dispatch this side took from a courier, once it has reached HQ. */
export interface ViewDocument {
  id: string;
  kind: CapturedDocument['kind'];
  capturedAt: GameTime;
  deliveredAt: GameTime;
  /** Game ms since it was taken. */
  ageMs: number;
  /** When the enemy HQ sent it. */
  issuedAt: GameTime;
  /** Name of the enemy unit it was addressed to. */
  addressedTo: string;
  /** Metres: where the courier was taken. */
  location: Point;
  place: string;
  /** The order exactly as the enemy wrote it. */
  text: string;
}

/**
 * Everything one side may know. This is the complete list; nothing else
 * reaches a client (see docs/architecture.md, "SideView contents").
 */
export interface EngineSideView {
  side: SideId;
  time: GameTime;
  /** Map size in metres. */
  mapWidth: number;
  mapHeight: number;
  /** This side's own headquarters, where its couriers set out. */
  hq?: Point;
  ownUnits: ViewUnit[];
  /** Own orders in flight and own units' planned routes (#203). */
  orderRoutes: ViewOrderRoute[];
  /** Own couriers on the road, with their delivery estimate. */
  couriers: ViewCourier[];
  visibleEnemies: ViewEnemy[];
  lastKnownContacts: ViewContact[];
  /** Only reports whose courier delay has passed. */
  reports: ViewReport[];
  /** Enemy dispatches taken from couriers, once they have reached HQ. */
  documents: ViewDocument[];
}

/**
 * The engine's prose for a report, as a field note from its sender (`fieldNote`, #419); the narrate
 * stage may replace it. `leadMs` is the report's age when it reached HQ (not travel time), so the text
 * is the same whenever it is read and agrees with the "received" time shown beside it (#318); never an
 * age measured against the clock at read time. Every kind says it one way: "about N minutes ago", or
 * "just now" (#325). `sender` and `seed` choose the manner and wording; without them, the first wording.
 */
export function renderReport(
  r: Report,
  leadMs: number,
  heardSince = false,
  sender?: NoteSender,
  seed?: number,
): string {
  return fieldNote(r, leadMs, heardSince, sender, seed);
}

/** Prose for the table: where and when the dispatch was taken, then the enemy's own words. */
export function renderDocument(d: ViewDocument): string {
  const mins = Math.round(d.ageMs / MS_PER_MINUTE);
  return `Enemy dispatch to ${d.addressedTo}, taken from a courier ${d.place}, ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago: "${d.text}"`;
}

function couriersOf(state: GameState, side: SideId): ViewCourier[] {
  const out: ViewCourier[] = [];
  for (const c of state.couriers) {
    const last = c.legs.at(-1);
    // Own couriers only. One lost or taken still shows on its plan until due: the sender cannot know.
    if (c.side !== side || !last || state.time > last.arriveAt) continue;
    out.push({
      id: c.order.id,
      unitId: c.order.to,
      position: viewPoint(courierPosition(c, state.time)),
      to: viewPoint(last.to),
      arriveAt: last.arriveAt,
    });
  }
  return out;
}

function orderRoutesOf(state: GameState, side: SideId): ViewOrderRoute[] {
  const out: ViewOrderRoute[] = [];
  for (const c of state.couriers) {
    if (c.side !== side) continue;
    const unit = state.units.find((u) => u.id === c.order.to && u.side === side);
    if (!unit || unit.strength <= 0) continue;
    let to: Point | undefined;
    for (const i of c.order.intents) {
      to = destinationOf(i);
      if (to) break;
    }
    if (to) {
      out.push({
        id: c.order.id,
        unitId: unit.id,
        kind: 'order',
        points: [viewPoint(unit.center), viewPoint(to)],
      });
    }
  }
  // Only units still in the fight get an arrow: a withdrawn or destroyed unit has no plan to show.
  for (const u of state.units) {
    if (u.side !== side || u.strength <= 0 || u.status !== 'active') continue;
    const i = u.intent;
    const to =
      i.kind === 'move' || i.kind === 'attack'
        ? i.to
        : i.kind === 'withdraw'
          ? i.toward
          : undefined;
    if (!to) continue;
    // The path the unit will take: the leg under way, then the planned route (the visibility graph, #343) from its end.
    const from = u.leg ? u.leg.to : u.center;
    const ahead = findPath(state.map, from, to, { width: u.footprint.frontage })?.waypoints ?? [to];
    const points = [u.center, ...(u.leg ? [u.leg.to] : []), ...ahead.slice(1), to].filter(
      (p, n, all) => n === 0 || p.x !== all[n - 1]!.x || p.y !== all[n - 1]!.y,
    );
    if (points.length > 1) {
      out.push({ id: `route-${u.id}`, unitId: u.id, kind: 'route', points: points.map(viewPoint) });
    }
  }
  return out;
}

/**
 * The only function that turns master state into something a side may see. Pure.
 * `now` is the engine clock (`EngineState.time`); `world.time` only moves when an
 * event fires, so pass `now` whenever the clock may have advanced past the last event.
 */
export function viewFor(
  world: GameState,
  side: SideId,
  now: GameTime = world.time,
): EngineSideView {
  const state = { ...world, time: now };
  const intel = state.intel[side];
  const seen = visibleTo(state, side);
  const seenIds = new Set(seen.map((u) => u.id));
  const hq = state.sides.find((s) => s.id === side)?.hq;
  return {
    side,
    time: state.time,
    mapWidth: metres(state.map.width),
    mapHeight: metres(state.map.height),
    ...(hq ? { hq: viewPoint(hq) } : {}),
    ownUnits: state.units
      .filter((u) => u.side === side)
      .map((u) => ({
        id: u.id,
        name: u.name,
        ...(u.commander === undefined ? {} : { commander: u.commander }),
        ...(u.trait === undefined ? {} : { trait: u.trait }),
        kind: u.kind,
        position: viewPoint(u.center),
        facing: u.facing,
        formation: u.formation,
        footprint: viewFootprint(u),
        ...(u.shape ? { shape: u.shape.map(viewPoint) } : {}),
        strength: u.strength,
        morale: u.morale,
        fatigue: u.fatigue,
        ammo: u.ammo,
      })),
    orderRoutes: orderRoutesOf(state, side),
    couriers: couriersOf(state, side),
    visibleEnemies: seen.map((u) => ({
      id: u.id,
      position: viewPoint(u.center),
      facing: u.facing,
      formation: u.formation,
      footprint: viewEnemyFootprint(u),
      ...(u.shape ? { shape: u.shape.map(viewPoint) } : {}),
      sizeEstimate: sizeEstimate(u.strength),
    })),
    lastKnownContacts: intel.contacts
      .filter((c) => !seenIds.has(c.id))
      // Aged out, or the enemy is destroyed and the side has been told so (#110).
      .filter((c) => !contactAgedOut(state, c, state.time))
      .filter((c) => {
        const u = state.units.find((x) => x.id === c.id);
        return u?.status !== 'destroyed' || !destructionDelivered(intel.reports, c.id, state.time);
      })
      .map((c) => {
        const ageMs = state.time - c.seenAt;
        return {
          id: c.id,
          position: viewPoint(c.position),
          facing: c.facing,
          seenAt: c.seenAt,
          ageMs,
          uncertaintyRadius: metres(
            Math.min(
              Math.ceil(ageMs / MS_PER_MINUTE) * UNCERTAINTY_MM_PER_MINUTE,
              Math.max(state.map.width, state.map.height),
            ),
          ),
          sizeEstimate: c.sizeEstimate,
        };
      }),
    reports: intel.reports
      .filter((r) => r.deliverAt <= state.time)
      .map((r) => {
        const ageMs = state.time - r.observedAt;
        return {
          id: r.id,
          kind: r.kind,
          observedAt: r.observedAt,
          deliveredAt: r.deliverAt,
          ageMs,
          from: r.from,
          location: viewPoint(r.location),
          place: r.place,
          uncertaintyRadius: metres(r.uncertainty),
          ...(r.sizeEstimate === undefined ? {} : { sizeEstimate: r.sizeEstimate }),
          confidence: r.confidence,
          text: renderReport(
            r,
            r.deliverAt - r.observedAt,
            heardFromSince(intel.reports, r),
            senderOf(state, side, r),
            state.seed,
          ),
        };
      }),
    documents: intel.documents
      .filter((d) => d.deliverAt <= state.time)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        capturedAt: d.capturedAt,
        deliveredAt: d.deliverAt,
        ageMs: state.time - d.capturedAt,
        issuedAt: d.issuedAt,
        addressedTo: d.addressedTo,
        location: viewPoint(d.location),
        place: d.place,
        text: d.text,
      })),
  };
}

function withIntel(world: GameState, side: SideId, patch: Partial<GameState['intel'][SideId]>) {
  return { ...world, intel: { ...world.intel, [side]: { ...world.intel[side], ...patch } } };
}

function reportId(world: GameState, side: SideId): string {
  return `${side}-r${world.intel[side].reports.length + 1}`;
}

function scan(world: GameState, time: GameTime): GameState {
  let w: GameState = { ...world, time };
  for (const side of w.sides.map((s) => s.id)) {
    const mine = w.units.filter((u) => u.side === side && u.strength > 0);
    const seen = visibleTo(w, side);
    const intel = w.intel[side];
    const contacts = new Map<string, Contact>(intel.contacts.map((c) => [c.id, c]));
    const reports = [...intel.reports];
    for (const u of seen) {
      contacts.set(u.id, {
        id: u.id,
        position: { ...u.center },
        facing: coarseFacing(u.facing),
        seenAt: time,
        sizeEstimate: sizeEstimate(u.strength),
      });
      if (intel.inSight.includes(u.id)) continue;
      const observer = mine.find((m) => canSee(w, m, u))!;
      const dist = distance(observer.center, u.center);
      reports.push({
        id: `${side}-r${reports.length + 1}`,
        kind: 'contact',
        observedAt: time,
        deliverAt: reachesHqAt(w, time, COURIER_DELAY_MS),
        from: observer.name,
        location: { ...u.center },
        place: describePlace(w.map, u.center),
        uncertainty: Math.max(MIN_REPORT_UNCERTAINTY_MM, Math.ceil(dist / 10 / 10_000) * 10_000),
        sizeEstimate: sizeEstimate(u.strength),
        confidence: dist <= sightRangeMm(w, observer) / 2 ? 'high' : 'medium',
        subject: u.id,
      });
    }
    // Prune last-known contacts (#110). One that has aged out no longer says where the enemy
    // might be. One for a destroyed enemy goes only once the side has been told of the
    // destruction: a scan that finds a contacted enemy destroyed files that report when one
    // of the side's units can see the wreck, and until the report's courier delay has passed
    // the contact stays, so the view never leaks a death nobody witnessed.
    const kept: Contact[] = [];
    for (const c of contacts.values()) {
      if (contactAgedOut(w, c, time)) continue;
      const u = w.units.find((x) => x.id === c.id);
      if (u?.status === 'destroyed') {
        if (destructionDelivered(reports, c.id, time)) continue;
        if (!reports.some((r) => r.kind === 'destroyed' && r.subject === c.id)) {
          const observer = mine.find((m) => canSee(w, m, u));
          if (observer) {
            const dist = distance(observer.center, u.center);
            reports.push({
              id: `${side}-r${reports.length + 1}`,
              kind: 'destroyed',
              observedAt: time,
              deliverAt: reachesHqAt(w, time, COURIER_DELAY_MS),
              from: observer.name,
              location: { ...u.center },
              place: describePlace(w.map, u.center),
              uncertainty: Math.max(
                MIN_REPORT_UNCERTAINTY_MM,
                Math.ceil(dist / 10 / 10_000) * 10_000,
              ),
              sizeEstimate: c.sizeEstimate,
              confidence: dist <= sightRangeMm(w, observer) / 2 ? 'high' : 'medium',
              subject: u.id,
            });
          }
        }
      }
      kept.push(c);
    }
    w = withIntel(w, side, {
      contacts: kept.sort((a, b) => (a.id < b.id ? -1 : 1)),
      inSight: seen.map((u) => u.id),
      reports,
    });
  }
  return w;
}

/** File a report from `unit` about itself (lost, orders received, short of ammunition...). */
export function fileReport(
  world: GameState,
  kind: Report['kind'],
  unit: Unit,
  time: GameTime,
  delayMs: number = COURIER_DELAY_MS,
  extra: Pick<Report, 'orderDueAt' | 'routed' | 'rallied'> = {},
): GameState {
  const report: Report = {
    id: reportId(world, unit.side),
    kind,
    observedAt: time,
    deliverAt: reachesHqAt(world, time, delayMs),
    from: unit.name,
    location: { ...unit.center },
    place: describePlace(world.map, unit.center),
    uncertainty: 0,
    confidence: 'high',
    ...extra,
  };
  return withIntel(world, unit.side, { reports: [...world.intel[unit.side].reports, report] });
}

/**
 * Register the visibility handlers. `intel.scan` rescans who sees whom, files a
 * contact report (delayed by the courier) for each enemy newly in sight, and
 * reschedules itself. `intel.report` files a unit-lost or order-delivered
 * report for the named unit's side; combat and orders schedule it.
 */
export function registerVisibility(registry: EventRegistry<GameState>): void {
  registry.register(SCAN_EVENT, (world, ev) => {
    // An umpire turn records no sightings: the umpire's observations stand for the turn.
    if (heldTurn(world, ev.time)) {
      return { world, schedule: [{ time: ev.time + SCAN_INTERVAL_MS, type: SCAN_EVENT }] };
    }
    // Standing orders are judged right after the scan, from each unit's own sight.
    const res = evaluateStanding(scan(world, ev.time), ev.time);
    return {
      world: res.world,
      schedule: [{ time: ev.time + SCAN_INTERVAL_MS, type: SCAN_EVENT }, ...(res.schedule ?? [])],
      ...(res.emit ? { emit: res.emit } : {}),
    };
  });

  registry.register(REPORT_EVENT, (world, ev) => {
    const p = ev.payload as unknown as { kind: string; unitId: string };
    if (!REPORT_KINDS.includes(p?.kind as Report['kind'])) {
      throw new Error(`${REPORT_EVENT}: unknown report kind ${String(p?.kind)}`);
    }
    const unit = world.units.find((u) => u.id === p.unitId);
    if (!unit) throw new Error(`${REPORT_EVENT}: unknown unit ${String(p.unitId)}`);
    const delay = p.kind === 'orderDelivered' ? ACK_DELAY_MS : COURIER_DELAY_MS;
    return { world: fileReport(world, p.kind as Report['kind'], unit, ev.time, delay) };
  });
}

/**
 * Each side's chief of staff hands over an opening situation report at once, so a player has
 * paper to read before any contact. It carries no enemy information, only the side's own.
 */
function openingReports(state: EngineState<GameState>): EngineState<GameState> {
  let world = state.world;
  for (const side of world.sides) {
    if (world.intel[side.id].reports.some((r) => r.kind === 'situation')) continue;
    const mine = world.units.filter((u) => u.side === side.id && u.strength > 0);
    const first = mine[0];
    if (!first) continue;
    const at = side.hq ?? first.center;
    const report: Report = {
      id: reportId(world, side.id),
      kind: 'situation',
      observedAt: state.time,
      deliverAt: state.time,
      from: 'Chief of staff',
      location: { ...at },
      place: describePlace(world.map, at),
      uncertainty: 0,
      sizeEstimate: `${mine.length} ${mine.length === 1 ? 'formation' : 'formations'}`,
      confidence: 'high',
    };
    world = withIntel(world, side.id, { reports: [...world.intel[side.id].reports, report] });
  }
  return { ...state, world };
}

/** Queue the first scan at the state's current time. Call once when a game starts. */
export function startVisibility(state: EngineState<GameState>): EngineState<GameState> {
  return schedule(openingReports(state), [{ time: state.time, type: SCAN_EVENT } as NewEvent]);
}
