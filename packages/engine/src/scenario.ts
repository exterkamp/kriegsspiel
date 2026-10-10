import {
  footprintCorners,
  footprintsOverlap,
  defaultFootprint,
  subPositions,
} from './formation.js';
import { mm, pointMm, polygonCentroid } from './geometry.js';
import { KIND_DEFAULTS, terrainAt } from './terrain.js';
import {
  FEATURE_KINDS,
  FORMATIONS,
  HEIGHTS,
  MS_PER_MINUTE,
  UNIT_KINDS,
  type FeatureGeometry,
  type Footprint,
  type GameState,
  type Point,
  type Side,
  type SideId,
  type TerrainAttrs,
  type TerrainFeature,
  type TerrainMap,
  type Unit,
} from './types.js';

export class ScenarioError extends Error {
  constructor(message: string) {
    super(`Invalid scenario: ${message}`);
    this.name = 'ScenarioError';
  }
}

type Obj = Record<string, unknown>;

function fail(msg: string): never {
  throw new ScenarioError(msg);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${path} must be an object`);
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(`${path} must be an array`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(`${path} must be a non-empty string`);
  return v;
}

function int(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${path} must be an integer`);
  if (v < min || v > max) fail(`${path} must be between ${min} and ${max}`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    fail(`${path} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

/** A finite number (not necessarily whole) within [min, max]. Lengths in scenario data are metres. */
function num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path} must be a finite number`);
  if (v < min || v > max) fail(`${path} must be between ${min} and ${max}`);
  return v;
}

/** A named point `{x, y}` in metres, quantised to integer mm. */
function parsePoint(raw: unknown, path: string): Point {
  const o = obj(raw, path);
  return pointMm(num(o.x, `${path}.x`), num(o.y, `${path}.y`));
}

/** A vertex `[x, y]` in metres, quantised to integer mm. */
function parseVertex(raw: unknown, path: string): Point {
  const a = arr(raw, path);
  if (a.length !== 2) fail(`${path} must be [x, y]`);
  return pointMm(num(a[0], `${path}[0]`), num(a[1], `${path}[1]`));
}

function inside(map: TerrainMap, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= map.width && p.y <= map.height;
}

function parseGeometry(o: Obj, path: string, map: TerrainMap): FeatureGeometry {
  const keys = ['polygon', 'polyline', 'at'].filter((k) => o[k] !== undefined);
  if (keys.length !== 1) fail(`${path} needs exactly one of polygon, polyline or at`);
  let g: FeatureGeometry;
  if (o.polygon !== undefined) {
    const points = arr(o.polygon, `${path}.polygon`).map((v, i) =>
      parseVertex(v, `${path}.polygon[${i}]`),
    );
    if (points.length < 3) fail(`${path}.polygon needs at least 3 points`);
    g = { shape: 'polygon', points };
  } else if (o.polyline !== undefined) {
    const points = arr(o.polyline, `${path}.polyline`).map((v, i) =>
      parseVertex(v, `${path}.polyline[${i}]`),
    );
    if (points.length < 2) fail(`${path}.polyline needs at least 2 points`);
    g = { shape: 'polyline', points, width: mm(num(o.width, `${path}.width`, 0.001)) };
  } else {
    g = {
      shape: 'point',
      at: parsePoint(o.at, `${path}.at`),
      radius: mm(num(o.radius, `${path}.radius`, 0.001)),
    };
  }
  const pts = g.shape === 'point' ? [g.at] : g.points;
  if (!pts.every((p) => inside(map, p))) fail(`${path} lies off the map`);
  return g;
}

function parseAttrs(o: Obj, path: string, base: TerrainAttrs): TerrainAttrs {
  return {
    moveCost: o.moveCost === undefined ? base.moveCost : num(o.moveCost, `${path}.moveCost`, 0.01),
    cover: o.cover === undefined ? base.cover : num(o.cover, `${path}.cover`, 0, 1),
    concealment:
      o.concealment === undefined
        ? base.concealment
        : num(o.concealment, `${path}.concealment`, 0, 1),
    height: o.height === undefined ? base.height : oneOf(o.height, HEIGHTS, `${path}.height`),
    passable:
      o.passable === undefined
        ? base.passable
        : typeof o.passable === 'boolean'
          ? o.passable
          : fail(`${path}.passable must be a boolean`),
  };
}

function parseMap(raw: unknown): TerrainMap {
  const m = obj(raw, 'map');
  const map: TerrainMap = {
    width: mm(num(m.width, 'map.width', 1)),
    height: mm(num(m.height, 'map.height', 1)),
    features: [],
  };
  const ids = new Set<string>();
  map.features = arr(m.features, 'map.features').map((f, i): TerrainFeature => {
    const p = `map.features[${i}]`;
    const o = obj(f, p);
    const id = str(o.id, `${p}.id`);
    if (ids.has(id)) fail(`duplicate feature id "${id}"`);
    ids.add(id);
    const kind = oneOf(o.kind, FEATURE_KINDS, `${p}.kind`);
    const d = KIND_DEFAULTS[kind];
    return {
      id,
      kind,
      ...(o.name === undefined ? {} : { name: str(o.name, `${p}.name`) }),
      layer: o.layer === undefined ? d.layer : int(o.layer, `${p}.layer`),
      geometry: parseGeometry(o, p, map),
      attrs: parseAttrs(o, p, d.attrs),
    };
  });
  return map;
}

function passableAt(map: TerrainMap, p: Point): boolean {
  return terrainAt(map, p)?.attrs.passable === true;
}

