import { speedFactor } from './fatigue.js';
import {
  FORMATIONS,
  MS_PER_MINUTE,
  UNIT_KINDS,
  type Formation,
  type Unit,
  type UnitKind,
} from './types.js';

/**
 * What a formation does, the same for every unit type. Multipliers are relative to a unit in
 * `line`, the baseline. See docs/rules.md ("Unit types and formations") for the sources and
 * for which of these numbers are simplifications.
 */
export interface FormationRules {
  /** Ground per man, as a multiple of the unit type's `areaPerMan`. */
  areaFactor: number;
  /** Frontage divided by depth. */
  aspect: number;
  /** Multiplier on march speed. */
  moveFactor: number;
  /** Multiplier on the casualties this formation's own fire causes. */
  fireFactor: number;
  /** Multiplier on casualties taken from fire. */
  fireVulnerability: number;
  /** Multiplier on casualties taken in melee. */
  meleeVulnerability: number;
}

/** One kind of unit: its stats, and which formations it may take. */
export interface UnitType {
  id: string;
  name: string;
  /** The arm: what it is for sight, charge and the umpire. */
  kind: UnitKind;
  /** Ground per man in square metres when in `line`. */
  areaPerMan: number;
  /** Metres covered per game minute on cost-1 ground, in the baseline formation. */
  marchMetresPerMinute: number;
  /** Casualties per tick as a fraction of strength, at a die of 3.5 and morale 100%. */
  fireRate: number;
  /** How far it can hurt an enemy, in metres. */
  rangeM: number;
  /** Cavalry only: how far from a target it closes to melee, in metres. */
  chargeM?: number;
  /** How far it sees in clear weather, in metres. */
  sightRangeM: number;
  /** 0..1: how well drilled the unit is. Well-trained units understand orders (fewer garbled). */
  training: number;
  /** A unit whose morale falls below this breaks and withdraws. */
  breakMorale: number;
  /** Game ms it stands still to change formation. */
  formationChangeMs: number;
  /** The formation a scenario unit starts in unless it says otherwise. */
  defaultFormation: Formation;
  /** The formations it may take. */
  formations: Formation[];
}

export type UnitTypeCatalogue = Record<string, UnitType>;
export type FormationTable = Record<Formation, FormationRules>;

export interface UnitData {
  formations: FormationTable;
  unitTypes: UnitType[];
}

/**
 * The shipped rules data. It is plain data, checked by `parseUnitData` like any other input.
 *
 * Sources and simplifications (docs/rules.md): infantry march at the 1824 route-march rate
 * of 200 paces per 2-minute move (about 100 m a minute), closed cavalry at the 600-pace trot
 * (about 300 m a minute); skirmishers and foot artillery are our own figures. Ground per man
 * for line infantry follows the troop-symbol block (450 men, 125 x 75 paces). Fire rates,
 * ranges, formation multipliers and change times are placeholders until they are fitted to
 * the fire and casualty tables.
 */
