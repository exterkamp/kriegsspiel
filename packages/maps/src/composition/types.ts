import type { GenerationResult, MapAsset, MapOverride, MapSettings } from '../contract.js';

export const COMPOSITION_VERSION = 'complete-frontage-access-v1' as const;
export const COMPLETE_VALIDATION_VERSION = 'complete-map-v1' as const;
export interface BattlefieldInput {
  seed: number;
  settings: MapSettings;
  overrides?: MapOverride[];
  /** Deterministic operational limits; lower limits never change successful geometry. */
  limits?: Partial<CompositionLimits>;
}
export interface CompositionLimits {
  maxConstraintWork: number;
  maxValidationWork: number;
}
export const DEFAULT_COMPOSITION_LIMITS: Readonly<CompositionLimits> = Object.freeze({
  maxConstraintWork: 200_000_000,
  maxValidationWork: 100_000_000,
});
export interface CompleteValidation {
  version: typeof COMPLETE_VALIDATION_VERSION;
  connected: true;
  sites: number;
  buildings: number;
  assignedPopulation: number;
  validationWork: number;
}
export type BattlefieldResult = GenerationResult<MapAsset>;
export type CompleteValidationResult = GenerationResult<CompleteValidation>;
export type BattlefieldPreset = 'flat-countryside' | 'wooded-hills' | 'river-valley';
