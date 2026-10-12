import type { Coord } from '@kriegsspiel/protocol';
import type { Engagement } from './types.js';

/** A label's footprint on the table: centre and size in metres. */
export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: LabelRect, b: LabelRect): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/**
 * Where each "Fighting" label goes (#325). The first choice is north of the ring (unit tags hang south of
 * their pieces); when that spot is taken by a unit label or an earlier fight label the label tries the
 * south, east and west of the ring, then each farther out. Pure and deterministic: fights are placed in
 * the order given, so the same scene always lays out the same way. Returns the label centres by fight id.
 */
export function placeFightLabels(
  fights: readonly Engagement[],
  obstacles: readonly LabelRect[],
  size: { w: number; h: number },
  ringRadius: number,
): Map<string, Coord> {
  const placed: LabelRect[] = [];
  const out = new Map<string, Coord>();
  for (const f of fights) {
    const dy = ringRadius + size.h / 2;
    const dx = ringRadius + size.w / 2;
    const candidates: Coord[] = [];
    for (let step = 0; step < 4; step++) {
      const k = 1 + step * 1.2;
      candidates.push(
        { x: f.position.x, y: f.position.y - dy * k },
        { x: f.position.x, y: f.position.y + dy * k },
        { x: f.position.x + dx * k, y: f.position.y },
        { x: f.position.x - dx * k, y: f.position.y },
      );
    }
    const free = (c: Coord): boolean => {
      const r = { ...c, ...size };
      return !obstacles.some((o) => overlaps(r, o)) && !placed.some((o) => overlaps(r, o));
    };
    const at = candidates.find(free) ?? candidates[0]!;
    placed.push({ ...at, ...size });
    out.set(f.id, at);
  }
  return out;
}
