import { holdTheBridge } from './holdTheBridge.js';

/**
 * "Hold the Bridge" with the armies far apart, as it was before the fair start (#178). Test
 * fixture: Blue
 * starts 500 to 700 m from its HQ, Red 250 to 550 m from the north edge. Movement and order
 * tests keep their numbers on this layout.
 */
const FAR_STARTS: Record<string, { x: number; y: number }> = {
  'blue-1': { x: 1850, y: 2450 },
  'blue-2': { x: 2250, y: 2550 },
  'blue-3': { x: 2050, y: 2750 },
  'red-1': { x: 1950, y: 450 },
  'red-2': { x: 2250, y: 250 },
  'red-3': { x: 1550, y: 550 },
};
export const holdTheBridgeFarStart = {
  ...holdTheBridge,
  units: holdTheBridge.units.map((u) => ({ ...u, at: FAR_STARTS[u.id]! })),
};
