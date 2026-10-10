import Anthropic from '@anthropic-ai/sdk';
import { TransportError } from './transport.js';
import type { TransportRequest, TransportResponse, UmpireTransport } from './transport.js';

/**
 * Sends one request through the Anthropic SDK using structured outputs
 * (`output_config.format`). SDK retries are off: `AnthropicUmpireClient` owns retry and backoff.
 */
export class AnthropicTransport implements UmpireTransport {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ maxRetries: 0 });
  }

  async send(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: { type: 'json_schema', schema: req.schema } },
        },
        { signal },
      );
    } catch (err) {
      throw toTransportError(err);
    }
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return {
      text,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
      refusal: message.stop_reason === 'refusal',
      truncated: message.stop_reason === 'max_tokens',
    };
  }
}

function toTransportError(err: unknown): Error {
  // Aborts come from our own timeout; let the wrapper classify them.
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIConnectionError) {
    return new TransportError(err.message, true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    const ms = Number(err.headers?.get('retry-after-ms'));
    const secs = Number(err.headers?.get('retry-after'));
    const retryAfterMs =
      Number.isFinite(ms) && ms > 0
        ? ms
        : Number.isFinite(secs) && secs > 0
          ? secs * 1000
          : undefined;
    return new TransportError(`${status}: ${err.message}`, retryable, retryAfterMs);
  }
  return err instanceof Error ? err : new Error(String(err));
}
