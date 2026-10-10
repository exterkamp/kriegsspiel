import { TransportError } from '../provider.js';
import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
} from '../provider.js';
import { joinUrl, postJson } from './http.js';
import type { FetchFn } from './http.js';

export interface OllamaOptions {
  id?: string;
  /** Defaults to a local server. */
  baseUrl?: string;
  /** Sent as `options.num_ctx`. Ollama's default context is small, so raise it for long inputs. */
  numCtx?: number;
  capabilities?: Partial<ProviderCapabilities>;
  fetch?: FetchFn;
}

interface OllamaChat {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

/** Ollama's native `/api/chat`, using its `format` JSON-schema structured output. */
export class OllamaProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  private readonly fetch: FetchFn;

  constructor(private readonly opts: OllamaOptions = {}) {
    this.id = opts.id ?? 'ollama';
    this.capabilities = { structuredOutput: 'native', toolUse: true, ...opts.capabilities };
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const options: Record<string, unknown> = { num_predict: req.maxTokens };
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (this.opts.numCtx !== undefined) options.num_ctx = this.opts.numCtx;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      stream: false,
      options,
    };
    if (req.structured === 'native') body.format = req.schema;
    else if (req.structured === 'json-mode') body.format = 'json';

    const json = (await postJson(
      this.fetch,
      joinUrl(this.opts.baseUrl ?? OLLAMA_DEFAULT_URL, '/api/chat'),
      {},
      body,
      signal,
    )) as OllamaChat;
    if (!json.message) throw new TransportError('response has no message', false);
    return {
      text: json.message.content ?? '',
      usage: {
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      truncated: json.done_reason === 'length',
    };
  }
}
