import type { Point } from './sim';

/**
 * Where to draw each counter so no two overlap (#443 point 2, the rendering half). Counters are a fixed size on the
 * screen, so at a distant zoom two units a few hundred metres apart would cover each other; this pushes the drawn
 * counters apart a little, and the page draws a leader line back to a counter's true place when it moved one.
 */
export interface Placed {
  id: string;
  at: Point;
  /** Where the unit really is. */
  true: Point;
}

/**
 * Push apart counters (boxes `w` by `h`, centred on each point) until none overlap, moving each as little as it can.
 * `pinned` ids do not move (the selected unit stays under the pointer). Deterministic: same input, same output.
 */
export function separate(
  items: Array<{ id: string; at: Point }>,
  w: number,
  h: number,
  pinned: ReadonlySet<string> = new Set(),
  gap = 0.15,
): Placed[] {
  const out = items.map((i) => ({ id: i.id, at: { ...i.at }, true: { ...i.at } }));
  const gw = w * (1 + gap);
  const gh = h * (1 + gap);
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const dx = b.at.x - a.at.x;
        const dy = b.at.y - a.at.y;
        const ox = gw - Math.abs(dx);
        const oy = gh - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const pa = pinned.has(a.id);
        const pb = pinned.has(b.id);
        const share = pa && pb ? 0 : pa ? 1 : pb ? 0 : 0.5;
        const keepA = pa && pb ? 0 : 1 - share;
        // Push along the axis that needs the shorter move; ties break by id so the result is stable.
        if (ox / gw < oy / gh) {
          const s = dx === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dx);
          a.at.x -= s * ox * keepA;
          b.at.x += s * ox * share;
        } else {
          const s = dy === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dy);
          a.at.y -= s * oy * keepA;
          b.at.y += s * oy * share;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

export type Detail = 'far' | 'mid' | 'near';

/** The level of detail for a view `viewWidth` metres wide. */
export function detailFor(viewWidth: number): Detail {
  return viewWidth > 3200 ? 'far' : viewWidth > 1300 ? 'mid' : 'near';
}
