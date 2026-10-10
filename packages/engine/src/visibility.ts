import type { EventRegistry, NewEvent } from './events.js';
import { schedule } from './queue.js';
import type { EngineState } from './events.js';
import {
  MS_PER_MINUTE,
  tileAt,
  type Contact,
  type GameState,
  type GameTime,
  type Point,
  type Report,
  type SideId,
  type Unit,
  type UnitKind,
} from './types.js';

/** Sight range in tiles (one tile is 100 paces). */
export const SIGHT_RANGE: Record<UnitKind, number> = { infantry: 6, cavalry: 8, artillery: 6 };

/** A unit standing in or looking out of a wood sees and is seen only this close. */
const WOOD_RANGE = 2;

/** How often (game time) the engine rescans who sees whom. */
export const SCAN_INTERVAL_MS = MS_PER_MINUTE;

/** Courier time for a report to reach HQ. */
export const COURIER_DELAY_MS = 10 * MS_PER_MINUTE;

export const SCAN_EVENT = 'intel.scan';
export const REPORT_EVENT = 'intel.report';

/** Tiles strictly between `a` and `b` on a Bresenham line. */
function between(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x !== b.x || y !== b.y) out.push({ x, y });
  }
  return out;
}

/**
 * Whether `observer` can see `target`: within sight range, no wood tile on the
 * line between them, and a unit in or looking from a wood only within 2 tiles.
 */
export function canSee(world: GameState, observer: Unit, target: Unit): boolean {
  const a = observer.position;
  const b = target.position;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist > SIGHT_RANGE[observer.kind]) return false;
  if (dist > WOOD_RANGE && (tileAt(world.map, a) === 'wood' || tileAt(world.map, b) === 'wood')) {
    return false;
  }
  // Walk the line from a canonical endpoint so sight is symmetric.
  const [p, q] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
  return between(p, q).every((t) => tileAt(world.map, t) !== 'wood');
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
  position: Point;
  strength: number;
  morale: number;
}

/** An enemy unit in sight now. */
export interface ViewEnemy {
  id: string;
  position: Point;
  sizeEstimate: string;
}

/** An enemy unit seen earlier, not in sight now. */
export interface ViewContact {
  id: string;
  /** Where it was when seen, not where it is. */
  position: Point;
  seenAt: GameTime;
  ageMs: number;
  /** Radius in tiles it may have moved since (grows with age). */
  uncertaintyTiles: number;
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
  location: Point;
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
  const where = `(${r.location.x}, ${r.location.y})`;
  const when = `${mins} min ago`;
  switch (r.kind) {
    case 'contact':
      return `${r.from} sighted ${r.sizeEstimate ?? 'enemy troops'} at ${where}, ${when} (${r.confidence} confidence).`;
    case 'unitLost':
      return `${r.from} is lost near ${where}, ${when}.`;
    case 'orderDelivered':
      return `${r.from} received its orders at ${where}, ${when}.`;
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
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    ownUnits: state.units
      .filter((u) => u.side === side)
      .map((u) => ({
        id: u.id,
        name: u.name,
        kind: u.kind,
        position: { ...u.position },
        strength: u.strength,
        morale: u.morale,
      })),
    visibleEnemies: seen.map((u) => ({
      id: u.id,
      position: { ...u.position },
      sizeEstimate: sizeEstimate(u.strength),
    })),
    lastKnownContacts: intel.contacts
      .filter((c) => !seenIds.has(c.id))
      .map((c) => {
        const ageMs = state.time - c.seenAt;
        return {
          id: c.id,
          position: { ...c.position },
          seenAt: c.seenAt,
          ageMs,
          uncertaintyTiles: Math.min(
            Math.ceil(ageMs / MS_PER_MINUTE),
            Math.max(state.map.width, state.map.height),
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
          location: { ...r.location },
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
        position: { ...u.position },
        seenAt: time,
        sizeEstimate: sizeEstimate(u.strength),
      });
      if (intel.inSight.includes(u.id)) continue;
      const observer = mine.find((m) => canSee(w, m, u))!;
      const dist = Math.hypot(
        observer.position.x - u.position.x,
        observer.position.y - u.position.y,
      );
      reports.push({
        id: `${side}-r${reports.length + 1}`,
        kind: 'contact',
        observedAt: time,
        deliverAt: time + COURIER_DELAY_MS,
        from: observer.name,
        location: { ...u.position },
        sizeEstimate: sizeEstimate(u.strength),
        confidence: dist <= SIGHT_RANGE[observer.kind] / 2 ? 'high' : 'medium',
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
      location: { ...unit.position },
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
