import {
  defaultFootprint,
  footprintCorners,
  footprintsOverlap,
  subPositions,
} from './formation.js';
import { COMBAT_CHECK_EVENT } from './contact.js';
import type { EngineState, EventRegistry, Json } from './events.js';
import { schedule } from './queue.js';
import { heldTurn } from './held.js';
import { findPath } from './navigation.js';
import { unitTypeOf } from './unitTypes.js';
import { legDuration, pathDuration, positionAlong, positionAt, updateUnit } from './movement.js';
import { metres, mm } from './geometry.js';
import { terrainAt } from './terrain.js';
import type {
  Footprint,
  Formation,
  GameState,
  GameTime,
  Intent,
  Point,
  Ruling,
  TerrainMap,
  Unit,
} from './types.js';
import { FORMATIONS } from './types.js';

/**
 * How far two footprints may overlap before the umpire's placement is refused, in mm. Ranks and files are not drawn to the millimetre, so a metre of overlap is allowed.
 */
export const OVERLAP_TOLERANCE_MM = mm(1);

/** The most sub-positions one loose arrangement may have. */
export const MAX_SHAPE_POINTS = 200;

/** How far a loose sub-position may lie from the unit's centre, in mm (2 km: a long road column). */
export const MAX_SHAPE_EXTENT_MM = mm(2000);

/** Where the umpire wants a unit to stand. */
export interface PlacementProposal {
  unitId: string;
  center: Point;
  /** Compass bearing in radians; the unit's current facing if omitted. Turning is free. */
  facing?: number;
  /** The formation the unit is in afterwards; its current one if omitted. Changing it is free here. */
  formation?: Formation;
  /**
   * Loose sub-positions as offsets in mm from `center` in the unit's own frame (x to its
   * right, y to its front): a skirmish arc along a treeline, a column strung out along a
   * road. Replaces any shape the unit has; omit it for a compact unit. The footprint becomes
   * the bounding rectangle of the points.
   */
  shape?: Point[];
  /**
   * Game ms the unit has had to get there from where the engine has it. The proposal is
   * clamped to the ground it could cover on foot in that time.
   */
  elapsedMs: GameTime;
}

export interface Placement {
  center: Point;
  facing: number;
  formation: Formation;
  footprint: Footprint;
  shape?: Point[];
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

/**
 * How `validatePlacement` is used for a turn (D39): a unit that is not `active` (a broken one
 * running) may be placed, and only overlap with its own side counts, since opposing units
 * placed in contact may overlap as in melee.
 */
export interface PlacementOptions {
  allowWithdrawn?: boolean;
  overlapWith?: 'all' | 'friendly';
}

/** Everything wrong with `unit` standing as it is, against the map and the other units. */
function problems(world: GameState, unit: Unit, opts: PlacementOptions = {}): string[] {
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
      if (opts.overlapWith === 'friendly' && other.side !== unit.side) continue;
      if (footprintsOverlap(shrunk(unit), shrunk(other))) {
        out.push(`overlaps unit "${other.id}"`);
      }
    }
  }
  return out;
}

/** `unit` standing as `p` says; a placement replaces the shape, so none given means none. */
function arranged(unit: Unit, p: Placement): Unit {
  const next: Unit = { ...unit, ...p };
  if (!p.shape) delete next.shape;
  return next;
}

function badShape(shape: Point[] | undefined): string | undefined {
  if (!shape) return undefined;
  if (shape.length > MAX_SHAPE_POINTS) return `shape has more than ${MAX_SHAPE_POINTS} points`;
  for (const p of shape) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'shape points must be numbers';
    if (Math.abs(p.x) > MAX_SHAPE_EXTENT_MM || Math.abs(p.y) > MAX_SHAPE_EXTENT_MM) {
      return `a shape point lies more than ${metres(MAX_SHAPE_EXTENT_MM)} m from the centre`;
    }
  }
  return undefined;
}

