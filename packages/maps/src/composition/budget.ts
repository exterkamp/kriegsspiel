import { infeasible, type GenerationResult } from '../contract.js';
import { MapValidationError } from '../errors.js';
import { DEFAULT_COMPOSITION_LIMITS, type CompositionLimits } from './types.js';

export class CompositionFailure extends Error {
  constructor(
    readonly code: string,
    readonly constraint: string,
    message: string,
    readonly featureId?: string,
  ) {
    super(message);
  }
}
export class Meter {
  used = 0;
  constructor(
    readonly max: number,
    readonly name: string,
  ) {}
  get remaining(): number {
    return this.max - this.used;
  }
  take(n = 1): void {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError('Work reservation must be a nonnegative integer');
    if (n > this.remaining) {
      this.used = this.max;
      throw new CompositionFailure(
        'COMPOSITION_RESOURCE_LIMIT',
        this.name,
        `Work reservation ${n} exceeds remaining capacity.`,
      );
    }
    this.used += n;
  }
}
export function compositionLimits(input: Partial<CompositionLimits> = {}): CompositionLimits {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError('Expected plain composition limits');
  const result = { ...DEFAULT_COMPOSITION_LIMITS };
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !Object.hasOwn(result, key))
      throw new TypeError('Unknown composition limit');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!descriptor.enumerable || !('value' in descriptor))
      throw new TypeError('Composition limits must be data properties');
    const value = descriptor.value;
    if (!Number.isSafeInteger(value) || value < 1 || value > result[key as keyof CompositionLimits])
      throw new TypeError(`Invalid composition limit ${key}`);
    result[key as keyof CompositionLimits] = value;
  }
  return result;
}
export function configurationData(input: unknown, key: string): unknown {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError('Expected plain configuration object');
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor))
    throw new TypeError('Configuration accessors/hidden properties are unsupported');
  return descriptor.value;
}
export function bounded<T>(run: () => T | GenerationResult<T>): GenerationResult<T> {
  try {
    const value = run();
    if (value && typeof value === 'object' && 'ok' in value) return value as GenerationResult<T>;
    return { ok: true, value: value as T, diagnostics: [] };
  } catch (e) {
    if (e instanceof CompositionFailure)
      return infeasible([
        {
          severity: 'error',
          stage: 'validation',
          code: e.code,
          constraint: e.constraint,
          message: e.message.slice(0, 512),
          ...(e.featureId ? { featureId: e.featureId } : {}),
        },
      ]);
    if (e instanceof MapValidationError && e.issues.every((i) => i.code === 'RESOURCE_LIMIT'))
      return infeasible(
        e.issues.map((i) => ({
          severity: 'error',
          stage: 'validation',
          code: 'COMPOSITION_RESOURCE_LIMIT',
          message: i.message,
          path: i.path,
        })),
      );
    throw e;
  }
}
export function requireValue<T>(r: GenerationResult<T>): T {
  if (!r.ok)
    throw new CompositionFailure(
      r.diagnostics[0]!.code,
      r.diagnostics[0]!.constraint ?? 'complete certificate',
      r.diagnostics.map((d) => d.message).join('; '),
    );
  return r.value;
}
