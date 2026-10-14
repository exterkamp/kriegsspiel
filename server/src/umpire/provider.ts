import type { JsonSchema, TokenUsage } from './umpireClient.js';

/** How a provider can be made to return JSON that matches a schema. */
export type StructuredOutputSupport =
  /** The server enforces the schema (Anthropic `output_config`, OpenAI `json_schema`, Ollama `format`). */
  | 'native'
  /** The server only guarantees syntactically valid JSON. The client validates and repairs. */
  | 'json-mode'
  /** No JSON guarantee at all. The client relies on the prompt, then validates and repairs. */
  | 'none';

export interface ProviderCapabilities {
  structuredOutput: StructuredOutputSupport;
  /** Tokens the model can see, when known. Informational. */
  contextWindow?: number;
  toolUse: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  schema: JsonSchema;
  /** How to ask for JSON on this call. The client sets it from the provider's capabilities. */
  structured: StructuredOutputSupport;
  maxTokens: number;
  temperature?: number;
}

export interface ProviderResponse {
  text: string;
  usage: TokenUsage;
  /** Set when the model declined; the client does not retry a refusal. */
  refusal?: boolean;
  /** Set when output was cut off at `maxTokens`. */
  truncated?: boolean;
  /** Set by the test provider: the answer came from canned rules, not a model. */
  canned?: boolean;
  /**
   * The call's cost when the provider knows it better than the price table, e.g. `0` from the Claude Code bridge on
   * a subscription. Absent: the client prices `usage` by model.
   */
  costUsd?: number;
}

/** A failed send. `retryable` is the provider's judgment (429, 5xx, network); not 4xx. */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Server-requested delay (Retry-After), which overrides the computed backoff when longer. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * The one place that touches a model server (Strategy). An adapter turns a `ProviderRequest`
 * into one HTTP call and maps the answer back. It does no retrying, timing or validation: those
 * are the client's and the decorators' job, so they behave the same for every provider.
 * Umpire stage code depends on `UmpireClient`, never on this or on an SDK.
 */
export interface LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}
