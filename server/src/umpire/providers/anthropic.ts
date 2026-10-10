import Anthropic from '@anthropic-ai/sdk';
import { TransportError } from '../provider.js';
import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
} from '../provider.js';
import { isRetryableStatus, retryAfterMs } from './http.js';

/**
 * Sends one request through the Anthropic SDK using structured outputs
 * (`output_config.format`). SDK retries are off: `ProviderUmpireClient` owns retry and backoff.
 * This is the only file that imports the SDK.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly capabilities: ProviderCapabilities = { structuredOutput: 'native', toolUse: true };
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ maxRetries: 0 });
  }

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
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
  // Aborts come from our own timeout; let the client classify them.
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIConnectionError) {
    return new TransportError(err.message, true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return new TransportError(
      `${status}: ${err.message}`,
      isRetryableStatus(status),
      err.headers ? retryAfterMs(err.headers) : undefined,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}
