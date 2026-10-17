/**
 * Turn mode's rules parse, on the map (D39, #522, #536): the rules parser's intents (`rulesParse`),
 * whose places are feature ids with an optional "where at the place", become the engine's points.
 * Pure.
 *
 * - A point feature (a bridge, a ford) is its centre; an area (a wood) its anchor, as before.
 * - A line is the nearest point of it to where the unit then stands: `the road` is where the unit
 *   meets it, not its middle. Water (a river, a stream) is its near bank, never the water itself.
 *   A road taken to the place (`down the High road to the river`) is joined first, so the river is
 *   its bank where the road meets it.
 * - `the south end of the bridge`, `its southern edge`, `the far bank`: the end of a point feature
 *   (its radius), the bank of a line on that side, the edge of an area (50 m inside it), toward the
 *   compass point, the unit (`near`), or away from it (`far`). A unit that stands on the place
 *   itself (on the bridge, in the water) has no near side of it, so near and far are then reckoned
 *   from its side's headquarters.
 * - `west of the road`: 150 m off the place that way. `behind the 1st Battalion`: 150 m (or as far
 *   as the order says) from the place, or the unit (`unit:<id>`; several ids: the middle of them),
 *   toward the side's headquarters; `in front of`, away from it. `on its left`: 150 m to the unit's
 *   left of the place, facing away from its headquarters.
 * - `the north bank just east of the bridge`: the point by the bridge, put on that bank of the
 *   river. `west along the bank for a mile`: that far on, that way.
 * - `400 paces short of the river`: that far before the point, on the line from where the unit then
 *   stands; already closer, it stays where it is.
 *
 * Each intent is measured from the one before (the unit's centre for the first), and every point is
 * kept on the map and on ground the unit can stand on: a point in the water or off the map moves to
 * the nearest passable ground on the side the order meant (its bank or compass point, else the
 * unit's own side). A point that is only a step on the way (`via`) is measured but not ordered; a
 * march to where the unit already is, or the same point twice, is left out.
 */
import {
  featureAnchor,
  mm,
  pointInPolygon,
  terrainAt,
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
/** A march shorter than this goes nowhere. */
const NO_MOVE_MM = mm(10);
/** How far a point in impassable ground is looked along for ground to stand on. */
const SNAP_SEARCH_MM = mm(3000);
const SNAP_STEP_MM = mm(10);

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
/** The compass point nearest the way `v` points. */
const axis = (v: Point): Point =>
  Math.abs(v.x) > Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };

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

/** Whether `p` stands on the feature itself: on the bridge, in the water, inside the wood. */
function onFeature(f: TerrainFeature, p: Point): boolean {
  const g = f.geometry;
  if (g.shape === 'point') return len(sub(p, g.at)) <= g.radius;
  if (g.shape === 'polyline') return len(sub(p, nearestOnLine(g.points, p).at)) <= g.width / 2;
  return pointInPolygon(p, g.points);
}

/**
 * The direction near or far lies in from `ref`, a point of the place: toward or away from where the
 * unit stood when the order came, or from its headquarters if it stood on the place itself.
 */
function nearFar(dir: 'near' | 'far', ref: Point, origin: Point, rear: Point, on: boolean): Point {
  const from = on ? rear : origin;
  return unitVec(dir === 'near' ? sub(from, ref) : sub(ref, from));
}

/** The bank of a line feature on the side `dir` names, at its nearest point to `p`. */
function bankOf(
  water: TerrainFeature,
  dir: Compass | 'near' | 'far',
  p: Point,
  origin: Point,
  rear: Point,
): Point {
  const g = water.geometry;
  if (g.shape !== 'polyline') return p;
  const { at, normal } = nearestOnLine(g.points, p);
  const v =
    dir === 'near' || dir === 'far'
      ? nearFar(dir, at, origin, rear, onFeature(water, origin))
      : COMPASS[dir];
  const side = Math.sign(dot(normal, v)) || 1;
  return add(at, normal, side * (g.width / 2 + BANK_MM));
}

/** The point of a feature (or a reference unit) that `where` names, seen from `from`. */
function pointAt(
  target: { feature?: TerrainFeature; unit?: Point },
  where: RulesWhere,
  from: Point,
  origin: Point,
  rear: Point,
  world: GameState,
): Point {
  const g = target.feature?.geometry;
  const water = target.feature ? WATER.has(target.feature.kind) : false;
  const on = target.feature ? onFeature(target.feature, origin) : false;
  // The direction the part (or the ground off it) lies in, from the place. Near and far are as the
  // unit sees it where the order finds it; the ends of a bridge or the edges of a wood lie on the
  // compass point nearest that way.
  const toward = (dir: Compass | 'near' | 'far', ref: Point, snap = true): Point => {
    if (dir !== 'near' && dir !== 'far') return COMPASS[dir];
    const v = nearFar(dir, ref, origin, rear, on);
    if (!snap || len(v) === 0) return v;
    return axis(v);
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
    const k = where.relM !== undefined ? mm(where.relM) : OFF_MM;
    p = add(p, v, where.rel === 'behind' ? k : -k);
  }
  if (where.flank) {
    // Facing away from its own rear (the compass point nearest that way); its left is a quarter
    // turn anticlockwise on the map (y south).
    const f = axis(sub(p, rear));
    const left = { x: f.y, y: -f.x };
    p = add(p, left, where.flank === 'left' ? OFF_MM : -OFF_MM);
  }
  if (where.bankOf && where.bank) {
    const river = world.map.features.find((f) => f.id === where.bankOf);
    if (river) p = bankOf(river, where.bank, p, origin, rear);
  }
  if (where.go && where.goM) p = add(p, COMPASS[where.go], mm(where.goM));
  if (where.shortM !== undefined) {
    const short = mm(where.shortM);
    const v = sub(p, from);
    p = len(v) <= short ? { ...from } : add(p, unitVec(v), -short);
  }
  return p;
}