const roundedShape = (shape: Point[]): Point[] =>
  shape.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));

/** The rectangle that bounds a loose shape (at least a metre each way). */
function shapeFootprint(shape: Point[]): Footprint {
  const hx = Math.max(0, ...shape.map((p) => Math.abs(p.x)));
  const hy = Math.max(0, ...shape.map((p) => Math.abs(p.y)));
  return { frontage: Math.max(mm(1), 2 * hx), depth: Math.max(mm(1), 2 * hy) };
}

/**
 * `unit` standing as `proposal` asks, before any check against the map, the other units or the
 * march; or why the proposal cannot even be drawn up (a bad shape, formation or number).
 */
export function proposedArrangement(
  unit: Unit,
  proposal: Pick<PlacementProposal, 'center' | 'facing' | 'formation' | 'shape'>,
): { wanted: Unit } | { reasons: string[] } {
  const facing = proposal.facing ?? unit.facing;
  const formation = proposal.formation ?? unit.formation;
  const shapeProblem = badShape(proposal.shape);
  if (shapeProblem) return { reasons: [shapeProblem] };
  if (!FORMATIONS.includes(formation)) return { reasons: ['unknown formation'] };
  if (!Number.isFinite(facing)) return { reasons: ['facing must be a number'] };
  if (!Number.isFinite(proposal.center.x) || !Number.isFinite(proposal.center.y)) {
    return { reasons: ['centre must be a point'] };
  }
  const shape =
    proposal.shape && proposal.shape.length > 0 ? roundedShape(proposal.shape) : undefined;
  const footprint = shape
    ? shapeFootprint(shape)
    : formation === unit.formation && !unit.shape
      ? unit.footprint
      : defaultFootprint(unitTypeOf(unit), formation, unit.strength);
  return {
    wanted: arranged(unit, { center: proposal.center, facing, formation, footprint, shape }),
  };
}

/** True when two compact units overlap by more than `OVERLAP_TOLERANCE_MM` (loose shapes may nest). */
export function overlapsBeyondTolerance(a: Unit, b: Unit): boolean {
  if (a.shape || b.shape) return false;
  return footprintsOverlap(shrunk(a), shrunk(b));
}

/**
 * Check a placement the umpire proposes for a unit: inside the map, not on impassable ground,
 * footprints not overlapping beyond `OVERLAP_TOLERANCE_MM`, and no further from where the
 * engine has the unit than it could march in `elapsedMs` over the ground between. Nothing
 * snaps to a grid. Too far is clamped to the point along the cheapest route reached when time
 * runs out; anything else wrong is rejected. Pure: it changes no state.
 */
