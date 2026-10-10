import { footprintCorners, footprintsOverlap, subPositions } from './formation.js';
import { findPath } from './navigation.js';
import { legDuration, pathDuration, positionAlong, positionAt } from './movement.js';
import { metres, mm } from './geometry.js';
import { terrainAt } from './terrain.js';
import type { GameState, GameTime, Point, TerrainMap, Unit } from './types.js';

/**
 * How far two footprints may overlap before the umpire's placement is refused, in mm. Ranks and files are not drawn to the millimetre, so a metre of overlap is allowed.
 */
export const OVERLAP_TOLERANCE_MM = mm(1);

/** Where the umpire wants a unit to stand. */
export interface PlacementProposal {
  unitId: string;
  center: Point;
  /** Compass bearing in radians; the unit's current facing if omitted. Turning is free. */
  facing?: number;
  /**
   * Game ms the unit has had to get there from where the engine has it. The proposal is
   * clamped to the ground it could cover on foot in that time.
   */
  elapsedMs: GameTime;
}

export interface Placement {
  center: Point;
  facing: number;
}

/**
 * The engine's answer to a proposed placement. It judges physical plausibility only: the
 * umpire may arrange units any way it likes within that. `clamp` carries the nearest
 * acceptable placement; `reasons` is empty only for `accept`.
 */
export type PlacementVerdict =
  | { verdict: 'accept'; placement: Placement; reasons: [] }
  | { verdict: 'clamp'; placement: Placement; reasons: string[] }
  | { verdict: 'reject'; reasons: string[] };

function inMap(map: TerrainMap, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= map.width && p.y <= map.height;
}

/** Shrunk by the tolerance in each dimension, so footprints may overlap by up to that much. */
function shrunk(u: Unit): Unit {
  return {
    ...u,
    footprint: {
      frontage: Math.max(1, u.footprint.frontage - OVERLAP_TOLERANCE_MM),
      depth: Math.max(1, u.footprint.depth - OVERLAP_TOLERANCE_MM),
    },
  };
}

/** Everything wrong with `unit` standing as it is, against the map and the other units. */
function problems(world: GameState, unit: Unit): string[] {
  const out: string[] = [];
  if (!footprintCorners(unit).every((c) => inMap(world.map, c))) {
    out.push('footprint extends off the map');
  }
  const spots = subPositions(unit);
  if (spots.some((p) => !inMap(world.map, p))) out.push('a position is off the map');
  else if (spots.some((p) => terrainAt(world.map, p)?.attrs.passable !== true)) {
    out.push('a position is on impassable ground');
  }
  // Loose shapes are arcs and lines whose rectangle is only a bound, so they may nest.
  if (!unit.shape) {
    for (const other of world.units) {
      if (other.id === unit.id || other.status === 'destroyed' || other.shape) continue;
      if (footprintsOverlap(shrunk(unit), shrunk(other))) {
        out.push(`overlaps unit "${other.id}"`);
      }
    }
  }
  return out;
}

/**
 * Check a placement the umpire proposes for a unit: inside the map, not on impassable ground,
 * footprints not overlapping beyond `OVERLAP_TOLERANCE_MM`, and no further from where the
 * engine has the unit than it could march in `elapsedMs` over the ground between. Nothing
 * snaps to a grid. Too far is clamped to the point along the cheapest route reached when time
 * runs out; anything else wrong is rejected. Pure: it changes no state.
 */
export function validatePlacement(world: GameState, proposal: PlacementProposal): PlacementVerdict {
  const unit = world.units.find((u) => u.id === proposal.unitId);
  if (!unit) return { verdict: 'reject', reasons: ['unknown unit'] };
  if (unit.status !== 'active') return { verdict: 'reject', reasons: ['unit not active'] };
  if (!Number.isFinite(proposal.elapsedMs) || proposal.elapsedMs < 0) {
    return { verdict: 'reject', reasons: ['elapsedMs must be zero or more'] };
  }
  const facing = proposal.facing ?? unit.facing;
  const wanted: Unit = { ...unit, center: proposal.center, facing };
  const wrong = problems(world, wanted);
  if (wrong.length > 0) return { verdict: 'reject', reasons: wrong };

  const from = positionAt(world.map, unit, world.time);
  const path = findPath(world.map, from, proposal.center, { width: unit.footprint.frontage });
  if (!path) {
    return { verdict: 'reject', reasons: ['no passable route from where the unit stands'] };
  }
  const needed = pathDuration(world.map, path.waypoints, unit.kind);
  if (needed <= proposal.elapsedMs) {
    return {
      verdict: 'accept',
      placement: { center: { ...proposal.center }, facing },
      reasons: [],
    };
  }

  // Walk the route until the time is spent.
  let left = proposal.elapsedMs;
  let center = from;
  for (let i = 1; i < path.waypoints.length; i++) {
    const a = path.waypoints[i - 1] as Point;
    const b = path.waypoints[i] as Point;
    const d = legDuration(world.map, a, b, unit.kind) as number;
    if (d > left) {
      center = positionAlong(world.map, a, b, unit.kind, left);
      break;
    }
    left -= d;
    center = b;
  }
  const reached: Unit = { ...unit, center, facing };
  const stuck = problems(world, reached);
  const reasons = [
    `too far: ${Math.round(needed / 1000)} s of marching needed, ${Math.round(proposal.elapsedMs / 1000)} s allowed (${Math.round(metres(path.cost))} m of weighted ground)`,
  ];
  if (stuck.length > 0) return { verdict: 'reject', reasons: [...reasons, ...stuck] };
  return { verdict: 'clamp', placement: { center, facing }, reasons };
}
