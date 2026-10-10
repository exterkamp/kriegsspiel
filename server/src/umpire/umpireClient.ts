/**
 * The seam every LLM call goes through. See docs/architecture.md (Umpire service).
 *
 * The server depends on this file only. Implementations (the Anthropic wrapper, the playback
 * client, test mocks) live next to it and are injected. A client never mutates game state: it
 * returns validated structured output, and the engine decides what to do with it.
 */

export type UmpireStage = 'parse' | 'judge' | 'narrate';

/** A JSON Schema (draft 2020-12 subset the API accepts) for the structured output. */
export type JsonSchema = Record<string, unknown>;

export interface UmpireRequest {
  stage: UmpireStage;
  /** Version of the prompt file `system` came from. Recorded, and part of the playback key. */
  promptVersion: string;
  system: string;
  /** JSON-serializable input. Sent to the model as a JSON user message. */
  input: unknown;
  /** The output must validate against this schema. */
  schema: JsonSchema;
  maxTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** One model call as written to the input log. Enough to replay it with no network. */
export interface UmpireCallRecord {
  stage: UmpireStage;
  model: string;
  promptVersion: string;
  system: string;
  input: unknown;
  /** The model's raw text, exactly as received. */
  rawOutput: string;
  usage: TokenUsage;
  /** Summed over all attempts, including failed ones. `null` when the model has no known price. */
  costUsd: number | null;
  attempts: number;
}

export interface UmpireResponse<T> {
  output: T;
  record: UmpireCallRecord;
}

export interface UmpireClient {
  call<T>(request: UmpireRequest): Promise<UmpireResponse<T>>;
}

/** Sink for the input log. The persistence layer implements it; tests use an array. */
export interface CallRecorder {
  record(record: UmpireCallRecord): void;
}

/** What went wrong in a call that did not produce valid output. Callers fall back conservatively. */
export class UmpireError extends Error {
  constructor(
    message: string,
    readonly kind: 'transport' | 'timeout' | 'schema' | 'refusal' | 'missing-recording',
    readonly attempts: number,
    /** Tokens spent on the attempts of a failed call. Absent when nothing was spent. */
    readonly usage?: TokenUsage,
    /** Cost of those attempts. `null` when the model has no known price. */
    readonly costUsd?: number | null,
  ) {
    super(message);
    this.name = 'UmpireError';
  }
}
