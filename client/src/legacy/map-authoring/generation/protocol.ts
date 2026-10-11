import {
  DiagnosticSchema,
  OverrideSchema,
  parseAsset,
  parseSettings,
  type Diagnostic,
  type GenerationResult,
  type MapAsset,
  type MapOverride,
  type MapSettings,
} from '@kriegsspiel/maps';

export const GENERATION_PROTOCOL_VERSION = 1;
export type ReadonlyData<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
  : T;
export interface ReplayParameters {
  seed: number;
  settings: MapSettings;
  overrides: MapOverride[];
}
export interface GenerateRequest extends ReplayParameters {
  v: 1;
  type: 'generate';
  requestId: number;
}
export interface Progress {
  stage: Diagnostic['stage'];
  fraction: number;
  message: string;
}
export interface LifecycleError {
  kind: 'protocol' | 'programming' | 'worker' | 'timeout' | 'invalid-input';
  code: string;
  message: string;
}
interface Envelope {
  v: 1;
  requestId: number;
}
export type WorkerResponse = Envelope &
  (
    | { type: 'progress'; progress: Progress }
    | { type: 'candidate'; asset: MapAsset; diagnostics: Diagnostic[] }
    | { type: 'infeasible'; diagnostics: Diagnostic[] }
    | { type: 'error'; error: LifecycleError }
  );
