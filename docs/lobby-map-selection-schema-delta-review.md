# R6 repair delta: independent public-schema review

**Verdict: Accepted at H for the bounded public-schema dependency.** Both original R6 blockers, R6-B1 and R6-B2, are resolved in source and independent checks. This clears the schema prerequisite for a separately owned pure public render-adapter packet. It does not accept native content, private pin codecs, registry/availability, API/storage or playable alternative-map exposure. The original R6 report remains unchanged as a historical Changes needed verdict at its original revision.

## Exact source and coverage

- H: `97bed058c3214d103539f80859b91dcc84dc02b5`.
- Tree: `ac54b6399fd20c8aaa80548b594f48a4d0e7e7bb`.
- Verified parent / bounded delta base P: `d3ffe40785bf3e6adaa0464d2811e3ee2990f1da`.
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD verified still `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Manifest `/private/tmp/lobby-map-schema-repair-candidate.json` names H/tree/P. Every manifest SHA-256 matches its H blob, all four delta paths are represented, and both changed protocol source/test files match the execution snapshot at the check. No whole-snapshot equality is claimed. Coordinator-owned untracked native content/pin work is outside H and this packet.
- Contract remains the accepted `e0e950d00e53c7ed88d290f62023fb496483f0eae5c1fd317ee9c3cc6ed989e6` document plus the recorded depth-32 / 65,536-value and receipt-404 clarifications. No contract amendment was needed for these repairs.
- Packet supplies native High verification. No reset, agent creation, permission change, source/test/config/Git/server/browser/pane mutation, external message, merge or deployment was performed. The sole new output is this exclusive report. The original R6 report was independently checked byte-identical to its frozen H copy and was not edited.

The complete P-to-H inventory is four paths, all inspected:

| H path | H blob | Inspection |
| --- | --- | --- |
| `packages/protocol/src/battlefield-catalog.ts` | `0e6a772e439ec3c7f4106dd2fc9ba7c5ecb8988f` | Complete repair and surrounding original schemas/decoders: iterative byte/property traversal and exact-mm predicate. |
| `packages/protocol/src/battlefield-catalog.test.ts` | `5e0954beb6072f8dba136e69230f33504ae946f0` | Complete new regressions plus retained earlier test context; independently rerun. |
| `docs/lobby-map-selection-execution-log.md` | `2e535a2571270bee823c6863ff21305690d2cdd4` | Entire delta: six red assertion failures, bounded repair/check record and explicitly unverified browser creation. CI claims remain coordinator evidence, not independent remote verification. |
| `docs/lobby-map-selection-schema-review.md` | `8e8cd244a09c6e7d990a8e20e0c62ca36365defe` | Completed original R6 report, preserved unchanged with its findings and scope limits. |

All prior R6 coverage for unchanged strict fields, parent/default/identity binding, geometry kinds/shapes/extents and transport limits carries forward by unchanged Git content. Barrel export and legacy `battlefield.ts` remain unchanged by the repair. No API, registry, pin or storage integration was added.

## Resolution of R6-B1: bounded JSON byte accounting

The resource gate no longer calls `JSON.stringify`, `TextEncoder.encode` or `Object.values`. It accumulates JSON bytes iteratively and rejects immediately on exceeding the selected budget. Property names and string contents account for quotes, quote/backslash escapes, short control escapes, six-byte Unicode escapes for other controls/unpaired surrogates, UTF-8 widths and four-byte surrogate pairs. Finite number spellings, null/boolean spellings, braces/brackets, commas and colons are included. Negative zero is counted as JSON's `0`.

Arrays check remaining value capacity before pushing index values; object traversal checks own properties incrementally rather than copying all values into an explicit staging array. Both use data-property descriptors and reject accessors rather than invoking their getters. Nonplain object prototypes are rejected; the existing detached-object/cycle, finite-number, depth and total-value checks remain. Stack/seen bookkeeping is limited by the structural ceilings. String lower-bound checking can reject an oversized key/value before scanning all its characters, while cumulative byte accounting stops subsequent work as soon as the budget is exceeded.

Independent probes reran the original repeated-string/oversized-key cases while replacing full serialization, encoding and `Object.values` with throwing sentinels. They rejected with the expected byte-limit error and **zero forbidden primitive calls**. No large/OOM experiment was needed. Additional getter checks confirmed an accessor is rejected without invocation.

## Resolution of R6-B2: exact millimetre membership

The new predicate requires a finite value, a safe rounded integer-mm value and exact equality after converting those millimetres back to metres. No epsilon or returned-value coercion is used. The ordinary positive-length schema then excludes zero-mm lengths; zero coordinates remain valid. Legitimate binary representations such as `1.001`, `1500.123` and `0.001` pass unchanged. Tiny positives, `Number.MIN_VALUE` and representable near-mm perturbations fail. Existing extent/radius/map-bound checks remain in force.

The same corrected predicate serves coordinates, widths/radii and dimensions. This repairs the accepted domain; it does not validate digest authenticity or registry approval, which are explicitly later boundaries.

## Checks actually run

All executed checks used matched protocol source in `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4/packages/protocol`, with pinned Node **v22.23.3**:

```sh
node ../../node_modules/vitest/vitest.mjs run --no-cache --configLoader runner
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**107 tests / 4 files passed; non-emitting protocol typecheck passed.** `git diff --check P H` passed. Manifest/H/snapshot comparisons and original-report equality passed. No independent build, full-root suite, native-content test, registry/pin test or browser operation was run; author build/CI claims are not counted as reviewer checks.

