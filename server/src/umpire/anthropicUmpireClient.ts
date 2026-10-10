import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { UmpireConfig } from './config.js';
import { DEFAULT_UMPIRE_CONFIG } from './config.js';
import { addUsage, costUsd, ZERO_USAGE } from './pricing.js';
import { TransportError } from './transport.js';
import type { UmpireTransport } from './transport.js';
import { UmpireError } from './umpireClient.js';
import type {
  CallRecorder,
  UmpireCallRecord,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
} from './umpireClient.js';

export interface AnthropicUmpireClientOptions {
  transport: UmpireTransport;
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
 * Calls the model with a strict JSON schema, retrying transport failures, timeouts and
 * schema-invalid output with exponential backoff. Cost and tokens are accumulated across all
 * attempts so failed tries are still accounted for.
 */
export class AnthropicUmpireClient implements UmpireClient {
  private readonly transport: UmpireTransport;
  private readonly config: UmpireConfig;
  private readonly recorder?: CallRecorder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly ajv = new Ajv({ strict: false, allErrors: false });
  private readonly validators = new WeakMap<object, ValidateFunction>();

  constructor(opts: AnthropicUmpireClientOptions) {
    this.transport = opts.transport;
    this.config = opts.config ?? DEFAULT_UMPIRE_CONFIG;
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
    const model = this.config.models[request.stage];
    const user = JSON.stringify(request.input);
    let usage = ZERO_USAGE;
    let cost: number | null = 0;
    let lastError: UmpireError | undefined;
    const withSpend = (e: UmpireError) =>
      new UmpireError(e.message, e.kind, e.attempts, usage, cost);

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      let delayHint = 0;
      let terminal = false;
      try {
        const res = await this.sendWithTimeout(model, request, user);
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
        let parsed: unknown;
        try {
          parsed = JSON.parse(res.text);
        } catch {
          throw this.schemaError('output is not JSON', attempt);
        }
        if (!validate(parsed)) {
          throw this.schemaError(this.ajv.errorsText(validate.errors), attempt);
        }
        const record: UmpireCallRecord = {
          stage: request.stage,
          model,
          promptVersion: request.promptVersion,
          system: request.system,
          input: request.input,
          rawOutput: res.text,
          usage,
          costUsd: cost,
          attempts: attempt,
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

  private async sendWithTimeout(model: string, request: UmpireRequest, user: string) {
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
      return await Promise.race([
        this.transport.send(
          {
            model,
            system: request.system,
            user,
            schema: request.schema,
            maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          },
          ctrl.signal,
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
