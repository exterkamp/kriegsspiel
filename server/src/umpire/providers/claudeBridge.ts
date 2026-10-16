import { TransportError } from '../provider.js';
import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
} from '../provider.js';
import type { TokenUsage } from '../umpireClient.js';
import { joinUrl, postJson } from './http.js';
import type { FetchFn } from './http.js';

export interface ClaudeBridgeOptions {
  id?: string;
  /** Where the host-side bridge (`npm run claude-bridge`) listens. */
  baseUrl?: string;
  /** The bridge's shared secret (`CLAUDE_BRIDGE_SECRET`), sent as a bearer token. */
  secret?: string;
  capabilities?: Partial<ProviderCapabilities>;
  fetch?: FetchFn;
}

/** The bridge's `POST /v1/generate` answer (`tools/claude-bridge/claude.ts`). */
interface BridgeAnswer {
  text?: string;
  usage?: Partial<TokenUsage>;
  /** Only when the bridge is told the CLI bills an API key (`CLAUDE_BRIDGE_BILLING=api`). */
  costUsd?: number;
  truncated?: boolean;
  refusal?: boolean;
}

export const CLAUDE_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:8790';

/**
 * The Claude Code bridge: a host-side service that runs `claude -p` once per request with no tools
 * and no session, so the umpire can use Claude Code's models from inside the container (#457). It
 * only asks for JSON (`json-mode`); the client validates and repairs as for any provider. The bridge
 * maps CLI failures to HTTP statuses (424 not logged in or CLI missing, 429 rate limited, 504
 * timeout, 502 other CLI failures), which `postJson` turns into `TransportError` verdicts.
 */
export class ClaudeBridgeProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  private readonly fetch: FetchFn;

  constructor(private readonly opts: ClaudeBridgeOptions = {}) {
    this.id = opts.id ?? 'claude-bridge';
    this.capabilities = { structuredOutput: 'json-mode', toolUse: false, ...opts.capabilities };
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const json = (await postJson(
      this.fetch,
      joinUrl(this.opts.baseUrl ?? CLAUDE_BRIDGE_DEFAULT_URL, '/v1/generate'),
      this.opts.secret ? { authorization: `Bearer ${this.opts.secret}` } : {},
      {
        model: req.model,
        system: req.system,
        messages: req.messages,
        schema: req.schema,
        structured: req.structured,
        maxTokens: req.maxTokens,
      },
      signal,
    )) as BridgeAnswer;
    if (typeof json.text !== 'string') throw new TransportError('bridge answer has no text', false);
    const u = json.usage ?? {};
    return {
      text: json.text,
      usage: {
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        cacheWriteTokens: u.cacheWriteTokens ?? 0,
      },
      // A subscription is not billed per call, so budgets count no dollars unless the bridge says otherwise.
      costUsd: json.costUsd ?? 0,
      ...(json.truncated ? { truncated: true } : {}),
      ...(json.refusal ? { refusal: true } : {}),
    };
  }
}