function parseHq(o: Record<string, unknown>, i: number, map: TerrainMap): Point {
  const p = parsePoint(o.hq, `sides[${i}].hq`);
  if (!passableAt(map, p)) fail(`sides[${i}].hq must be on passable ground`);
  return p;
}

function parseSides(raw: unknown, map: TerrainMap): Side[] {
  const list = arr(raw, 'sides');
  if (list.length !== 2) fail('sides must contain exactly two sides');
  const sides = list.map((s, i): Side => {
    const o = obj(s, `sides[${i}]`);
    return {
      id: oneOf(o.id, ['blue', 'red'] as const, `sides[${i}].id`),
      name: str(o.name, `sides[${i}].name`),
      controller: oneOf(o.controller, ['human', 'scripted'] as const, `sides[${i}].controller`),
      hq: parseHq(o, i, map),
    };
  });
  if (sides[0]?.id === sides[1]?.id) fail('sides must have distinct ids');
  return sides;
}

function parseUnits(raw: unknown, map: TerrainMap, sides: Side[]): Unit[] {
  const list = arr(raw, 'units');
  const ids = new Set<string>();
  const sideIds = sides.map((s) => s.id);
  const units: Unit[] = [];
  list.forEach((u, i) => {
    const p = `units[${i}]`;
    const o = obj(u, p);
    const id = str(o.id, `${p}.id`);
    if (ids.has(id)) fail(`duplicate unit id "${id}"`);
    ids.add(id);
    const center = parsePoint(o.at, `${p}.at`);
    const kind = oneOf(o.kind, UNIT_KINDS, `${p}.kind`);
    const strength = int(o.strength, `${p}.strength`, 1);
    const formation =
      o.formation === undefined ? 'line' : oneOf(o.formation, FORMATIONS, `${p}.formation`);
    const def = defaultFootprint(kind, formation, strength);
    const footprint: Footprint = {
      frontage:
        o.frontage === undefined ? def.frontage : mm(num(o.frontage, `${p}.frontage`, 0.001)),
      depth: o.depth === undefined ? def.depth : mm(num(o.depth, `${p}.depth`, 0.001)),
    };
    const unit: Unit = {
      id,
      side: oneOf(o.side, sideIds, `${p}.side`),
      kind,
      name: str(o.name, `${p}.name`),
      center,
      facing: (num(o.facingDeg, `${p}.facingDeg`) * Math.PI) / 180,
      formation,
      footprint,
      ...(o.shape === undefined
        ? {}
        : { shape: arr(o.shape, `${p}.shape`).map((v, k) => parseVertex(v, `${p}.shape[${k}]`)) }),
      strength,
      morale: int(o.morale, `${p}.morale`, 0, 100),
      intent: { kind: 'idle' },
      status: 'active',
      home: { ...center },
    };
    if (unit.shape && unit.shape.length === 0) {
      fail(`${p}.shape must have at least one sub-position`);
    }
    const where = `(${center.x / 1000}, ${center.y / 1000})`;
    if (!inside(map, center)) fail(`${p} center ${where} is off the map`);
    for (const sp of subPositions(unit)) {
      if (!inside(map, sp)) fail(`${p} has a sub-position off the map`);
      if (!passableAt(map, sp)) fail(`${p} has a position on impassable ground`);
    }
    if (!footprintCorners(unit).every((c) => inside(map, c))) {
      fail(`${p} footprint extends off the map`);
    }
    // Loose shapes are arcs and lines whose rectangle is only a bound, so they may nest.
    if (!unit.shape) {
      const hit = units.find((v) => !v.shape && footprintsOverlap(unit, v));
      if (hit) fail(`${p} overlaps unit "${hit.id}"`);
    }
    units.push(unit);
  });
  for (const id of sideIds) {
    if (!units.some((u) => u.side === id)) fail(`side "${id}" has no units`);
  }
  return units;
}

/** Validate raw scenario data (e.g. parsed JSON) and build the initial `GameState` at t=0. */
export function loadScenario(raw: unknown): GameState {
  const o = obj(raw, 'scenario');
  const map = parseMap(o.map);
  const sides = parseSides(o.sides, map);
  const units = parseUnits(o.units, map, sides);

  const v = obj(o.victory, 'victory');
  const objective = arr(v.objective, 'victory.objective').map((q, i) =>
    parseVertex(q, `victory.objective[${i}]`),
  );
  if (objective.length < 3) fail('victory.objective needs at least 3 points');
  for (const [i, q] of objective.entries()) {
    if (!inside(map, q)) fail(`victory.objective[${i}] is off the map`);
  }
  const onBridge = terrainAt(map, polygonCentroid(objective))?.featureIds.some(
    (fid) => map.features.find((f) => f.id === fid)?.kind === 'bridge',
  );
  if (!onBridge) fail('victory.objective must be centred on a bridge');
  const sideIds: SideId[] = sides.map((s) => s.id);
  const defender = oneOf(v.defender, sideIds, 'victory.defender');
  const attacker = oneOf(v.attacker, sideIds, 'victory.attacker');
  if (defender === attacker) fail('victory.defender and victory.attacker must differ');

  return {
    scenarioId: str(o.id, 'id'),
    time: 0,
    seed: int(o.seed, 'seed'),
    map,
    sides,
    units,
    intel: Object.fromEntries(
      sideIds.map((id) => [id, { contacts: [], inSight: [], reports: [] }]),
    ) as unknown as GameState['intel'],
    victory: {
      objective,
      defender,
      attacker,
      holdMs: int(v.holdMinutes, 'victory.holdMinutes', 1) * MS_PER_MINUTE,
    },
    combatActive: false,
    outcome: null,
    rulings: [],
  };
}
