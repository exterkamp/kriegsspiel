import { expect } from 'vitest';
import { MAX_FIELD_SLOPE } from '../src/geography/cover/index.js';
import type { RealismReport } from '../src/realism.js';

/** Land cover that follows the ground (#500); shared with the full representative assets. */
export function expectRealisticCover(
  report: RealismReport,
  settings: { cover: { woodFraction: number; fieldFraction: number } },
): void {
  const c = report.cover;
  // Woods take the steeper ground; no field stands above the field slope limit.
  if (report.terrain.reliefM > 5) expect(c.woodMeanSlope).toBeGreaterThan(c.fieldMeanSlope);
  expect(c.fieldMaxSlope).toBeLessThanOrEqual(MAX_FIELD_SLOPE);
  // Fields lie nearer the settlements than woods do.
  expect(c.fieldMeanSettlementDistanceM).toBeLessThan(c.woodMeanSettlementDistanceM);
  // Coverage within three points of the recipe's shares.
  expect(Math.abs(c.woodShare - settings.cover.woodFraction)).toBeLessThanOrEqual(0.03);
  expect(Math.abs(c.fieldShare - settings.cover.fieldFraction)).toBeLessThanOrEqual(0.03);
  // Organic outlines: land boundaries are not lattice staircases. Outlines
  // along water keep the conservative cell mask, so the overall share allows them.
  expect(c.sharedAxisAlignedShare).toBeLessThan(0.05);
  expect(c.axisAlignedShare).toBeLessThan(0.25);
  // River flats are meadow, not wood.
  if (c.riverFlatPoints > 50) {
    expect(c.riverFlatOpenShare).toBeGreaterThan(0.6);
    expect(c.riverFlatWoodShare).toBeLessThan(0.3);
  }
}