export type ValidationOutcome =
  | { ok: true; diagnostics: Diagnostic[] }
  | { ok: false; kind: 'infeasible'; diagnostics: Diagnostic[] };

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Check descriptors before schema parsers: no getters, custom prototypes or cycles. */
export function checkJson(input: unknown): void {
  let nodes = 0;
  let bytes = 0;
  function stringBytes(value: string): number {
    if (value.length > 64 * 1024 * 1024) throw new ProtocolError('String bound exceeded');
    let size = 2;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 32)
        size += 6; // Conservative for short control-character escapes.
      else if (code === 34 || code === 92) size += 2;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff
      ) {
        size += 4;
        i++;
      } else size += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
    }
    return size;
  }
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++nodes > 6_000_000 || depth > 32) throw new ProtocolError('JSON work limit exceeded');
    if (typeof value === 'string') {
      // Count UTF-8/JSON bytes without allocating a second encoded string.
      bytes += stringBytes(value);
    } else if (value === null || typeof value === 'boolean') bytes += 5;
    else if (typeof value === 'number' && Number.isFinite(value)) bytes += String(value).length;
    else if (typeof value === 'object' && value !== null) {
      const array = Array.isArray(value);
      if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
        throw new ProtocolError('Expected plain JSON data');
      }
      if (array && value.length > 6_000_000) throw new ProtocolError('Array limit exceeded');
      if (ancestors.has(value)) throw new ProtocolError('Cyclic JSON data');
      ancestors.add(value);
      bytes += 2;
      const keys = Reflect.ownKeys(value);
      if (array && keys.length !== value.length + 1) throw new ProtocolError('Sparse/custom array');
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string') throw new ProtocolError('Symbol JSON property');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new ProtocolError('Accessor/hidden JSON property');
        }
        if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new ProtocolError('Custom array key');
        bytes += array ? 1 : stringBytes(key) + 2;
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(value);
    } else throw new ProtocolError('Non-JSON value');
    if (bytes > 64 * 1024 * 1024) throw new ProtocolError('Message byte bound exceeded');
  }
  visit(input, 0);
}
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProtocolError('Expected message object');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new ProtocolError('Unexpected/missing message fields');
  }
  return record;
}
function envelope(input: unknown): Record<string, unknown> {
  checkJson(input);
  const data = input as Record<string, unknown>;
  if (!data || data.v !== 1 || !validId(data.requestId))
    throw new ProtocolError('Invalid envelope');
  return data;
}
export function validId(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
}
export function parseRequest(input: unknown): GenerateRequest {
  const data = envelope(input);
  object(data, ['v', 'type', 'requestId', 'seed', 'settings', 'overrides']);
  if (data.type !== 'generate') throw new ProtocolError('Unknown request type');
  if (typeof data.seed !== 'number' || !Number.isSafeInteger(data.seed) || data.seed < 0) {
    throw new ProtocolError('Seed must be a nonnegative safe integer');
  }
  if (!Array.isArray(data.overrides) || data.overrides.length > 256) {
    throw new ProtocolError('Overrides must be an ordered array of at most 256 entries');
  }
  return {
    v: 1,
    type: 'generate',
    requestId: data.requestId as number,
    seed: data.seed,
    settings: parseSettings(data.settings),
    overrides: data.overrides.map((override) => OverrideSchema.parse(override)),
  };
}
export function parseReplayParameters(input: unknown): ReplayParameters {
  checkJson(input);
  const data = object(input, ['seed', 'settings', 'overrides']);
  const { seed, settings, overrides } = parseRequest({
    v: 1,
    type: 'generate',
    requestId: 1,
    ...data,
  });
  return { seed, settings, overrides };
}
export function parseGeneratorResult(input: unknown): GenerationResult<MapAsset> {
  checkJson(input);
  const data = input as Record<string, unknown>;
  if (data?.ok === true) {
    object(data, ['ok', 'value', 'diagnostics']);
    const diagnostics = parseDiagnostics(data.diagnostics);
    if (diagnostics.some((item) => item.severity === 'error'))
      throw new ProtocolError('Generator success contains errors');
    return { ok: true, value: parseAsset(data.value), diagnostics };
  }
  object(input, ['ok', 'kind', 'diagnostics']);
  if (data.ok !== false || data.kind !== 'infeasible')
    throw new ProtocolError('Invalid generator outcome');
  return { ok: false, kind: 'infeasible', diagnostics: parseDiagnostics(data.diagnostics, true) };
}
export function parseDiagnostics(input: unknown, requireError = false): Diagnostic[] {
  checkJson(input);
  if (!Array.isArray(input) || input.length > 1024) throw new ProtocolError('Invalid diagnostics');
  const diagnostics = input.map((item) => DiagnosticSchema.parse(item));
  if (requireError && !diagnostics.some((item) => item.severity === 'error')) {
    throw new ProtocolError('Infeasibility requires an error diagnostic');
  }
  return diagnostics;
}
export function parseProgress(input: unknown): Progress {
  checkJson(input);
  const data = object(input, ['stage', 'fraction', 'message']);
  const stage = DiagnosticSchema.shape.stage.parse(data.stage);
  if (typeof data.fraction !== 'number' || data.fraction < 0 || data.fraction > 1) {
    throw new ProtocolError('Progress fraction outside [0,1]');
  }
  if (typeof data.message !== 'string' || data.message.length > 512) {
    throw new ProtocolError('Invalid progress message');
  }
  return { stage, fraction: data.fraction, message: data.message };
}
export function parseResponse(input: unknown): WorkerResponse {
  const data = envelope(input);
  const base: Envelope = { v: 1, requestId: data.requestId as number };
  switch (data.type) {
    case 'progress':
      object(data, ['v', 'type', 'requestId', 'progress']);
      return { ...base, type: 'progress', progress: parseProgress(data.progress) };
    case 'candidate':
      object(data, ['v', 'type', 'requestId', 'asset', 'diagnostics']);
      return {
        ...base,
        type: 'candidate',
        asset: parseAsset(data.asset),
        diagnostics: parseDiagnostics(data.diagnostics),
      };
    case 'infeasible':
      object(data, ['v', 'type', 'requestId', 'diagnostics']);
      return { ...base, type: 'infeasible', diagnostics: parseDiagnostics(data.diagnostics, true) };
    case 'error': {
      object(data, ['v', 'type', 'requestId', 'error']);
      const error = object(data.error, ['kind', 'code', 'message']);
      if (
        typeof error.kind !== 'string' ||
        !['protocol', 'programming', 'worker', 'timeout', 'invalid-input'].includes(error.kind) ||
        typeof error.code !== 'string' ||
        !error.code.length ||
        error.code.length > 96 ||
        typeof error.message !== 'string' ||
        error.message.length > 512
      ) {
        throw new ProtocolError('Invalid error payload');
      }
      return {
        ...base,
        type: 'error',
        error: {
          kind: error.kind as LifecycleError['kind'],
          code: error.code,
          message: error.message,
        },
      };
    }
    default:
      throw new ProtocolError('Unknown response type');
  }
}
export function parseValidation(input: unknown): ValidationOutcome {
  checkJson(input);
  const data = input as Record<string, unknown>;
  if (data?.ok === true) {
    object(data, ['ok', 'diagnostics']);
    const diagnostics = parseDiagnostics(data.diagnostics);
    if (diagnostics.some((item) => item.severity === 'error'))
      throw new ProtocolError('Successful validation contains errors');
    return { ok: true, diagnostics };
  }
  object(input, ['ok', 'kind', 'diagnostics']);
  if (data.ok !== false || data.kind !== 'infeasible')
    throw new ProtocolError('Invalid validation outcome');
  return { ok: false, kind: 'infeasible', diagnostics: parseDiagnostics(data.diagnostics, true) };
}
const deeplyFrozen = new WeakSet<object>();
export function freezeData<T>(value: T): ReadonlyData<T> {
  if (value !== null && typeof value === 'object' && !deeplyFrozen.has(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
    deeplyFrozen.add(value);
  }
  return value as ReadonlyData<T>;
}
export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Non-Error exception').slice(0, 512);
}
