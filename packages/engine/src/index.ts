/** Pure, deterministic engine. Never reads the wall clock. */
export const ENGINE_NAME = 'kriegsspiel-engine';

export * from './rng.js';
export * from './events.js';
export { compareEvents, schedule } from './queue.js';
export { advanceTo, createState } from './advance.js';
export type { AdvanceResult } from './advance.js';
export { serialize, deserialize } from './snapshot.js';

export * from './types.js';
export { loadScenario, parseTerrain, ScenarioError } from './scenario.js';
export { holdTheBridge } from './scenarios/holdTheBridge.js';
export * from './geometry.js';
export { rasterise, SAMPLE_TERRAIN } from './raster.js';
export type { TerrainRaster } from './raster.js';
export {
  BLOCKS_SIGHT,
  KIND_DEFAULTS,
  OPEN_GROUND,
  ROAD_CLASS_COST,
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
  DEFAULT_TYPE_OF_KIND,
  FORMATION_RULES,
  UNIT_DATA,
  UNIT_TYPES,
  UnitDataError,
  catalogueOf,
  msPerMetreOf,
  parseUnitData,
  unitTypeOf,
} from './unitTypes.js';
export type {
  FormationRules,
  FormationTable,
  UnitData,
  UnitType,
  UnitTypeCatalogue,
} from './unitTypes.js';
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
export {
  MAX_SHAPE_EXTENT_MM,
  MAX_SHAPE_POINTS,
  OVERLAP_TOLERANCE_MM,
  PLACEMENT_EVENT,
  issuePlacement,
  registerPlacement,
  validatePlacement,
} from './placement.js';
export type {
  Placement,
  PlacementProposal,
  PlacementRuling,
  PlacementVerdict,
} from './placement.js';
export {
  BREAK_MORALE,
  COMBAT_TICK_MS,
  coverFactor,
  FIRE_RATE,
  issueAttack,
  registerCombat,
  startGame,
} from './combat.js';
export {
  CHARGE_M,
  FLANK_FACTOR,
  LONG_RANGE_FACTOR,
  MELEE_FACTOR,
  RANGE_M,
  REAR_FACTOR,
  aspectOf,
  canReach,
  inMelee,
  onObjective,
  rangeFactor,
} from './contact.js';
export type { Aspect } from './contact.js';
export {
  COURIER_CHOICES,
  COURIER_LOST_EVENT,
  COURIER_MS_PER_METRE,
  COURIER_STEP_EVENT,
  choiceRisk,
  issueOrder,
  registerOrders,
} from './orders.js';
export {
  GARBLE_MAX_M,
  GARBLE_MIN_M,
  INTERCEPT_BY_KIND,
  INTERCEPT_CHECK_MS,
  MAX_GARBLE,
  MAX_LOSS,
  courierPosition,
  interceptChance,
  rideRisk,
} from './courier.js';
export type { CourierChoice, Order, OrderIntent } from './orders.js';
export {
  STANDING_EVENT,
  applyIntents,
  evaluateStanding,
  fireOnReceipt,
  triggerHolds,
} from './standing.js';
export { describePlace } from './place.js';
export { beginMarch } from './movement.js';
export {
  ACK_DELAY_MS,
  COURIER_DELAY_MS,
  SCAN_INTERVAL_MS,
  SIGHT_RANGE_MM,
  UNCERTAINTY_MM_PER_MINUTE,
  canSee,
  sightRangeMm,
  registerVisibility,
  startVisibility,
  viewFor,
  renderDocument,
  renderReport,
} from './visibility.js';
export type {
  EngineSideView,
  ViewContact,
  ViewDocument,
  ViewEnemy,
  ViewReport,
  ViewUnit,
} from './visibility.js';
export * from './fatigue.js';
export {
  AMMO_PER_FIRE_TICK,
  LOW_AMMO,
  OUT_OF_AMMO_FACTOR,
  RESUPPLY_PER_TICK,
  SUPPLY_TICK_EVENT,
  SUPPLY_TICK_MS,
  WAGON_REACH_COST_M,
  depotsOf,
  registerSupply,
  wagonsReach,
} from './supply.js';
export { ROLES, maySign, mayDraft, mayForward, viewForRole } from './roles.js';
export type { EngineRoleView, Role, Seat, ViewUnitOutline } from './roles.js';
