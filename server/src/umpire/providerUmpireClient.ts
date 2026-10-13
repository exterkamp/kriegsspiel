import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { UmpireConfig } from './config.js';
import { DEFAULT_UMPIRE_CONFIG } from './config.js';
import { addUsage, costUsd, ZERO_USAGE } from './pricing.js';
import { TransportError } from './provider.js';
import type { ChatMessage, LlmProvider, ProviderRequest } from './provider.js';
import { UmpireError } from './umpireClient.js';
import type {
  CallRecorder,
  UmpireCallRecord,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
} from './umpireClient.js';

export interface ProviderUmpireClientOptions {
  /** Providers by the ids the config's stages refer to. */
  providers: Record<string, LlmProvider>;
  config?: UmpireConfig;
  /** Every successful call is recorded here (model, prompt version, input, raw output). */
  recorder?: CallRecorder;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). */
  random?: () => number;
}

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Routes each stage to its configured provider and model, asks for JSON matching the schema,
 * and retries transport failures, timeouts and schema-invalid output with exponential backoff.
 * Cost and tokens are accumulated across all attempts so failed tries are still accounted for.
 *
 * A provider with native structured output is trusted to follow the schema (a retry just
 * resends). Otherwise the schema goes in the prompt, and a bad reply is answered with a repair
 * message that quotes the error. Either way the output is validated here before it is returned,
 * and the retries are bounded by `maxAttempts`.
 */
export class ProviderUmpireClient implements UmpireClient {
  private readonly providers: Record<string, LlmProvider>;
  private readonly config: UmpireConfig;
  private readonly recorder?: CallRecorder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly ajv = new Ajv({ strict: false, allErrors: false });
  private readonly validators = new WeakMap<object, ValidateFunction>();

  constructor(opts: ProviderUmpireClientOptions) {
    this.providers = opts.providers;
    this.config = opts.config ?? DEFAULT_UMPIRE_CONFIG;
    for (const [stage, route] of Object.entries(this.config.stages)) {
      if (!this.providers[route.provider]) {
        throw new Error(`stage "${stage}" uses provider "${route.provider}", which was not built`);
      }
    }
    this.recorder = opts.recorder;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    let validate = this.validators.get(request.schema);
    if (!validate) {
      validate = this.ajv.compile(request.schema);
      this.validators.set(request.schema, validate);
    }
    const route = this.config.stages[request.stage];
    const provider = this.providers[route.provider]!;
    const model = route.model;
    const structured = provider.capabilities.structuredOutput;
    const system =
      structured === 'native'
        ? request.system
        : `${request.system}\n\nReply with a single JSON object and nothing else (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(request.schema)}`;
    const messages: ChatMessage[] = [{ role: 'user', content: JSON.stringify(request.input) }];
    const base: ProviderRequest = {
      model,
      system,
      messages,
      schema: request.schema,
      structured,
      maxTokens: request.maxTokens ?? route.params?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    const temperature = request.temperature ?? route.params?.temperature;
    if (temperature !== undefined) base.temperature = temperature;
    let usage = ZERO_USAGE;
    let cost: number | null = 0;
    let lastError: UmpireError | undefined;
    const withSpend = (e: UmpireError) =>
      new UmpireError(e.message, e.kind, e.attempts, usage, cost);

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      let delayHint = 0;
      let terminal = false;
      let repair: { reply: string; problem: string } | undefined;
      try {
        const res = await this.sendWithTimeout(provider, { ...base, messages: [...messages] });
        usage = addUsage(usage, res.usage);
        const c = costUsd(model, res.usage);
        cost = cost === null || c === null ? null : cost + c;

        if (res.refusal) {
          throw new UmpireError('model refused the request', 'refusal', attempt);
        }
        if (res.truncated) {
          // Same input and limit would truncate again, so retrying only pays for it twice.
          terminal = true;
          throw this.schemaError('output truncated at max_tokens', attempt);
        }
        const text = structured === 'native' ? res.text : stripFence(res.text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          repair = { reply: res.text, problem: 'it is not valid JSON' };
          throw this.schemaError('output is not JSON', attempt);
        }
        if (!validate(parsed)) {
          const detail = this.ajv.errorsText(validate.errors);
          repair = { reply: res.text, problem: `it fails the schema: ${detail}` };
          throw this.schemaError(detail, attempt);
        }
        const record: UmpireCallRecord = {
          stage: request.stage,
          provider: route.provider,
          model,
          promptVersion: request.promptVersion,
          system: request.system,
          input: request.input,
          rawOutput: text,
          usage,
          costUsd: cost,
          attempts: attempt,
          ...(res.canned ? { canned: true } : {}),
        };
        this.recorder?.record(record);
        return { output: parsed as T, record };
      } catch (err) {
        if (err instanceof UmpireError && (err.kind === 'refusal' || terminal)) {
          throw withSpend(err);
        }
        if (err instanceof TransportError) {
          if (!err.retryable) throw withSpend(new UmpireError(err.message, 'transport', attempt));
          delayHint = err.retryAfterMs ?? 0;
          if (delayHint > this.config.maxBackoffMs * 4) {
            // The server wants a wait longer than the barrier can tolerate: fail now.
            throw withSpend(
              new UmpireError(
                `${err.message} (retry-after ${delayHint}ms too long)`,
                'transport',
                attempt,
              ),
            );
          }
          lastError = new UmpireError(err.message, 'transport', attempt);
        } else if (err instanceof UmpireError) {
          lastError = err;
        } else {
          throw err;
        }
      }
      if (repair && structured !== 'native') {
        messages.push(
          { role: 'assistant', content: repair.reply },
          {
            role: 'user',
            content: `Your reply was rejected because ${repair.problem}. Reply again with only the corrected JSON object.`,
          },
        );
      }
      if (attempt < this.config.maxAttempts) {
        await this.sleep(Math.max(delayHint, this.backoffMs(attempt)));
      }
    }
    throw new UmpireError(
      lastError?.message ?? 'no attempts made',
      lastError?.kind ?? 'transport',
      this.config.maxAttempts,
      usage,
      cost,
    );
  }

  private schemaError(detail: string, attempt: number): UmpireError {
    return new UmpireError(`output failed schema validation: ${detail}`, 'schema', attempt);
  }

  private backoffMs(attempt: number): number {
    const { baseBackoffMs, maxBackoffMs } = this.config;
    const exp = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
    return Math.round(exp * (0.5 + this.random() / 2));
  }

  private async sendWithTimeout(provider: LlmProvider, request: ProviderRequest) {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new UmpireError(`timed out after ${this.config.timeoutMs}ms`, 'timeout', 0));
      }, this.config.timeoutMs);
    });
    try {
      // Race so a transport that ignores the abort signal still times out.
      return await Promise.race([provider.generate(request, ctrl.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Local models often wrap JSON in a markdown fence even when told not to. */
function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1]! : text;
}
