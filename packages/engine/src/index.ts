/** Pure, deterministic engine. Never reads the wall clock. */
export const ENGINE_NAME = 'kriegsspiel-engine';

export * from './rng.js';
export * from './events.js';
export { compareEvents, schedule } from './queue.js';
export { advanceTo, createState } from './advance.js';
export type { AdvanceResult } from './advance.js';
export { serialize, deserialize } from './snapshot.js';
