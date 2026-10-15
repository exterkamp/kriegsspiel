# R6 independent bounded public-schema review

**Verdict: Changes needed at H.** Two blocking schema/budget defects must be repaired before accepting this dependency for the pure public render-adapter packet. The accepted contract remains unchanged; this is a bounded implementation repair, not a new design round or a request to implement registry/pin/storage/API work.

## Frozen source and exact coverage

- H: `d3ffe40785bf3e6adaa0464d2811e3ee2990f1da`.
- Tree: `7f101a0521ac17e586c8ee4492dea773fe2f8258`.
- Verified parent P: `5e8425de9c95a5b07ebd0a0e062181b0cd9cfa9b`.
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD verified still `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Contract: H's `docs/lobby-map-selection-pairing-contract.md`, SHA-256 `e0e950d00e53c7ed88d290f62023fb496483f0eae5c1fd317ee9c3cc6ed989e6`, with its accepted review's depth-32 / 65,536-value and receipt-404 clarifications.
- `/private/tmp/lobby-map-schema-candidate.json` matches H/tree/P. All seven changed paths are represented; every supplied SHA-256 matches its H blob. The three changed protocol product files in the execution snapshot match H exactly. No whole-snapshot equality is claimed: the coordinator's two untracked native-scenario content files are outside H and this review.
- Model/High verification is supplied by the packet. No reset, agent, permission change, external action, source/test/config/Git/server/pane/browser mutation or publication was performed. Only this exclusive report was written; prior reviews and the contract were not edited.

The complete P-to-H delta is seven paths. All were inspected from explicit Git objects:

| Path | H blob | Inspection |
| --- | --- | --- |
| `packages/protocol/src/battlefield-catalog.ts` | `3461e3d0c0c67a1f746529484d518fd9d6498114` | Entire module: budgets, iterative preflight, all nested strict schemas/refinements, types and decoders. |
| `packages/protocol/src/battlefield-catalog.test.ts` | `044faf91b48d35d72f0750b938db8d8affcd59ad` | Entire suite, fixture premises, boundary assertions and what they omit. Independently rerun. |
| `packages/protocol/src/index.ts` | `4228c2a7425685c438a174c9cff02eb34c979c3a` | Single additive export and surrounding legacy export. No legacy DTO edit. |
| `docs/lobby-map-selection-pairing-contract.md` | `edc1fc65cc3afa6a5593117e6b0f5f61c3c76a2f` | Frozen accepted amendment and scoped schema requirements. |
| `docs/lobby-map-selection-pairing-contract-review.md` | `841e3b110066fa31e2c5d14973cbb1de42049e1a` | Hash-bound acceptance, routine limits and bounded dependency-release conditions. |
| `docs/lobby-map-selection-chunk1-final-review.md` | `3924eb6889a33733dc443e71fb174f98de77383c` | Frozen R5 source/artifact/evidence and explicit missing browser-create gate; not reclassified as complete. |
| `docs/lobby-map-selection-execution-log.md` | `7829d10e5f2cbfdb48a8a5b009ef57c55322f270` | Complete delta and relevant surrounding checkpoint, including test-fixture correction and excluded native content. Author claims separated from reviewer results. |

Also read legacy `battlefield.ts`, protocol package/check configuration and the existing accepted caller context. No registry, private pin codec, request schema, database or endpoint is added by this candidate. Chunk 1 client source is unchanged by this delta.

## Blocking findings

### R6-B1 — P2: byte preflight materializes the oversized JSON before enforcing its cumulative budget

**Location:** `battlefield-catalog.ts:21–47`, `assertBattlefieldBudget`.

The iterative walk bounds depth/value count and each individual string's UTF-16 length, but never accumulates serialized bytes across strings, keys, containers or punctuation. After that walk it unconditionally calls `JSON.stringify(value)` and allocates a second UTF-8 buffer through `TextEncoder`, then checks the byte limit. `Object.values` also materializes a complete object-value array before applying the remaining-value limit. Object keys do not participate in the early string check.

An independent bounded probe passed an array of 32 references to the primitive string `'x'.repeat(60_000)` with a **65,536-byte** budget. The walk accepted its structure, and instrumentation observed `JSON.stringify` produce **1,920,097 characters** before the byte-limit error. No large/OOM experiment was run. The permitted structural count and per-string length allow far larger amplification; a small in-memory repeated-string input can require an enormous intermediate serialized string. This defeats the intended resource gate before expensive work, even though the function eventually rejects an ordinary-sized over-budget fixture.

**Required bounded repair:** account conservatively/exactly for cumulative JSON UTF-8 bytes during iterative traversal, including property names, escaping, scalar spellings and punctuation, rejecting as soon as the budget is exceeded. Avoid first materializing an unbounded value/serialization collection just to measure it. Only perform full serialization after proving that its output fits the selected budget, or use bounded incremental encoding without that full allocation. Keep depth/value checks, nonfinite/non-JSON rejection and aggregate limits. No new catalog/pin implementation is needed.

**Required effective tests:** cumulative repeated strings and oversized keys must fail before full-value serialization/encoding; retain byte-accurate Unicode/escaping/container boundary cases. Include early rejection for an over-wide object/array without an unbounded preflight staging allocation. The current dense UTF-8 and 16-entry catalog tests assert eventual rejection; they do not assert the missing early-allocation property.

This module is not yet exposed on an API, so this is a dependency/resource-contract blocker, not a claim of an observed production incident.

### R6-B2 — P2: the millimetre tolerance accepts values outside the integer-mm domain, including effectively zero lengths

**Location:** `battlefield-catalog.ts:59–74`, `millimetres`, shared `length`/`coordinate` refinements.

`abs(v * 1000 - round(v * 1000)) < 0.000001` permits arbitrary off-grid numbers sufficiently close to a millimetre. The positive-length check occurs before that tolerance and therefore accepts tiny positive widths/radii which quantize to **zero** millimetres. The decoder returns them unchanged, so this is neither exact integer-mm representation nor normalization to it.

An independent probe decoded a structurally valid entry with point `x = 1e-10` metres and `radiusM = 1e-10` metres. Both were accepted and returned exactly as supplied. These cannot represent the positive integer-mm geometry required by the native contract and real scenario loader. Similar off-grid perturbations can pass around nonzero coordinates. Existing `1.001` binary-float acceptance is necessary; an arbitrary absolute epsilon is not necessary to provide it.

**Required bounded repair:** check membership in the actual integer-mm representation without coercing the returned value—for example, a finite/safe integer rounded-mm value whose metres round-trip equals the supplied number. Positive lengths must correspond to at least one millimetre. Preserve legitimate `1.001`, `1500.123`, zero coordinates and upper-bound values; reject tiny positive lengths and non-mm perturbations rather than silently rounding them.

**Required effective tests:** tiny positive coordinate/radius/width, near-mm perturbations at zero and nonzero values, and exact valid 1 mm values. Keep the existing no-coercion behavior and binary-float regression. This is a schema-domain mismatch; digest authenticity/approval remains registry work and is not inferred here.

## Remaining schema assessment

The nested public object schemas use `.strict()` and explicit shape/kind unions; unknown private fields are rejected rather than copied/stripped. The implementation uses ordinary Zod number/string/boolean/literal parsing and has no coercion, trimming or default-value transformation. Decode returns Zod-detached data, preserving legitimate display whitespace and geometry. Map/pairing identities and IDs agree; `scenario-default` corresponds to `isDefault`. Collections require exactly one default, unique pairing IDs, and entry binding to collection scenario, with a separate independently supplied parent-scenario check in both decoders. Modern revision syntax is distinct from legacy scenario revision syntax. No full digest or registry-availability verification is claimed by these format checks.

Extents, feature counts, polygon/polyline minima, per-geometry and aggregate point counts, unique feature IDs, layer range, in-map coordinates and width/radius versus extent are implemented. Width/radius positivity is subject to R6-B2. Depth is rooted at zero and the value count includes the root; the iterative structural limits themselves are present. Aggregate catalog and individual descriptor limits are checked through decoders, subject to R6-B1's allocation ordering.

**Nonblocking integration limit:** exported raw `...Schema.parse/safeParse` do not apply the wrapper's byte budget or external parent binding. The tests deliberately show a structurally valid over-64-KiB descriptor passes the raw schema. Transport consumers must use the decoder/budget boundary, and publication of a whole `/scenarios` envelope must enforce the aggregate response budget across all scenarios, not independently for each collection. Neither transport/envelope wiring nor private pin limits are implemented or required in this packet. This distinction must remain in the adapter/registry packets; do not treat importing an inferred type or calling a raw schema as server approval.

Accepting an `owned` source shape does not make an owned map approved/playable: the module explicitly requires later server registry resolution. The current native-only release must keep canonical geography unpaired. No map-source value, digest-shaped string, empty preview or internally coherent logical ID is a substitute for that later authoritative membership check.

## Tests and independent evidence

On the matched snapshot protocol source, using pinned Node **v22.23.3**, R6 ran:

```sh
node ../../node_modules/vitest/vitest.mjs run --no-cache --configLoader runner
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**99 tests / 4 files passed; protocol non-emitting typecheck passed.** `git diff --check P H` passed. R6 did not independently run a build or full-root suite; the author-reported protocol build is not a reviewer-run result.

