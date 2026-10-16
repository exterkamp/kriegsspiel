import { expect } from 'vitest';
import { MAX_FIELD_SLOPE } from '../src/geography/cover/index.js';
import type { RealismReport } from '../src/realism.js';
import { SHALLOW_WATER } from '../src/geography/shallow.js';

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

/**
 * Fords only on shallow water and minor roads, with low banks and road-grade
 * ramps and approaches; main roads cross water by bridge only (#501, D46).
 */
export function expectPlausibleCrossings(
  report: RealismReport,
  settings: { roads: { maxGrade: number } },
): void {
  const c = report.crossings;
  expect(c.fordsOnMainRoads).toBe(0);
  if (!c.fords) return;
  expect(c.fordMaxDepthM).toBeLessThanOrEqual(SHALLOW_WATER.maxFordDepthM);
  expect(c.fordMaxBankM).toBeLessThanOrEqual(SHALLOW_WATER.maxBankM + 1e-6);
  expect(c.fordMaxRampGrade).toBeLessThanOrEqual(settings.roads.maxGrade + 1e-9);
  expect(c.fordMaxApproachGrade).toBeLessThanOrEqual(settings.roads.maxGrade + 1e-9);
}
