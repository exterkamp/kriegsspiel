import { BudgetedUmpireClient, RateLimitedUmpireClient } from './decorators.js';
import { UMPIRE_STAGES } from './config.js';
import type { UmpireConfig } from './config.js';
import type { LlmProvider } from './provider.js';
import { ProviderUmpireClient } from './providerUmpireClient.js';
import { defaultProviderRegistry } from './providers/index.js';
import type { ProviderRegistry } from './registry.js';
import type { CallRecorder, UmpireClient } from './umpireClient.js';

export interface CreateUmpireClientOptions {
  config: UmpireConfig;
  /** Where API keys come from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to the built-in adapters. Register more to add a provider. */
  registry?: ProviderRegistry;
  recorder?: CallRecorder;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * The composition root for live play: builds the providers the stages use, wraps them in the
 * routing client, then applies the rate limit and budget from the config.
 */
export function createUmpireClient(opts: CreateUmpireClientOptions): UmpireClient {
  const { config } = opts;
  const registry = opts.registry ?? defaultProviderRegistry();
  const env = opts.env ?? process.env;
  const providers: Record<string, LlmProvider> = {};
  for (const stage of UMPIRE_STAGES) {
    const id = config.stages[stage].provider;
    const spec = config.providers[id];
    if (!spec) throw new Error(`stage "${stage}" uses provider "${id}", which is not configured`);
    providers[id] ??= registry.create({
      id,
      spec,
      env,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }
  let client: UmpireClient = new ProviderUmpireClient({
    providers,
    config,
    ...(opts.recorder ? { recorder: opts.recorder } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.random ? { random: opts.random } : {}),
  });
  if (config.rateLimit) {
    client = new RateLimitedUmpireClient(client, {
      ...config.rateLimit,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  }
  if (config.budget) client = new BudgetedUmpireClient(client, config.budget);
  return client;
}
