/** Game time in integer milliseconds since the scenario start. Never derived from the wall clock. */
export type GameTime = number;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

export type SideId = 'blue' | 'red';

/**
 * A point on the continuous map plane. In master state every coordinate and length is an
 * integer count of millimetres (see `mm` / `metres` in geometry.ts), so serialisation and
 * replay are exact. The map origin is the north-west corner: x grows east, y grows south.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Terrain height tag. For sight, ground standing higher than both the observer and the target
 * blocks the line between them (a ridge); `low` ground (water, marsh) never does.
 */
export const HEIGHTS = ['low', 'flat', 'rise', 'high'] as const;
export type Height = (typeof HEIGHTS)[number];

/** What a piece of ground does to units on it. */
export interface TerrainAttrs {
  /** Multiplier on march time; 1 is open ground. Ignored when not passable. */
  moveCost: number;
  /** 0..1: protection from fire. */
  cover: number;
  /** 0..1: how well it hides troops. 1 blocks sight through it. */
  concealment: number;
  height: Height;
  passable: boolean;
}

export const FEATURE_KINDS = [
  'field',
  'wood',
  'marsh',
  'water',
  'road',
  'river',
  'stream',
  'bridge',
  'ford',
  'building',
] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

/** A closed area (woods, marsh, water, fields). */
export interface PolygonGeometry {
  shape: 'polygon';
  points: Point[];
}

/** A line with a width (roads, rivers, streams). `width` is the full width in mm. */
export interface PolylineGeometry {
  shape: 'polyline';
  points: Point[];
  width: number;
}

/** A place with a radius (bridges, fords, buildings). `radius` is in mm. */
export interface PointGeometry {
  shape: 'point';
  at: Point;
  radius: number;
}

export type FeatureGeometry = PolygonGeometry | PolylineGeometry | PointGeometry;

/** A vector terrain feature. Where features overlap, the highest `layer` decides the ground. */
export interface TerrainFeature {
  id: string;
  kind: FeatureKind;
  name?: string;
  layer: number;
  geometry: FeatureGeometry;
  attrs: TerrainAttrs;
}

/** The ground: a rectangle `width` x `height` mm from the origin, and the features on it. */
export interface TerrainMap {
  width: number;
  height: number;
  features: TerrainFeature[];
}

export const FORMATIONS = ['line', 'column', 'square', 'skirmish', 'loose'] as const;
export type Formation = (typeof FORMATIONS)[number];

/** The ground a unit covers, as an oriented rectangle around its centre, in mm. */
export interface Footprint {
  /** Width across the facing. */
  frontage: number;
  /** Length along the facing. */
  depth: number;
}

/** What a unit is currently trying to do. Produced from orders; the engine applies it. */
export type Intent =
  | { kind: 'idle' }
  /** `startedAt` ties scheduled step events to this order, so a newer intent makes them stale. */
  | { kind: 'move'; to: Point; startedAt: GameTime; thenHold?: boolean }
  /** Like a move, but a retreat; the unit stays in this intent until it arrives. */
  | { kind: 'withdraw'; toward: Point; startedAt: GameTime }
  | { kind: 'hold'; at: Point }
  /** Close on `target` (a unit id) and fight it. `to` is where it stood when the march was planned. */
  | { kind: 'attack'; target: string; to: Point; startedAt: GameTime };

export const UNIT_KINDS = ['infantry', 'cavalry', 'artillery'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** `withdrawn`: broke and is falling back (out of the fight for good). `destroyed`: no men left. */
export type UnitStatus = 'active' | 'withdrawn' | 'destroyed';

export interface Unit {
  id: string;
  side: SideId;
  kind: UnitKind;
  name: string;
  /** Centre of the unit's footprint. */
  center: Point;
  /** Compass bearing in radians the unit faces: 0 is north (-y), growing clockwise (east is pi/2). */
  facing: number;
  formation: Formation;
  footprint: Footprint;
  /**
   * Sub-positions of a loose formation (a skirmish line along a treeline, an arc), as offsets
   * in mm from `center` in the unit's own frame: x to its right, y to its front.
   */
  shape?: Point[];
  /** Men remaining. Fractional, since casualties are. */
  strength: number;
  /** 0..100. */
  morale: number;
  intent: Intent;
  status: UnitStatus;
  /** Where the unit starts, and where it withdraws to if it breaks. */
  home: Point;
}

export interface Side {
  id: SideId;
  name: string;
  /** Human-controlled or scripted. */
  controller: 'human' | 'scripted';
  /** Where this side's orders start from. Couriers ride from here. */
  hq: Point;
}

/**
 * The `attacker` wins the moment its units alone hold `objective`. The `defender` wins if
 * the game clock reaches `holdMs` with the attacker not having taken it.
 */
export interface VictoryCondition {
  objective: Point;
  defender: SideId;
  attacker: SideId;
  holdMs: GameTime;
}

export type VictoryReason = 'objective-taken' | 'objective-held' | 'eliminated' | 'withdrawn';

/** How the game ended. `winner` is null if both sides were put out of the fight together. */
export interface Outcome {
  winner: SideId | null;
  reason: VictoryReason;
  time: GameTime;
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
  /** Plain-language place of `location`, from the named features near it. */
  place: string;
  /** Radius in mm around `location` the report is good to. */
  uncertainty: number;
  /** Enemy unit id; only for contacts. */
  subject?: string;
}

/** Last sighting of an enemy unit, as the side saw it then. */
export interface Contact {
  id: string;
  position: Point;
  seenAt: GameTime;
  /** The facing as judged at the sighting, rounded to the nearest eighth of a turn. */
  facing: number;
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
  map: TerrainMap;
  sides: Side[];
  units: Unit[];
  victory: VictoryCondition;
  /** True while a chain of combat ticks is running (units are in contact). */
  combatActive: boolean;
  /** Set once, when the game ends. Nothing happens in combat or victory handlers after that. */
  outcome: Outcome | null;
  intel: Record<SideId, SideIntel>;
  /** Weather hook: multiplies every unit's sight range (1 when absent, 0.5 in fog). */
  sightFactor?: number;
}
