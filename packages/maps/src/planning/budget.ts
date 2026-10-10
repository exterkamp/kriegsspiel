import { infeasible, type GenerationResult } from '../contract.js';
import { MapValidationError, TopologyBudget } from '../errors.js';
export class PlanningFailure extends Error {
  constructor(
    readonly code: string,
    readonly constraint: string,
    message: string,
  ) {
    super(message);
  }
}
export class Work {
  used = 0;
  constructor(
    readonly max: number,
    readonly label: string,
  ) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 100_000_000)
      throw new RangeError(`Invalid ${label} limit`);
  }
  take(n = 1): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid work charge');
    if (n > this.max - this.used)
      throw new PlanningFailure(
        'PLANNING_RESOURCE_LIMIT',
        this.label,
        `Work exceeds ${this.max} ${this.label}.`,
      );
    this.used += n;
  }
}
export class Meter extends TopologyBudget {
  constructor(private readonly work: Work) {
    super(Number.MAX_SAFE_INTEGER);
  }
  override consume(_path: string, count = 1): void {
    this.work.take(count);
  }
}
export function bounded<T>(f: () => T): GenerationResult<T> {
  try {
    return { ok: true, value: f(), diagnostics: [] };
  } catch (e) {
    if (e instanceof PlanningFailure)
      return infeasible([
        {
          severity: 'error',
          stage: 'roads',
          code: e.code,
          constraint: e.constraint,
          message: e.message,
          remediation:
            'Change the recorded constraints or bounded work limits; no partial plan was returned.',
        },
      ]);
    if (e instanceof MapValidationError && e.issues.every((i) => i.code === 'RESOURCE_LIMIT'))
      return infeasible(
        e.issues.map((i) => ({
          severity: 'error',
          stage: 'roads',
          code: 'PLANNING_RESOURCE_LIMIT',
          constraint: 'input allocation',
          message: i.message,
          path: i.path,
        })),
      );
    throw e;
  }
}
