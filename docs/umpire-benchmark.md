# Umpire benchmark (turn mode)

Story 11.2 (#398) of Epic #393. Before building the turn umpire (D39) we need to know which models can adjudicate a whole turn: read every side's orders against the true situation and return a plausible, consistent `TurnProposal`. This page is the procedure; the results and the recommendation are in [llm-providers.md](llm-providers.md#turn-umpire-benchmark).

## What is in the repo

All under `server/src/umpire/eval/`:

| File | What it is |
| --- | --- |
| `turnCases.ts` | 12 turn cases on "Hold the Bridge": both sides' orders as written for one 20-minute turn, courier status (arrival minute, or still riding), the rules parse the projection uses, and `tests` (what the case is for; the grader sees it, the umpire does not). |
| `turnInput.ts` | The case world (`loadScenario(holdTheBridge)` with the case's units placed), the **engine projection** of the turn, the umpire's input JSON and the prompt `adjudicate-v0`, and the canned adjudicator (the projection as the proposal, which is what the `test` provider does per D39). |
| `turnProposal.ts` | D39's `TurnProposal` zod schema (a copy of #414's `packages/protocol/src/turn.ts` until it lands) and the JSON schema the model is asked to fill. |
| `turnChecks.ts` | The automatic checks (below), for reuse by 11.5 and 11.6. |
| `rubric.ts` | The grader's 1-to-5 rubric and the `grades.json` shape. |
| `bench.ts`, `benchCli.ts` | The runner: run, export, import, blind packet, report. |
| `turnBench.test.ts` | Runs offline in CI with the canned adjudicator: every case builds deterministically and passes; each check catches the faults it is for; export, import, blind packet and report round-trip. |

Outputs are under `server/bench/umpire/`: one directory per model with one JSON file per case (`raw` output, `latencyMs`, token counts, check results), `models.json` (disk and memory per local model), `answers/<model>/` (the exported prompts and the Claude Code panes' answers and timings), `grading/` (the blind packet), `grades.json`, `blind-key.json` and `results.md` (the joined table).

### The cases

`uncontested-march`, `advance-to-contact`, `bridge-assault`, `flank-march-woods`, `rout-pursuit` (continues a previous turn), `cavalry-screen`, `courier-mid-turn` (one order arrives at minute 14, another is still riding), `ambiguous-order`, `impossible-order` (wade a 200 m river with no ford), `injected-order` (order text that addresses the umpire and asks it to destroy every enemy unit and write a marker word), `personality-bends` (D36: an aggressive major told to stay in reserve, a cautious colonel told to advance at once), and `garbled-order` (D39: the umpire is told `garbled: true` and must have it misread).

### The projection

11.4's projection (#400) does not exist yet, so the benchmark has its own: each order's rules parse (written in the case) is given to its unit at its arrival minute, units carry on with what they were doing, and the world advances from `T0` to `T1` under the server's handlers (movement, combat, morale, rally, visibility) on the scenario seed. No courier is rolled: the case fixes the courier results, as D39's courier pass does. It is deterministic, and it is what the umpire is shown under the `standard` dial. Note that the engine marches fast compared with the period (infantry 100 m a minute, cavalry 300, more in column on a road), and its combat is bloody (a hussar squadron that rides into a battalion's fire is destroyed in 15 minutes). The umpire is told the march limit, and the checks use the engine's limits, but the rubric grades plausibility "by Napoleonic practice", so a model that is gentler than the projection and says why is not penalised.

### Prompt and schema v0

`ADJUDICATE_SYSTEM` (`adjudicate-v0`) and the input of `turnInput(c)`: turn and minutes, the dial (`standard`) and the departure tolerance, the map's features, the victory condition, both sides' HQs, every unit (position, facing, formation, strength, morale, fatigue, ammunition, status, commander, personality and character, what it was doing, its march per turn on open ground, fire and sight ranges), every order as written with its courier status, the previous turn's summary when there is one, and the projection (per-unit outcome and the engine's events). The output is D39's `TurnProposal` exactly (per-unit `account`, private `summary`, observations); per-side reports are a separate call (11.9) and are not part of this benchmark. Rolls are not asked for in v0 (11.7).

### Automatic checks

Each failure is tagged with the check that found it:

- `schema`: the `TurnProposal` zod schema (string bounds included). A reply that is not JSON fails here.
- `ids`: the turn number; every unit known, once, and every unit alive at `T0` present; each listed order was sent to that unit; `not-arrived` exactly for an order still on the road.
- `limits`: D39's hard limits. The march (`validatePlacement` from the `T0` position over the turn, on a scratch world with only that unit, so it tests ground and distance; 11.5's friendly-overlap rule is not checked here), `0 <= strength <= T0 strength` with 0 meaning destroyed, morale, fatigue and ammunition in 0..100, ammunition no higher than projected, and no loss for a unit no enemy could reach in the turn (reach plus a turn's march, at `T0` and at `T1`).
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
   One model at a time; the runner records disk and resident memory in `models.json` from `/api/tags` and `/api/ps`. `--num-ctx` defaults to 12288 (the input is about 5k tokens). Temperature is 0.
3. **API models**: `ANTHROPIC_API_KEY=... npm run bench:umpire -- --provider anthropic --model claude-sonnet-5-5`.
4. **Claude Code reference umpire** (no API key in the server):
   ```bash
   node dist/umpire/eval/benchCli.js --export bench/umpire/answers/claude-code-sonnet
   ```
   writes `<case>.prompt.md` per case (system prompt, input JSON, output schema; not the case's `tests`). Start a Claude Code pane in that directory (Herdr: `herdr agent start <name> --kind claude --pane <pane> -- --model sonnet`) and ask it to answer each prompt, alone and in order, into `<case>.json` next to it, timing each with `date +%s%3N` into `timings.json` (the time includes reading and writing the files, so it is an upper bound on a model call). Then:
   ```bash
   node dist/umpire/eval/benchCli.js --import bench/umpire/answers/claude-code-sonnet --model claude-code-sonnet
   ```
   Repeat with `opus`.
5. **Blind grading**: `node dist/umpire/eval/benchCli.js --blind bench/umpire/grading --key bench/umpire/blind-key.json` writes one file per case with the input and every model's proposal under a letter (one letter per model across the packet, in a fixed shuffled order) and `RUBRIC.md`. Start a second pane (Opus) in `bench/umpire/grading` only, and ask it to write `grades.json` there (`{ "<letter>": { "<case>": { "plausibility": n, ..., "note": "..." } } }`) without reading anything outside that directory. It is not told which model is which, nor that the reference is a Claude model.
6. **Report**: `node dist/umpire/eval/benchCli.js --report --grades bench/umpire/grading/grades.json --key bench/umpire/blind-key.json` prints the table and writes `bench/umpire/results.md`.
7. Spot-check three cases by hand against the grader's notes and record the agreement in llm-providers.md.
