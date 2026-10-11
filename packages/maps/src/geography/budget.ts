import { infeasible, type GenerationResult } from '../contract.js';
import { MapValidationError } from '../errors.js';
export class GeographyFailure extends Error {
  constructor(
    readonly code: string,
    readonly constraint: string,
    message: string,
  ) {
    super(message);
  }
}
export class Budget {
  used = 0;
  constructor(
    readonly max: number,
    readonly constraint: string,
  ) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 100_000_000)
      throw new RangeError(`Invalid ${constraint} budget`);
  }
  take(n = 1): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid work charge');
    if (n > this.max - this.used)
      throw new GeographyFailure(
        'GEOGRAPHY_RESOURCE_LIMIT',
        this.constraint,
        `Work exceeds ${this.max} ${this.constraint}.`,
      );
    this.used += n;
  }
}
export function bounded<T>(run: () => GenerationResult<T>): GenerationResult<T> {
  try {
    return run();
  } catch (e) {
    if (e instanceof GeographyFailure)
      return infeasible([
        {
          severity: 'error',
          stage: 'hydrology',
          code: e.code,
          constraint: e.constraint,
          message: e.message,
          remediation: 'Change the recorded geometry settings or increase the bounded work limit.',
        },
      ]);
    if (e instanceof MapValidationError && e.issues.every((i) => i.code === 'RESOURCE_LIMIT'))
      return infeasible(
        e.issues.map((i) => ({
          severity: 'error',
          stage: 'hydrology',
          code: 'GEOGRAPHY_RESOURCE_LIMIT',
          constraint: 'allocation',
          message: i.message,
          path: i.path,
        })),
      );
    throw e;
  }
}
