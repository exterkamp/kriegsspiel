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
export type Intent =
  | { kind: 'idle' }
  /** `startedAt` ties scheduled step events to this order, so a newer intent makes them stale. */
  | { kind: 'move'; to: Point; startedAt: GameTime }
  | { kind: 'hold'; at: Point }
  /** Close on `target` (a unit id) and fight it. `to` is where it stood when the march was planned. */
  | { kind: 'attack'; target: string; to: Point; startedAt: GameTime };

export const UNIT_KINDS = ['infantry', 'cavalry', 'artillery'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** `withdrawn`: broke and is falling back (out of the fight for good). `destroyed`: no men left. */
export type UnitStatus = 'active' | 'withdrawn' | 'destroyed';

export interface Unit {
  id: string;
  side: SideId;
  kind: UnitKind;
  name: string;
  position: Point;
  /** Men remaining. Fractional, since casualties are. */
  strength: number;
  /** 0..100. */
  morale: number;
  facing: Facing;
  intent: Intent;
  status: UnitStatus;
  /** Where the unit starts, and where it withdraws to if it breaks. */
  home: Point;
}

export interface Side {
  id: SideId;
  name: string;
  /** Human-controlled or scripted. */
  controller: 'human' | 'scripted';
}

/**
 * The `attacker` wins the moment its units alone hold `objective`. The `defender` wins if
 * the game clock reaches `holdMs` with the attacker not having taken it.
 */
export interface VictoryCondition {
  objective: Point;
  defender: SideId;
  attacker: SideId;
  holdMs: GameTime;
}

export type VictoryReason = 'objective-taken' | 'objective-held' | 'eliminated' | 'withdrawn';

/** How the game ended. `winner` is null if both sides were put out of the fight together. */
export interface Outcome {
  winner: SideId | null;
  reason: VictoryReason;
  time: GameTime;
}

export interface GameState {
  scenarioId: string;
  time: GameTime;
  seed: number;
  map: MapGrid;
  sides: Side[];
  units: Unit[];
  victory: VictoryCondition;
  /** True while a chain of combat ticks is running (units are in contact). */
  combatActive: boolean;
  /** Set once, when the game ends. Nothing happens in combat or victory handlers after that. */
  outcome: Outcome | null;
}

export function tileAt(map: MapGrid, p: Point): Terrain | undefined {
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return undefined;
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return undefined;
  return map.tiles[p.y * map.width + p.x];
}
