/** Game time in integer milliseconds since the scenario start. Never derived from the wall clock. */
export type GameTime = number;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

export type SideId = 'blue' | 'red';

export const TERRAINS = ['open', 'wood', 'river', 'bridge', 'road'] as const;
export type Terrain = (typeof TERRAINS)[number];

export interface Point {
  x: number;
  y: number;
}

/** Row-major grid: `tiles[y * width + x]`. */
export interface MapGrid {
  width: number;
  height: number;
  tiles: Terrain[];
}

export const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Facing = (typeof FACINGS)[number];

/** What a unit is currently trying to do. Produced from orders; the engine applies it. */
export type Intent =
  | { kind: 'idle' }
  /** `startedAt` ties scheduled step events to this order, so a newer intent makes them stale. */
  | { kind: 'move'; to: Point; startedAt: GameTime; thenHold?: boolean }
  /** Like a move, but a retreat; the unit stays in this intent until it arrives. */
  | { kind: 'withdraw'; toward: Point; startedAt: GameTime }
  | { kind: 'hold'; at: Point };

export const UNIT_KINDS = ['infantry', 'cavalry', 'artillery'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export interface Unit {
  id: string;
  side: SideId;
  kind: UnitKind;
  name: string;
  position: Point;
  /** Men remaining. */
  strength: number;
  /** 0..100. */
  morale: number;
  facing: Facing;
  intent: Intent;
}

export interface Side {
  id: SideId;
  name: string;
  /** Human-controlled or scripted. */
  controller: 'human' | 'scripted';
  /** Where this side's orders start from. Couriers ride from here. */
  hq: Point;
}

/** The `defender` wins by holding `objective` for `holdMs`; the `attacker` wins by taking it. */
export interface VictoryCondition {
  objective: Point;
  defender: SideId;
  attacker: SideId;
  holdMs: GameTime;
}

/** A report waiting for, or already past, its courier delay. Belongs to one side's intel. */
export interface Report {
  id: string;
  kind: 'contact' | 'unitLost' | 'orderDelivered';
  /** Game time of the thing reported. */
  observedAt: GameTime;
  /** Game time the report reaches HQ (observedAt plus courier delay). */
  deliverAt: GameTime;
  /** The side's own reporting unit. */
  from: string;
  /** Where it happened; for a contact, where the enemy was seen. */
  location: Point;
  /** Coarse size of the enemy force; only for contacts. */
  sizeEstimate?: string;
  confidence: 'low' | 'medium' | 'high';
  /** Enemy unit id; only for contacts. */
  subject?: string;
}

/** Last sighting of an enemy unit, as the side saw it then. */
export interface Contact {
  id: string;
  position: Point;
  seenAt: GameTime;
  sizeEstimate: string;
}

/** What one side has learned so far. Never sent to a client except through `viewFor`. */
export interface SideIntel {
  /** Latest sighting per enemy unit id. */
  contacts: Contact[];
  /** Enemy ids visible at the last scan, so a report fires only on first sight. */
  inSight: string[];
  reports: Report[];
}

export interface GameState {
  scenarioId: string;
  time: GameTime;
  seed: number;
  map: MapGrid;
  sides: Side[];
  units: Unit[];
  victory: VictoryCondition;
  intel: Record<SideId, SideIntel>;
}

export function tileAt(map: MapGrid, p: Point): Terrain | undefined {
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return undefined;
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return undefined;
  return map.tiles[p.y * map.width + p.x];
}
