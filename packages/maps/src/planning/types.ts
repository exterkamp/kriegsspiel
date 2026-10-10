import type {
  Bounds,
  GenerationResult,
  Cover,
  Elevation,
  Entrance,
  MapOverride,
  MapSettings,
  PlanningOutput,
  Point,
} from '../contract.js';
import type { CrossingCandidate } from '../geography/types.js';
import type { Water } from '../contract.js';
export const PLANNING_VERSION = 'sites-lattice-decks-v1' as const;
export const DECK_POLICY = 'linear-ground-endpoints-v1' as const;
export interface PlanningLimits {
  maxCandidateWork?: number;
  maxValidationWork?: number;
  maxHeapWork?: number;
  maxOutputFeatures?: number;
}
export interface PlanningInput {
  elevation: Elevation;
  bounds: Bounds;
  water: Water[];
  cover?: Cover[];
  crossingCandidates?: CrossingCandidate[];
  settings: MapSettings;
  seed: number;
  overrides?: MapOverride[];
  limits?: PlanningLimits;
  /** Extra boundary terminals; default one west exit. */
  boundarySides?: ('north' | 'east' | 'south' | 'west')[];
  /** Requires an actually linked bridge in the successful regional network. */
  requireBridge?: boolean;
  /** Derived layout preference, bounded by the recorded site area/extent limits. */
  preferredSiteExtentM?: { village?: number; farm?: number };
}
export interface DeckProfile {
  crossingId: string;
  policy: typeof DECK_POLICY;
  endpointHeightsM: [number, number];
  maxGrade: number;
}
export interface SiteSizing {
  siteId: string;
  areaM2: number;
  extentM: number;
  maxGradient: number;
  minimumSpacingM: number;
  candidateRank: number;
}
export interface RouteProvenance {
  id: string;
  from: string;
  to: string;
  roadIds: string[];
  crossingIds: string[];
}
export interface PlanningEvidence {
  candidateWork: number;
  validationWork: number;
  heapWork: number;
  expansions: number;
  placementAttempts: number;
  planningCells: number;
}
export interface RegionalPlanningOutput extends PlanningOutput {
  version: typeof PLANNING_VERSION;
  routes: RouteProvenance[];
  sizes: SiteSizing[];
  decks: DeckProfile[];
  evidence: PlanningEvidence;
}
export interface Suitability {
  suitable: boolean;
  maxGradient: number;
  reason?: 'bounds' | 'water' | 'gradient';
}
export interface CorridorCertificate {
  traversable: boolean;
  maxDirectionalGrade: number;
  reason?: 'bounds' | 'water' | 'grade';
}
export interface LocalJoin {
  siteId: string;
  entranceId: string;
  /** Authoritative world metres, after local placement/rotation. */
  endpoint: Point;
  bearingDeg: number;
  widthM: number;
}
export interface ReconciliationOutput {
  plan: RegionalPlanningOutput;
  /** Regional joins only; no statement about internal local streets. */
  joins: Entrance[];
  passes: number;
  work: number;
}

/** Work survives expected failure, allowing bounded composition retries. */
export type ReconciliationResult = GenerationResult<ReconciliationOutput> & {
  work: number;
  passes: number;
};
