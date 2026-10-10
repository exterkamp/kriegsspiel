/** Game time in integer milliseconds since the scenario start. Never derived from the wall clock. */
export type GameTime = number;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

export type SideId = 'blue' | 'red';

export const TERRAINS = ['open', 'wood', 'river', 'bridge', 'road'] as const;
export type Terrain = (typeof TERRAINS)[number];

export interface Point {
  x: number;
  y: number;
}

/** Row-major grid: `tiles[y * width + x]`. */
export interface MapGrid {
  width: number;
  height: number;
  tiles: Terrain[];
}

export const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Facing = (typeof FACINGS)[number];

/** What a unit is currently trying to do. Produced from orders; the engine applies it. */
export type Intent = { kind: 'idle' } | { kind: 'move'; to: Point } | { kind: 'hold'; at: Point };

export interface Unit {
  id: string;
  side: SideId;
  name: string;
  position: Point;
  /** Men remaining. */
  strength: number;
  /** 0..100. */
  morale: number;
  facing: Facing;
  intent: Intent;
}

export interface Side {
  id: SideId;
  name: string;
  /** Human-controlled or scripted. */
  controller: 'human' | 'scripted';
}

/** The `defender` wins by holding `objective` for `holdMs`; the `attacker` wins by taking it. */
export interface VictoryCondition {
  objective: Point;
  defender: SideId;
  attacker: SideId;
  holdMs: GameTime;
}

export interface GameState {
  scenarioId: string;
  time: GameTime;
  seed: number;
  map: MapGrid;
  sides: Side[];
  units: Unit[];
  victory: VictoryCondition;
}

export function tileAt(map: MapGrid, p: Point): Terrain | undefined {
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return undefined;
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return undefined;
  return map.tiles[p.y * map.width + p.x];
}
