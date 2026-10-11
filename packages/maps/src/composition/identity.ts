import { CONSTRAINT_VERSION } from '@kriegsspiel/settlemaker';
import {
  HARD_LIMITS,
  COORDINATES,
  PRECISION_POLICY,
  SCHEMA_VERSION,
  type MapAsset,
} from '../contract.js';
import { TERRAIN_VERSION, CONTOUR_VERSION } from '../terrain/index.js';
import { GEOGRAPHY_VERSION, COVER_VERSION, geographyPreset } from '../geography/index.js';
import { PLANNING_VERSION } from '../planning/index.js';
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
/** Synchronous identity support check, independent of generation/physical validation. */
export function supportsReplay(asset: unknown): boolean {
  try {
    if (
      configurationData(asset, 'schema') !== 'kriegsspiel/local-map' ||
      configurationData(asset, 'schemaVersion') !== SCHEMA_VERSION ||
      configurationData(asset, 'precisionPolicy') !== PRECISION_POLICY
    )
      return false;
    const p = configurationData(asset, 'provenance'),
      generator = configurationData(p, 'generator'),
      fork = configurationData(p, 'fork'),
      coordinates = configurationData(asset, 'coordinates');
    preflightAsset(
      { generator, fork, coordinates },
      { ...HARD_LIMITS, maxNodes: 1000, maxBytes: 16384 },
    );
    return (
      equal(coordinates, COORDINATES) &&
      equal(generator, CURRENT_GENERATOR) &&
      equal(fork, CONSUMED_FORK)
    );
  } catch {
    return false;
  }
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
