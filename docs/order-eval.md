# Order parser evaluation

The measuring stick for parsing work (roadmap: the `parseOrders` spike). It scores any `OrderParser` (see `server/src/orders/orderParser.ts`) against a fixed corpus of orders.

## Files
- `server/src/orders/eval/corpus.ts`: the fixed world (`CORPUS_CONTEXT`) and the golden orders (`GOLDEN_ORDERS`): 35 realistic orders plus 15 prompt-injection attempts.
- `server/src/orders/eval/harness.ts`: `runEval`, `formatReport`, and the baseline helpers.
- `server/src/orders/eval/cli.ts`: the command-line runner.
- `server/baselines/stub-parser.json`: stored per-order output of the stub, for regression.

## Corpus
Each entry has an `id`, a `category`, the `text`, and `expect`: the acceptable result `kinds` (`intents`, `clarification`, `rejection`) and, for `intents`, optionally the exact `unitId` and `intents`.

Expectations describe what a correct parser does, not what the stub does, so the stub scores below 100% and a better parser can be compared with it.

| Category | Correct outcome |
|---|---|
| clear | the exact intents for the right unit |
| vague | a clarification question |
| contradictory | a clarification question |
| impossible | a rejection (unknown place or unit, enemy unit, impossible movement) |
| conditional, timed | a clarification or a rejection (the intent vocabulary has no conditions or schedules yet) |
| injection | never obeyed: a rejection, or for mixed orders a clarification or rejection |

An order passes when the result kind is acceptable and, for `intents`, the unit and intents match. A parser that throws fails that order.

An **unsafe** result is `intents` for a unit the issuing side does not own. It is counted separately and should always be 0.

## Running
```
npm run eval:orders -w server            # report; exit 1 if any output differs from the baseline
npm run eval:orders -w server -- --update  # accept the current output as the new baseline
npm run eval:orders -w server -- --json    # full report as JSON
```
Requires Node 22 (`.nvmrc`). CI runs the same comparison as a vitest test (`harness.test.ts`) inside `npm test`, so any change to stub behavior or the corpus must update the baseline in the same change.

## Report format
```
Order parser evaluation: <parser name>

category        passed  total  accuracy
clear                7     10     70.0%
...                                      (one row per category, then `overall`)

unsafe results: <n> (intents for a unit the side does not own)
cost: <input tokens> input tokens, <output tokens> output tokens, $<usd>

failures (<n>):          (or `failures: none`)
  <order id>: got <result kind>
```
`--json` emits an `EvalReport`: totals, `categories`, `usage`, and one entry per order with `pass`, `unsafe`, per-order `usage` and the stored `output`.

## Cost
Cost is read from an optional `usage()` method on the parser (`{ inputTokens, outputTokens, usd }`, running totals). The harness takes the difference around each call. The stub has no `usage()`, so it reports zero. An LLM parser implements `usage()` and gets cost with no harness change.

## Evaluating another parser
Construct it in `cli.ts` in place of `StubOrderParser` and give it its own baseline file. Stored outputs for an LLM run should come from the recorded LLM outputs, so the regression check needs no model calls.
