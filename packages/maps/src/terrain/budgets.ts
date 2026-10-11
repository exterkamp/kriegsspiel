import { infeasible, type Diagnostic, type GenerationResult } from '../contract.js';
import { MapValidationError } from '../errors.js';

export class TerrainLimit extends Error {
  constructor(
    readonly stage: 'terrain' | 'contours',
    readonly constraint: string,
    message: string,
  ) {
    super(message);
  }
}
export class WorkBudget {
  used = 0;
  constructor(
    readonly max: number,
    readonly stage: 'terrain' | 'contours',
    readonly constraint: string,
  ) {}
  take(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.max - this.used)
      throw new TerrainLimit(
        this.stage,
        this.constraint,
        `Requested work exceeds ${this.max} ${this.constraint}.`,
      );
    this.used += count;
  }
}
export function bounded<T>(
  stage: 'terrain' | 'contours',
  run: () => GenerationResult<T>,
): GenerationResult<T> {
  try {
    return run();
  } catch (error) {
    if (error instanceof TerrainLimit)
      return infeasible([
        {
          severity: 'error',
          stage: error.stage,
          code: 'TERRAIN_RESOURCE_LIMIT',
          message: error.message,
          constraint: error.constraint,
          remediation:
            'Reduce extent/relief, increase contour interval/tolerance, or raise the bounded recipe budget.',
        },
      ]);
    if (
      error instanceof MapValidationError &&
      error.issues.every((i) => i.code === 'RESOURCE_LIMIT')
    )
      return infeasible(
        error.issues.map((i) => ({
          severity: 'error',
          stage,
          code: 'TERRAIN_RESOURCE_LIMIT',
          message: i.message,
          path: i.path,
          constraint: 'allocation',
          remediation: 'Reduce sample/planning density or increase the bounded recipe budget.',
        })),
      );
    throw error;
  }
}
export function information(
  stage: 'terrain' | 'contours',
  code: string,
  message: string,
): Diagnostic {
  return { severity: 'info', stage, code, message };
}
