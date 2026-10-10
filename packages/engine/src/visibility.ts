import type { EventRegistry, NewEvent } from './events.js';
import { schedule } from './queue.js';
import type { EngineState } from './events.js';
import { distance, metres } from './geometry.js';
import { describePlace } from './place.js';
import { BLOCKS_SIGHT, profileAlong, terrainAt } from './terrain.js';
import {
  MS_PER_MINUTE,
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
const coarse = (mmLen: number) => Math.max(10, Math.round(metres(mmLen) / 10) * 10);
const viewEnemyFootprint = (u: Unit) => ({
  frontage: coarse(u.footprint.frontage),
  depth: coarse(u.footprint.depth),
});

/** Sight range in mm: infantry and artillery 600 m, cavalry 800 m. */
export const SIGHT_RANGE_MM: Record<UnitKind, number> = {
  infantry: 600_000,
  cavalry: 800_000,
  artillery: 600_000,
};

/** A unit standing in or looking out of a wood sees and is seen only this close (200 m). */
const COVERED_RANGE_MM = 200_000;

/** How far, in mm, a contact's possible position spreads per minute of age (100 m). */
export const UNCERTAINTY_MM_PER_MINUTE = 100_000;

/** A sighting report is good to a tenth of the range, but never tighter than 20 m. */
const MIN_REPORT_UNCERTAINTY_MM = 20_000;

/** How often (game time) the engine rescans who sees whom. */
export const SCAN_INTERVAL_MS = MS_PER_MINUTE;

/** Courier time for a report to reach HQ. */
export const COURIER_DELAY_MS = 10 * MS_PER_MINUTE;

export const SCAN_EVENT = 'intel.scan';
export const REPORT_EVENT = 'intel.report';

function concealedAt(world: GameState, p: Point): boolean {
  return (terrainAt(world.map, p)?.attrs.concealment ?? 0) >= BLOCKS_SIGHT;
}

const HEIGHT_RANK: Record<Height, number> = { low: -1, flat: 0, rise: 1, high: 2 };

function rankAt(world: GameState, p: Point): number {
  return HEIGHT_RANK[terrainAt(world.map, p)?.attrs.height ?? 'flat'];
}

/** Sight range in mm for a unit kind, after the weather hook. */
export function sightRangeMm(world: GameState, kind: UnitKind): number {
  return SIGHT_RANGE_MM[kind] * (world.sightFactor ?? 1);
}

/** Round a bearing to the nearest eighth of a turn, in [0, 2 pi): all a watcher can judge. */
const coarseFacing = (f: number): number => {
  const step = Math.PI / 4;
  const n = ((Math.round(f / step) % 8) + 8) % 8;
  return n * step;
};

/**
 * Whether `observer` can see `target`: within sight range (unit kind and weather), and on
 * the straight line between them no sight-blocking ground (a wood, a building) and no ground
 * higher than both of them (a ridge). A unit in or looking from a wood or building sees and
 * is seen only within 200 m. Facing does not matter yet.
 */
export function canSee(world: GameState, observer: Unit, target: Unit): boolean {
  const a = observer.center;
  const b = target.center;
  const dist = distance(a, b);
  if (dist > sightRangeMm(world, observer.kind)) return false;
  if (concealedAt(world, a) || concealedAt(world, b)) return dist <= COVERED_RANGE_MM;
  // Walk the line from a canonical endpoint so sight is symmetric.
  const [p, q] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
  // Only rise/high ground can block, so low-lying observers still see across flat ground.
  const eye = Math.max(0, rankAt(world, a), rankAt(world, b));
  return !profileAlong(world.map, p, q).some(
    (piece) =>
      piece.length > 0 &&
      (piece.attrs.concealment >= BLOCKS_SIGHT || HEIGHT_RANK[piece.attrs.height] > eye),
  );
}

function visibleTo(world: GameState, side: SideId): Unit[] {
  const mine = world.units.filter((u) => u.side === side && u.strength > 0);
  return world.units.filter(
    (u) => u.side !== side && u.strength > 0 && mine.some((m) => canSee(world, m, u)),
  );
}

/** A coarse description. Never the real number. */
function sizeEstimate(strength: number): string {
  if (strength < 300) return 'a small detachment';
  if (strength < 800) return 'about a battalion';
  if (strength < 2000) return 'about a brigade';
  return 'a large force';
}

export interface ViewUnit {
  id: string;
  name: string;
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
  ownUnits: ViewUnit[];
  visibleEnemies: ViewEnemy[];
  lastKnownContacts: ViewContact[];
  /** Only reports whose courier delay has passed. */
  reports: ViewReport[];
}

/** Plain template prose for a report. The LLM replaces this later. */
export function renderReport(r: Report, ageMs: number): string {
  const mins = Math.round(ageMs / MS_PER_MINUTE);
  const where = r.place;
  const when = `${mins} min ago`;
  switch (r.kind) {
    case 'contact':
      return `${r.from} sighted ${r.sizeEstimate ?? 'enemy troops'} ${where}, ${when} (${r.confidence} confidence).`;
    case 'unitLost':
      return `${r.from} is lost ${where}, ${when}.`;
    case 'orderDelivered':
      return `${r.from} received its orders ${where}, ${when}.`;
  }
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
  return {
    side,
    time: state.time,
    mapWidth: metres(state.map.width),
    mapHeight: metres(state.map.height),
    ownUnits: state.units
      .filter((u) => u.side === side)
      .map((u) => ({
        id: u.id,
        name: u.name,
        kind: u.kind,
        position: viewPoint(u.center),
        facing: u.facing,
        formation: u.formation,
        footprint: viewFootprint(u),
        ...(u.shape ? { shape: u.shape.map(viewPoint) } : {}),
        strength: u.strength,
        morale: u.morale,
      })),
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
          text: renderReport(r, ageMs),
        };
      }),
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
        deliverAt: time + COURIER_DELAY_MS,
        from: observer.name,
        location: { ...u.center },
        place: describePlace(w.map, u.center),
        uncertainty: Math.max(MIN_REPORT_UNCERTAINTY_MM, Math.ceil(dist / 10 / 10_000) * 10_000),
        sizeEstimate: sizeEstimate(u.strength),
        confidence: dist <= sightRangeMm(w, observer.kind) / 2 ? 'high' : 'medium',
        subject: u.id,
      });
    }
    w = withIntel(w, side, {
      contacts: [...contacts.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      inSight: seen.map((u) => u.id),
      reports,
    });
  }
  return w;
}

