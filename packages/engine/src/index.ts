/** Pure, deterministic engine. Never reads the wall clock. */
export const ENGINE_NAME = 'kriegsspiel-engine';

export * from './rng.js';
export * from './events.js';
export { compareEvents, schedule } from './queue.js';
export { advanceTo, createState } from './advance.js';
export type { AdvanceResult } from './advance.js';
export { serialize, deserialize } from './snapshot.js';

export * from './types.js';
export { loadScenario, ScenarioError } from './scenario.js';
export { holdTheBridge } from './scenarios/holdTheBridge.js';
export * from './geometry.js';
export {
  BLOCKS_SIGHT,
  KIND_DEFAULTS,
  OPEN_GROUND,
  featureAnchor,
  featuresAlong,
  featuresIn,
  profileAlong,
  segmentCost,
  segmentPassable,
  terrainAt,
} from './terrain.js';
export type { FeatureSpan, ProfilePiece, TerrainSample } from './terrain.js';
export {
  axes,
  defaultFootprint,
  footprintCorners,
  footprintsOverlap,
  subPositions,
  toWorld,
} from './formation.js';
export {
  FORMATION_CHANGE_MS,
  MS_PER_METRE,
  issueFormation,
  issueHalt,
  issueMove,
  legDuration,
  pathDuration,
  positionAlong,
  positionAt,
  registerMovement,
} from './movement.js';
export { findPath, legCost } from './navigation.js';
export type { Path, RouteOptions } from './navigation.js';
export { OVERLAP_TOLERANCE_MM, validatePlacement } from './placement.js';
export type { Placement, PlacementProposal, PlacementVerdict } from './placement.js';
export {
  BREAK_MORALE,
  COMBAT_TICK_MS,
  coverFactor,
  FIRE_RATE,
  issueAttack,
  registerCombat,
  startGame,
} from './combat.js';
export { OBJECTIVE_RADIUS_M, RANGE_M, canReach, onObjective } from './contact.js';
export { COURIER_MS_PER_METRE, issueOrder, registerOrders } from './orders.js';
export type { Order, OrderIntent } from './orders.js';
export { beginMarch } from './movement.js';
export {
  COURIER_DELAY_MS,
  SCAN_INTERVAL_MS,
  SIGHT_RANGE_MM,
  UNCERTAINTY_MM_PER_MINUTE,
  canSee,
  registerVisibility,
  startVisibility,
  viewFor,
  renderReport,
} from './visibility.js';
export type { EngineSideView, ViewUnit, ViewEnemy, ViewContact, ViewReport } from './visibility.js';
