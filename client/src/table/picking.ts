import * as THREE from 'three';
import type { Coord } from '@kriegsspiel/protocol';
import type { BaseMap, GhostPiece, OwnPiece, SceneState } from './types.js';

/** Map point (metres) -> world: X = x - width/2, Z = y - height/2, Y is up. One world unit is a metre. */
export function mapToWorld(map: BaseMap, p: Coord, y = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x - map.width / 2, y, p.y - map.height / 2);
}

export function worldToMap(map: BaseMap, v: THREE.Vector3): Coord {
  return { x: v.x + map.width / 2, y: v.z + map.height / 2 };
}

export function onMap(map: BaseMap, p: Coord): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= map.width && p.y <= map.height;
}

/** A piece is easier to hit than it is to see at table scale: its pick area is at least this wide, in metres. */
export function pickMinSize(map: BaseMap): number {
  return Math.max(map.width, map.height) / 80;
}

/** `coord` is where the pointer ray met the map plane, in metres. */
export type PickResult =
  | { type: 'piece'; pieceKind: 'own' | 'ghost'; id: string; coord: Coord }
  | { type: 'point'; coord: Coord }
  | { type: 'none' };

const MAP_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Intersect a ray with the flat map plane and return map coordinates in metres, if on the map. */
export function rayToMap(map: BaseMap, ray: THREE.Ray): Coord | undefined {
  const hit = ray.intersectPlane(MAP_PLANE, new THREE.Vector3());
  if (!hit) return undefined;
  const c = worldToMap(map, hit);
  return onMap(map, c) ? c : undefined;
}

/**
 * Distance from the piece's centre to `c` if `c` is on the piece, else undefined. A piece
 * covers its oriented footprint (at least `minSize` wide) and, if loose, each sub-position.
 */
function hitDistance(piece: OwnPiece | GhostPiece, c: Coord, minSize: number): number | undefined {
  const dx = c.x - piece.position.x;
  const dy = c.y - piece.position.y;
  const dist = Math.hypot(dx, dy);
  const sin = Math.sin(piece.facing);
  const cos = Math.cos(piece.facing);
  // Unit frame: x to its right (cos, sin), y to its front (sin, -cos).
  const lx = dx * cos + dy * sin;
  const ly = dx * sin - dy * cos;
  const fp = piece.footprint ?? { frontage: minSize, depth: minSize };
  if (
    Math.abs(lx) <= Math.max(fp.frontage, minSize) / 2 &&
    Math.abs(ly) <= Math.max(fp.depth, minSize) / 2
  )
    return dist;
  for (const s of piece.shape ?? []) {
    if (Math.hypot(lx - s.x, ly - s.y) <= minSize / 2) return dist;
  }
  return undefined;
}

/** The piece under a map point, nearest centre first; own units win over ghosts. */
export function pieceAtPoint(
  state: SceneState,
  c: Coord,
): { pieceKind: 'own' | 'ghost'; id: string } | undefined {
  const minSize = pickMinSize(state.map);
  for (const [pieceKind, pieces] of [
    ['own', state.own],
    ['ghost', state.ghosts],
  ] as const) {
    let best: { id: string; d: number } | undefined;
    for (const p of pieces) {
      const d = hitDistance(p, c, minSize);
      if (d !== undefined && (!best || d < best.d)) best = { id: p.id, d };
    }
    if (best) return { pieceKind, id: best.id };
  }
  return undefined;
}

/** Pure pick for a ray: the piece under the plane hit, otherwise the plane point, in metres. */
export function pickFromRay(state: SceneState, ray: THREE.Ray): PickResult {
  const coord = rayToMap(state.map, ray);
  if (!coord) return { type: 'none' };
  const piece = pieceAtPoint(state, coord);
  return piece ? { type: 'piece', ...piece, coord } : { type: 'point', coord };
}
