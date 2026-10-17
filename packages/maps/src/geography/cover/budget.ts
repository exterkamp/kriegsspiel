import { infeasible, type Diagnostic, type GenerationResult } from '../../contract.js';
import { TopologyBudget } from '../../errors.js';

export class CoverLimit extends Error {
  constructor(
    readonly constraint: string,
    message: string,
  ) {
    super(message);
  }
}
export class CoverWork {
  private used = 0;
  constructor(readonly maximum: number) {}
  reserve(count: number, constraint: string): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.maximum - this.used)
      throw new CoverLimit(
        constraint,
        `Cover work reservation ${count} exceeds remaining ${this.maximum - this.used} of ${this.maximum}.`,
      );
    this.used += count;
  }
}
export function coverDiagnostic(
  code: string,
  message: string,
  severity: Diagnostic['severity'] = 'info',
): Diagnostic {
  return {
    stage: 'cover',
    code,
    message,
    severity,
    constraint: 'cover',
    remediation:
      'Adjust cover density/coherence or the recorded stage limits; inspect water masking and field suitability.',
  };
}
export function boundedCover<T>(operation: () => GenerationResult<T>): GenerationResult<T> {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof CoverLimit)) throw error;
    return infeasible([
      { ...coverDiagnostic('COVER_LIMIT', error.message, 'error'), constraint: error.constraint },
    ]);
  }
}
/** Frozen geometry queries metered against the cover work reservation. */
export class MeteredTopology extends TopologyBudget {
  constructor(private readonly work: CoverWork) {
    super(Number.MAX_SAFE_INTEGER);
  }
  override consume(_path: string, count = 1): void {
    this.work.reserve(count, 'cover geometry queries');
  }
}
