import type { OrderIntent } from './orders.js';
import type { Point, Unit } from './types.js';

/**
 * Subordinate personalities (D36, docs/design.md). A commander's traits are master state: they
 * are never sent to a player, who learns them from behaviour and reputation. The umpire's
 * `interpret` task proposes how a unit reads an order; `shapeIntents` is the only place that
 * proposal can touch the game, and it holds it to the limits below.
 */
export const TRAITS = ['aggressive', 'cautious', 'literal', 'initiative'] as const;
export type Trait = (typeof TRAITS)[number];

/**
 * How the unit's commander reads the order, as the umpire proposed it. `amount` is the share of
 * the leg left unmarched for `halt_short` and the metres past the objective for `exceed`.
 * `intentStated` is whether the order's wording explains what it is for.
 */
export interface Interpretation {
  action: 'none' | 'halt_short' | 'exceed';
  amount?: number;
  intentStated: boolean;
}

/** The most of a leg a cautious commander may leave unmarched. */
export const HALT_SHORT_MAX = 0.4;
/** The furthest, in metres, a bold commander may carry on past his objective. */
export const EXCEED_MAX_M = 400;
/** Chance that a permitted deviation happens at all. */
export const DEVIATION_CHANCE = 0.6;
/** An order that explains its intent shrinks the deviation to this share and makes it rarer. */
export const INTENT_DAMPING = 0.25;
export const INTENT_CHANCE = 0.3;

/** What `shapeIntents` did, for the master log. */
export interface Deviation {
  action: 'halt_short' | 'exceed';
  /** Metres the destination moved: shorter for a halt, further for an exceed. */
  metres: number;
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Apply `interp` to the first immediate move in `intents`, if `unit`'s traits allow it. The caller
 * draws `roll` (uniform in [0,1)) from the game RNG whenever `interp.action` is not `none`, so the
 * RNG stream never depends on the traits. Every number is clamped here: a model that proposes
 * more, or a deviation the traits do not permit, changes nothing.
 */
export function shapeIntents(
  unit: Pick<Unit, 'center' | 'personality'>,
  intents: OrderIntent[],
  interp: Interpretation | undefined,
  roll: number,
  bounds: { width: number; height: number },
): { intents: OrderIntent[]; deviation?: Deviation } {
  if (!interp || interp.action === 'none') return { intents };
  const traits = unit.personality ?? [];
  // A literal commander does exactly what is written.
  if (traits.includes('literal')) return { intents };
  const permitted =
    interp.action === 'halt_short'
      ? traits.includes('cautious')
      : traits.includes('aggressive') || traits.includes('initiative');
  if (!permitted) return { intents };
  if (roll >= (interp.intentStated ? INTENT_CHANCE : DEVIATION_CHANCE)) return { intents };
  const i = intents.findIndex((x) => x.kind === 'move');
  if (i < 0) return { intents };
  const move = intents[i] as Extract<OrderIntent, { kind: 'move' }>;
  const leg = dist(unit.center, move.to);
  if (leg <= 0) return { intents };
  const damp = interp.intentStated ? INTENT_DAMPING : 1;
  const ask = Number.isFinite(interp.amount) ? Math.max(0, interp.amount ?? 0) : 0;
  let to: Point;
  if (interp.action === 'halt_short') {
    const short = Math.min(ask, HALT_SHORT_MAX * damp);
    const f = 1 - short;
    to = {
      x: Math.round(unit.center.x + (move.to.x - unit.center.x) * f),
      y: Math.round(unit.center.y + (move.to.y - unit.center.y) * f),
    };
  } else {
    const past = Math.min(ask, EXCEED_MAX_M * damp) * 1000;
    const k = (leg + past) / leg;
    to = {
      x: Math.round(unit.center.x + (move.to.x - unit.center.x) * k),
      y: Math.round(unit.center.y + (move.to.y - unit.center.y) * k),
    };
  }
  to = {
    x: Math.min(bounds.width, Math.max(0, to.x)),
    y: Math.min(bounds.height, Math.max(0, to.y)),
  };
  const metres = Math.abs(dist(unit.center, to) - leg) / 1000;
  if (metres < 1) return { intents };
  const out = intents.map((x, n) => (n === i ? { ...move, to } : x));
  return { intents: out, deviation: { action: interp.action, metres: Math.round(metres) } };
}
