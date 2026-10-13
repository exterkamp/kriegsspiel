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

## Test provider

`{ "type": "test" }` answers every stage from rules and templates, with no model and no network (`server/src/umpire/providers/test.ts`, `testParse.ts`). It is for demos and tests without a key.

Select it with `UMPIRE_PROVIDER=test` (every stage), `UMPIRE_PROVIDER_<STAGE>=test` (one stage), a `test` provider named in the config file, or `UMPIRE_KEYLESS_PROVIDER=test`, which moves only the stages that would use Anthropic with no `ANTHROPIC_API_KEY` (the Docker image and compose file set it; a key switches back to the real model). `ORDER_PARSER=stub` still forces the rule-based parser. Its model name is `test` and it is priced at zero, so budgets and per-game caps never trip.

| Stage | What it does |
| --- | --- |
| `parse` | Finds the unit (id, name, or `the cavalry`, `the 1st`), then one or more clauses split at `and`, `then` and commas, each a verb (move, hold/screen/defend, withdraw/fall back, attack) and a place (by name, or by kind narrowed by name words, such as `the northern wood`). `it` or `there` means the place before. Several fits: a clarification with options. It never guesses (#389): no unit named, a condition or an hour (`if pressed`, `at noon`), a negation, steps that undo each other (hold, then advance; fall back from a place and fight for it), an order to all units, a vague place (`somewhere`, `forward`), or other text mixed into a real order (claims of umpire authority, `reveal`, dice): a clarification. An unknown place or unit (words before the verb that fit none of ours, such as `3rd Battalion`, refused without quoting them back), no verb, or text that is no order: a rejection with a reason. It is the keyless demo's order parser; `testProvider.test.ts` holds it to the golden corpus (95%, no injection or ambiguity carried out). |
| `narrate` | One dispatch per report, built only from the report's own officer, place, size and numbers, so it passes `checkNarration`. |
| `staff` | One short piece of advice, chosen by the topic keywords of an optional `question` (enemy, supply, fatigue, ground, orders) or else by the officer's role, from counts in the officer's view. |
| `judge` | No placements. |
| `command` | Every unit holds the named place nearest the objective. |

Its output is deterministic and validated like any model's, and recorded through `CallRecorder`. The game shows a "Test umpire (canned responses)" badge (`GET /scenarios` carries `umpire: "test"`), and the admin LLM panel shows its calls with mode `test`.

## Local model in the Docker demo

`UMPIRE_KEYLESS_PROVIDER=ollama` (the compose default) puts `narrate` and `staff` (and `parse` if `OLLAMA_STAGES` lists it) on an `ollama` provider built from the env: `OLLAMA_URL`, `OLLAMA_MODEL` (default `qwen2.5:0.5b`), `OLLAMA_NUM_CTX` (4096), `OLLAMA_TIMEOUT_MS` (60000), with temperature 0.2, at most 700 output tokens (400 for parse), two attempts, and one call at a time. Every other stage uses `test`. With a key, none of this applies.

**Fallback.** `createUmpireClient` wraps those stages in `FallbackUmpireClient` (`server/src/umpire/fallbackUmpireClient.ts`) when the config has `fallbackProvider` (set for this mode). If the model call fails with a transport error (Ollama down, or `model not found` while it is still being pulled), a timeout, a refusal, or output that still fails the schema after the allowed attempts, the same request is answered by the `test` provider and the returned record carries `fallbackFor` (reason, kind, provider, model). A transport failure or timeout also makes the client skip the model for 30 s so a down or slow model does not cost each call its timeout; schema failures do not, so a model that keeps producing bad output costs each call its full attempts before the fallback answers. The one-call-at-a-time limit applies to the model only: `test` stages and fallback answers never queue behind it. Budget and rate-limit refusals are not retried elsewhere. Narration and staff replies that parse but fail `checkNarration` or the staff checks are already replaced by the engine's template text or silence, as with any model. The order parser, if `parse` is on the model, falls back to the canned parser and then the rule-based stub. The recorded call is the one that answered, so replay needs no model. The trace marks fallback calls with mode `fallback` and the reason; the admin LLM panel shows the provider (`ollama`), model, latency, token counts and that mode.

**Narration and staff answers on a slow model (#342).** Three limits decide whether a small local model's text reaches the player. (1) The narrate stage holds game time (the LLM barrier) for at most `narrateTimeoutMs` (default 150 s, `GameActor`/`GameHost` option), separate from the 60 s order-parse timeout: a CPU model answers in 55 to 107 s under load, and with the parse timeout shared the reply was thrown away after 60 s and the template text stayed, which is why no dispatch was ever model-written. Narration makes at most two model calls per window (one retry), so a fallback costs at most the one timeout, not a second wait. (2) A staff answer to a conference question must be complete: `checkAnswerText` rejects a fragment (under three words, or not ending in a full stop, `!`, `?` or a closing quote, as when the model stops mid-sentence) and an officer who sends the commander to his own post. The call is repeated once with the problems listed; if the second reply fails too, the exchange is text-less and the client answers from the view (the canned answer). (3) The narration window is in game time: 5 minutes at 1:1, growing with the rate and capped at 20 game minutes (`narrateWindowMs`): 5, 10, 20 and 20 minutes at 1:1, 2:1, 4:1 and 12:1, so a 50-minute game at 12:1 still gets windows (about 100 wall seconds apart). A call longer than that holds the clock, so on a slow host prefer a lower rate. The same window paces vacant-seat staff reports (`runStaff`), so at 12:1 they speak every 20 game minutes instead of every 60, about three times as many staff calls per game. When narration falls back, the `narrate` input-log entry (and the admin LLM panel) says why: the problems found in each rejected reply, a timeout, or a refused call; the rejected raw output is in the entry's `calls`. The benchmark prints `outcomes` (first try, retried, fallback) for narration and for conference answers.

**Benchmark.** `OLLAMA_URL=... OLLAMA_MODEL=<tag> npm run bench:ollama -w server` (`server/src/umpire/ollamaBench.ts`) calls a live Ollama with no fallback: the golden order corpus (`orders/eval`), `checkNarration` over six report batches, and the staff checks for the four seats twice. Result on a 4-CPU, no-GPU host shared with other work (load average 3 to 9 during the runs; latencies include that contention and a cold model load):

| Model | Disk | Memory | Parse (50 orders) | Narrate pass, median / p95 | Staff pass, median / p95 |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5:0.5b` | 397 MB | 0.8 GB | 24/50, median 3.5 s, p95 7.4 s | 6/6, 7.2 s / 8.9 s | 7/8, 15.7 s / 50.8 s |
| `gemma3:270m` | 291 MB | 0.8 GB | 4/50, 2.7 s / 4.2 s | 1/6, 6.3 s / 21.6 s | 0/8, 30.4 s / 41.4 s |
| `llama3.2:1b` | 1.3 GB | 2.4 GB | 24/50, 16.6 s / 48.6 s | 1/6, 11.8 s / 72.9 s | 8/8, 19.5 s / 51.0 s |

Narrate "pass" means the first reply passed `checkNarration` (no repair, no template); staff "pass" means a non-silent turn with no rejected reply. Parse "pass" counts the corpus's expected result per order. **No model parses a clear order**: all three score 0/10 in the `clear` category (they leave out `unitId`, or give names where place ids are required) and their 24 passes are clarifications and rejections that the corpus also accepts, with 5/15 on the injection orders. So `parse` is not on the model by default; set `OLLAMA_STAGES=parse,narrate,staff` to try it (an unusable parse falls back to the canned parser, after waiting for the model). `qwen2.5:0.5b` is the default because it is the smallest model that passes narration and almost all staff turns, and it is faster than the 1B model.

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

With `AI_COMMANDER=llm` and no `gameBudget` dollar or token cap, the server logs a startup warning, because the commander's share is a share of a cap and there is then nothing to limit it. Set `UMPIRE_GAME_BUDGET_USD` or `UMPIRE_GAME_BUDGET_TOKENS`.

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
| Per-game caps and cost report | `GameUmpireClient` | One per game over the shared client. `gameBudget`: dollars, tokens, calls per sliding minute. Staff calls are held to a quarter of each cap and the AI commander (its `command` calls and the parses of its text, via `commanderClient()`) to 40%, so neither starves a human's parsing or judging. Refuses with `UmpireError` kind `budget` or `rate-limit` (nothing sent), so stage code falls back. `report()` gives calls, tokens, cost and refusals per stage; `onMetric` logs each call and refusal. |
| Record / playback | `CallRecorder`, `PlaybackUmpireClient` | Playback has no provider, so no network. |
