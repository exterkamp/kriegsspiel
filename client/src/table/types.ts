import type { Coord } from '@kriegsspiel/protocol';

// NOTE: duplicated from packages/engine/src/types.ts until the map moves into @kriegsspiel/protocol.
// `table.test.ts` pins the terrain list so drift is caught.
export const TERRAINS = ['open', 'wood', 'river', 'bridge', 'road'] as const;
export type Terrain = (typeof TERRAINS)[number];

export const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Facing = (typeof FACINGS)[number];

/** The base map the player sees: row-major `tiles[y * width + x]`. Same shape as the engine grid. */
export interface MapGrid {
  width: number;
  height: number;
  tiles: Terrain[];
}

export interface OwnPiece {
  kind: 'own';
  id: string;
  label: string;
  side: string;
  /** Map coordinates (tile units; a unit on tile (x, y) has position {x, y}). */
  position: Coord;
  facing: Facing;
}

export interface GhostPiece {
  kind: 'ghost';
  id: string;
  position: Coord;
  ageMs: number;
  /** Paper tag text, for example "2h 10m old". */
  ageTag: string;
  sizeEstimate?: string;
}

export interface SceneState {
  side: string;
  map: MapGrid;
  own: OwnPiece[];
  ghosts: GhostPiece[];
}