R6 also ran an isolated inline Node/assert probe importing the actual matched schema source with TypeScript stripping. It confirmed R6-B2's accepted tiny values and instrumented/restored `JSON.stringify` within that process to confirm R6-B1's 1,920,097-character allocation before rejection. No source fixture, deliberate source mutation, server, database or browser operation was used. No huge-memory stress test was attempted.

The new tests meaningfully cover parent binding, detachment, private-field rejection, modern revision format, default/identity mismatch, basic invalid coordinates, binary representation, extent/text/layer/radius checks, duplicate/features/point limits, collection defaults, unsupported geometry, structural depth/value count and eventual UTF-8 byte limits. Their Unicode over-limit test retains a correct explicit size premise. Gaps are the two observed boundary conditions above, not a request for an artificial coverage target. The native-scenario content tests and their reported correction were not run or accepted by R6.

## Packet disposition

Do not accept H as the frozen schema dependency for the next writer yet. Release only a bounded repair of the schema budget/mm predicates and effective regression tests, then obtain a new exact candidate/manifest and delta review. Leave the legacy DTO and all source/API/pin/storage exposure semantics unchanged. The accepted e0e950 contract does not need a new design cycle. This report makes no change to R5's explicit browser create-to-live limit and no claim of native content, registry, codec, durable receipt or alternative-map readiness.
