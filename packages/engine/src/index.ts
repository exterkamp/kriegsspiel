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
export {
  MS_PER_TILE,
  enterCost,
  findPath,
  issueHalt,
  issueMove,
  pathDuration,
  registerMovement,
  stepDuration,
} from './movement.js';
export type { Path } from './movement.js';
export { COURIER_MS_PER_TILE, issueOrder, registerOrders } from './orders.js';
export type { Order, OrderIntent } from './orders.js';
export { beginMarch } from './movement.js';
