import type { Coord } from '@kriegsspiel/protocol';
import type { BaseMap, GhostPiece, OwnPiece } from './types';

/** The flat board's pure geometry, in map metres (x east, y south, so SVG can use it as it is). */

/** A piece's pick and draw size is at least this fraction of the map's long side, so it can always be seen and hit. */
const MIN_PIECE_FRACTION = 1 / 70;

export function longSide(map: BaseMap): number {
  return Math.max(map.width, map.height);
}

/** The four corners of a piece's footprint, front first, turned to face its compass bearing (0 is north, i.e. -y). */
export function pieceCorners(piece: OwnPiece | GhostPiece, map: BaseMap): Coord[] {
  const min = longSide(map) * MIN_PIECE_FRACTION;
  const fp = piece.footprint ?? { frontage: min, depth: min };
  const hw = Math.max(fp.frontage, min) / 2;
  const hd = Math.max(fp.depth, min) / 2;
  const fx = Math.sin(piece.facing);
  const fy = -Math.cos(piece.facing);
  const rx = -fy; // right of the facing direction
  const ry = fx;
  const at = (side: number, front: number): Coord => ({
    x: piece.position.x + rx * side * hw + fx * front * hd,
    y: piece.position.y + ry * side * hw + fy * front * hd,
  });
  return [at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)];
}

/** The triangle at the head of an arrow running `from` to `to`, `size` metres long. Empty if the arrow has no length. */
export function arrowHead(from: Coord, to: Coord, size: number): Coord[] {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return [];
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  return [to, { x: bx - uy * size * 0.4, y: by + ux * size * 0.4 }, { x: bx + uy * size * 0.4, y: by - ux * size * 0.4 }];
}

export function pointsAttr(points: readonly Coord[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Where to write each tag: just below its piece, moved further down while it would overlap a tag already placed, so two
 * battalions standing together read as a stack and not one over the other (#343). Tags are `w` wide and `h` tall.
 */
export function stackLabels(
  tags: ReadonlyArray<{ id: string; at: Coord; w: number }>,
  h: number,
): Map<string, Coord> {
  const placed: Array<{ x: number; y: number; w: number }> = [];
  const out = new Map<string, Coord>();
  for (const t of tags) {
    let y = t.at.y;
    for (let tries = 0; tries < tags.length; tries++) {
      const hit = placed.find(
        (p) => Math.abs(p.x - t.at.x) < (p.w + t.w) / 2 && Math.abs(p.y - y) < h,
      );
      if (!hit) break;
      y = hit.y + h;
    }
    placed.push({ x: t.at.x, y, w: t.w });
    out.set(t.id, { x: t.at.x, y });
  }
  return out;
}

/** Screen position -> map metres for a board drawn `meet`-fitted (centred, uniformly scaled) in `rect`; undefined off the map. */
export function screenToMap(
  map: BaseMap,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Coord | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const scale = Math.min(rect.width / map.width, rect.height / map.height);
  const x = (clientX - rect.left - (rect.width - map.width * scale) / 2) / scale;
  const y = (clientY - rect.top - (rect.height - map.height * scale) / 2) / scale;
  if (x < 0 || y < 0 || x > map.width || y > map.height) return undefined;
  return { x, y };
}
