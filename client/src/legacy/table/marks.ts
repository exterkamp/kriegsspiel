import type { Coord, Mark } from '@kriegsspiel/protocol';

/** A mark fades toward grey over this much game time and then stays at its faintest. */
export const MARK_FADE_MS = 12 * 3_600_000;
const FADE_STEPS = 20;

/** 0 for a fresh mark up to 1 for an old one, in 1/20 steps so the scene redraws only when it visibly changes. */
export function markAgeFactor(madeAtGame: number, nowGame: number): number {
  const f = Math.min(1, Math.max(0, (nowGame - madeAtGame) / MARK_FADE_MS));
  return Math.round(f * FADE_STEPS) / FADE_STEPS;
}

const move = (c: Coord, dx: number, dy: number): Coord => ({ x: c.x + dx, y: c.y + dy });

/** The mark slid by (dx, dy) metres. Everything else about it, including when it was made, stays. */
export function translateMark(m: Mark, dx: number, dy: number): Mark {
  switch (m.kind) {
    case 'pin':
    case 'ring':
      return { ...m, at: move(m.at, dx, dy) };
    case 'line':
      return { ...m, points: m.points.map((p) => move(p, dx, dy)) };
    case 'arrow':
      return { ...m, from: move(m.from, dx, dy), to: move(m.to, dx, dy) };
  }
}

function distToSegment(c: Coord, a: Coord, b: Coord): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((c.x - a.x) * vx + (c.y - a.y) * vy) / len2));
  return Math.hypot(c.x - (a.x + t * vx), c.y - (a.y + t * vy));
}

/** How far a point is from the drawn mark itself (the ink), in metres. */
export function distToMark(m: Mark, c: Coord): number {
  switch (m.kind) {
    case 'pin':
      return Math.hypot(c.x - m.at.x, c.y - m.at.y);
    case 'ring':
      return Math.abs(Math.hypot(c.x - m.at.x, c.y - m.at.y) - m.radius);
    case 'arrow':
      return distToSegment(c, m.from, m.to);
    case 'line': {
      let best = Infinity;
      for (let i = 1; i < m.points.length; i++)
        best = Math.min(best, distToSegment(c, m.points[i - 1]!, m.points[i]!));
      return best;
    }
  }
}

/** The mark nearest `c` within `tolerance` metres; on a tie the newest wins. */
export function pickMark(marks: readonly Mark[], c: Coord, tolerance: number): Mark | undefined {
  let best: { m: Mark; d: number } | undefined;
  for (const m of marks) {
    const d = distToMark(m, c);
    if (
      d <= tolerance &&
      (!best || d < best.d || (d === best.d && m.madeAtGame >= best.m.madeAtGame))
    )
      best = { m, d };
  }
  return best?.m;
}

/** Drop points closer than `minStep` to the last kept one, always keeping the last point. */
export function simplifyPath(points: readonly Coord[], minStep: number): Coord[] {
  const out: Coord[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minStep) out.push(p);
  }
  const end = points[points.length - 1];
  if (end && out[out.length - 1] !== end) {
    if (
      out.length > 1 &&
      Math.hypot(end.x - out[out.length - 1]!.x, end.y - out[out.length - 1]!.y) < minStep
    )
      out[out.length - 1] = end;
    else out.push(end);
  }
  return out;
}

/** An id unique within a side: time plus a counter, chosen by the client. */
export function newMarkId(counter: number, nowWall: number): string {
  return `k-${nowWall.toString(36)}-${counter}`;
}

/** Marks with `next` put in place of the one with the same id, or added. */
export function withMark(marks: readonly Mark[], next: Mark): Mark[] {
  const i = marks.findIndex((m) => m.id === next.id);
  if (i < 0) return [...marks, next];
  const out = [...marks];
  out[i] = next;
  return out;
}
