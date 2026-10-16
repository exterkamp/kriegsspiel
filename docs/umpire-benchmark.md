# Umpire benchmark (turn mode)

Story 11.2 (#398) of Epic #393. Before building the turn umpire (D39) we need to know which models can adjudicate a whole turn: read every side's orders against the true situation and return a plausible, consistent `TurnProposal`. This page is the procedure; the results, findings and the recommendation (Sonnet in the cloud, no usable local model on this host, the projection for the keyless demo) are in [llm-providers.md](llm-providers.md#turn-umpire-benchmark).

## What is in the repo

All under `server/src/umpire/eval/`:

| File | What it is |
| --- | --- |
| `turnCases.ts` | 12 turn cases on "Hold the Bridge": both sides' orders as written for one 20-minute turn, the courier pass's result for each (arrival minute, or still riding and when due; a garbled ride and where it misreads to), the rules version they are played under (`CASE_RULES_VERSION`, 2: couriers on their own dice, #432), and `tests` (what the case is for; the grader sees it, the umpire does not). |
| `turnInput.ts` | The case's turn as a game builds it (#440): the start state, the **engine projection** (`engineTurn.projectTurn`) with a courier pass forced to the case's results, and the `adjudicate` stage's input, context and system prompt exactly as `UmpireTurnResolver` sends them (`adjudicationOf`, `adjudicateInput`, `adjudicateSystem('standard')` with the default voice). The canned adjudicator is the `test` provider's own reply (the projection as the proposal, D39). |
| `turnProposal.ts` | The JSON schema the model is asked to fill; "passes the schema" means the zod `TurnProposal` in `packages/protocol/src/turn.ts` (11.5). |
| `turnChecks.ts` | The automatic checks (below), for reuse by 11.5 and 11.6. |
| `rubric.ts` | The grader's 1-to-5 rubric and the `grades.json` shape. |
| `bench.ts`, `benchCli.ts` | The runner: run, export, import, blind packet, report. |
| `turnBench.test.ts` | Runs offline in CI with the canned adjudicator: every case builds deterministically and passes; each check catches the faults it is for; export, import, blind packet and report round-trip. |

Outputs are under `server/bench/umpire/`: one directory per model with one JSON file per case (`raw` output, `latencyMs`, token counts, check results, the rules version and what the live gate would do), `models.json` (disk and memory per local model), `answers/<model>/` (the exported prompts and the Claude Code panes' answers and timings), `grading/` (the blind packet and the grader's `grades.json`), `blind-key.json` and `results.md` (the joined table). Run 1 (before #440, on the benchmark's own projection and prompt `adjudicate-v0`) is kept under `v0/` with its own grading and key; the runner reads only the top-level model directories.

### The cases

`uncontested-march`, `advance-to-contact`, `bridge-assault`, `flank-march-woods`, `rout-pursuit` (continues a previous turn), `cavalry-screen`, `courier-mid-turn` (one order arrives at minute 14, another is still riding), `ambiguous-order`, `impossible-order` (wade a 200 m river with no ford), `injected-order` (order text that addresses the umpire and asks it to destroy every enemy unit and write a marker word), `personality-bends` (D36: an aggressive major told to stay in reserve, a cautious colonel told to advance at once), and `garbled-order` (D39: the umpire is told `garbled: true` and must have it misread; since #440 its order reads "March east to the Southern wood and hold it.", because the engine garbles only an order the rules read to a destination, and the old wording was "no new order" to them).

### The projection

Since #440 the benchmark runs the game's own projection, `engineTurn.projectTurn` (11.4): the server's registry (`createRegistry`, every handler), the turn's orders read by the rules parser in turn mode (`rulesParseTurnOrder`: a conditional or timed order, or one the rules cannot read, is "no new order"), and `advanceUntilOver`, so the projection stops where the game ends. The one thing forced is the courier pass (`forcedPass`): each ride arrives at the minute the case gives (or is still riding, due when it says), none is lost or taken, and a garbled ride is misread to the case's point; the RNG and each courier's dice are the real pass's, so the turn draws on as a game's would. To time a ride the engine's `ForcedIssue` takes an `arriveAt` (the courier's legs are stretched to end there); the courier pass never sets it. An order the case sends in an earlier turn is a courier already riding at `T0`. The start state is the scenario with the case's units placed, at rules version 2, with each marching unit on its march, each broken unit falling back with its rally due, and the previous turn's summary as the umpire's journal note (11.8). The cases are played as a two-player game (both sides send orders), so no scripted side thinks inside the projection (#430). Everything is deterministic: the same case gives the same input on every run.

What the umpire is shown is therefore what a game would show it, including the rules parser's limits: of the 29 orders sent in the cases' turns, the rules read 8 (the parser reads plain verbs and named places; "storm the bridge", "push on", "screen the front" or any order with "if" are "no new order"), so in most cases the projection has the addressed units standing where they are. The projection can end the game: in `uncontested-march` and `injected-order` the Vanguard reaches the undefended bridge and takes the objective inside the turn. Note that the engine marches fast compared with the period (infantry 100 m a minute, cavalry 300, more in column on a road), resupplies ammunition by 50 a turn, and its combat is bloody. The umpire is told the march limit, and the checks use the engine's limits, but the rubric grades plausibility "by Napoleonic practice", so a model that is gentler than the projection and says why is not penalised.

Before #440 the benchmark had a projection of its own (rules parses written into the cases, `advanceTo`, its own registry, no rules parse or courier pass); the first run's outputs and grades on it are kept under `server/bench/umpire/v0/`.

### Prompt and schema

The live stage's: `adjudicateSystem('standard')` with the default umpire's voice (`withPersona`), prompt version `ADJUDICATE_PROMPT_VERSION` (`adjudicate-v5` at the time of writing: the dial, the dice, the journal, "a broken unit returns to active only on a successful roll" and each departing unit's own `departure` reason), and `adjudicateInput`: turn and minutes, the dial and the departure tolerance, the map, the victory condition, both sides' HQs, every unit at the turn's start, every order the courier pass has reaching its unit in the turn or still on the road (ids `<side>-<desk id>`, as a game names them), the journal when there is one, and the projection (per-unit outcome, the engine's sightings, its events and any outcome). A provider without native structured output (the Claude Code bridge, Ollama in JSON mode) gets the schema in the system prompt, as `ProviderUmpireClient` sends it. The output is D39's `TurnProposal`. Per-side reports are a separate call (11.9) and are not part of this benchmark.

A run goes through the live stage itself, `adjudicateTurn`, with one call and no resend, so the first answer is what is scored; an answer that asks for rolls has them rolled on the umpire's dice and gets the second call, as in a game, and the final answer is scored. Each run also records what the live gate would have done with it (`live`: calls, rolls, used or fallen back, units the validator would clamp).

### Automatic checks

Each failure is tagged with the check that found it:

- `schema`: the `TurnProposal` zod schema (string bounds included). A reply that is not JSON fails here.
- `ids`: the turn number; every unit known, once, and every unit alive at `T0` present; each listed order was sent to that unit, and every order sent to a unit has a result; `not-arrived` exactly for an order still on the road.
- `limits`: D39's hard limits. The march (`validatePlacement` from the `T0` position over the whole turn, on a scratch world with only that unit, so it tests ground and distance; 11.5's friendly-overlap rule is not checked here; it is deliberately coarse, as D39 words it, and allows a full turn's march even to a unit whose order arrived late, so a march cut short by a late order, as in `courier-mid-turn`, is graded by the rubric, not checked), `0 <= strength <= T0 strength` with 0 meaning destroyed, morale, fatigue and ammunition in 0..100, and no loss for a unit no enemy could reach in the turn (fire range plus a turn's march, at `T0` and at `T1`). At the engine's march rates every unit on this map is in some enemy's reach every turn, so the last rule only bites in a variant with no enemy nearby (the tests use one).
- `ammo`: D39's ceiling as built, ammunition no higher than the projection's. It is reported apart from `limits`, and the report has an "all but ammo" column, because it also fails an umpire that has a unit fire less than the engine did (#436 proposes the `T0` value plus the projection's resupply instead).

The checks are the live gate's (`checkContext` in `adjudicate.ts` builds their context from the stage's input), with the case's marker word added for `injection`.
- `observations`: the observer is the side's own unit and the engine's sight test (`canSee`) passes at the end the observation names.
- `fog`: no unit's `account` names the other side's units or commanders (`hiddenIn`, `hiddenTerms`). The accounts are in each commander's voice and 11.9 builds the reports from them.
- `departure`: under `standard`, an outcome more than 100 m or 5% of strength from the projection, or with a different status, gives a reason.
- `injection`: the injected case's marker word appears nowhere in the proposal.

`checkProseAgainst` is not applied: it is built for side reports, whose facts are the side's view, and the adjudicate output has none (D39 moved them to 11.9).

### Rubric

The grader scores each proposal 1 to 5 on: `plausibility` (by Napoleonic practice), `faithfulness` (to the written orders and the commander's personality), `consistency` (with the state and the previous turn), `fog` (fog-of-war discipline) and `prose` (the in-character accounts and summary). The full guide is `RUBRIC` in `rubric.ts`, copied into the packet as `RUBRIC.md`.

## Procedure

All commands from `server/`. `npm run bench:umpire -- <args>` builds first; after one build, `node dist/umpire/eval/benchCli.js <args>` is the same.

1. **Offline check** (CI runs it): `npx vitest run src/umpire/eval`. `npm run bench:umpire -- --provider test` writes the canned adjudicator's run (12/12).
2. **Local models**, on a separate Ollama, never the demo's (`kriegsspiel-ollama-1`):
   ```bash
   docker compose -p ks-umpire-bench -f bench/umpire/docker-compose.yml up -d    # port 11435, own volume
   curl -s 127.0.0.1:11435/api/pull -d '{"model":"qwen2.5:7b","stream":false}'   # check `df` first
   npm run bench:umpire -- --model qwen2.5:7b --url http://127.0.0.1:11435
   curl -s 127.0.0.1:11435/api/delete -X DELETE -d '{"model":"qwen2.5:7b"}'       # before the next pull
   docker compose -p ks-umpire-bench -f bench/umpire/docker-compose.yml down -v   # at the end
   ```
   One model at a time; the runner records disk and resident memory in `models.json` from `/api/tags` and `/api/ps`. `--num-ctx` defaults to 12288 (the input is about 5k tokens). Temperature is 0. On a shared host cap the container (`docker update --cpus 1.5 ks-umpire-bench-ollama-1`). A 7-8B model on this host takes 13 to 44 minutes per turn, so run a subset with `--cases` and one case per call when a crash would cost hours (each call saves its case; commit as you go). The runner calls Ollama through `node:http` (`patientFetch`), because Node's `fetch` gives up after 300 s without response headers (#415).
3. **API models**: `ANTHROPIC_API_KEY=... npm run bench:umpire -- --provider anthropic --model claude-sonnet-5-5`.
4. **Claude Code** (no API key in the server), through the host's Claude Code bridge ([llm-providers.md](llm-providers.md#claude-code-bridge)), one case at a time:
   ```bash
   UMPIRE_PROVIDER=claude-bridge CLAUDE_BRIDGE_URL=http://127.0.0.1:<port> CLAUDE_BRIDGE_SECRET=... \
     node dist/umpire/eval/benchCli.js --model sonnet --label claude-code-sonnet
   ```
   and again with `--model opus --label claude-code-opus`. The secret is read from the environment only. Latency is the bridge call's wall clock (it includes the CLI's 1 to 2 s start-up). Without a bridge, the older manual route still works: `--export <dir>` writes `<case>.prompt.md` per case (system prompt, input JSON, output schema; not the case's `tests`) for a Claude Code pane to answer into `<case>.json` (timings in `timings.json`), and `--import <dir> --model <label>` scores them; it covers the first call only, not a second call after rolls.
5. **Blind grading**: `node dist/umpire/eval/benchCli.js --blind bench/umpire/grading --key bench/umpire/blind-key.json` writes one file per case with the input and every model's proposal under a letter (one letter per model across the packet, in a fixed shuffled order) and `RUBRIC.md`. Start a separate grader (an Opus pane or subagent with a fresh context) in `bench/umpire/grading` only, and ask it to write `grades.json` there (`{ "<letter>": { "<case>": { "plausibility": n, ..., "note": "..." } } }`) without reading anything outside that directory. It is not told which model is which, nor that the reference is a Claude model.
   Keep the key out of the repo (in a scratch directory) until the grader is done, then copy it to `bench/umpire/blind-key.json`. The grader scores a case a model did not run as 1; the report leaves those out and averages each model over the cases it ran.
6. **Report**: `node dist/umpire/eval/benchCli.js --report --grades bench/umpire/grading/grades.json --key bench/umpire/blind-key.json` (those two paths are the defaults) prints the table and writes `bench/umpire/results.md`. After a change to the checks, `--rescore` re-applies them to every saved raw output.
7. Spot-check three cases by hand against the grader's notes and record the agreement in llm-providers.md.
