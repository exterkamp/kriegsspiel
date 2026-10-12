import { holdTheBridge } from './scenarios/holdTheBridge.js';
import { loadScenario } from './scenario.js';
import type { GameState } from './types.js';

/* Helpers for tests: build a small scenario in metres through the public loader. */

export type RawFeature = Record<string, unknown> & { id: string; kind: string };

export interface RawUnit {
  id: string;
  side?: 'blue' | 'red';
  x: number;
  y: number;
  kind?: 'infantry' | 'cavalry' | 'artillery';
  /** A unit type id; when set it replaces `kind`. */
  type?: string;
  formation?: string;
  strength?: number;
  facingDeg?: number;
}

export const wood = (id: string, x0: number, y0: number, x1: number, y1: number): RawFeature => ({
  id,
  kind: 'wood',
  polygon: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
});

export const road = (id: string, width: number, ...pts: Array<[number, number]>): RawFeature => ({
  id,
  kind: 'road',
  polyline: pts,
  width,
});

export const river = (id: string, width: number, ...pts: Array<[number, number]>): RawFeature => ({
  id,
  kind: 'river',
  polyline: pts,
  width,
});

export const bridge = (id: string, x: number, y: number, radius: number): RawFeature => ({
  id,
  kind: 'bridge',
  at: { x, y },
  radius,
});

/**
 * A world with a bridge (so the loader's objective check passes) at the bottom-left corner,
 * HQs in the two top corners, and the given features and units. Units are small infantry
 * battalions (strength 437) unless stated. A side with no unit gets a far-away one.
 */
export function miniWorld(opts: {
  width?: number;
  height?: number;
  features?: RawFeature[];
  units: RawUnit[];
}): GameState {
  const width = opts.width ?? 3000;
  const height = opts.height ?? 2000;
  return loadScenario({
    id: 't',
    seed: 1,
    map: {
      width,
      height,
      features: [bridge('test-bridge', 50, height - 50, 40), ...(opts.features ?? [])],
    },
    sides: [
      { id: 'blue', name: 'Blue', controller: 'human', hq: { x: 5, y: 5 } },
      { id: 'red', name: 'Red', controller: 'scripted', hq: { x: width - 5, y: 5 } },
    ],
    units: [
      ...opts.units,
      // Each side needs a unit; park a red one in the far corner unless the test brings its own.
      ...(opts.units.some((u) => u.side === 'red')
        ? []
        : [{ id: 'red-far', side: 'red' as const, x: width - 150, y: height - 150 }]),
      ...(opts.units.some((u) => (u.side ?? 'blue') === 'blue')
        ? []
        : [{ id: 'blue-far', side: 'blue' as const, x: 150, y: 150 }]),
    ].map((u) => ({
      id: u.id,
      side: u.side ?? 'blue',
      ...(u.type ? { type: u.type } : { kind: u.kind ?? 'infantry' }),
      ...(u.formation ? { formation: u.formation } : {}),
      name: `Unit ${u.id}`,
      at: { x: u.x, y: u.y },
      facingDeg: u.facingDeg ?? 0,
      strength: u.strength ?? 437,
      morale: 71,
    })),
    victory: {
      objective: [
        [20, height - 80],
        [80, height - 80],
        [80, height - 20],
        [20, height - 20],
      ],
      defender: 'blue',
      attacker: 'red',
      holdMinutes: 10,
    },
  });
}

/**
 * "Hold the Bridge" with the armies far apart, as it was before the fair start (#178): Blue
 * 500 to 700 m south of its HQ line, Red 250 to 550 m from the north edge. Movement and order
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
