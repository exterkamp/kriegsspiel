export * from './types.js';
export { deriveDrainage, accumulateFlow, streamSamples } from './drainage.js';
export { generateHydrology, type HydrologyStageOutput } from './hydrology.js';
export { validateWaterPhysics } from './physics.js';
export {
  crossingCandidate,
  validateCrossingCandidate,
  findCrossingCandidates,
} from './crossings.js';
export { geographyPreset, GEOGRAPHY_PRESET_VERSION } from './presets.js';
export { generateGeography } from './generate.js';
export { generateCover, COVER_VERSION } from './cover/index.js';
export { createGeographyQueries, type GeographyQueries } from './queries.js';

export { SHOULDER_POLICY, type ShoulderEvidence } from './shoulders.js';
