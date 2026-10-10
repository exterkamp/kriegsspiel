import { HARD_LIMITS, type Bounds, type Elevation, type MapSettings } from '../contract.js';
import { fail } from '../errors.js';
import { validateElevationShape } from '../queries.js';
import { preflightAsset } from '../resources.js';
import { parseSettings } from '../validation.js';
import { decimal6 } from './precision.js';

export function requireGridPrecision(bounds: Bounds, spacingM: number): void {
  for (const [path, value] of [
    ['$.bounds.minX', bounds.minX],
    ['$.bounds.minY', bounds.minY],
    ['$.bounds.maxX', bounds.maxX],
    ['$.bounds.maxY', bounds.maxY],
    ['$.elevation.spacingM', spacingM],
  ] as const)
    if (decimal6(value) !== value)
      fail(
        path,
        'Authoritative grid metadata must already be decimal-6-v1 stable; normalize upstream before extraction',
        'UNSUPPORTED_PRECISION',
      );
}

export function checkField(
  elevation: Elevation,
  bounds: Bounds,
  settings: MapSettings,
): MapSettings {
  const s = parseSettings(settings);
  preflightAsset({ elevation, bounds }, { ...HARD_LIMITS, maxSamples: s.limits.maxSamples });
  validateElevationShape(elevation, bounds, s.limits.maxSamples);
  requireGridPrecision(bounds, elevation.spacingM);
  for (let i = 0; i < elevation.samples.length; i++)
    if (decimal6(elevation.samples[i]!) !== elevation.samples[i])
      fail(
        `$.elevation.samples[${i}]`,
        'Authoritative ground must already be decimal-6-v1 stable; normalize upstream before extraction',
        'UNSUPPORTED_PRECISION',
      );
  if (
    bounds.maxX !== s.widthM ||
    bounds.maxY !== s.heightM ||
    elevation.spacingM !== s.sampleSpacingM
  )
    fail('$.elevation', 'Contour field/bounds must match recorded dimensions and spacing');
  return s;
}
