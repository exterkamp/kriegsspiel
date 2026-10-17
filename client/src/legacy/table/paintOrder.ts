import type { BaseFeature, FeatureKind } from './types.js';

/** Legacy fixture defaults; approved native descriptors always supply their own layer. */
const LEGACY_LAYER: Record<FeatureKind, number> = {
  field: 0,
  marsh: 1,
  wood: 1,
  road: 2,
  building: 2,
  water: 3,
  stream: 3,
  river: 3,
  ford: 4,
  bridge: 4,
};

/** Later entries paint on top. Returns a new array without changing features. */
export function paintOrder(features: readonly BaseFeature[]): BaseFeature[] {
  return features
    .map((feature, index) => ({ feature, index }))
    .sort((a, b) => {
      const layer =
        (a.feature.layer ?? LEGACY_LAYER[a.feature.kind]) -
        (b.feature.layer ?? LEGACY_LAYER[b.feature.kind]);
      if (layer) return layer;
      const aNative = a.feature.layer !== undefined;
      const bNative = b.feature.layer !== undefined;
      // Keep mixed inputs deterministic too: explicit features cover implicit
      // ones at the same effective layer, rather than creating a cyclic tie.
      if (aNative !== bNative) return aNative ? 1 : -1;
      if (aNative && a.feature.id !== b.feature.id) return a.feature.id < b.feature.id ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ feature }) => feature);
}