An additional independent inline Node/assert source probe performed **65,752 exact byte-boundary cases**. It compared the resource gate's pass-at-exact/reject-one-byte-below behavior with actual JSON UTF-8 size for every individual UTF-16 code unit, representative surrogate combinations, finite number extremes/exponents, booleans/null, empty containers, escaped/Unicode keys and 200 deterministically varied nested JSON objects. It also checked inclusive depth-32 / 65,536-value boundaries, exact-mm positives/negatives, early repeated-string/key rejection without full primitives, getter noninvocation and nonplain-object rejection. These bounded probes emitted no files or source mutations and are not arbitrary performance/load certification.

## Test effectiveness

Inspected `/private/tmp/lobby-map-schema-review-red.log` directly. It records **6 assertion failures / 20 passes**, comprising four tiny/off-grid parameter cases that previously failed to throw, the old `[1,1]` stringify/encode calls versus required `[0,0]`, and one `Object.values` staging call versus zero. These are assertion detections rather than collection/compiler failures. The red source identity/run was supplied by the coordinator; this reviewer did not change source to recreate it. The current full green suite and additional probes are independent reviewer runs bound to H.

The new tests retain explicit exact byte premises, verify Unicode/control/surrogate/numeric/container punctuation boundaries, preserve valid binary-mm cases and reject coordinate/radius/width perturbations. The source and independent boundary checks support the corrections rather than merely trusting a green count. No original assertion was weakened to accept rounded geometry or late oversized serialization.

## Release boundary and remaining limits

No blocking or new nonblocking finding was identified in the repair delta. Accept the schema/types/decoder boundary at H for the coordinator's next separately named pure public adapter/shared-paint-order writer packet, under the existing accepted ownership contract. The reviewer does not dispatch that writer or grant additional shared-file ownership.

Keep the original integration limits explicit: transport callers use the decoder/budget wrapper and independent parent ID, not merely an inferred type or raw `Schema.parse`; whole `/scenarios` responses require aggregate envelope bounds when integrated. Public shape/digest syntax is not assembly approval, availability, private pin validation or library certification. Keep canonical/owned geography unpaired and the alternative unavailable until its later implementation gates pass.

The untracked native content/private pin files are not accepted by this result. Original R6/R1/R2/R3/R5 history and R5's missing real-browser create-to-live acceptance remain unchanged. No API workaround or publication action was performed.
