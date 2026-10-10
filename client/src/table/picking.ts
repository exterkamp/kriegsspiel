import * as THREE from 'three';
import type { Coord } from '@kriegsspiel/protocol';
import type { MapGrid, SceneState } from './types.js';

/** Map tile (x, y) maps to world X = x - width/2, Z = y - height/2; Y is up. Tiles are 1 unit. */
export function mapToWorld(map: MapGrid, p: Coord, y = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x - map.width / 2, y, p.y - map.height / 2);
}

export function worldToMap(map: MapGrid, v: THREE.Vector3): Coord {
  return { x: v.x + map.width / 2, y: v.z + map.height / 2 };
}

/** Tile under a continuous map coordinate, or undefined if off the map. */
export function tileAt(map: MapGrid, p: Coord): { x: number; y: number } | undefined {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return { x, y };
}

export type PickResult =
  | { type: 'piece'; pieceKind: 'own' | 'ghost'; id: string; tile: { x: number; y: number } }
  | { type: 'tile'; tile: { x: number; y: number }; coord: Coord }
  | { type: 'none' };

const MAP_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Intersect a ray with the flat map plane and return map coordinates. */
export function rayToMap(map: MapGrid, ray: THREE.Ray): Coord | undefined {
  const hit = ray.intersectPlane(MAP_PLANE, new THREE.Vector3());
  if (!hit) return undefined;
  const c = worldToMap(map, hit);
  return tileAt(map, c) ? c : undefined;
}

/** Piece footprint used for ray-free picking (a piece owns its tile). */
export function pieceAtTile(
  state: SceneState,
  tile: { x: number; y: number },
): PickResult | undefined {
  for (const o of state.own) {
    const t = tileAt(state.map, o.position);
    if (t && t.x === tile.x && t.y === tile.y)
      return { type: 'piece', pieceKind: 'own', id: o.id, tile };
  }
  for (const g of state.ghosts) {
    const t = tileAt(state.map, g.position);
    if (t && t.x === tile.x && t.y === tile.y)
      return { type: 'piece', pieceKind: 'ghost', id: g.id, tile };
  }
  return undefined;
}

/** Pure pick for a ray: pieces occupy their tile; otherwise report the tile. */
export function pickFromRay(state: SceneState, ray: THREE.Ray): PickResult {
  const coord = rayToMap(state.map, ray);
  if (!coord) return { type: 'none' };
  const tile = tileAt(state.map, coord);
  if (!tile) return { type: 'none' };
  return pieceAtTile(state, tile) ?? { type: 'tile', tile, coord };
}
