/**
 * Pieces gliding to where a turn left them (D39, 11.10). In a turn-mode game the table jumps by a whole
 * turn at once, so each piece that moved is drawn sliding from where it stood to where it stands now over
 * a second or two. Pure: the 3D table and the flat board both keep a `GlideState` and read positions from it.
 */
import type { Coord } from '@kriegsspiel/protocol';
import { easeInOut } from './transition.js';

/** How long a piece takes to reach its new place after a turn. */
export const GLIDE_MS = 1500;

/** Moves shorter than this (metres) are drawn at once: a piece that only turned or shuffled. */
const MIN_GLIDE_M = 1;

export interface Glide {
  from: Coord;
  to: Coord;
  start: number;
  ms: number;
}

export interface GlideState {
  /** Where each piece stands now, by key: the target of any glide. */
  at: ReadonlyMap<string, Coord>;
  glides: ReadonlyMap<string, Glide>;
}

export const NO_GLIDES: GlideState = { at: new Map(), glides: new Map() };

/** Where a glide has got to at wall time `now`. */
export function glidePoint(g: Glide, now: number): Coord {
  const t = g.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - g.start) / g.ms));
  const e = easeInOut(t);
  return { x: g.from.x + (g.to.x - g.from.x) * e, y: g.from.y + (g.to.y - g.from.y) * e };
}

/** Where to draw the piece `key`, standing at `to`, at `now`. */
export function drawnAt(s: GlideState, key: string, to: Coord, now: number): Coord {
  const g = s.glides.get(key);
  return g && g.to.x === to.x && g.to.y === to.y ? glidePoint(g, now) : to;
}

/** True while any glide is still moving at `now`. */
export const gliding = (s: GlideState, now: number): boolean =>
  [...s.glides.values()].some((g) => now < g.start + g.ms);

/**
 * The glides after the pieces move to `next`. A piece already on the table that moved glides from where it
 * is drawn now (mid-glide if it was still moving) to its new place; a new piece, or any piece when `ms` is
 * 0, appears at once. Pieces that did not move keep any glide still running.
 */
export function nextGlides(
  prev: GlideState,
  next: ReadonlyMap<string, Coord>,
  now: number,
  ms: number,
): GlideState {
  const glides = new Map<string, Glide>();
  for (const [key, to] of next) {
    const was = prev.at.get(key);
    const running = prev.glides.get(key);
    if (ms <= 0 || !was) continue;
    if (was.x === to.x && was.y === to.y) {
      if (running && now < running.start + running.ms) glides.set(key, running);
      continue;
    }
    const from = running ? glidePoint(running, now) : was;
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_GLIDE_M) continue;
    glides.set(key, { from, to, start: now, ms });
  }
  return { at: new Map(next), glides };
}