export const UNIT_DATA: UnitData = {
  formations: {
    line: {
      areaFactor: 1,
      aspect: 12,
      moveFactor: 1,
      fireFactor: 1,
      fireVulnerability: 1,
      meleeVulnerability: 1,
    },
    column: {
      areaFactor: 1,
      aspect: 0.15,
      moveFactor: 1.25,
      fireFactor: 0.4,
      fireVulnerability: 1.4,
      meleeVulnerability: 1.2,
    },
    square: {
      areaFactor: 1.3,
      aspect: 1,
      moveFactor: 0.5,
      fireFactor: 0.6,
      fireVulnerability: 1.1,
      meleeVulnerability: 0.4,
    },
    skirmish: {
      areaFactor: 20,
      aspect: 25,
      moveFactor: 1,
      fireFactor: 0.8,
      fireVulnerability: 0.5,
      meleeVulnerability: 1.5,
    },
    loose: {
      areaFactor: 20,
      aspect: 4,
      moveFactor: 1,
      fireFactor: 0.8,
      fireVulnerability: 0.6,
      meleeVulnerability: 1.3,
    },
  },
  unitTypes: [
    {
      id: 'line_infantry',
      name: 'Line infantry',
      kind: 'infantry',
      areaPerMan: 1.2,
      marchMetresPerMinute: 100,
      fireRate: 0.03,
      rangeM: 200,
      sightRangeM: 600,
      training: 0.5,
      breakMorale: 25,
      formationChangeMs: 2 * MS_PER_MINUTE,
      defaultFormation: 'line',
      formations: ['line', 'column', 'square', 'skirmish', 'loose'],
    },
    {
      id: 'skirmishers',
      name: 'Skirmishers',
      kind: 'infantry',
      areaPerMan: 1.2,
      marchMetresPerMinute: 125,
      fireRate: 0.02,
      rangeM: 250,
      sightRangeM: 700,
      training: 0.6,
      breakMorale: 35,
      formationChangeMs: MS_PER_MINUTE,
      defaultFormation: 'skirmish',
      formations: ['line', 'column', 'skirmish', 'loose'],
    },
    {
      id: 'cavalry',
      name: 'Cavalry',
      kind: 'cavalry',
      areaPerMan: 4,
      marchMetresPerMinute: 300,
      fireRate: 0.06,
      rangeM: 100,
      chargeM: 60,
      sightRangeM: 800,
      training: 0.6,
      breakMorale: 25,
      formationChangeMs: MS_PER_MINUTE,
      defaultFormation: 'line',
      formations: ['line', 'column', 'loose'],
    },
    {
      id: 'artillery',
      name: 'Artillery',
      kind: 'artillery',
      areaPerMan: 10,
      marchMetresPerMinute: (100 * 2) / 3,
      fireRate: 0.04,
      rangeM: 400,
      sightRangeM: 600,
      training: 0.7,
      breakMorale: 25,
      formationChangeMs: 3 * MS_PER_MINUTE,
      defaultFormation: 'line',
      formations: ['line', 'column'],
    },
  ],
};

export class UnitDataError extends Error {
  constructor(message: string) {
    super(`unit data: ${message}`);
    this.name = 'UnitDataError';
  }
}

const fail = (msg: string): never => {
  throw new UnitDataError(msg);
};

