import type { ShoulderEvidence } from './shoulders.js';
import type { Bounds, Cover, Drainage, Elevation, Point, Polygon, Water } from '../contract.js';

export const GEOGRAPHY_VERSION = 'flood-carved-graded-backwater-v1' as const;
export const CROSSING_VERSION = 'reserved-dry-disks-v1' as const;
/** Resource overrides affect success/failure, never successful geometry. */
export interface GeographyLimits {
  maxFloodWork?: number;
  maxRegionWork?: number;
  maxPhysicsWork?: number;
  maxCrossingWork?: number;
}
export interface FloodEvidence {
  enqueued: number;
  popped: number;
  neighbourChecks: number;
  work: number;
}
export interface DrainageOutput {
  drainage: Drainage;
  /** Strictly increasing pop order resolves equal-height flats without epsilon. */
  ranks: number[];
  evidence: FloodEvidence;
}
/** A suitability proposal; #137 supplies final road IDs and linked edges. */
export interface CrossingCandidate {
  id: string;
  kind: 'bridge';
  waterId: string;
  endpoints: [Point, Point];
  spanM: number;
  widthM: number;
  deck: Polygon;
  minimumAbutmentM: number;
  policy: typeof CROSSING_VERSION;
}
export interface GeographyOutput {
  version: typeof GEOGRAPHY_VERSION;
  /** Immutable content snapshot before hydrology; never the filled surface. */
  sourceElevation: Elevation;
  /** Authoritative, decimal6 ground; regenerate contours if groundChanged. */
  elevation: Elevation;
  groundChanged: boolean;
  drainage: Drainage;
  water: Water[];
  cover: Cover[];
  crossingCandidates: CrossingCandidate[];
  evidence: {
    flood: FloodEvidence;
    regionWork: number;
    physicsWork: number;
    shoulder?: ShoulderEvidence;
  };
}
export interface PhysicsEvidence {
  maxGroundExcessM: number;
  work: number;
}
export type Field = { elevation: Elevation; bounds: Bounds };
