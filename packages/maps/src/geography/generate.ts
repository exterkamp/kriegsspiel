import {
  infeasible,
  type Bounds,
  type Elevation,
  type GenerationResult,
  type MapSettings,
} from '../contract.js';
import { preflightAsset } from '../resources.js';
import { HARD_LIMITS } from '../contract.js';
import { generateCover } from './cover/index.js';
import { findCrossingCandidates } from './crossings.js';
import { generateHydrology } from './hydrology.js';
import { bounded } from './budget.js';
import type { GeographyLimits, GeographyOutput } from './types.js';

/**
 * Composes geography only; #139 must regenerate contours before infrastructure.
 * With `cover: false` the cover layer is left empty so a caller can lay cover
 * out later around roads and settlements (composition does, see D45).
 */
export function generateGeography(
  elevation: Elevation,
  bounds: Bounds,
  settings: MapSettings,
  seed: number,
  limits: GeographyLimits = {},
  options: { cover?: boolean } = {},
): GenerationResult<GeographyOutput> {
  return bounded<GeographyOutput>(() => {
    const hydro = generateHydrology(elevation, bounds, settings, seed, limits);
    if (!hydro.ok) return hydro;
    const crossings = findCrossingCandidates(
      hydro.value.water,
      bounds,
      settings,
      limits,
      hydro.value.elevation,
    );
    if (!crossings.ok) return crossings;
    let vertices = 0;
    for (const w of hydro.value.water) {
      for (const p of w.polygons)
        vertices += p.outer.length + p.holes.reduce((n, r) => n + r.length, 0);
      if (w.kind === 'river') vertices += w.centreline.length;
    }
    for (const c of crossings.value)
      vertices += 2 + c.deck.outer.length + c.deck.holes.reduce((n, r) => n + r.length, 0);
    const remainingFeatures =
        settings.limits.maxFeatures - hydro.value.water.length - crossings.value.length,
      remainingVertices = settings.limits.maxVertices - vertices;
    if (remainingFeatures < 1 || remainingVertices < 1)
      return infeasible([
        {
          severity: 'error',
          stage: 'hydrology',
          code: 'GEOGRAPHY_RESOURCE_LIMIT',
          constraint: 'aggregate geography output',
          message: 'Water/crossing output leaves no capacity for independent cover.',
        },
      ]);
    const coverSettings = structuredClone(settings);
    coverSettings.limits.maxFeatures = remainingFeatures;
    coverSettings.limits.maxVertices = remainingVertices;
    const cover =
      options.cover === false
        ? { ok: true as const, value: [], diagnostics: [] }
        : generateCover(hydro.value.elevation, bounds, hydro.value.water, coverSettings, seed);
    if (!cover.ok) return cover;
    const output: GeographyOutput = {
      ...hydro.value,
      cover: cover.value,
      crossingCandidates: crossings.value,
    };
    preflightAsset(
      {
        layers: { water: output.water, cover: output.cover },
        crossingCandidates: output.crossingCandidates,
      },
      {
        ...HARD_LIMITS,
        maxFeatures: settings.limits.maxFeatures,
        maxVertices: settings.limits.maxVertices,
      },
    );
    return {
      ok: true,
      value: output,
      diagnostics: [...hydro.diagnostics, ...cover.diagnostics, ...crossings.diagnostics],
    };
  });
}
