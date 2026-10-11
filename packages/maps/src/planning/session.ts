import { HARD_LIMITS, type GenerationResult, type Point, type Polygon } from '../contract.js';
import { preflightAsset } from '../resources.js';
import { parseSettings } from '../validation.js';
import type { ElevationQueries } from '../queries.js';
import type { CrossingCandidate } from '../geography/types.js';
import { bounded, withCallerErrorIdentity, Work } from './budget.js';
import { Context } from './context.js';
import { footprint, corridor, segmentGrade } from './certificates.js';
import { bridge } from './bridges.js';
import type { CorridorCertificate, DeckProfile, PlanningInput, Suitability } from './types.js';
import { fail } from '../errors.js';

function configurationValue(object: unknown, key: string, path: string): unknown {
  if (
    object === null ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(object))
  )
    fail(path, 'Expected plain configuration object');
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor))
    fail(`${path}.${key}`, 'Hidden/accessor configuration is not JSON data');
  return descriptor.value;
}

/** Private detached surface/index, shared across a bounded composition operation. */
export interface PlanningCertificates {
  readonly work: number;
  footprint(polygon: Polygon): GenerationResult<Suitability>;
  roadSegment(
    a: Point,
    b: Point,
    widthM?: number,
    exit?: 'north' | 'east' | 'south' | 'west',
  ): GenerationResult<CorridorCertificate>;
  directionalGrade(a: Point, b: Point): GenerationResult<number>;
  bridge(candidate: CrossingCandidate, profile?: DeckProfile): GenerationResult<DeckProfile>;
  heightAt(x: number, y: number): number;
  gradientAt(x: number, y: number): ReturnType<ElevationQueries['gradientAt']>;
}

export function createPlanningCertificates(
  input: PlanningInput,
  chargeWork?: (units: number) => void,
): GenerationResult<PlanningCertificates> {
  return bounded(() => {
    const limits = configurationValue(input, 'limits', '$');
    const override =
      limits === undefined
        ? undefined
        : configurationValue(limits, 'maxValidationWork', '$.limits');
    const rawSettings = configurationValue(input, 'settings', '$');
    const settingsLimits = configurationValue(rawSettings, 'limits', '$.settings');
    const topology = configurationValue(settingsLimits, 'maxTopologyChecks', '$.settings.limits');
    if (typeof topology !== 'number' || !Number.isSafeInteger(topology) || topology < 1)
      fail('$.settings.limits.maxTopologyChecks', 'Expected positive safe integer');
    if (override !== undefined && typeof override !== 'number')
      fail('$.limits.maxValidationWork', 'Expected positive safe integer');
    const shared = new Work(
      (override as number | undefined) ?? Math.min(100_000_000, topology * 20),
      'composition certificates',
      chargeWork,
    );
    const charge = () => shared.take();
    const usage = preflightAsset(input, HARD_LIMITS, charge, charge);
    // Reserve the following schema/context traversal before copying the surface.
    shared.take(usage.nodes);
    parseSettings(rawSettings);
    // Context detaches its query samples, parsed settings and water. Certificates
    // also read elevation grid metadata through input, so detach that frame here.
    const c = new Context(
      { ...input, elevation: { ...input.elevation }, bounds: { ...input.bounds } },
      shared,
    );
    const points = (a: Point, b: Point) =>
      preflightAsset({ a, b }, HARD_LIMITS, () => c.validation.take());
    return Object.freeze({
      get work() {
        return shared.used;
      },
      footprint: (p: Polygon) => bounded(() => footprint(c, p)),
      roadSegment: (
        a: Point,
        b: Point,
        width = c.settings.roads.maxReservedWidthM,
        exit?: 'north' | 'east' | 'south' | 'west',
      ) =>
        bounded(() => {
          points(a, b);
          return corridor(c, a, b, width, exit);
        }),
      directionalGrade: (a: Point, b: Point) =>
        bounded(() => {
          points(a, b);
          return segmentGrade(c, a, b);
        }),
      bridge: (candidate: CrossingCandidate, profile?: DeckProfile) =>
        bounded(() => bridge(c, candidate, profile)),
      heightAt: (x: number, y: number) =>
        withCallerErrorIdentity(() => {
          c.validation.take();
          return c.q.heightAt(x, y);
        }),
      gradientAt: (x: number, y: number) =>
        withCallerErrorIdentity(() => {
          c.validation.take();
          return c.q.gradientAt(x, y);
        }),
    });
  });
}
