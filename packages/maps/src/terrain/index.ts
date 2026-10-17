import { type GenerationResult, type MapSettings, type TerrainOutput } from '../contract.js';
import { extractContours } from './contours.js';
import { generateElevation } from './elevation.js';

export {
  generateElevation,
  reliefShape,
  RELIEF_SHAPE,
  TERRAIN_VERSION,
  type ReliefShape,
} from './elevation.js';
export { extractContours, CONTOUR_VERSION } from './contours.js';
export { validateContourHeights, type ContourHeightEvidence } from './validation.js';

export function generateTerrain(
  settings: MapSettings,
  seed: number,
): GenerationResult<TerrainOutput> {
  const elevation = generateElevation(settings, seed);
  if (!elevation.ok) return elevation;
  const bounds = {
    minX: 0 as const,
    minY: 0 as const,
    maxX: settings.widthM,
    maxY: settings.heightM,
  };
  const contours = extractContours(elevation.value, bounds, settings);
  if (!contours.ok) return contours;
  return {
    ok: true,
    value: { elevation: elevation.value, contours: contours.value },
    diagnostics: [...elevation.diagnostics, ...contours.diagnostics],
  };
}
