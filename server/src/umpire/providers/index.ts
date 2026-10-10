import Anthropic from '@anthropic-ai/sdk';
import { ProviderRegistry } from '../registry.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCompatibleProvider } from './openaiCompatible.js';

export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider, OLLAMA_DEFAULT_URL } from './ollama.js';
export { OpenAiCompatibleProvider } from './openaiCompatible.js';

/** The registry with the built-in adapters: `anthropic`, `openai-compatible` and `ollama`. */
export function defaultProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register('anthropic', ({ spec, env, fetch }) => {
      const apiKey = env[spec.apiKeyEnv ?? 'ANTHROPIC_API_KEY'];
      return new AnthropicProvider(
        new Anthropic({
          maxRetries: 0,
          ...(apiKey ? { apiKey } : {}),
          ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
          ...(fetch ? { fetch } : {}),
        }),
      );
    })
    .register('openai-compatible', ({ id, spec, env, fetch }) => {
      if (!spec.baseUrl) throw new Error(`provider "${id}": openai-compatible needs a baseUrl`);
      const apiKey = spec.apiKeyEnv ? env[spec.apiKeyEnv] : undefined;
      return new OpenAiCompatibleProvider({
        id,
        baseUrl: spec.baseUrl,
        ...(apiKey ? { apiKey } : {}),
        capabilities: capabilitiesOf(spec),
        ...(fetch ? { fetch } : {}),
      });
    })
    .register(
      'ollama',
      ({ id, spec, fetch }) =>
        new OllamaProvider({
          id,
          ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
          ...(spec.numCtx ? { numCtx: spec.numCtx } : {}),
          capabilities: capabilitiesOf(spec),
          ...(fetch ? { fetch } : {}),
        }),
    );
}

function capabilitiesOf(spec: {
  structuredOutput?: 'native' | 'json-mode' | 'none';
  contextWindow?: number;
}) {
  return {
    ...(spec.structuredOutput ? { structuredOutput: spec.structuredOutput } : {}),
    ...(spec.contextWindow ? { contextWindow: spec.contextWindow } : {}),
  };
}
