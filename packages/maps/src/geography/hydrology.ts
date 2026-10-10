import {
  infeasible,
  type Bounds,
  type Elevation,
  type GenerationResult,
  type MapSettings,
} from '../contract.js';
import { deriveSeed } from '../overrides.js';
import { checkField } from '../terrain/input.js';
import { Budget, bounded } from './budget.js';
import { deriveDrainage } from './drainage.js';
import { validateWaterPhysics } from './physics.js';
import { carveRiver, depressionWater } from './water.js';
import { GEOGRAPHY_VERSION, type GeographyLimits, type GeographyOutput } from './types.js';
export type HydrologyStageOutput = Omit<GeographyOutput, 'cover' | 'crossingCandidates'>;
export function generateHydrology(
  elevation: Elevation,
  bounds: Bounds,
  settings: MapSettings,
  seed: number,
  limits: GeographyLimits = {},
): GenerationResult<HydrologyStageOutput> {
  return bounded<HydrologyStageOutput>(() => {
    deriveSeed(seed, GEOGRAPHY_VERSION); // Validate and reserve the versioned hydro stream.
    const s = checkField(elevation, bounds, settings);
    const budget = new Budget(
      limits.maxRegionWork ?? Math.min(100_000_000, s.limits.maxTopologyChecks * 8),
      'water region work',
    );
    budget.take(elevation.samples.length);
    const sourceElevation = { ...elevation, samples: elevation.samples.slice() },
      output = new Budget(s.limits.maxVertices, 'aggregate water vertices');
    const initial = deriveDrainage(sourceElevation, bounds, s, limits);
    if (!initial.ok) return initial;
    const carved = carveRiver(
      sourceElevation,
      bounds,
      initial.value.drainage,
      initial.value.ranks,
      s,
      budget,
      output,
    );
    if (!carved) budget.take(sourceElevation.samples.length);
    const authoritative = carved?.elevation ?? {
      ...sourceElevation,
      samples: sourceElevation.samples.slice(),
    };
    const final = carved ? deriveDrainage(authoritative, bounds, s, limits) : initial;
    if (!final.ok) return final;
    const lakeSettings = structuredClone(s);
    if (carved) lakeSettings.limits.maxFeatures = Math.max(1, s.limits.maxFeatures - 1);
    const lakes = depressionWater(
        authoritative,
        final.value.drainage,
        lakeSettings,
        budget,
        carved?.riverCells,
        output,
      ),
      water = [...(carved?.water ?? []), ...lakes];
    if (water.length > s.limits.maxFeatures)
      return infeasible([
        {
          severity: 'error',
          stage: 'hydrology',
          code: 'GEOGRAPHY_RESOURCE_LIMIT',
          constraint: 'aggregate water features',
          message: 'River and lake output exceed the aggregate feature cap.',
        },
      ]);
    if (s.hydrology.requireRiver && !water.some((w) => w.kind === 'river'))
      return infeasible([
        {
          severity: 'error',
          stage: 'hydrology',
          code: 'RIVER_INFEASIBLE',
          constraint: 'required river',
          message:
            'No qualifying drainage trunk supports the configured grid-aligned channel. Flat ground, threshold, width below four spacings, or disconnected raster banks can prevent carving.',
          remediation:
            'Use the documented river-valley-v1 preset or revise width/spacing/threshold; the seed is never changed.',
        },
      ]);
    const physics = validateWaterPhysics(authoritative, bounds, water, s, limits);
    if (!physics.ok) return physics;
    return {
      ok: true,
      value: {
        version: GEOGRAPHY_VERSION,
        sourceElevation,
        elevation: authoritative,
        groundChanged: !!carved,
        drainage: final.value.drainage,
        water,
        evidence: {
          flood: final.value.evidence,
          regionWork: budget.used,
          physicsWork: physics.value.work,
          ...(carved?.grading ? { shoulder: carved.grading } : {}),
        },
      },
      diagnostics: [
        {
          severity: carved ? 'info' : 'warning',
          stage: 'hydrology',
          code: carved ? 'GROUND_CARVED_REGENERATE_CONTOURS' : 'NO_RIVER_FALLBACK',
          message: carved
            ? 'Authoritative ground changed: regenerate contours from returned elevation. River stage is explicit constant standing/backwater; original samples are retained separately.'
            : 'No supported trunk was carved; depression lakes remain physically checked and no decorative river is emitted.',
        },
      ],
    };
  });
}
