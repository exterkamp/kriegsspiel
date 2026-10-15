import type { Coord, Footprint, Formation } from '@kriegsspiel/protocol';

// NOTE: mirrors the vector feature kinds in packages/engine/src/types.ts until the base map
// moves into @kriegsspiel/protocol. `scene.test.ts` compares the list with the engine's source so drift is caught.
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

/** A closed area (woods, marsh, water, fields), in metres. */
export interface PolygonShape {
  shape: 'polygon';
  points: Coord[];
}
/** A line with a full `width` in metres (roads, rivers, streams). */
export interface PolylineShape {
  shape: 'polyline';
  points: Coord[];
  width: number;
}
/** A place with a `radius` in metres (bridges, fords, buildings). */
export interface PointShape {
  shape: 'point';
  at: Coord;
  radius: number;
}

/** A feature of the base map the player sees. Later features draw over earlier ones. */
export interface BaseFeature {
  id: string;
  kind: FeatureKind;
  /** Native terrain precedence. Omission preserves legacy fixture kind ordering. */
  layer?: number;
  geometry: PolygonShape | PolylineShape | PointShape;
}

/**
 * The base map the player sees: a plane `width` x `height` metres from the north-west
 * corner (x east, y south), with vector features painted on it. There is no grid.
 */
export interface BaseMap {
  width: number;
  height: number;
  features: BaseFeature[];
}

/** An oriented footprint at a centre, in metres. `facing` is a compass bearing in radians. */
interface Placed {
  /** Centre of the footprint, in metres. */
  position: Coord;
  facing: number;
}

export interface OwnPiece extends Placed {
  kind: 'own';
  /** Player-visible snapshot strength; absence remains unknown. */
  strength?: number;
  id: string;
  label: string;
  side: string;
  formation: Formation;
  footprint: Footprint;
  /** Loose sub-positions, as offsets in metres in the unit's own frame (x right, y front). */
  shape?: Coord[];
  /** Source snapshot time, never a report date. */
  snapshotAtGame?: number;
  /** Supplied observation time; never inferred from age. */
  observedAtGame?: number;
}

export interface GhostPiece extends Placed {
  kind: 'ghost';
  id: string;
  ageMs: number;
  /** Paper tag text, for example "2h 10m old". */
  ageTag: string;
  /** The enemy may now be anywhere within this many metres of `position`; 0 for a live sighting. */
  uncertaintyRadius: number;
  sizeEstimate?: string;
  /** Only for a live sighting, where the watcher can judge the ground it covers. */
  formation?: Formation;
  footprint?: Footprint;
  shape?: Coord[];
  snapshotAtGame?: number;
  observedAtGame?: number;
}

/** Render-only annotation geometry in metres; no knowledge or authorization metadata. */
export type SceneMarkGeometry =
  | { readonly kind: 'pin'; readonly at: Readonly<Coord> }
  | { readonly kind: 'polyline'; readonly points: readonly Readonly<Coord>[] }
  | { readonly kind: 'arrow'; readonly points: readonly Readonly<Coord>[] }
  | { readonly kind: 'ring'; readonly centre: Readonly<Coord>; readonly radiusM: number }
  | {
      readonly kind: 'symbol';
      readonly at: Readonly<Coord>;
      readonly symbol: 'cross' | 'dot' | 'flag';
    };

export interface SceneMark {
  readonly id: string;
  readonly label: string;
  readonly geometry: SceneMarkGeometry;
}

/**
 * An order of ours in flight, for the overlays: `order` is drawn as an arrow from the unit to where it
 * was told to go, `route` as the path it will take. The server does not send these yet (see AGENTS.md),
 * so `buildSceneState` leaves the list empty.
 */
export interface OrderRoute {
  id: string;
  kind: 'order' | 'route';
  /** Start first; an `order` arrow runs from the first to the last point. */
  points: Coord[];
}

/** One of our own couriers on the road: where it is now and how long HQ expects the ride to take from here. Never an enemy's. */
export interface SceneCourier {
  id: string;
  position: Coord;
  /** The unit it rides to, in metres. */
  to: Coord;
  /** Whole minutes of game time until the planned arrival, 0 when due. */
  etaMin: number;
}

export interface Overlays {
  orders: boolean;
  routes: boolean;
  /** The shading around stale enemy sightings that shows how old the knowledge is. */
  lastKnown: boolean;
}

export const ALL_OVERLAYS: Overlays = { orders: true, routes: true, lastKnown: true };

/** A fight the side knows about: its own unit and an enemy it can see, within fire of each other. */
export interface Engagement {
  id: string;
  /** Midway between the two, in metres. */
  position: { x: number; y: number };
}

export interface SceneState {
  side: string;
  map: BaseMap;
  own: OwnPiece[];
  ghosts: GhostPiece[];
  /** Accepted live overlays; absent in the HQ fixture port. */
  orderRoutes?: OrderRoute[];
  /** Own couriers riding; shown with the order arrows. */
  couriers?: SceneCourier[];
  /** Where this side's units and a visible enemy are within fire of each other: drawn as a fight marker. */
  engagements?: Engagement[];
  /** Omission preserves the standalone client and renders no annotations. */
  marks?: readonly SceneMark[];
}