function rec(v: unknown, p: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${p} must be an object`);
  return v as Record<string, unknown>;
}

function pos(v: unknown, p: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
    fail(`${p} must be a positive number`);
  return v as number;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], p: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(`${p} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

/** Check raw unit data (e.g. parsed JSON) and return it typed, or throw `UnitDataError`. */
export function parseUnitData(raw: unknown): UnitData {
  const o = rec(raw, 'data');
  const ft = rec(o.formations, 'formations');
  const formations = {} as FormationTable;
  for (const f of FORMATIONS) {
    const r = rec(ft[f], `formations.${f}`);
    formations[f] = {
      areaFactor: pos(r.areaFactor, `formations.${f}.areaFactor`),
      aspect: pos(r.aspect, `formations.${f}.aspect`),
      moveFactor: pos(r.moveFactor, `formations.${f}.moveFactor`),
      fireFactor: pos(r.fireFactor, `formations.${f}.fireFactor`),
      fireVulnerability: pos(r.fireVulnerability, `formations.${f}.fireVulnerability`),
      meleeVulnerability: pos(r.meleeVulnerability, `formations.${f}.meleeVulnerability`),
    };
  }
  for (const k of Object.keys(ft)) oneOf(k, FORMATIONS, `formations.${k}`);
  if (!Array.isArray(o.unitTypes) || o.unitTypes.length === 0) {
    fail('unitTypes must be a non-empty array');
  }
  const seen = new Set<string>();
  const unitTypes = (o.unitTypes as unknown[]).map((t, i): UnitType => {
    const p = `unitTypes[${i}]`;
    const r = rec(t, p);
    if (typeof r.id !== 'string' || !/^[a-z0-9_]+$/.test(r.id))
      fail(`${p}.id must be a snake_case string`);
    const id = r.id as string;
    if (seen.has(id)) fail(`duplicate unit type "${id}"`);
    seen.add(id);
    if (typeof r.name !== 'string' || r.name === '') fail(`${p}.name must be a string`);
    if (!Array.isArray(r.formations) || r.formations.length === 0) {
      fail(`${p}.formations must be a non-empty array`);
    }
    const allowed = (r.formations as unknown[]).map((f, k) =>
      oneOf(f, FORMATIONS, `${p}.formations[${k}]`),
    );
    const defaultFormation = oneOf(r.defaultFormation, FORMATIONS, `${p}.defaultFormation`);
    if (!allowed.includes(defaultFormation)) {
      fail(`${p}.defaultFormation "${defaultFormation}" is not in its formations`);
    }
    const kind = oneOf(r.kind, UNIT_KINDS, `${p}.kind`);
    if (kind === 'cavalry' && r.chargeM === undefined) fail(`${p}.chargeM is required for cavalry`);
    const breakMorale = pos(r.breakMorale, `${p}.breakMorale`);
    if (breakMorale > 100) fail(`${p}.breakMorale must be at most 100`);
    const training = r.training as number;
    if (typeof training !== 'number' || !(training >= 0 && training <= 1))
      fail(`${p}.training must be a number from 0 to 1`);
    const ms = pos(r.formationChangeMs, `${p}.formationChangeMs`);
    if (!Number.isInteger(ms)) fail(`${p}.formationChangeMs must be a whole number of ms`);
    return {
      id,
      name: r.name as string,
      kind,
      areaPerMan: pos(r.areaPerMan, `${p}.areaPerMan`),
      marchMetresPerMinute: pos(r.marchMetresPerMinute, `${p}.marchMetresPerMinute`),
      fireRate: pos(r.fireRate, `${p}.fireRate`),
      rangeM: pos(r.rangeM, `${p}.rangeM`),
      ...(r.chargeM === undefined ? {} : { chargeM: pos(r.chargeM, `${p}.chargeM`) }),
      sightRangeM: pos(r.sightRangeM, `${p}.sightRangeM`),
      training,
      breakMorale,
      formationChangeMs: ms,
      defaultFormation,
      formations: allowed,
    };
  });
  for (const k of UNIT_KINDS) {
    if (!unitTypes.some((t) => t.kind === k)) fail(`no unit type has kind "${k}"`);
  }
  return { formations, unitTypes };
}

/** Build a catalogue keyed by id from checked data. */
export function catalogueOf(data: UnitData): UnitTypeCatalogue {
  return Object.fromEntries(data.unitTypes.map((t) => [t.id, t]));
}

const DATA = parseUnitData(UNIT_DATA);

/** The shipped formation rules. */
export const FORMATION_RULES: FormationTable = DATA.formations;
/** The shipped unit types by id. */
export const UNIT_TYPES: UnitTypeCatalogue = catalogueOf(DATA);

/** The first shipped type of each arm: what a scenario that names only a `kind` gets. */
export const DEFAULT_TYPE_OF_KIND: Record<UnitKind, string> = Object.fromEntries(
  UNIT_KINDS.map((k) => [k, DATA.unitTypes.find((t) => t.kind === k)!.id]),
) as Record<UnitKind, string>;

/** The type of a unit (or of an arm, meaning its default type). Throws for an unknown id. */
export function unitTypeOf(u: Pick<Unit, 'type' | 'kind'> | UnitKind): UnitType {
  const id = typeof u === 'string' ? DEFAULT_TYPE_OF_KIND[u] : u.type;
  const t = UNIT_TYPES[id];
  if (!t) throw new UnitDataError(`unknown unit type "${id}"`);
  return t;
}

/**
 * Game ms to march one metre of cost-1 ground. A bare arm marches at its type's base speed;
 * a unit's pace and fatigue (fatigue.ts) change its own.
 */
export function msPerMetreOf(
  u:
    | (Pick<Unit, 'type' | 'kind' | 'formation'> & Partial<Pick<Unit, 'pace' | 'fatigue'>>)
    | UnitKind,
): number {
  const base = MS_PER_MINUTE / unitTypeOf(u).marchMetresPerMinute;
  return typeof u === 'string'
    ? base
    : base / (FORMATION_RULES[u.formation].moveFactor * speedFactor(u));
}
