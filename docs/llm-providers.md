# LLM providers

The umpire stages (`parse`, `judge`, `narrate`, `staff`, and `command` for the AI commander) call the `UmpireClient` interface in `server/src/umpire/`. Which model answers is configuration. See D14 in [decisions.md](decisions.md).

## Configuration

Config is built from defaults, then an optional JSON file named by `UMPIRE_CONFIG_FILE`, then env overrides. Build it in the server's composition root:

```ts
const config = loadUmpireConfig(); // reads UMPIRE_CONFIG_FILE and the env
const umpire = createUmpireClient({ config, recorder });
```

Example file: parse on a local model, judging and narration in the cloud.

```json
{
  "providers": {
    "anthropic": { "type": "anthropic" },
    "local": { "type": "ollama", "baseUrl": "http://localhost:11434", "numCtx": 16384 },
    "openai": { "type": "openai-compatible", "baseUrl": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" }
  },
  "stages": {
    "parse": { "provider": "local", "model": "<model tag>", "params": { "temperature": 0 } },
    "judge": { "provider": "anthropic", "model": "claude-opus-5-5" },
    "narrate": { "provider": "openai", "model": "<model name>", "params": { "maxTokens": 2000 } },
    "staff": { "provider": "anthropic", "model": "claude-sonnet-5-5" }
  },
  "timeoutMs": 60000,
  "maxAttempts": 3,
  "rateLimit": { "maxConcurrent": 2, "minIntervalMs": 250 },
  "budget": { "maxCostUsd": 5, "maxTotalTokens": 2000000 },
  "gameBudget": { "maxCostUsd": 1, "maxTotalTokens": 400000, "maxCallsPerMinute": 20 }
}
```

Env overrides (they win over the file): `UMPIRE_PROVIDER_PARSE|JUDGE|NARRATE|STAFF|COMMAND`, `UMPIRE_MODEL_PARSE|JUDGE|NARRATE|STAFF|COMMAND`, `UMPIRE_TIMEOUT_MS`, `UMPIRE_MAX_ATTEMPTS`, `UMPIRE_BASE_BACKOFF_MS`, `UMPIRE_MAX_BACKOFF_MS`, `UMPIRE_MAX_CONCURRENT`, `UMPIRE_MIN_INTERVAL_MS`, `UMPIRE_BUDGET_USD`, `UMPIRE_BUDGET_TOKENS`, `UMPIRE_GAME_BUDGET_USD`, `UMPIRE_GAME_BUDGET_TOKENS`, `UMPIRE_GAME_CALLS_PER_MINUTE`.

**API keys come only from the environment.** A provider names the variable in `apiKeyEnv`; a literal key in a file is rejected. `anthropic` defaults to `ANTHROPIC_API_KEY`. `openai-compatible` sends no key unless `apiKeyEnv` is set. Never commit keys.

Provider fields: `type`, `baseUrl`, `apiKeyEnv`, `structuredOutput` (`native`, `json-mode` or `none`, see below), `contextWindow` (informational), `numCtx` (Ollama).

## Structured output

- `native`: the server enforces the schema (Anthropic `output_config`, OpenAI `json_schema`, Ollama `format`). The default for all three adapters.
- `json-mode`: the server only guarantees valid JSON. The client puts the schema in the prompt, validates the reply, and on failure sends a repair message quoting the error.
- `none`: same, without asking the server for JSON mode.

Repairs use the same `maxAttempts` as any retry. If they run out the call throws `UmpireError` (`kind: 'schema'`) and the caller falls back conservatively. Set `structuredOutput` on a provider whose server rejects `json_schema` (older llama.cpp or vLLM builds, some LM Studio models).

### Known limitation: `max_tokens`

The OpenAI-compatible adapter always sends `max_tokens`. OpenAI's newer models (the o-series and later) reject it and require `max_completion_tokens`, so pointing the adapter at them fails with a non-retryable 400. Local OpenAI-compatible servers still expect `max_tokens`. A per-provider option for the parameter name is future work.

## Running Gemma locally

1. Install and start [Ollama](https://ollama.com), then pull the Gemma 4 build you want. Check the tag your server serves with `ollama list`; this repo does not assume one.
2. Point a stage at it, using that exact tag as the model string:

   ```bash
   UMPIRE_CONFIG_FILE=umpire.json UMPIRE_MODEL_JUDGE=<tag from ollama list> UMPIRE_PROVIDER_JUDGE=local
   ```

   These variables are read by `umpireConfigFromEnv` and `createUmpireClient`, which the server entry point does not call yet, so setting them changes nothing until the composition root is wired. Start the server itself with `devrun` (see `AGENTS.md`), not bare `npm run dev`.

   with `local` defined as `{ "type": "ollama" }` in `umpire.json`. Ollama's default context window is small; set `numCtx` (above) to fit the board state plus the prompt.
3. Or use Ollama's OpenAI-compatible endpoint: `{ "type": "openai-compatible", "baseUrl": "http://localhost:11434/v1" }`. The same works for llama.cpp server, LM Studio and vLLM with their own base URL.

Local models are slow. Raise `timeoutMs` (a 60 s default is tight for a large model on a CPU), and expect `costUsd: null` in the call record since only Claude models are priced; use `budget.maxTotalTokens` to cap them.

### Live test

Skipped unless `OLLAMA_LIVE` is set:

```bash
OLLAMA_LIVE=1 OLLAMA_MODEL=<tag from ollama list> npm test --workspace server -- providers
# OLLAMA_URL=http://host:11434 if the server is not on localhost
```

## Adding a provider

1. Write a class implementing `LlmProvider` (`id`, `capabilities`, `generate`). Map HTTP errors to `TransportError(message, retryable, retryAfterMs?)`; rethrow aborts. Do no retry, timeout or validation of your own.
2. Register it by type, in code or in `defaultProviderRegistry()`:

   ```ts
   registry.register('my-provider', ({ id, spec, env, fetch }) => new MyProvider({ id, baseUrl: spec.baseUrl }));
   ```

3. Use `{ "type": "my-provider" }` in config. Add a wire description to the contract tests in `providers.test.ts`; the same suite then checks it with retry, record/playback, rate limit and budget.

Only adapter files may import a vendor SDK; a test enforces it.

## Cross-cutting behaviour

| Concern | Where | Notes |
| --- | --- | --- |
| Retry, backoff, timeout, validation, repair | `ProviderUmpireClient` | Per stage, same for every provider. |
| Rate limit | `RateLimitedUmpireClient` | `maxConcurrent`, `minIntervalMs`. |
| Budget | `BudgetedUmpireClient` | Counts failed attempts. Dollars only for priced models. |
| Per-game caps and cost report | `GameUmpireClient` | One per game over the shared client. `gameBudget`: dollars, tokens, calls per sliding minute. Refuses with `UmpireError` kind `budget` or `rate-limit` (nothing sent), so stage code falls back. `report()` gives calls, tokens, cost and refusals per stage; `onMetric` logs each call and refusal. |
| Record / playback | `CallRecorder`, `PlaybackUmpireClient` | Playback has no provider, so no network. |
