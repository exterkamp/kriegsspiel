import type { JsonSchema, TokenUsage } from './umpireClient.js';

export interface TransportRequest {
  model: string;
  system: string;
  /** The user message text (the request input, serialized). */
  user: string;
  schema: JsonSchema;
  maxTokens: number;
}

export interface TransportResponse {
  text: string;
  usage: TokenUsage;
  /** Set when the model declined; the wrapper does not retry a refusal. */
  refusal?: boolean;
  /** Set when output was cut off at `maxTokens`. */
  truncated?: boolean;
}

/** A failed send. `retryable` is the transport's judgment (429, 5xx, network); not 4xx. */
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

/** The one place that touches the network. Swap it for a fake in tests. */
export interface UmpireTransport {
  send(request: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;
}
