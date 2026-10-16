/**
 * Turn mode's rules parse, on the map (D39, #522): the rules parser's intents (`rulesParse`), whose
 * places are feature ids with an optional "where at the place", become the engine's points. Pure.
 *
 * - A point feature (a bridge, a ford) is its centre; an area (a wood) its anchor, as before.
 * - A line is the nearest point of it to where the unit then stands: `the road` is where the unit
 *   meets it, not its middle. Water (a river, a stream) is its near bank, never the water itself.
 * - `the south end of the bridge`, `its southern edge`, `the far bank`: the end of a point feature
 *   (its radius), the bank of a line on that side, the edge of an area (50 m inside it), toward the
 *   compass point, the unit (`near`), or away from it (`far`).
 * - `west of the road`: 150 m off the place that way. `behind the 1st Battalion`: 150 m from the
 *   place (or the unit, `unit:<id>`) toward the side's headquarters; `in front of`, away from it.
 * - `400 paces short of the river`: that far before the point, on the line from where the unit then
 *   stands; already closer, it stays where it is.
 *
 * Each intent is measured from the one before (the unit's centre for the first), and every point is
 * kept on the map.
 */
import {
  featureAnchor,
  mm,
  pointInPolygon,
  type GameState,
  type OrderIntent,
  type Point,
  type TerrainFeature,
  type Unit,
} from '@kriegsspiel/engine';
import type { Compass, RulesIntent, RulesWhere } from '../umpire/providers/testParse.js';

/** How far beyond the water's edge a bank is. */
const BANK_MM = mm(40);
/** How far off a place `west of`, `behind` and `in front of` are. */
const OFF_MM = mm(150);
/** How far inside an area its edge is, so the unit stays in it. */
const INSET_MM = mm(50);
/** A unit as a point of reference has no radius; its "end" is this far off. */
const UNIT_RADIUS_MM = mm(100);

const COMPASS: Record<Compass, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

const add = (a: Point, v: Point, k: number): Point => ({ x: a.x + v.x * k, y: a.y + v.y * k });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point) => Math.hypot(v.x, v.y);
const unitVec = (v: Point): Point => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

const WATER = new Set(['river', 'stream']);

/** The nearest point of a polyline to `p`, and the unit normal of the segment it lies on. */
function nearestOnLine(points: readonly Point[], p: Point): { at: Point; normal: Point } {
  let best = { at: points[0] as Point, normal: { x: 0, y: -1 }, d: Infinity };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    const at = add(a, ab, t);
    const d = len(sub(p, at));
    if (d < best.d) best = { at, normal: unitVec({ x: -ab.y, y: ab.x }), d };
  }
  return { at: best.at, normal: best.normal };
}

/** The point of a feature (or a reference unit) that `where` names, seen from `from`. */
function pointAt(
  target: { feature?: TerrainFeature; unit?: Point },
  where: RulesWhere,
  from: Point,
  origin: Point,
  rear: Point,
): Point {
  const g = target.feature?.geometry;
  const water = target.feature ? WATER.has(target.feature.kind) : false;
  // The direction the part (or the ground off it) lies in, from the place. Near and far are as the
  // unit sees it where the order finds it; the ends of a bridge or the edges of a wood lie on the
  // compass point nearest that way.
  const toward = (dir: Compass | 'near' | 'far', ref: Point, snap = true): Point => {
    if (dir !== 'near' && dir !== 'far') return COMPASS[dir];
    const v = unitVec(dir === 'near' ? sub(origin, ref) : sub(ref, origin));
    if (!snap || len(v) === 0) return v;
    return Math.abs(v.x) > Math.abs(v.y)
      ? { x: Math.sign(v.x), y: 0 }
      : { x: 0, y: Math.sign(v.y) };
  };
  /** The part of the place toward `dir`, `beyond` past its edge (for an area, `-inset`). */
  const part = (dir: Compass | 'near' | 'far', beyond: number): Point => {
    if (!g) {
      const c = target.unit as Point;
      return add(c, toward(dir, c), UNIT_RADIUS_MM + beyond);
    }
    if (g.shape === 'point') return add(g.at, toward(dir, g.at), g.radius + beyond);
    if (g.shape === 'polyline') {
      const { at, normal } = nearestOnLine(g.points, from);
      let v = toward(dir, at, false);
      if (len(v) === 0) v = normal;
      const side = Math.sign(dot(normal, v)) || 1;
      return add(at, normal, side * (g.width / 2 + beyond));
    }
    const c = featureAnchor(g);
    const v = toward(dir, c);
    let t = 0;
    while (t < mm(20_000) && pointInPolygon(add(c, v, t + mm(10)), g.points)) t += mm(10);
    return add(c, v, Math.max(0, t + beyond));
  };
  let p: Point;
  if (where.off)
    p = add(part(where.off, 0), COMPASS[where.off], where.offM ? mm(where.offM) : OFF_MM);
  else if (where.part)
    p = part(where.part, g?.shape === 'polygon' ? -INSET_MM : water ? BANK_MM : 0);
  else if (!g) p = { ...(target.unit as Point) };
  else if (g.shape === 'polyline') {
    // The near bank as the unit then stands, not as it stood when the order came.
    const { at, normal } = nearestOnLine(g.points, from);
    const side = Math.sign(dot(normal, sub(from, at))) || 1;
    p = water ? add(at, normal, side * (g.width / 2 + BANK_MM)) : at;
  } else p = featureAnchor(g);
  if (where.rel) {
    const v = unitVec(sub(rear, p));
    p = add(p, v, where.rel === 'behind' ? OFF_MM : -OFF_MM);
  }
  if (where.shortM !== undefined) {
    const short = mm(where.shortM);
    const v = sub(p, from);
    p = len(v) <= short ? { ...from } : add(p, unitVec(v), -short);
  }
  return p;
}

/**
 * The rules parse's intents for `unit` as engine intents, or why one cannot be placed. `here` is
 * where the unit stands; `unit:<id>` one of its own side's units.
 */
export function placeRulesIntents(
  intents: readonly RulesIntent[],
  unit: Unit,
  world: GameState,
): OrderIntent[] | string {
  const rear = world.sides.find((s) => s.id === unit.side)?.hq ?? unit.center;
  const clamp = (p: Point): Point => ({
    x: Math.round(Math.min(Math.max(p.x, 0), world.map.width)),
    y: Math.round(Math.min(Math.max(p.y, 0), world.map.height)),
  });
  const out: OrderIntent[] = [];
  let from = unit.center;
  for (const i of intents) {
    let to: Point;
    if (i.place === 'here') {
      if (i.kind !== 'hold') return 'only a hold can be "here"';
      to = { ...unit.center };
    } else if (i.place.startsWith('unit:')) {
      const ref = world.units.find(
        (u) => u.id === i.place.slice('unit:'.length) && u.side === unit.side,
      );
      if (!ref) return `unknown unit "${i.place}"`;
      to = clamp(pointAt({ unit: ref.center }, i.where ?? {}, from, unit.center, rear));
    } else {
      const feature = world.map.features.find((f) => f.id === i.place);
      if (!feature) return `unknown place "${i.place}"`;
      to = clamp(pointAt({ feature }, i.where ?? {}, from, unit.center, rear));
    }
    out.push(
      i.kind === 'move'
        ? { kind: 'move', to }
        : i.kind === 'hold'
          ? { kind: 'hold', at: to }
          : i.kind === 'withdraw'
            ? { kind: 'withdraw', toward: to }
            : // An attack has no engine intent in turn mode; the caller refuses it before this.
              { kind: 'move', to },
    );
    from = to;
  }
  return out;
}
