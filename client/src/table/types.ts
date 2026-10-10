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
  id: string;
  label: string;
  side: string;
  formation: Formation;
  footprint: Footprint;
  /** Loose sub-positions, as offsets in metres in the unit's own frame (x right, y front). */
  shape?: Coord[];
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
}

export interface SceneState {
  side: string;
  map: BaseMap;
  own: OwnPiece[];
  ghosts: GhostPiece[];
}
