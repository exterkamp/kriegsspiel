import type { ProviderSpec } from './config.js';
import type { LlmProvider } from './provider.js';

export interface ProviderContext {
  /** The key this provider has in `UmpireConfig.providers`. */
  id: string;
  spec: ProviderSpec;
  env: Record<string, string | undefined>;
  /** Injected into HTTP adapters so tests need no network. */
  fetch?: typeof globalThis.fetch;
}

export type ProviderFactory = (ctx: ProviderContext) => LlmProvider;

/** Builds providers from config by `type`. New providers register without touching old code. */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(type: string, factory: ProviderFactory): this {
    if (this.factories.has(type)) throw new Error(`provider type "${type}" is already registered`);
    this.factories.set(type, factory);
    return this;
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  create(ctx: ProviderContext): LlmProvider {
    const factory = this.factories.get(ctx.spec.type);
    if (!factory) {
      const known = [...this.factories.keys()].join(', ');
      throw new Error(
        `provider "${ctx.id}": unknown type "${ctx.spec.type}" (registered: ${known})`,
      );
    }
    return factory(ctx);
  }
}
