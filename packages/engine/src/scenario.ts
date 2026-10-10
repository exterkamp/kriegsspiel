import {
  FACINGS,
  MS_PER_MINUTE,
  TERRAINS,
  tileAt,
  type Facing,
  type GameState,
  type MapGrid,
  type Point,
  type Side,
  type SideId,
  type Terrain,
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

function parseMap(raw: unknown): MapGrid {
  const m = obj(raw, 'map');
  const legendRaw = obj(m.legend, 'map.legend');
  const legend = new Map<string, Terrain>();
  for (const [ch, t] of Object.entries(legendRaw)) {
    if (ch.length !== 1) fail(`map.legend key "${ch}" must be a single character`);
    legend.set(ch, oneOf(t, TERRAINS, `map.legend["${ch}"]`));
  }
  const rows = arr(m.rows, 'map.rows');
  if (rows.length === 0) fail('map.rows must not be empty');
  const first = str(rows[0], 'map.rows[0]');
  const width = first.length;
  const tiles: Terrain[] = [];
  rows.forEach((r, y) => {
    const row = str(r, `map.rows[${y}]`);
    if (row.length !== width) {
      fail(`map.rows[${y}] has width ${row.length}, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const t = legend.get(row[x] as string);
      if (t === undefined) fail(`map.rows[${y}] has unknown tile "${row[x]}" at x=${x}`);
      tiles.push(t);
    }
  });
  return { width, height: rows.length, tiles };
}

function parseSides(raw: unknown): Side[] {
  const list = arr(raw, 'sides');
  if (list.length !== 2) fail('sides must contain exactly two sides');
  const sides = list.map((s, i): Side => {
    const o = obj(s, `sides[${i}]`);
    return {
      id: oneOf(o.id, ['blue', 'red'] as const, `sides[${i}].id`),
      name: str(o.name, `sides[${i}].name`),
      controller: oneOf(o.controller, ['human', 'scripted'] as const, `sides[${i}].controller`),
    };
  });
  if (sides[0]?.id === sides[1]?.id) fail('sides must have distinct ids');
  return sides;
}

function parseUnits(raw: unknown, map: MapGrid, sides: Side[]): Unit[] {
  const list = arr(raw, 'units');
  const ids = new Set<string>();
  const occupied = new Set<string>();
  const sideIds = sides.map((s) => s.id);
  const units = list.map((u, i): Unit => {
    const p = `units[${i}]`;
    const o = obj(u, p);
    const id = str(o.id, `${p}.id`);
    if (ids.has(id)) fail(`duplicate unit id "${id}"`);
    ids.add(id);
    const position: Point = { x: int(o.x, `${p}.x`), y: int(o.y, `${p}.y`) };
    const terrain = tileAt(map, position);
    if (terrain === undefined) fail(`${p} position (${position.x},${position.y}) is off the map`);
    if (terrain === 'river') fail(`${p} position (${position.x},${position.y}) is in the river`);
    const key = `${position.x},${position.y}`;
    if (occupied.has(key)) fail(`${p} shares tile (${key}) with another unit`);
    occupied.add(key);
    return {
      id,
      side: oneOf(o.side, sideIds, `${p}.side`),
      name: str(o.name, `${p}.name`),
      position,
      strength: int(o.strength, `${p}.strength`, 1),
      morale: int(o.morale, `${p}.morale`, 0, 100),
      facing: oneOf<Facing>(o.facing, FACINGS, `${p}.facing`),
      intent: { kind: 'idle' },
    };
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
  const sides = parseSides(o.sides);
  const units = parseUnits(o.units, map, sides);

  const v = obj(o.victory, 'victory');
  const obRaw = obj(v.objective, 'victory.objective');
  const objective: Point = {
    x: int(obRaw.x, 'victory.objective.x'),
    y: int(obRaw.y, 'victory.objective.y'),
  };
  if (tileAt(map, objective) !== 'bridge') fail('victory.objective must be on a bridge tile');
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
    victory: {
      objective,
      defender,
      attacker,
      holdMs: int(v.holdMinutes, 'victory.holdMinutes', 1) * MS_PER_MINUTE,
    },
  };
}
