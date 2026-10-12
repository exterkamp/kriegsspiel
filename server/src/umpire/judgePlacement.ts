/**
 * The `judge` stage's placement task: the umpire arranges units however it finds realistic,
 * and the engine checks only physical plausibility (D15). See docs/architecture.md.
 *
 * The model never writes state. `judgePlacements` returns proposals; the caller queues each
 * with the engine's `issuePlacement`, which validates, applies and records a `Ruling`. A
 * failed call throws `UmpireError` and the caller leaves the units where the engine has them.
 */
import { FORMATIONS, metres, mm, positionAt } from '@kriegsspiel/engine';
import type { TerrainFeature, GameState, Point, PlacementRuling } from '@kriegsspiel/engine';
import { UmpireError, type JsonSchema, type UmpireClient } from './umpireClient.js';

export const JUDGE_PLACEMENT_PROMPT_VERSION = 'judge-placement-v1';

export const JUDGE_PLACEMENT_SYSTEM = `You are the umpire of a Napoleonic wargame in the tradition of Kriegsspiel. You decide where units actually stand. The map is continuous: there is no grid, and every coordinate and length is in metres. The origin is the north-west corner, x grows east and y grows south. A facing is a compass bearing in degrees: 0 is north, 90 is east.

Input: the map as vector features (polygons, polylines with a width, and points with a radius; the highest layer decides the ground), the units with where the engine has them, and a situation describing what happened. Return a placement for each unit whose position, facing or formation changes.

Be realistic, not tidy. Troops do not stand in neat rectangles:
- a column on a road strings out along it, with stragglers at the tail;
- units bunch at fords and bridges and queue behind them;
- a unit may land a little short or long of where it was ordered, from friction, fatigue and fog;
- skirmishers deploy in a loose arc or line along a treeline, a hedge or a wall.

Describe a loose arrangement with "shape": sub-positions in metres, each an offset from the unit's "x","y" in the unit's own frame (first number to its right, second to its front). Leave "shape" out for a compact unit. Keep every position on passable ground, and do not move units further than they could march in "elapsedMinutes"; do not put units inside one another. The engine checks this, and clamps or rejects a placement that breaks it. Give "rationale" (your reasoning, for the record) and "narrative" (one sentence for the players). Reply with the JSON object only.`;

const num = { type: 'number' };
const point = {
  type: 'object',
  properties: { x: num, y: num },
  required: ['x', 'y'],
  additionalProperties: false,
};

/** The structured output of the placement task. Coordinates in metres, facing in degrees. */
export const JUDGE_PLACEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    placements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitId: { type: 'string' },
          x: num,
          y: num,
          facingDeg: num,
          formation: { type: 'string', enum: [...FORMATIONS] },
          shape: { type: 'array', items: point },
          rationale: { type: 'string' },
          narrative: { type: 'string' },
        },
        required: ['unitId', 'x', 'y', 'rationale', 'narrative'],
        additionalProperties: false,
      },
    },
  },
  required: ['placements'],
  additionalProperties: false,
};

export interface JudgePlacementOutput {
  placements: Array<{
    unitId: string;
    x: number;
    y: number;
    facingDeg?: number;
    formation?: (typeof FORMATIONS)[number];
    shape?: Point[];
    rationale: string;
    narrative: string;
  }>;
}

const m = (millimetres: number) => Math.round(metres(millimetres) * 1000) / 1000;
const inMetres = (p: Point) => ({ x: m(p.x), y: m(p.y) });
const deg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10;

function featureInput(f: TerrainFeature) {
  const g = f.geometry;
  const geometry =
    g.shape === 'polygon'
      ? { shape: 'polygon', points: g.points.map(inMetres) }
      : g.shape === 'polyline'
        ? { shape: 'polyline', points: g.points.map(inMetres), width: m(g.width) }
        : { shape: 'point', at: inMetres(g.at), radius: m(g.radius) };
  return { id: f.id, kind: f.kind, name: f.name, layer: f.layer, geometry, attrs: f.attrs };
}

/** What the model sees: the master state in metres. The umpire may know everything. */
export function judgePlacementInput(world: GameState, situation: string, elapsedMs: number) {
  return {
    situation,
    gameMinutes: Math.round(world.time / 600) / 100,
    elapsedMinutes: Math.round(elapsedMs / 600) / 100,
    map: {
      widthM: m(world.map.width),
      heightM: m(world.map.height),
      features: world.map.features.map(featureInput),
    },
    units: world.units
      .filter((u) => u.status === 'active')
      .map((u) => ({
        id: u.id,
        side: u.side,
        kind: u.kind,
        name: u.name,
        ...inMetres(positionAt(world.map, u, world.time)),
        facingDeg: deg(u.facing),
        formation: u.formation,
        strength: Math.round(u.strength),
        footprintM: { frontage: m(u.footprint.frontage), depth: m(u.footprint.depth) },
        ...(u.shape ? { shape: u.shape.map(inMetres) } : {}),
      })),
  };
}

/**
 * Ask the umpire where units stand after `situation`, `elapsedMs` of game time since the
 * engine last placed them. Returns proposals for the engine to validate; unknown units are
 * left for the engine to reject so the refusal is on record.
 */
export async function judgePlacements(
  client: UmpireClient,
  world: GameState,
  situation: string,
  elapsedMs: number,
): Promise<PlacementRuling[]> {
  let output: JudgePlacementOutput;
  try {
    ({ output } = await client.call<JudgePlacementOutput>({
      stage: 'judge',
      promptVersion: JUDGE_PLACEMENT_PROMPT_VERSION,
      system: JUDGE_PLACEMENT_SYSTEM,
      input: judgePlacementInput(world, situation, elapsedMs),
      schema: JUDGE_PLACEMENT_SCHEMA,
    }));
  } catch (e) {
    // A game over its cap gets no rulings: the units stay where the engine put them.
    if (e instanceof UmpireError && (e.kind === 'budget' || e.kind === 'rate-limit')) return [];
    throw e;
  }
  return output.placements.map((p) => ({
    proposal: {
      unitId: p.unitId,
      center: { x: mm(p.x), y: mm(p.y) },
      ...(p.facingDeg !== undefined ? { facing: (p.facingDeg * Math.PI) / 180 } : {}),
      ...(p.formation ? { formation: p.formation } : {}),
      ...(p.shape ? { shape: p.shape.map((s) => ({ x: mm(s.x), y: mm(s.y) })) } : {}),
      elapsedMs,
    },
    rationale: p.rationale,
    narrative: p.narrative,
  }));
}
