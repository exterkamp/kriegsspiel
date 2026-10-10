import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { UmpireError } from './umpireClient.js';
import type {
  CallRecorder,
  UmpireCallRecord,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
  UmpireStage,
} from './umpireClient.js';

/** A failure to inject. `times` limits it to the first N matching calls; omit it to fail always. */
export interface FixtureFailure {
  kind: UmpireError['kind'];
  message?: string;
  times?: number;
}

/** One canned answer. See docs/umpire-fixtures.md. */
export interface UmpireFixture {
  name?: string;
  stage: UmpireStage;
  /** Match only this prompt version. Omit to match any. */
  promptVersion?: string;
  /** Match only this exact input (key order ignored). Omit to match any input for the stage. */
  input?: unknown;
  /** The structured output to return. Required unless `failure` is set with no `times`. */
  output?: unknown;
  /** Simulated model latency in milliseconds. */
  latencyMs?: number;
  failure?: FixtureFailure;
}

export interface MockUmpireClientOptions {
  /** Every served call is recorded here, like the real client. */
  recorder?: CallRecorder;
  /** Injected so tests control latency. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

const FAILURE_KINDS = ['transport', 'timeout', 'schema', 'refusal', 'missing-recording'];
const STAGES = ['parse', 'judge', 'narrate'];

/** Reads one fixture file (`{"fixtures": [...]}` or a bare array) and checks its shape. */
export function loadFixtureFile(path: string): UmpireFixture[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : (parsed as { fixtures?: unknown })?.fixtures;
  if (!Array.isArray(list)) throw new Error(`${path}: expected {"fixtures": [...]}`);
  return list.map((f: UmpireFixture, i) => {
    const where = `${path} fixture ${i}`;
    if (!f || !STAGES.includes(f.stage)) throw new Error(`${where}: bad or missing stage`);
    if (f.failure && !FAILURE_KINDS.includes(f.failure.kind)) {
      throw new Error(`${where}: bad failure kind`);
    }
    if (!('output' in f) && (!f.failure || f.failure.times !== undefined)) {
      throw new Error(`${where}: needs output or failure`);
    }
    return f;
  });
}

/** Loads every `*.json` file in a directory (sorted by name), or a single file. */
export function loadFixtures(path: string): UmpireFixture[] {
  if (!statSync(path).isDirectory()) return loadFixtureFile(path);
  return readdirSync(path)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => loadFixtureFile(join(path, f)));
}

/**
 * A deterministic, offline `UmpireClient` for tests. It has no transport, so it cannot reach the
 * network. Each call is answered by the first fixture matching stage, prompt version and input;
 * the output is validated against the request schema, so a stale fixture fails like a bad model
 * reply would. Fixtures are reusable. Configurable latency and failure injection let tests
 * exercise the LLM barrier and the fallback paths.
 */
export class MockUmpireClient implements UmpireClient {
  /** Every request received, in order. */
  readonly calls: UmpireRequest[] = [];
  private readonly fixtures: UmpireFixture[];
  private readonly failed = new Map<UmpireFixture, number>();
  private readonly recorder?: CallRecorder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly ajv = new Ajv({ strict: false });
  private readonly validators = new WeakMap<object, ValidateFunction>();

  constructor(fixtures: readonly UmpireFixture[], opts: MockUmpireClientOptions = {}) {
    this.fixtures = [...fixtures];
    this.recorder = opts.recorder;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.calls.push(request);
    const fixture = this.fixtures.find(
      (f) =>
        f.stage === request.stage &&
        (f.promptVersion === undefined || f.promptVersion === request.promptVersion) &&
        (!('input' in f) || stable(f.input) === stable(request.input)),
    );
    if (!fixture) {
      throw new UmpireError(
        `no fixture for ${request.stage} call (prompt ${request.promptVersion})`,
        'missing-recording',
        0,
      );
    }
    if (fixture.latencyMs) await this.sleep(fixture.latencyMs);

    const { failure } = fixture;
    if (failure) {
      const n = this.failed.get(fixture) ?? 0;
      if (failure.times === undefined || n < failure.times) {
        this.failed.set(fixture, n + 1);
        throw new UmpireError(
          failure.message ?? `injected ${failure.kind} failure`,
          failure.kind,
          1,
        );
      }
    }

    let validate = this.validators.get(request.schema);
    if (!validate) {
      validate = this.ajv.compile(request.schema);
      this.validators.set(request.schema, validate);
    }
    if (!validate(fixture.output)) {
      throw new UmpireError(
        `fixture ${fixture.name ?? fixture.stage} does not match schema: ${this.ajv.errorsText(validate.errors)}`,
        'schema',
        1,
      );
    }
    const record: UmpireCallRecord = {
      stage: request.stage,
      model: 'mock',
      promptVersion: request.promptVersion,
      system: request.system,
      input: request.input,
      rawOutput: JSON.stringify(fixture.output),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      attempts: 1,
    };
    this.recorder?.record(record);
    return { output: fixture.output as T, record };
  }
}
