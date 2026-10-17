import type { HachureStyle } from './map-style.js';
import type { ViewBounds } from './viewport.js';

export interface GradientField {
  gradientAt(x: number, y: number): { dx: number; dy: number };
}
/** One hachure: a short polyline down the fall line, in map metres, with a 0..1 slope weight. */
export interface Hachure {
  readonly points: readonly number[];
  readonly weight: number;
}
export interface HachureLayout {
  /** Seed spacing on the ground. */
  readonly spacingM: number;
  readonly lengthM: number;
}

/** Ground spacing and stroke length for a zoom band drawn at `bandScale` px per metre. */
export function hachureLayout(style: HachureStyle, bandScale: number): HachureLayout {
  const spacingM = Math.max(style.spacingPx / bandScale, style.minSpacingM);
  return { spacingM, lengthM: Math.min(spacingM * style.length, style.maxLengthPx / bandScale) };
}

/** Deterministic 0..1 hash of an integer cell, so tiles and zoom bands agree on every seed. */
function hash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Hachures whose seeds fall in `area` (expanded by one stroke length so neighbouring tiles join) and in
 * `bounds`. Seeds sit on a staggered grid with jitter; each stroke follows the downhill gradient in three
 * steps, so it bends with the ground. Gentle slopes keep only some seeds; steeper ones keep all and weigh
 * more (Lehmann's rule: the steeper, the darker).
 */
export function hachureStrokes(
  ground: GradientField,
  bounds: ViewBounds,
  area: ViewBounds,
  layout: HachureLayout,
  style: HachureStyle,
): Hachure[] {
  const { spacingM: d, lengthM: length } = layout;
  const out: Hachure[] = [];
  const range = style.fullSlope - style.minSlope;
  const minX = Math.max(bounds.minX, area.minX - length);
  const maxX = Math.min(bounds.maxX, area.maxX + length);
  const minY = Math.max(bounds.minY, area.minY - length);
  const maxY = Math.min(bounds.maxY, area.maxY + length);
  if (!(d > 0) || minX > maxX || minY > maxY) return out;
  const step = length / 3;
  for (let j = Math.floor(minY / d) - 1; j <= Math.ceil(maxY / d); j++) {
    const stagger = j & 1 ? 0.5 : 0;
    for (let i = Math.floor(minX / d) - 1; i <= Math.ceil(maxX / d); i++) {
      const x = (i + 0.5 + stagger + (hash(i, j, 1) - 0.5) * 0.3) * d;
      const y = (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.3) * d;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const g = ground.gradientAt(x, y);
      const slope = Math.hypot(g.dx, g.dy);
      if (!(slope >= style.minSlope)) continue;
      const weight = Math.min(1, (slope - style.minSlope) / range);
      // Gentle ground keeps a share of its seeds; from half the full slope every seed is drawn.
      const density = style.gentleDensity + (1 - style.gentleDensity) * Math.min(1, weight * 2);
      if (hash(i, j, 3) >= density) continue;
      // Centre the stroke on the seed, then walk downhill re-reading the gradient.
      let px = x - (-g.dx / slope) * (length / 2);
      let py = y - (-g.dy / slope) * (length / 2);
      const points = [px, py];
      for (let k = 0; k < 3; k++) {
        const h = k === 0 ? g : ground.gradientAt(px, py);
        const s = Math.hypot(h.dx, h.dy);
        if (!(s > 0)) break;
        px -= (h.dx / s) * step;
        py -= (h.dy / s) * step;
        points.push(px, py);
      }
      if (points.length >= 4) out.push({ points, weight });
    }
  }
  return out;
}
