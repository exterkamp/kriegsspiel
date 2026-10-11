import {
  AssetSchema,
  BoundsSchema,
  HARD_LIMITS,
  type Bounds,
  type Elevation,
  type MapSettings,
  type Water,
} from '../../contract.js';
import { validateElevationShape } from '../../queries.js';
import { validatePolygon, polygonsOverlap } from '../../geometry.js';
import { TopologyBudget } from '../../errors.js';
import { parseSettings } from '../../validation.js';
import { preflightAsset } from '../../resources.js';
import { CoverWork } from './budget.js';

export const decimal6 = (value: number): number => (value === 0 ? 0 : Number(value.toFixed(6)));
function requireStable(value: number, path: string): void {
  if (decimal6(value) !== value)
    throw new RangeError(`${path} must already be decimal-6-v1 stable`);
}
export function checkInput(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
): { settings: MapSettings; water: Water[]; work: CoverWork } {
  preflightAsset({ elevation, bounds, settings, layers: { water } }, { ...HARD_LIMITS });
  const s = parseSettings(settings);
  BoundsSchema.parse(bounds);
  validateElevationShape(elevation, bounds, s.limits.maxSamples);
  if (
    bounds.maxX !== s.widthM ||
    bounds.maxY !== s.heightM ||
    elevation.spacingM !== s.sampleSpacingM
  )
    throw new RangeError('Cover ground/bounds must match recorded settings');
  requireStable(bounds.maxX, 'bounds.maxX');
  requireStable(bounds.maxY, 'bounds.maxY');
  requireStable(elevation.spacingM, 'elevation.spacingM');
  for (const z of elevation.samples) requireStable(z, 'elevation.samples');
  if (Math.max(bounds.maxX, bounds.maxY) / s.cover.coherenceM > 0x7ffffffe)
    throw new RangeError('Cover coherence is outside the supported signed noise lattice');
  const parsed = AssetSchema.shape.layers.shape.water.parse(water);
  const work = new CoverWork(s.limits.maxTopologyChecks);
  let validationWork = 0;
  for (const f of parsed) {
    let vertices = 0;
    for (const p of f.polygons)
      vertices += p.outer.length + p.holes.reduce((n, h) => n + h.length, 0);
    validationWork += vertices * vertices * 2;
  }
  work.reserve(validationWork + elevation.samples.length, 'input water topology/ground scan');
  const topology = new TopologyBudget(Math.max(1, validationWork));
  const ids = new Set<string>();
  for (const f of parsed) {
    if (ids.has(f.id)) throw new RangeError('Duplicate water feature ID');
    ids.add(f.id);
    for (const [i, p] of f.polygons.entries()) {
      for (const ring of [p.outer, ...p.holes])
        for (const [x, y] of ring) {
          requireStable(x, 'water.x');
          requireStable(y, 'water.y');
          if (x < 0 || y < 0 || x > bounds.maxX || y > bounds.maxY)
            throw new RangeError('Water polygon leaves cover bounds');
        }
      validatePolygon(p, `$.water.${f.id}.polygons[${i}]`, topology);
    }
    for (let i = 0; i < f.polygons.length; i++)
      for (let j = 0; j < i; j++) {
        const a = f.polygons[i]!,
          b = f.polygons[j]!;
        if (polygonsOverlap(a, b, topology, `$.water.${f.id}.polygons`))
          throw new RangeError('Water multipolygon components touch or overlap');
      }
  }
  return { settings: s, water: parsed, work };
}
