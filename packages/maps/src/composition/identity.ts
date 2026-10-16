import { CONSTRAINT_VERSION } from '@kriegsspiel/settlemaker';
import {
  HARD_LIMITS,
  COORDINATES,
  PRECISION_POLICY,
  SCHEMA_VERSION,
  type MapAsset,
} from '../contract.js';
import { TERRAIN_VERSION, CONTOUR_VERSION } from '../terrain/index.js';
import {
  GEOGRAPHY_VERSION,
  COVER_VERSION,
  LEGACY_COVER_VERSION,
  CROSSING_VERSION,
  LEGACY_CROSSING_VERSION,
  geographyPreset,
  type CrossingPolicy,
} from '../geography/index.js';
import { PLANNING_VERSION, LEGACY_PLANNING_VERSION } from '../planning/index.js';
import { preflightAsset } from '../resources.js';
import { CONSUMED_FORK } from './source.js';
import { COMPOSITION_VERSION, type BattlefieldInput, type BattlefieldPreset } from './types.js';
import { configurationData } from './budget.js';

export const CURRENT_GENERATOR: MapAsset['provenance']['generator'] = Object.freeze({
  id: 'kriegsspiel/maps',
  version: COMPOSITION_VERSION,
  stages: Object.freeze({
    terrain: TERRAIN_VERSION,
    contours: CONTOUR_VERSION,
    hydrology: GEOGRAPHY_VERSION,
    cover: COVER_VERSION,
    roads: PLANNING_VERSION,
    settlements: CONSTRAINT_VERSION,
  }),
  randomPolicy: 'fnv1a-stage-v1',
  runtimePolicy: 'js-binary64-v1',
});
/** Terrain and hydrology from D44 until #540: value noise along one grain, D8 rivers. */
const D44_RELIEF = Object.freeze({
  terrain: 'structured-relief-eroded-v2',
  hydrology: 'flood-carved-stepped-network-v2',
});
/**
 * Generators whose saved maps the current complete validator still certifies,
 * although they can no longer be regenerated: their geometry is checked by the
 * same generator-independent rules, with the crossing deck policy they recorded.
 */
export const LEGACY_GENERATORS: readonly MapAsset['provenance']['generator'][] = Object.freeze([
  // v1 stages (before D44), with rectangle cover.
  Object.freeze({
    ...CURRENT_GENERATOR,
    stages: Object.freeze({
      ...CURRENT_GENERATOR.stages,
      terrain: 'value-noise-ridges-v1',
      hydrology: 'flood-carved-graded-backwater-v1',
      cover: LEGACY_COVER_VERSION,
      roads: 'sites-lattice-decks-v1',
    }),
  }),
  // D44 stages with rectangle cover (before D45).
  Object.freeze({
    ...CURRENT_GENERATOR,
    stages: Object.freeze({
      ...CURRENT_GENERATOR.stages,
      ...D44_RELIEF,
      cover: LEGACY_COVER_VERSION,
      roads: LEGACY_PLANNING_VERSION,
    }),
  }),
  // D45 stages: terrain-following cover, bridges only (before D46 fords).
  Object.freeze({
    ...CURRENT_GENERATOR,
    stages: Object.freeze({
      ...CURRENT_GENERATOR.stages,
      ...D44_RELIEF,
      roads: LEGACY_PLANNING_VERSION,
    }),
  }),
  // D46 stages: fords, on the combed v2 relief and D8 rivers (before #540).
  Object.freeze({
    ...CURRENT_GENERATOR,
    stages: Object.freeze({ ...CURRENT_GENERATOR.stages, ...D44_RELIEF }),
  }),
]);
function recordedIdentity(asset: unknown): MapAsset['provenance']['generator'] | undefined {
  try {
    if (
      configurationData(asset, 'schema') !== 'kriegsspiel/local-map' ||
      configurationData(asset, 'schemaVersion') !== SCHEMA_VERSION ||
      configurationData(asset, 'precisionPolicy') !== PRECISION_POLICY
    )
      return undefined;
    const p = configurationData(asset, 'provenance'),
      generator = configurationData(p, 'generator'),
      fork = configurationData(p, 'fork'),
      coordinates = configurationData(asset, 'coordinates');
    preflightAsset(
      { generator, fork, coordinates },
      { ...HARD_LIMITS, maxNodes: 1000, maxBytes: 16384 },
    );
    if (!equal(coordinates, COORDINATES) || !equal(fork, CONSUMED_FORK)) return undefined;
    return [CURRENT_GENERATOR, ...LEGACY_GENERATORS].find((g) => equal(generator, g));
  } catch {
    return undefined;
  }
}
/** Synchronous check that the current generator can regenerate this recipe exactly. */
export function supportsReplay(asset: unknown): boolean {
  return recordedIdentity(asset) === CURRENT_GENERATOR;
}
/** Synchronous check that the complete validator can certify this saved map (current or legacy generator). */
export function supportsValidation(asset: unknown): boolean {
  return recordedIdentity(asset) !== undefined;
}
/** Crossing deck policy recorded by a supported generator. */
export function crossingPolicyFor(asset: MapAsset): CrossingPolicy {
  return asset.provenance.generator.stages.hydrology === LEGACY_GENERATORS[0]!.stages.hydrology
    ? LEGACY_CROSSING_VERSION
    : CROSSING_VERSION;
}
function equal(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  const left = Object.keys(a).sort(),
    right = Object.keys(b).sort();
  return (
    left.length === right.length &&
    left.every(
      (k, i) =>
        k === right[i] &&
        equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}
export function battlefieldPreset(name: BattlefieldPreset): BattlefieldInput {
  return {
    seed: { 'flat-countryside': 17, 'wooded-hills': 31, 'river-valley': 97 }[name],
    settings: geographyPreset(name),
    overrides: [],
  };
}
export { CONSUMED_FORK } from './source.js';
