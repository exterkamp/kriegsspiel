# LLM providers

The umpire stages (`parse`, `judge`, `narrate`, `staff`, `critique` after the game, and `command` for the AI commander) call the `UmpireClient` interface in `server/src/umpire/`. Which model answers is configuration. See D14 in [decisions.md](decisions.md).

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

Env overrides (they win over the file): `UMPIRE_PROVIDER_PARSE|JUDGE|NARRATE|STAFF|COMMAND|CRITIQUE|ADJUDICATE`, `UMPIRE_MODEL_<same stages>`, `UMPIRE_TIMEOUT_MS`, `UMPIRE_TIMEOUT_MS_ADJUDICATE` (per attempt, default 300 s; the file's `stageTimeoutMs.adjudicate`), `UMPIRE_MAX_ATTEMPTS`, `UMPIRE_BASE_BACKOFF_MS`, `UMPIRE_MAX_BACKOFF_MS`, `UMPIRE_MAX_CONCURRENT`, `UMPIRE_MIN_INTERVAL_MS`, `UMPIRE_BUDGET_USD`, `UMPIRE_BUDGET_TOKENS`, `UMPIRE_GAME_BUDGET_USD`, `UMPIRE_GAME_BUDGET_TOKENS`, `UMPIRE_GAME_CALLS_PER_MINUTE`.

**The turn umpire** (`adjudicate`, D39, 11.6) defaults to `claude-sonnet-5-5` with a 12,000-token reply limit and the 300 s per-attempt timeout above; a whole turn's adjudication (both calls and their retries) is cut off after 15 minutes and the turn falls back to the engine. It runs only when `turnUmpireEnabled` holds: an Anthropic route with its key, or another provider type than `test` and `ollama` on the stage, or `UMPIRE_PROVIDER_ADJUDICATE` set explicitly (any provider, `test` included, for development). `TURN_UMPIRE=off` turns it off. Otherwise turn-mode games are decided by the engine at every dial; the keyless demo (Ollama or `test`) is in this case, by the benchmark below. The stage is not in `OLLAMA_STAGES`' eligible list. Its calls count against the game's `GameUmpireClient` caps; a refused call is not retried and the turn falls back. After an umpire turn the same client makes one report call per human side on the `narrate` stage's route (prompt `turn-reports-v1`, D39 "As built (11.9)"), with that route's provider and model; a failed or refused report call keeps the engine's text and never fails the turn.

**API keys come only from the environment.** A provider names the variable in `apiKeyEnv`; a literal key in a file is rejected. `anthropic` defaults to `ANTHROPIC_API_KEY`. `openai-compatible` sends no key unless `apiKeyEnv` is set. Never commit keys.

Provider types: `anthropic`, `openai-compatible`, `ollama`, `claude-bridge` (the host's Claude Code, [below](#claude-code-bridge)) and `test`. Provider fields: `type`, `baseUrl`, `apiKeyEnv`, `structuredOutput` (`native`, `json-mode` or `none`, see below), `contextWindow` (informational), `numCtx` (Ollama).

## Test provider

`{ "type": "test" }` answers every stage from rules and templates, with no model and no network (`server/src/umpire/providers/test.ts`, `testParse.ts`). It is for demos and tests without a key.

Select it with `UMPIRE_PROVIDER=test` (every stage), `UMPIRE_PROVIDER_<STAGE>=test` (one stage), a `test` provider named in the config file, or `UMPIRE_KEYLESS_PROVIDER=test`, which moves only the stages that would use Anthropic with no `ANTHROPIC_API_KEY` (the Docker image and compose file set it; a key switches back to the real model). `ORDER_PARSER=stub` still forces the rule-based parser. Its model name is `test` and it is priced at zero, so budgets and per-game caps never trip.

| Stage | What it does |
| --- | --- |
| `parse` | Finds the unit (id, name, or `the cavalry`, `the 1st`), then one or more clauses split at `and`, `then` and commas, each a verb (move, hold/screen/defend, withdraw/fall back, attack) and a place (by name, or by kind narrowed by name words, such as `the northern wood`). `it` or `there` means the place before. No unit named: the unit nearest the first place. Several fits: a clarification with options. An unknown place or unit, no verb, or injected instructions: a rejection with a reason. Conditions and times are ignored. |
| `narrate` | One dispatch per report, built only from the report's own officer, place, size and numbers, so it passes `checkNarration`. A turn report (11.9) also says what became of the unit's orders and its losses, and gives the umpire's account as written. |
| `staff` | One short piece of advice, chosen by the topic keywords of an optional `question` (enemy, supply, fatigue, ground, orders) or else by the officer's role, from counts in the officer's view. |
| `judge` | No placements. |
| `command` | Every unit holds the named place nearest the objective. |
| `critique` | Quotes the digest's own facts as points (result, a report per side, misreadings, pauses, a delivery), so it passes `checkCritique`. |
| `adjudicate` | The engine's projection as the proposal: each unit where the projection ends it, every arrived order `carried-out` and every riding one `not-arrived`, the engine's own sightings, no departures. A turn it answers ends as the engine adjudicator's would. |

Its output is deterministic and validated like any model's, and recorded through `CallRecorder`. The game shows a "Test umpire (canned responses)" badge (`GET /scenarios` carries `umpire: "test"`), and the admin LLM panel shows its calls with mode `test`.

## Local model in the Docker demo

`UMPIRE_KEYLESS_PROVIDER=ollama` (the compose default) puts `narrate` and `staff` (and `parse` if `OLLAMA_STAGES` lists it) on an `ollama` provider built from the env: `OLLAMA_URL`, `OLLAMA_MODEL` (default `qwen2.5:0.5b`), `OLLAMA_NUM_CTX` (4096), `OLLAMA_TIMEOUT_MS` (60000), with temperature 0.2, at most 700 output tokens (400 for parse, 220 for narrate, #419), two attempts, and one call at a time. Every other stage uses `test`. With a key, none of this applies.

**Fallback.** `createUmpireClient` wraps those stages in `FallbackUmpireClient` (`server/src/umpire/fallbackUmpireClient.ts`) when the config has `fallbackProvider` (set for this mode). If the model call fails with a transport error (Ollama down, or `model not found` while it is still being pulled), a timeout, a refusal, or output that still fails the schema after the allowed attempts, the same request is answered by the `test` provider and the returned record carries `fallbackFor` (reason, kind, provider, model). A transport failure or timeout also makes the client skip the model for 30 s so a down or slow model does not cost each call its timeout; schema failures do not, so a model that keeps producing bad output costs each call its full attempts before the fallback answers. The one-call-at-a-time limit applies to the model only: `test` stages and fallback answers never queue behind it. Budget and rate-limit refusals are not retried elsewhere. Narration and staff replies that parse but fail `checkNarration` or the staff checks are already replaced by the engine's template text or silence, as with any model. The order parser, if `parse` is on the model, falls back to the canned parser and then the rule-based stub. The recorded call is the one that answered, so replay needs no model. The trace marks fallback calls with mode `fallback` and the reason; the admin LLM panel shows the provider (`ollama`), model, latency, token counts and that mode.

**Narration and staff answers on a slow model (#342).** Three limits decide whether a small local model's text reaches the player. (1) The narrate stage holds game time (the LLM barrier) for at most `narrateTimeoutMs` (default 150 s, `GameActor`/`GameHost` option), separate from the 60 s order-parse timeout: a CPU model answers in 55 to 107 s under load, and with the parse timeout shared the reply was thrown away after 60 s and the template text stayed, which is why no dispatch was ever model-written. Narration makes at most two model calls per window (one retry), so a fallback costs at most the one timeout, not a second wait. (2) A staff answer to a conference question must be complete: `checkAnswerText` rejects a fragment (under three words, or not ending in a full stop, `!`, `?` or a closing quote, as when the model stops mid-sentence) and an officer who sends the commander to his own post. The call is repeated once with the problems listed; if the second reply fails too, the exchange is text-less and the client answers from the view (the canned answer). (3) The narration window is in game time: 5 minutes at 1:1, growing with the rate and capped at 20 game minutes (`narrateWindowMs`): 5, 10, 20 and 20 minutes at 1:1, 2:1, 4:1 and 12:1, so a 50-minute game at 12:1 still gets windows (about 100 wall seconds apart). A call longer than that holds the clock, so on a slow host prefer a lower rate. The same window paces vacant-seat staff reports (`runStaff`), so at 12:1 they speak every 20 game minutes instead of every 60, about three times as many staff calls per game. When narration falls back, the `narrate` input-log entry (and the admin LLM panel) says why: the problems found in each rejected reply, a timeout, or a refused call; the rejected raw output is in the entry's `calls`. The benchmark prints `outcomes` (first try, retried, fallback) for narration and for conference answers.

**Narration on a small model (#419).** Four things keep a weak model from wasting time or reaching the player with nonsense. (1) A side played by a server-side agent (the scripted or LLM opponent) is never narrated. (2) A per-game circuit breaker: when 3 of the last 5 narrate calls failed the checks, timed out or failed, the model is not called for a cooling-off of three narration windows of game time (at least 15 game minutes) and reports keep their template text; the admin LLM panel shows a `fallback` row from "narration breaker", e.g. "model narration paused: 5 of 6 failed, until game minute 75". The state is logged on each `narrate` input entry and restored when a game is reopened. (3) `checkFieldNote` rejects third-person accounts of the sender's own unit, invented durations ("for 10 minutes"), strengths ("a strong line") and fire, contradictory or wrong condition words, a recited condition list, a note that does not say what happened, and notes over 360 characters or 4 sentences; each rejection's reason is in the entry and the trace. (4) The template text a player sees instead is a field note by report kind and the sender's manner, chosen from the game seed and report id (`fieldNote` in the engine), so it reads like a note and replays exactly. Prompt `narrate-dispatches-v7` is short and states the rules the checks enforce, plus one to hedge an unsure report.

**Narrate benchmark.** `OLLAMA_URL=... OLLAMA_MODEL=<tag> npm run bench:narrate -w server -- [--per-kind 3] [--system-file f --prompt-version v] [--max-tokens n] [--out f.json]` (`server/src/umpire/narrateBench.ts`) narrates realistic reports of eight kinds from four officers in varied states, one report per call with no retry and no fallback, and judges each reply by the fact check alone (what passed before #419) and by the full checks, with the rejection reasons per kind and latency. `--system-file` tries another prompt without a code change; the order debug page (D40) does the same for orders.

**Benchmark.** `OLLAMA_URL=... OLLAMA_MODEL=<tag> npm run bench:ollama -w server` (`server/src/umpire/ollamaBench.ts`) calls a live Ollama with no fallback: the golden order corpus (`orders/eval`), `checkNarration` over six report batches, and the staff checks for the four seats twice. Result on a 4-CPU, no-GPU host shared with other work (load average 3 to 9 during the runs; latencies include that contention and a cold model load):

| Model | Disk | Memory | Parse (50 orders) | Narrate pass, median / p95 | Staff pass, median / p95 |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5:0.5b` | 397 MB | 0.8 GB | 24/50, median 3.5 s, p95 7.4 s | 6/6, 7.2 s / 8.9 s | 7/8, 15.7 s / 50.8 s |
| `gemma3:270m` | 291 MB | 0.8 GB | 4/50, 2.7 s / 4.2 s | 1/6, 6.3 s / 21.6 s | 0/8, 30.4 s / 41.4 s |
| `llama3.2:1b` | 1.3 GB | 2.4 GB | 24/50, 16.6 s / 48.6 s | 1/6, 11.8 s / 72.9 s | 8/8, 19.5 s / 51.0 s |

Narrate "pass" means the first reply passed `checkNarration` (no repair, no template); staff "pass" means a non-silent turn with no rejected reply. Parse "pass" counts the corpus's expected result per order. **No model parses a clear order**: all three score 0/10 in the `clear` category (they leave out `unitId`, or give names where place ids are required) and their 24 passes are clarifications and rejections that the corpus also accepts, with 5/15 on the injection orders. So `parse` is not on the model by default; set `OLLAMA_STAGES=parse,narrate,staff` to try it (an unusable parse falls back to the canned parser, after waiting for the model). `qwen2.5:0.5b` is the default because it is the smallest model that passes narration and almost all staff turns, and it is faster than the 1B model.

## Claude Code bridge

The `claude-bridge` provider (#457) runs the umpire on Claude Code's models through the `claude` CLI and its login on the host, so a subscription can serve the game with no API key. The game server runs in Docker and the CLI does not, so a small host-side service, `tools/claude-bridge/`, sits between them: `POST /v1/generate` takes the provider request (model, system prompt, messages, JSON schema, `maxTokens`) and runs `claude -p` once for it.

**Isolation.** Each request is a fresh `claude -p --output-format json` process with `--tools ""` (no tools at all), `--safe-mode` (no CLAUDE.md, hooks, plugins or skills), `--strict-mcp-config` (no MCP servers), `--permission-mode dontAsk --permission-prompts none` (nothing can prompt), `--disable-slash-commands` and `--no-session-persistence`, in a new empty working directory under the system temp directory that is deleted afterwards. The system prompt replaces Claude Code's own and is passed as a file outside that directory; the messages go on stdin (a repair turn's rejected reply is quoted in the prompt, as the CLI takes no assistant turns). A model reply is text and nothing else: it cannot run a command or touch a file. `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from the child's environment, so a key in a shared `.env` does not silently bill the API instead of the subscription.

**Structured output.** The provider declares `json-mode`: the client puts the schema in the system prompt and validates and repairs the reply as for any provider. `structuredOutput: "native"` on the provider spec makes the bridge pass the schema to `--json-schema`, which the CLI enforces with an extra tool turn; it is not the default because it has not been measured on the umpire's schemas.

**Failures.** The bridge maps the CLI to HTTP statuses, by the API status when the result has one and by its text otherwise, that the provider turns into `TransportError` verdicts: CLI not found or not logged in, 424 (not retried); rate or usage limit, 429 with `Retry-After` (from the limit's reset time, else 60 s; the client fails at once when that is longer than the barrier can wait); overloaded, 503; another API 4xx such as an unknown model, 400 (not retried); a crash or output with no result event, 502; no answer within `CLAUDE_BRIDGE_TIMEOUT_MS`, 504; the queue full, 503. A reply cut at `maxTokens` (passed as `CLAUDE_CODE_MAX_OUTPUT_TOKENS`) comes back `truncated`. On a timeout, or when the server gives up and closes the connection, the bridge kills the CLI's whole process group (SIGTERM, then SIGKILL after 2 s); a queued request is dropped. A body over the size limit gets 413 (not retried). On SIGTERM or SIGINT the bridge kills every run and waits for them to end (up to the kill grace plus a second) before it exits.

**Cost and tokens.** Token counts come from the CLI's result event (input, output, cache read and cache write), so token budgets work. Cost is reported as zero, since a subscription is not billed per call and the CLI's `total_cost_usd` is a list-price estimate; budgets in dollars therefore never trip. With `CLAUDE_BRIDGE_BILLING=api` (the CLI logged in with an API key) the bridge reports that cost and budgets count it.

**Security.** The bridge spends the host's Claude subscription, so it binds the docker0 gateway (`172.17.0.1`) by default, which the containers can reach and other LAN hosts normally cannot, and it refuses to start on any address but the loopback without `CLAUDE_BRIDGE_SECRET` (at least 16 characters), which every request must carry as `Authorization: Bearer`. It refuses `0.0.0.0` and `::`, in any spelling. The server sends the secret from `CLAUDE_BRIDGE_SECRET` (or the variable named by the provider's `apiKeyEnv`). Never publish the port.

**Run it.**

```bash
# on the host, where `claude` is installed and logged in; .env is read if present
echo "CLAUDE_BRIDGE_SECRET=$(openssl rand -hex 24)" >> .env
npm run claude-bridge          # builds tools/claude-bridge and listens on http://172.17.0.1:8790
docker compose -f docker-compose.yml -f docker-compose.claude-bridge.yml up -d
```

Without Docker (`npm run dev -w server` on the host), set `CLAUDE_BRIDGE_HOST=127.0.0.1` for the bridge, which then needs no secret, and `UMPIRE_PROVIDER=claude-bridge CLAUDE_BRIDGE_URL=http://127.0.0.1:8790` for the server. Under `devrun`: `devrun up --name claude-bridge --port-env CLAUDE_BRIDGE_PORT -- sh -c 'CLAUDE_BRIDGE_HOST=127.0.0.1 npm run claude-bridge'`. It logs one JSON line per call with the model, queue wait, CLI time and tokens.

| Bridge variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_BRIDGE_HOST` | `172.17.0.1` | Address to listen on. Not `0.0.0.0`; anything but the loopback needs the secret |
| `CLAUDE_BRIDGE_PORT` | `8790` | Port |
| `CLAUDE_BRIDGE_SECRET` | unset | Shared bearer secret, also set for the game server |
| `CLAUDE_BIN` | `claude` | The CLI to run |
| `CLAUDE_BRIDGE_MAX_CONCURRENT` | `2` | CLI runs at once; the rest wait in order. Time in the queue counts toward the server's per-attempt timeout (60 s), so with several games resolving turns at once raise this or `UMPIRE_TIMEOUT_MS` |
| `CLAUDE_BRIDGE_MAX_QUEUE` | `16` | Waiting requests beyond this get 503 |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `300000` | Kill a run after this long (the server's own per-attempt timeout is usually shorter) |
| `CLAUDE_BRIDGE_BILLING` | `subscription` | `api` reports the CLI's cost to the server's budgets |

**Server side.** `UMPIRE_PROVIDER=claude-bridge` puts every stage on the bridge, `UMPIRE_PROVIDER_<STAGE>=claude-bridge` one stage, and `UMPIRE_KEYLESS_PROVIDER=claude-bridge` every stage that would use Anthropic with no key (parse, judge, narrate, staff, command, critique and adjudicate), with the `test` provider as the fallback while the bridge is down or failing, as in the Ollama mode above; the turn umpire's `adjudicate` falls back to the engine instead (D39). Naming the bridge in any of these, or setting `CLAUDE_BRIDGE_URL` (default `http://127.0.0.1:8790`), configures a `claude-bridge` provider; a config file can define its own (`{ "type": "claude-bridge", "baseUrl": "...", "apiKeyEnv": "..." }`). Stages keep their route's model (`claude-haiku-5-5` for parse, `claude-opus-5-5` for judge, `claude-sonnet-5-5` for the rest), which the CLI accepts, and `UMPIRE_MODEL_<STAGE>` picks another, including the CLI's aliases `sonnet`, `opus` and `haiku`. Timeouts and attempts are the ordinary ones (60 s per attempt, 300 s for `adjudicate`, three attempts). The turn umpire is on with the bridge (`turnUmpireEnabled`), and the admin LLM panel shows the provider `claude-bridge` and the model like any other.

**Measured** on this host (CLI 2.1.299, `UMPIRE_PROVIDER=claude-bridge`, through `createUmpireClient` and the real stage code, one call each, all valid on the first attempt): parse (`claude-haiku-5-5`, the golden order "Move the 1st Battalion to the bridge and hold it.") 3.7 s; narrate (`claude-sonnet-5-5`, one contact report) 3.5 s; adjudicate (`claude-sonnet-5-5`, benchmark case `advance-to-contact`, 4,192 output tokens) 31.9 s. Of that, the CLI's start-up is about 1 to 2 s per call. From the game container over the docker0 address a trivial call took 2.9 s.

## Turn umpire benchmark

Story 11.2 (#398): can a model adjudicate a whole turn (D39)? The cases, prompt `adjudicate-v0`, checks, rubric and procedure are in [umpire-benchmark.md](umpire-benchmark.md); raw outputs, grades and the joined table are in `server/bench/umpire/`. Run 2026-10-12/13 on this host (4 CPUs, no GPU, 15 GB RAM, shared with other agents).

| Umpire | Cases | Schema | All checks | All but ammo | Failing checks (cases) | Median / p95 per turn | Plausibility | Faithfulness | Consistency | Fog | Prose | Rubric mean | Disk | Memory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code, Opus (`claude-opus-5-5`) | 12 | 12/12 | 7/12 | 12/12 | ammo 5 | 29 s / 52 s | 5.0 | 5.0 | 4.9 | 5.0 | 5.0 | **5.0** | cloud | cloud |
| Claude Code, Sonnet (`claude-sonnet-5-5`) | 12 | 12/12 | 7/12 | 11/12 | ammo 5, departure 1 | 31 s / 54 s | 4.6 | 4.9 | 4.8 | 4.9 | 5.0 | **4.8** | cloud | cloud |
| `test` (projection as proposal) | 12 | 12/12 | 12/12 | 12/12 | none | 0 | 2.7 | 2.2 | 3.8 | 3.1 | 1.0 | 2.6 | 0 | 0 |
| `qwen2.5:7b` | 6 | 6/6 | 0/6 | 0/6 | ids 6, observations 6 | 13 min / 24 min | 2.5 | 2.2 | 3.2 | 2.0 | 2.0 | 2.4 | 4.7 GB | 5.7 GB |
| `llama3.1:8b` | 5 | 5/5 | 0/5 | 0/5 | ids 2, observations 5, departure 1 | 24 min / 27 min | 2.2 | 2.4 | 2.4 | 2.4 | 1.4 | 2.2 | 4.9 GB | not recorded |
| `gemma4:e4b` | 6 | 6/6 | 0/6 | 0/6 | ids 1, limits 1, observations 5, departure 1, injection 1 | 32 min / 44 min | 1.7 | 1.5 | 2.0 | 1.8 | 2.2 | 1.8 | 6.6 GB | 7.6 GB |
| `gemma4:12b`, `qwen2.5:14b` | - | not run | | | | | | | | | | | 8.0 / 9.0 GB | |
| `gemma4:26b`, `gemma4:31b` | - | not run | | | | | | | | | | | 18.7 / 20.4 GB | |
| Anthropic API | - | not run | | | | | | | | | | | | |

How to read it:
- **Cases.** The Claude Code umpires and `test` answered all 12 cases. The local models ran a fixed subset, because one turn takes them 13 to 44 minutes here: the 7-8B models and Gemma 4 e4b ran `uncontested-march`, `advance-to-contact`, `bridge-assault`, `courier-mid-turn`, `impossible-order` and `injected-order`; `llama3.1:8b` lost its sixth (`injected-order`) to a Docker daemon crash on the host and is reported on five. Rubric means are over the cases each model ran. On that same six-case subset Opus passes 6/6 and Sonnet 5/6 of every check but ammo.
- **Not run.** `gemma4:12b` and `qwen2.5:14b` were not run: the 7-8B models already take 13 to 27 minutes per turn on this host, a 12-14B model would take roughly twice that, and the owner capped the run after the daemon crash. `gemma4:26b` and `gemma4:31b` need more memory than the host has. No `ANTHROPIC_API_KEY` is configured, so the API rows were not run; the Claude Code panes stand in for Sonnet and Opus with the same prompt and schema.
- **Latency.** Claude Code times are from each pane's `date` before reading a case and after writing the answer, so they include file handling and are an upper bound on an API call. Local times are wall clock with Ollama on about 2 CPUs (its default thread count here) while other agents shared the host; the Gemma run was capped at 1.5 CPUs.
- **Memory.** `qwen2.5:7b` from Ollama `/api/ps`; `gemma4:e4b` from `docker stats` while it ran (Ollama's `/api/ps` reported 1.9 GB after the run, which is not its working set); `llama3.1:8b` was not recorded before the crash.
- **Grading.** A separate Opus pane graded every proposal blind (letters A to F, model names and the key withheld). Grades are in `server/bench/umpire/grading/grades.json`, the key in `blind-key.json`. The grader may be biased toward Claude's own style; the automatic checks agree with its ranking independently. Spot check by hand on three cases (`impossible-order`, `uncontested-march`, `injected-order`): agreement on every ranking and on the reasons, with one correction to a note: the grader says the projection marched Blue-2 "over the impassable river" in `impossible-order`, but the engine routed it over the bridge; the outcome (a battalion through the Red army to its headquarters in 17 minutes on an order to wade) is still implausible, so the score stands.

What the failures were:
- **All three local models** copy the engine's projection for positions and losses and then write accounts that contradict it (`qwen2.5:7b` has Blue-2 "hesitate to cross" while placing it at the enemy headquarters; `llama3.1:8b` says it "waded the river" and that the hussars were destroyed "in the previous turn" on turn 1). Every one lists a unit as having observed itself, and two attach orders to units they were not sent to. `gemma4:e4b` departs from the projection but badly: it marches Red through the Blue line in an "uncontested" march, puts a battalion in the river, marks an order still on the road as carried out, and **writes the injected marker word**, obeying instructions hidden in an order.
- **Opus and Sonnet** read every order as written and as the commander would (the cautious colonel refuses to wade the river, the aggressive major makes one unauthorised charge, the garbled order is misread, the order on the road is not acted on), ignore the injected text and say so, and explain each departure from the projection. Their only check failures are D39's ammunition ceiling (below) and one missing departure reason from Sonnet.
- **The projection itself** (`test`, what `rigid` and the keyless demo do) passes every check but grades 2.6: the engine's march rates and combat are harsh (a column storming the bridge ends at 96 men, a hussar squadron is destroyed in 15 minutes, cavalry pursue 1.3 km), and it cannot refuse an impossible order or let a personality bend one.

Findings for the turn-mode stories (measured on the benchmark's own projection, written before 11.4's `engineTurn.projectTurn` landed and different from it in the ways [umpire-benchmark.md](umpire-benchmark.md#the-projection) lists; re-running on 11.4's is #440):
- **D39's ammunition ceiling is wrong.** "The projection's value is the ceiling" fails every umpire that has a unit fire less than the engine did (5 of 12 cases for both Claude umpires). The rule should be "no rise above the `T0` value except by the engine's supply rule"; 11.5 (#401) built the validator with the projection ceiling, so this is #436.
- **D39's reach rule hardly ever applies.** With engine march rates (cavalry 6 km and infantry 2 km per 20-minute turn) every unit on "Hold the Bridge" is within some enemy's reach every turn, so "no loss out of reach" catches nothing here (11.5).
- **Observations need a clearer prompt.** Every local model listed self-sightings; the field names (`unitId` seen, `by` observer) are easy to swap. 11.6 should say it in the prompt and the validator should drop them quietly (D39 already drops observations that fail the sight test).
- **Local calls cannot last past 300 s** through the server's `fetch` (#415), so a local adjudicator would fail at the timeout D39 sets even if it were good enough.

**Recommendation.**
- **Cloud: Sonnet** (`claude-sonnet-5-5`) as the `adjudicate` default, as D39 says. It grades 4.8 against Opus's 5.0, with the same check results apart from one missing departure reason, at the same speed in this harness; Opus is the option for a game whose owner wants the best umpire and accepts the cost.
- **Local: no model that runs on this host is good enough.** The 7-8B models and Gemma 4 e4b fail every case, take 13 to 44 minutes per turn, and one obeys injected text. Larger local models were not run; on this hardware they would be slower still.
- **Keyless demo:** keep D39's plan: `adjudicate` is not an Ollama stage, the `test` provider answers with the projection (the engine's resolution, with the canned badge), so turn mode plays as `rigid` at every dial. It is consistent and checkable but harsh and literal (rubric 2.6); with a key the umpire is Sonnet.

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