export function validatePlacement(
  world: GameState,
  proposal: PlacementProposal,
  opts: PlacementOptions = {},
): PlacementVerdict {
  const unit = world.units.find((u) => u.id === proposal.unitId);
  if (!unit) return { verdict: 'reject', reasons: ['unknown unit'] };
  const placeable =
    unit.status === 'active' || (opts.allowWithdrawn === true && unit.status === 'withdrawn');
  if (!placeable) return { verdict: 'reject', reasons: ['unit not active'] };
  if (!Number.isFinite(proposal.elapsedMs) || proposal.elapsedMs < 0) {
    return { verdict: 'reject', reasons: ['elapsedMs must be zero or more'] };
  }
  const want = proposedArrangement(unit, proposal);
  if ('reasons' in want) return { verdict: 'reject', reasons: want.reasons };
  const { wanted } = want;
  const { facing, formation, footprint, shape } = wanted;
  const wrong = problems(world, wanted, opts);
  if (wrong.length > 0) return { verdict: 'reject', reasons: wrong };

  const from = positionAt(world.map, unit, world.time);
  const path = findPath(world.map, from, proposal.center, { width: unit.footprint.frontage });
  if (!path) {
    return { verdict: 'reject', reasons: ['no passable route from where the unit stands'] };
  }
  const needed = pathDuration(world.map, path.waypoints, unit);
  if (needed <= proposal.elapsedMs) {
    return {
      verdict: 'accept',
      placement: {
        center: { ...proposal.center },
        facing,
        formation,
        footprint,
        ...(shape ? { shape } : {}),
      },
      reasons: [],
    };
  }

  // Walk the route until the time is spent.
  let left = proposal.elapsedMs;
  let center = from;
  for (let i = 1; i < path.waypoints.length; i++) {
    const a = path.waypoints[i - 1] as Point;
    const b = path.waypoints[i] as Point;
    const d = legDuration(world.map, a, b, unit) as number;
    if (d > left) {
      center = positionAlong(world.map, a, b, unit, left);
      break;
    }
    left -= d;
    center = b;
  }
  const reached = arranged(unit, { center, facing, formation, footprint, shape });
  const stuck = problems(world, reached, opts);
  const reasons = [
    `too far: ${Math.round(needed / 1000)} s of marching needed, ${Math.round(proposal.elapsedMs / 1000)} s allowed (${Math.round(metres(path.cost))} m of weighted ground)`,
  ];
  if (stuck.length > 0) return { verdict: 'reject', reasons: [...reasons, ...stuck] };
  return {
    verdict: 'clamp',
    placement: { center, facing, formation, footprint, ...(shape ? { shape } : {}) },
    reasons,
  };
}

export const PLACEMENT_EVENT = 'umpire.placement';

/** What the umpire says about a placement, besides the proposal itself. */
export interface PlacementRuling {
  proposal: PlacementProposal;
  rationale: string;
  narrative: string;
}

/**
 * Queue an umpire placement to be ruled on at `time` (default: now). The engine validates it
 * then, applies what is acceptable and records a `Ruling`. The queued event carries the whole
 * proposal, so replaying the input log needs no model call.
 */
export function issuePlacement(
  state: EngineState<GameState>,
  ruling: PlacementRuling,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [{ time, type: PLACEMENT_EVENT, payload: ruling as unknown as Json }]);
}

/**
 * Register the placement handler. An accepted or clamped placement moves the unit, ends any
 * march it was on (a `hold` is kept, at the new spot) and has combat re-checked. A rejected one
 * changes nothing. Either way the ruling is recorded.
 */
export function registerPlacement(registry: EventRegistry<GameState>): void {
  registry.register(PLACEMENT_EVENT, (w, ev) => {
    // In an umpire turn only `umpire.turn` places units (D39).
    if (heldTurn(w, ev.time)) return { world: w };
    const { proposal, rationale, narrative } = ev.payload as unknown as PlacementRuling;
    const world: GameState = { ...w, time: ev.time };
    const verdict = validatePlacement(world, proposal);
    const ruling: Ruling = {
      id: `ruling-${world.rulings.length + 1}`,
      time: ev.time,
      proposal,
      verdict,
      rationale,
      narrative,
    };
    const emit = [
      {
        type: 'umpire.ruling',
        payload: { rulingId: ruling.id, unitId: proposal.unitId, verdict: verdict.verdict },
      },
    ];
    if (verdict.verdict === 'reject') {
      return { world: { ...world, rulings: [...world.rulings, ruling] }, emit };
    }
    const p = verdict.placement;
    const unit = world.units.find((u) => u.id === proposal.unitId)!;
    const intent: Intent =
      unit.intent.kind === 'hold' ? { kind: 'hold', at: p.center } : { kind: 'idle' };
    const moved = updateUnit(
      world,
      unit.id,
      {
        center: p.center,
        facing: p.facing,
        formation: p.formation,
        footprint: p.footprint,
        shape: p.shape,
        intent,
        leg: undefined,
      },
      ev.time,
    );
    return {
      world: { ...moved, rulings: [...world.rulings, ruling] },
      emit,
      schedule: [{ time: ev.time, type: COMBAT_CHECK_EVENT }],
    };
  });
}
