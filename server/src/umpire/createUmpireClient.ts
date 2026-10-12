import { BudgetedUmpireClient, RateLimitedUmpireClient } from './decorators.js';
import { UMPIRE_STAGES } from './config.js';
import type { UmpireConfig } from './config.js';
import { TEST_MODEL } from './providers/test.js';
import type { LlmProvider } from './provider.js';
import { ProviderUmpireClient } from './providerUmpireClient.js';
import { defaultProviderRegistry } from './providers/index.js';
import { FallbackUmpireClient } from './fallbackUmpireClient.js';
import type { UmpireFallback } from './fallbackUmpireClient.js';
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
  /** Called each time a stage answers from the fallback provider (`config.fallbackProvider`). */
  onFallback?: (f: UmpireFallback) => void;
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
  if (config.fallbackProvider) {
    const fb = config.fallbackProvider;
    const spec = config.providers[fb];
    if (!spec) throw new Error(`fallback provider "${fb}" is not configured`);
    const fbProvider = providers[fb] ?? registry.create({ id: fb, spec, env });
    const fbStages = Object.fromEntries(
      UMPIRE_STAGES.map((s) => [s, { provider: fb, model: TEST_MODEL }]),
    ) as UmpireConfig['stages'];
    const local = UMPIRE_STAGES.filter((s) => config.stages[s].provider !== fb);
    const first = config.stages[local[0] ?? 'parse'];
    client = new FallbackUmpireClient({
      primary: client,
      fallback: new ProviderUmpireClient({
        providers: { [fb]: fbProvider },
        config: { ...config, stages: fbStages, maxAttempts: 1 },
        ...(opts.recorder ? { recorder: opts.recorder } : {}),
      }),
      stages: local,
      provider: first.provider,
      model: first.model,
      ...(opts.onFallback ? { onFallback: opts.onFallback } : {}),
    });
  }
  if (config.rateLimit) {
    client = new RateLimitedUmpireClient(client, {
      ...config.rateLimit,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  }
  if (config.budget) client = new BudgetedUmpireClient(client, config.budget);
  return client;
}
