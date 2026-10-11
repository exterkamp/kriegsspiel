import { DEFAULT_SETTINGS, type MapSettings } from '../contract.js';
export const GEOGRAPHY_PRESET_VERSION = 'geography-presets-v1' as const;
/** Versioned, fully materialized settings. No seed choice or generation retries. */
export function geographyPreset(
  name: 'flat-countryside' | 'wooded-hills' | 'river-valley',
): MapSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.widthM = s.heightM = 5000;
  if (name === 'flat-countryside') {
    s.terrain.reliefM = 0;
    s.cover.woodFraction = 0.15;
    s.cover.fieldFraction = 0.6;
  } else if (name === 'wooded-hills') {
    s.terrain.reliefM = 120;
    s.terrain.featureScaleM = 1000;
    s.cover.woodFraction = 0.65;
    s.cover.fieldFraction = 0.1;
  } else if (name === 'river-valley') {
    s.terrain.reliefM = 60;
    s.terrain.roughness = 0.35;
    s.terrain.featureScaleM = 1000;
    s.hydrology.requireRiver = true;
    s.hydrology.riverThresholdSamples = 100;
    // Coarse grid banks need four spacings. The actual polygon is a conservative
    // subset of the max-width capsule; widths are fully explicit in the recipe.
    s.hydrology.minRiverWidthM = 20;
    s.hydrology.maxRiverWidthM = 100;
    s.roads.maxReservedWidthM = 8;
    s.roads.minimumAbutmentM = 3;
    s.roads.maxCrossingSpanM = 150;
    s.cover.coherenceM = 1000; // Bound water-mask work for the long coarse-grid trunk.
    s.cover.woodFraction = 0.3;
    s.cover.fieldFraction = 0.4;
  } else throw new RangeError('Unknown geography preset');
  return s;
}
