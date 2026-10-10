import { expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HARD_LIMITS,
  type GenerationResult,
  type Polygon,
} from '../src/contract.js';
import { preflightAsset } from '../src/resources.js';
import { MapValidationError } from '../src/errors.js';
import { PlanningFailure } from '../src/planning/budget.js';
import {
  createPlanningCertificates,
  certifyFootprint,
  certifyRoadSegment,
  directionalGrade,
  type PlanningInput,
} from '../src/planning/index.js';
const rectangle = (lo: number, hi: number): Polygon => ({
  outer: [
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
    [lo, lo],
  ],
  holes: [],
});
function input(): PlanningInput {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 100;
  return {
    settings,
    seed: 17,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    elevation: {
      columns: 5,
      rows: 5,
      spacingM: 25,
      samples: Array.from({ length: 25 }, (_, i) => (i % 5) * 0.25 + Math.floor(i / 5) * 0.5),
    },
    water: [],
    limits: { maxValidationWork: 1_000_000 },
  };
}
function value<T>(result: GenerationResult<T>): T {
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.value;
}
it('shares existing boundary-exit corridor policy and cumulative work', () => {
  const a = input();
  const certificates = value(createPlanningCertificates(a));
  const before = certificates.work;
  expect(value(certificates.roadSegment([25, 50], [0, 50], 12)).traversable).toBe(false);
  const refused = certificates.work;
  expect(refused).toBeGreaterThan(before);
  const accepted = certificates.roadSegment([25, 50], [0, 50], 12, 'west');
  expect(accepted).toEqual(certifyRoadSegment(a, [25, 50], [0, 50], 12, 'west'));
  expect(value(accepted).traversable).toBe(true);
  expect(certificates.work).toBeGreaterThan(refused);
  expect(value(certificates.roadSegment([25, 50], [0, 50], 12, 'east')).traversable).toBe(false);
});
it('charges an injected caller budget before queries and preserves its exception', () => {
  let active = false;
  const denied = new Error('caller budget exhausted');
  const certificates = value(
    createPlanningCertificates(input(), () => {
      if (active) throw denied;
    }),
  );
  const initial = certificates.work;
  active = true;
  expect(() => certificates.heightAt(25, 25)).toThrow(denied);
  expect(() => certificates.footprint(rectangle(25, 35))).toThrow(denied);
  expect(certificates.work).toBe(initial);
  active = false;
  expect(certificates.heightAt(25, 25)).toBe(0.75);
  expect(certificates.work).toBe(initial + 1);
});
it.each([
  new PlanningFailure('CALLER_FAILURE', 'external budget', 'external failure'),
  new MapValidationError([{ code: 'RESOURCE_LIMIT', path: '$', message: 'external failure' }]),
])('preserves caller error identity even when its class is locally recoverable: %s', (error) => {
  let active = false;
  const certificates = value(
    createPlanningCertificates(input(), () => {
      if (active) throw error;
    }),
  );
  const initial = certificates.work;
  active = true;
  for (const query of [
    () => certificates.footprint(rectangle(25, 35)),
    () => certificates.heightAt(25, 25),
    () => certificates.gradientAt(25, 25),
  ]) {
    let caught;
    try {
      query();
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBe(error);
    expect(certificates.work).toBe(initial);
  }
});
it('reuses the same bilinear certificates with numerical parity and shared work', () => {
  const source = input(),
    certificates = value(createPlanningCertificates(source));
  const before = certificates.work;
  const p = rectangle(25, 35);
  expect(certificates.footprint(p)).toEqual(certifyFootprint(source, p));
  expect(certificates.roadSegment([25, 25], [75, 75])).toEqual(
    certifyRoadSegment(source, [25, 25], [75, 75]),
  );
  expect(certificates.directionalGrade([25, 25], [75, 75])).toEqual(
    directionalGrade(source, [25, 25], [75, 75]),
  );
  expect(certificates.heightAt(25, 25)).toBe(0.75);
  expect(certificates.gradientAt(25, 25)).toEqual({ dx: 0.01, dy: 0.02 });
  expect(certificates.work).toBeGreaterThan(before);
});
it('detaches grid metadata, sample queries, water, bounds and settings from the caller', () => {
  const source = input();
  source.water = [
    { id: 'lake:detached', kind: 'lake', surfaceElevationM: 0, polygons: [rectangle(30, 40)] },
  ];
  const certificates = value(createPlanningCertificates(source));
  source.elevation.samples.fill(100);
  source.elevation.spacingM = 50;
  source.elevation.columns = source.elevation.rows = 3;
  source.water.length = 0;
  source.settings.settlements.maxBuildingGradient = 0;
  source.bounds.maxX = source.bounds.maxY = 1000;
  expect(certificates.heightAt(25, 25)).toBe(0.75);
  expect(value(certificates.footprint(rectangle(32, 35))).reason).toBe('water');
  expect(value(certificates.footprint(rectangle(10, 20))).suitable).toBe(true);
  expect(value(certificates.footprint(rectangle(110, 120))).reason).toBe('bounds');
});
it('preserves aggregate exhaustion across failed and subsequent checks at the exact boundary', () => {
  const source = input(),
    p = rectangle(25, 35);
  const measured = value(createPlanningCertificates(source));
  expect(value(measured.footprint(p)).suitable).toBe(true);
  source.limits!.maxValidationWork = measured.work;
  const exact = value(createPlanningCertificates(source));
  expect(value(exact.footprint(p)).suitable).toBe(true);
  const used = exact.work;
  for (let i = 0; i < 2; i++) {
    expect(exact.footprint(p)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
    expect(exact.work).toBe(used);
  }
});
it('rejects accessor arguments without invoking them in a reused context', () => {
  const certificates = value(createPlanningCertificates(input()));
  let calls = 0;
  const p = Object.defineProperty({ holes: [] }, 'outer', {
    enumerable: true,
    get() {
      calls++;
      return rectangle(25, 35).outer;
    },
  }) as unknown as Polygon;
  expect(() => certificates.footprint(p)).toThrow(/accessor/);
  expect(calls).toBe(0);
  expect(() => certificates.roadSegment([NaN, 25], [75, 75])).toThrow(/finite/);
});
it('exhausts a tiny initialization budget before traversing the numerical field', () => {
  const source = input();
  source.limits!.maxValidationWork = 1;
  let sampleReads = 0;
  const original = Object.getOwnPropertyDescriptor;
  const spy = vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((object, key) => {
    if (object === source.elevation.samples) sampleReads++;
    return original(object, key);
  });
  try {
    expect(createPlanningCertificates(source)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
    expect(sampleReads).toBe(0);
  } finally {
    spy.mockRestore();
  }
});
it('also stops descriptor scanning when a budget expires inside the sample array', () => {
  const source = input();
  let charged = 0,
    firstSampleCharge: number | undefined,
    sampleReads = 0;
  const original = Object.getOwnPropertyDescriptor;
  const spy = vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((object, key) => {
    if (object === source.elevation.samples) {
      firstSampleCharge ??= charged;
      sampleReads++;
    }
    return original(object, key);
  });
  try {
    const charge = () => {
      charged++;
    };
    preflightAsset(source, HARD_LIMITS, charge, charge);
    expect(firstSampleCharge).toBeDefined();
    source.limits!.maxValidationWork = firstSampleCharge! + 2;
    sampleReads = 0;
    expect(createPlanningCertificates(source)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PLANNING_RESOURCE_LIMIT' }],
    });
    expect(sampleReads).toBeGreaterThan(0);
    expect(sampleReads).toBeLessThan(source.elevation.samples.length);
  } finally {
    spy.mockRestore();
  }
});