/** Whether a unit can stand at `p`: on the map and on passable ground. */
const standable = (world: GameState, p: Point) => terrainAt(world.map, p)?.attrs.passable === true;

/**
 * `p` if a unit can stand there; otherwise the nearest such point along `prefer` (the bank or
 * compass point the order meant, else the compass point nearest the way the unit comes from), a
 * bank's width past
 * the edge where there is room, or failing that along any compass point.
 */
function snapToGround(world: GameState, p: Point, prefer: Point | undefined): Point {
  if (standable(world, p)) return p;
  const along = (v: Point): Point | undefined => {
    for (let t = SNAP_STEP_MM; t <= SNAP_SEARCH_MM; t += SNAP_STEP_MM) {
      const q = add(p, v, t);
      if (standable(world, q)) {
        const clear = add(p, v, t + BANK_MM);
        return standable(world, clear) ? clear : q;
      }
    }
    return undefined;
  };
  const first = prefer && len(prefer) > 0 ? along(unitVec(prefer)) : undefined;
  if (first) return first;
  const all = Object.values(COMPASS)
    .map(along)
    .filter((q): q is Point => q !== undefined)
    .sort((a, b) => len(sub(a, p)) - len(sub(b, p)));
  return all[0] ?? p;
}

/**
 * The rules parse's intents for `unit` as engine intents, or why one cannot be placed. `here` is
 * where the unit stands; `unit:<id>` one of its own side's units (`unit:<id>,<id>`: the middle of
 * several).
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
    const where = i.where ?? {};
    // A road taken to the place is joined first: the place is measured from where it meets it.
    const road = i.along ? world.map.features.find((f) => f.id === i.along) : undefined;
    const start =
      road?.geometry.shape === 'polyline' ? nearestOnLine(road.geometry.points, from).at : from;
    if (i.place === 'here') {
      if (i.kind !== 'hold') return 'only a hold can be "here"';
      to = { ...unit.center };
    } else if (i.place.startsWith('unit:')) {
      const ids = i.place.slice('unit:'.length).split(',');
      const refs = ids.map((id) => world.units.find((u) => u.id === id && u.side === unit.side));
      if (refs.some((r) => !r)) return `unknown unit "${i.place}"`;
      const c = refs.reduce((s, r) => add(s, (r as Unit).center, 1 / refs.length), { x: 0, y: 0 });
      to = clamp(pointAt({ unit: c }, where, start, unit.center, rear, world));
    } else {
      const feature = world.map.features.find((f) => f.id === i.place);
      if (!feature) return `unknown place "${i.place}"`;
      to = clamp(pointAt({ feature }, where, start, unit.center, rear, world));
    }
    // Never a destination in the water or off the map: the nearest ground on the side meant.
    // In the water, the way out is across it: to the bank the order named, else the unit's own.
    const side = where.bank ?? where.part;
    const named = side === undefined || side === 'near' || side === 'far' ? undefined : side;
    const inWater = world.map.features.find(
      (f) => WATER.has(f.kind) && f.geometry.shape === 'polyline' && onFeature(f, to),
    );
    let prefer = named ? COMPASS[named] : axis(sub(from, to));
    if (inWater?.geometry.shape === 'polyline') {
      const { at, normal } = nearestOnLine(inWater.geometry.points, to);
      const v = named ? COMPASS[named] : sub(from, at);
      prefer = {
        x: normal.x * (Math.sign(dot(normal, v)) || 1),
        y: normal.y * (Math.sign(dot(normal, v)) || 1),
      };
    }
    to = clamp(snapToGround(world, to, prefer));
    const prior = from;
    from = to;
    if (i.via) continue;
    // A march to where the unit already is goes nowhere; the same point twice is said once.
    if (
      i.kind !== 'hold' &&
      len(sub(to, prior)) < NO_MOVE_MM &&
      out.length === 0 &&
      intents.length > 1
    )
      continue;
    const last = out[out.length - 1];
    if (last && last.kind === i.kind && samePoint(last, to)) continue;
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
  }
  if (out.length === 0) return 'not understood';
  return out;
}

const samePoint = (i: OrderIntent, p: Point): boolean => {
  const q =
    i.kind === 'move'
      ? i.to
      : i.kind === 'hold'
        ? i.at
        : i.kind === 'withdraw'
          ? i.toward
          : undefined;
  return q !== undefined && q.x === p.x && q.y === p.y;
};
