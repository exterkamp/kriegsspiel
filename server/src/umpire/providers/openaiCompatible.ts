import { TransportError } from '../provider.js';
import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
} from '../provider.js';
import { joinUrl, postJson } from './http.js';
import type { FetchFn } from './http.js';

export interface OpenAiCompatibleOptions {
  id?: string;
  /** Up to and including the version segment, e.g. `https://api.openai.com/v1` or `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Sent as a bearer token when set. Local servers usually need none. */
  apiKey?: string;
  capabilities?: Partial<ProviderCapabilities>;
  fetch?: FetchFn;
}

interface ChatCompletion {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/**
 * The OpenAI chat-completions wire format. Covers OpenAI itself and local servers that copy it:
 * Ollama's `/v1`, llama.cpp server, LM Studio and vLLM. Servers that lack `json_schema` support
 * can be set to `json-mode` (or `none`), and the client then validates and repairs.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  private readonly fetch: FetchFn;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.id = opts.id ?? 'openai-compatible';
    this.capabilities = { structuredOutput: 'native', toolUse: true, ...opts.capabilities };
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      stream: false,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.structured === 'native') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'umpire_output', strict: true, schema: req.schema },
      };
    } else if (req.structured === 'json-mode') {
      body.response_format = { type: 'json_object' };
    }
    const headers: Record<string, string> = {};
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const json = (await postJson(
      this.fetch,
      joinUrl(this.opts.baseUrl, '/chat/completions'),
      headers,
      body,
      signal,
    )) as ChatCompletion;

    const choice = json.choices?.[0];
    if (!choice) throw new TransportError('response has no choices', false);
    const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: choice.message?.content ?? '',
      usage: {
        inputTokens: Math.max(0, (json.usage?.prompt_tokens ?? 0) - cached),
        outputTokens: json.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
      refusal: Boolean(choice.message?.refusal) || choice.finish_reason === 'content_filter',
      truncated: choice.finish_reason === 'length',
    };
  }
}
