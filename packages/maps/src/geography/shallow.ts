import type { Point, Water } from '../contract.js';
import { distance, polygonLocation } from '../geometry.js';
import type { TopologyBudget } from '../errors.js';
import { decimal6 } from '../terrain/precision.js';

/** Policy identity of the shallow-water model and the ford rules built on it (D46). */
export const FORD_POLICY = 'shallow-riffle-v1' as const;

/**
 * Frozen `shallow-riffle-v1` parameters. A reach's riffle depth (the depth at
 * its shallowest crossing places, at ordinary low water) follows downstream
 * hydraulic geometry: width grows as discharge^0.5 and depth as about
 * discharge^0.4, so for the reach width the generator derived from its
 * catchment (D44), depth grows as width^0.75. At a given discharge a steeper
 * reach runs faster and shallower (Manning: depth ~ slope^-0.3), taken here as
 * slope^-0.25. Only square roots are used, so results are exact under binary64.
 */
export const SHALLOW_WATER = Object.freeze({
  /**
   * A 10 m wide reach falling 3 m per km has 0.3 m over its riffles at ordinary
   * water (about a third of its bankfull depth), so a 30 m river has about
   * 0.7 m and a 60 m one over 1.1 m.
   */
  referenceWidthM: 10,
  referenceDepthM: 0.3,
  referenceSlope: 0.003,
  /** Reach slope clamp: still water (or an outlet reach) counts as minSlope. */
  minSlope: 0.0005,
  maxSlope: 0.03,
  /** Deepest water carts and field guns can wade (period manuals: 0.6-0.9 m). */
  maxFordDepthM: 0.8,
  /** Highest ford end (bank) above the water surface. */
  maxBankM: 1.5,
  /** Steepest ground on a ford's dry ramp, as a share of the road maximum. */
  rampGradeShare: 0.8,
  /** Steepest ground over the gentlest outward approach (straight out or slanting), as a share of the road maximum. */
  approachGradeShare: 0.8,
  /** Fords on one reach are at least this far apart along it, and clear of bridges by this much. */
  spacingM: 100,
  clearanceM: 25,
  /** Fixed route cost of a ford in metres: cheaper than a bridge, dearer than a dry road. */
  routeFixedM: 120,
  routeSpanFactor: 3,
});

const fourthRoot = (x: number) => Math.sqrt(Math.sqrt(x));

/** Riffle depth (m) of a reach of this width and surface slope, before rounding. */
export function riffleDepthM(widthM: number, slope: number): number {
  const p = SHALLOW_WATER,
    s = Math.min(p.maxSlope, Math.max(p.minSlope, slope)),
    w = widthM / p.referenceWidthM;
  return p.referenceDepthM * Math.sqrt(w) * fourthRoot(w) * fourthRoot(p.referenceSlope / s);
}

function centrelineLength(path: Point[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1]!, path[i]!);
  return length;
}

/**
 * Surface slope of a river reach from public geometry: the fall from its
 * surface to the downstream neighbour's (a reach starting where it ends, else
 * the water containing its end), over its centreline length. Reaches ending at
 * the map edge, in nothing, or above higher water count as still (slope 0).
 */
export function reachSlope(
  river: Extract<Water, { kind: 'river' }>,
  water: readonly Water[],
  budget?: TopologyBudget,
): number {
  const end = river.centreline.at(-1)!;
  let next: Water | undefined;
  for (const o of water)
    if (
      o.id !== river.id &&
      o.kind === 'river' &&
      o.centreline[0]![0] === end[0] &&
      o.centreline[0]![1] === end[1]
    ) {
      next = o;
      break;
    }
  next ??= water.find(
    (o) =>
      o.id !== river.id &&
      o.polygons.some((p) => polygonLocation(end, p, budget, '$.water') !== 'outside'),
  );
  if (!next) return 0;
  const downstream = next.kind === 'lake' ? next.surfaceElevationM : next.surfaceProfileM[0]!;
  const fall = Math.max(0, river.surfaceProfileM[0]! - downstream),
    length = Math.max(river.widthM, centrelineLength(river.centreline));
  return fall / length;
}

/** Recorded (decimal6) riffle depth of a river reach under `shallow-riffle-v1`. */
export function fordDepthM(
  river: Extract<Water, { kind: 'river' }>,
  water: readonly Water[],
  budget?: TopologyBudget,
): number {
  return decimal6(riffleDepthM(river.widthM, reachSlope(river, water, budget)));
}

/** True when the reach is shallow enough for a ford. */
export function isShallow(depthM: number): boolean {
  return depthM <= SHALLOW_WATER.maxFordDepthM;
}

const terminalOf = (rest: string, ids: readonly string[]): [string, string] | undefined => {
  for (const a of ids)
    if (rest.startsWith(`${a}:`)) {
      const b = rest.slice(a.length + 1);
      if (ids.includes(b)) return [a, b];
    }
  return undefined;
};

/**
 * Main or minor road class of a regional route, from its identity alone.
 * Routes joining only villages and boundary exits (and required-bridge routes)
 * are main roads; any route with a farm at one end is a minor road (a farm or
 * field lane), which may ford shallow water. Unknown identities count as main.
 */
export function isMinorRoute(
  routeId: string,
  sites: readonly { id: string; kind: 'village' | 'farm' }[],
): boolean {
  if (!routeId.startsWith('route:') || routeId.startsWith('route:bridge:')) return false;
  let rest = routeId.slice('route:'.length);
  if (rest.startsWith('extra:')) rest = rest.slice('extra:'.length);
  const ids = [
    ...sites.map((s) => s.id),
    'boundary:north',
    'boundary:east',
    'boundary:south',
    'boundary:west',
  ];
  const pair = terminalOf(rest, ids);
  if (!pair) return false;
  const farms = new Set(sites.filter((s) => s.kind === 'farm').map((s) => s.id));
  return farms.has(pair[0]) || farms.has(pair[1]);
}