/**
 * Register the visibility handlers. `intel.scan` rescans who sees whom, files a
 * contact report (delayed by the courier) for each enemy newly in sight, and
 * reschedules itself. `intel.report` files a unit-lost or order-delivered
 * report for the named unit's side; combat and orders schedule it.
 */
export function registerVisibility(registry: EventRegistry<GameState>): void {
  registry.register(SCAN_EVENT, (world, ev) => ({
    world: scan(world, ev.time),
    schedule: [{ time: ev.time + SCAN_INTERVAL_MS, type: SCAN_EVENT }],
  }));

  registry.register(REPORT_EVENT, (world, ev) => {
    const p = ev.payload as unknown as { kind: string; unitId: string };
    if (p?.kind !== 'unitLost' && p?.kind !== 'orderDelivered') {
      throw new Error(`${REPORT_EVENT}: unknown report kind ${String(p?.kind)}`);
    }
    const unit = world.units.find((u) => u.id === p.unitId);
    if (!unit) throw new Error(`${REPORT_EVENT}: unknown unit ${String(p.unitId)}`);
    const report: Report = {
      id: reportId(world, unit.side),
      kind: p.kind,
      observedAt: ev.time,
      deliverAt: ev.time + COURIER_DELAY_MS,
      from: unit.name,
      location: { ...unit.center },
      place: describePlace(world.map, unit.center),
      uncertainty: 0,
      confidence: 'high',
    };
    return {
      world: withIntel(world, unit.side, {
        reports: [...world.intel[unit.side].reports, report],
      }),
    };
  });
}

/** Queue the first scan at the state's current time. Call once when a game starts. */
export function startVisibility(state: EngineState<GameState>): EngineState<GameState> {
  return schedule(state, [{ time: state.time, type: SCAN_EVENT } as NewEvent]);
}
