import type { Pace } from './fatigue.js';
import type { Order, OrderIntent } from './orders.js';
import type { PlacementProposal, PlacementVerdict } from './placement.js';

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

/** Road classes, best first. A road's class sets its march-cost multiplier. */
export const ROAD_CLASSES = ['highway', 'road', 'track'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

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
  /** Roads only: the class that set `attrs.moveCost`. */
  roadClass?: RoadClass;
  /** Bridges and fords: the widest marching column (frontage, mm) the crossing carries. */
  capacity?: number;
  /** Fords: 0..1 hazard of the crossing (data for the umpire; the planner only prices it). */
  risk?: number;
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
  | { kind: 'attack'; target: string; to: Point; startedAt: GameTime }
  /** Changing formation: the unit stands still until `formation.done` fires. */
  | { kind: 'reform'; formation: Formation; startedAt: GameTime };

/**
 * The stretch of a march a unit is on: it left `from` at `startedAt` and reaches `to` at
 * `arriveAt`. `center` only moves at the end of a leg; the leg says where the unit is in between.
 */
export interface Leg {
  from: Point;
  to: Point;
  startedAt: GameTime;
  arriveAt: GameTime;
  /** The game ms per metre of cost-1 ground the leg was timed with (pace and fatigue at its start). */
  msPerMetre?: number;
}

export const UNIT_KINDS = ['infantry', 'cavalry', 'artillery'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** `withdrawn`: broke and is falling back (out of the fight for good). `destroyed`: no men left. */
export type UnitStatus = 'active' | 'withdrawn' | 'destroyed';

/**
 * What sets off a standing order. Each is judged from the unit's own knowledge: an enemy it
 * can see itself, its own strength, the orders it has been handed, the clock.
 */
export type Trigger =
  /** An enemy unit the unit itself can see has its centre inside `area` (a closed polygon). */
  | { kind: 'enemySighted'; area: Point[] }
  /** The unit's own strength (men) has dropped below `strength`. */
  | { kind: 'strengthBelow'; strength: number }
  /** An order from `from` (an `Order.from`, 'hq' unless stated) reaches the unit. */
  | { kind: 'orderReceived'; from: string }
  /** Game time has reached `gameTime`. */
  | { kind: 'timeReached'; gameTime: GameTime };

/** A conditional or timed instruction the unit carries until its trigger fires (once). */
export interface StandingOrder {
  /** `<orderId>#<n>`; unique among a unit's standing orders. */
  id: string;
  orderId: string;
  trigger: Trigger;
  then: OrderIntent[];
}

export interface Unit {
  id: string;
  side: SideId;
  kind: UnitKind;
  /** Id of the unit type (see unitTypes.ts) that gives this unit its stats. */
  type: string;
  name: string;
  /** Who commands it, as the scenario names them. Absent when the scenario does not say. */
  commander?: string;
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
  /** 0 fresh .. 100 spent. Slows the march and, when high, wears morale down. */
  fatigue: number;
  /** 0..100: the share of its ammunition left. At 0 its fire is nearly useless. */
  ammo: number;
  /** How hard the current march is pushed. Only matters while marching. */
  pace: Pace;
  intent: Intent;
  /** Game time the unit broke and fled, while it is a routed unit that can still be run down. */
  brokenAt?: GameTime;
  /** Conditional and timed orders waiting on their trigger. Absent when there are none. */
  standing?: StandingOrder[];
  /** Set while the unit is marching along a leg, so a new order can stop it mid-leg. */
  leg?: Leg;
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
  /** Where wagons load ammunition. Defaults to the HQ when a scenario names none. */
  depots?: Point[];
}

/**
 * The `attacker` wins once its units alone have held `objective` for `takeMs`, an area (a closed polygon
 * of at least three points); a unit holds it when its centre is inside. The `defender` wins if
 * the game clock reaches `holdMs` with the attacker not having taken it.
 */
export interface VictoryCondition {
  objective: Point[];
  defender: SideId;
  attacker: SideId;
  holdMs: GameTime;
  /** How long the attacker must hold the objective alone for it to count as taken. Default 10 game minutes. */
  takeMs?: GameTime;
}

/** Game time the attacker must hold the objective, alone, before it counts as taken (D13). */
export const DEFAULT_TAKE_MS = 10 * 60_000;

export type VictoryReason =
  | 'objective-taken'
  | 'objective-held'
  | 'eliminated'
  | 'withdrawn'
  /** The attacker's force was broken before it took the objective (D13). */
  | 'attack-broken'
  /** The defender's force was broken, so the attacker holds the field (D13). */
  | 'defence-broken';

/** How the game ended. `winner` is null if both sides were put out of the fight together. */
export interface Outcome {
  winner: SideId | null;
  reason: VictoryReason;
  time: GameTime;
  /** Set when the losing side had nobody left to fight (destroyed, or all withdrawn) rather than being broken. */
  loserOut?: 'eliminated' | 'withdrawn';
}

/** A report waiting for, or already past, its courier delay. Belongs to one side's intel. */
export interface Report {
  id: string;
  kind:
    | 'situation'
    | 'contact'
    | 'unitLost'
    | 'courierLost'
    | 'orderDelivered'
    | 'lowAmmo'
    | 'exhausted'
    | 'destroyed'
    | 'engaged'
    | 'heavyLosses'
    | 'broke'
    | 'battle';
  /** Game time of the thing reported. */
  observedAt: GameTime;
  /** Game time the report reaches HQ (observedAt plus courier delay). */
  deliverAt: GameTime;
  /** The side's own reporting unit. */
  from: string;
  /** Where it happened; for a contact, where the enemy was seen. */
  location: Point;
  /** Coarse size of the enemy force; only for contacts and destroyed reports. */
  sizeEstimate?: string;
  confidence: 'low' | 'medium' | 'high';
  /** Plain-language place of `location`, from the named features near it. */
  place: string;
  /** Radius in mm around `location` the report is good to. */
  uncertainty: number;
  /** Enemy unit id; only for contacts and destroyed reports. */
  subject?: string;
  /** The wording itself, for a report that is the umpire's own (`battle`). */
  text?: string;
}

/**
 * A courier on the map, riding an order from HQ to its unit along `legs`. It exists from the
 * moment the order leaves HQ until it delivers, is lost, or is taken. Master state only.
 */
export interface Courier {
  id: string;
  side: SideId;
  /** The dispatch as signed. Its `text` is what a captor reads. */
  order: Order;
  /** Where the ride began (HQ). */
  origin: Point;
  /** The ride, one leg per route segment, with the times it is on each. Empty if HQ is the destination. */
  legs: Leg[];
  /** The intents the unit will adopt, when the courier garbles the order. Absent if the order arrives as signed. */
  garbled?: OrderIntent[];
  /**
   * Set when the courier was lost or taken. It stays in master state, riding on paper, until its
   * due arrival, so the sender's view cannot tell it has gone (the report comes later).
   */
  lostAt?: GameTime;
}

/** An enemy dispatch a side has taken from a courier. Belongs to the capturing side's intel. */
export interface CapturedDocument {
  id: string;
  kind: 'capturedDispatch';
  capturedAt: GameTime;
  /** Game time it reaches the capturing side's HQ (capturedAt plus courier delay). */
  deliverAt: GameTime;
  /** Game time the dispatch left the enemy HQ. */
  issuedAt: GameTime;
  fromSide: SideId;
  /** Name of the enemy unit it was addressed to. */
  addressedTo: string;
  /** Where the courier was taken. */
  location: Point;
  place: string;
  /** The order's original wording. */
  text: string;
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
  /** Enemy dispatches taken from couriers. */
  documents: CapturedDocument[];
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
  /** Since when the attacker alone has held the objective, or null (D13). Absent counts as null. */
  heldSince?: GameTime | null;
  intel: Record<SideId, SideIntel>;
  /** Couriers riding now, both sides. Master state only: never sent to a client. */
  couriers: Courier[];
  /** Weather hook: multiplies every unit's sight range (1 when absent, 0.5 in fog). */
  sightFactor?: number;
  /** Every umpire placement ruling so far, in order. Master state only: never sent to a client. */
  rulings: Array<Ruling | BattleRuling>;
  /** Men each unit started with, the yardstick for a broken force (D13). Absent: no unit counts as broken. */
  startStrength?: Record<string, number>;
  /** Set once, when the umpire has declared one side's force broken; the game closes soon after (D13). */
  battle?: { winner: SideId; reason: 'attack-broken' | 'defence-broken'; declaredAt: GameTime };
}

/**
 * The umpire's declaration that a battle is decided: whose force broke and who holds the field.
 * Worded without any figure a side could not know, so both sides may be told it (D13).
 */
export interface BattleRuling {
  id: string;
  time: GameTime;
  kind: 'battle';
  winner: SideId;
  loser: SideId;
  reason: 'attack-broken' | 'defence-broken';
  /** The umpire's reasoning, for the record and the post-game window. */
  rationale: string;
  /** What the table is told. */
  narrative: string;
}

/**
 * An umpire judgment call about where a unit stands, kept whole so a game can be replayed and
 * audited with no model call: what the umpire proposed, what the engine made of it, and why.
 */
export interface Ruling {
  id: string;
  /** Game time the engine ruled on the proposal. */
  time: GameTime;
  proposal: PlacementProposal;
  verdict: PlacementVerdict;
  /** The umpire's reasoning. */
  rationale: string;
  /** What the table is told happened ("the column strung out along the road"). */
  narrative: string;
}
