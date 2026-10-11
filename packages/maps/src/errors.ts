export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}
export class MapValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message} [${i.code}]`).join('\n'));
    this.name = 'MapValidationError';
  }
}
export function fail(path: string, message: string, code = 'INVALID_MAP'): never {
  throw new MapValidationError([{ code, path, message }]);
}
export class TopologyBudget {
  private used = 0;
  constructor(private readonly max: number) {}
  consume(path: string, count = 1): void {
    this.used += count;
    if (this.used > this.max)
      fail(path, `Topology work exceeds ${this.max} checks`, 'RESOURCE_LIMIT');
  }
}
