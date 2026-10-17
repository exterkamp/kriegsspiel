# R10: independent permanent native-regression review

**Verdict: Accepted at H. R7-N1 and R7-N2 are addressed by permanent tests. No blocking or nonblocking finding in this delta.** Production native behavior is unchanged from accepted R7. This accepts the bounded regression packet, not API/persistence/availability or whole-product readiness. The original R7 and R8 reports remain unchanged.

## Exact source and complete inventory

- Native H: `2a71d553c92560c3b596ecc7ccb1df3a34aaa23d`.
- Tree: `7ffa96fc5343ccd71e9acfc657af0230030f9090`.
- Verified parent P: `c4a3bf221e28b42b2bb8a92cbf069c3966e412ba`.
- Manifest `/private/tmp/lobby-map-native-tests-candidate.json`; writer handoff `/private/tmp/lobby-map-w3-native-tests-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD verified still `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

Independently verified H/tree/parent, the full four-path P..H inventory, every manifest SHA-256 against its H blob, and both changed test files against the execution snapshot. All paths were inspected:

| H path | H blob | Coverage |
| --- | --- | --- |
| `server/src/game/native-scenario-pin.test.ts` | `a44dc78c5d348bb0178b8ec7c4623c88d03bba21` | Full retained body and appended creator/budget tests; independent run. |
| `server/src/game/native-scenario-replay.test.ts` | `54a03d19a4fcf99f77853caa150d0ed51e7920e9` | Complete new six-case suite; independent run. |
| `docs/lobby-map-selection-native-pin-review.md` | `b600687c5c446f566abf15db0bdc36a2285e83a5` | Completed historical R7 report; canonical bytes match exactly and remain unchanged. |
| `docs/lobby-map-selection-execution-log.md` | `64f937c6c6b821988de08670dda52b5e5d920f3d` | Complete delta, including test handoff, prior packet verdicts and explicit exclusion of unreviewed creation work. Remote PR/CI statements remain coordinator evidence. |

Changed-test SHA-256 values match the manifest/handoff: `ac923456d50ceda9c3b46f372f3fc52a3ee39c9a06e632a5708ff3b98c7822a1` for the pin test and `fb98ce925a8cb303b5ee8374456a525591306464d5dc2c6f3d52f73d36f0d166` for the replay test. Original pin-test helpers/assertions after the import block are retained verbatim; only imports and the appended test section change.

The snapshot is `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`. Verified its native pin/registry and retained input implementations, unchanged native registry/open-input tests, engine/protocol sources, replay/advance/registry/battlefield dependencies and server test/compiler config against H. Production native files are byte-identical to P. No whole-snapshot identity is claimed: accepted shared-DB changes, coordinator creation-intent/store work and a separately owned future client fetch helper are outside these candidates.

## R7-N1: durable-pin logged-order replay

Each retained authored definition runs separately at seeds1815/17/97. The test preserves a copy of the original authored input, changes only a detached test input's seed, creates a pin, serializes it to JSON and independently parses/decodes it twice before runtime initialization. Equality plus distinct pin/world references, time0, requested seed and exact null initial outcome are asserted. Header scenario identity comes from the decoded resolved scenario. No seed variant is registered.

The three log-shaped accepted parse results are the intended engine-mm orders: Blue `blue-1` and Red `red-1` hold at bridge `(2050000,1500000)`; Blue `blue-3` moves toward `(1000000,600000)`. The direct path applies `startingState`, advances to each signing time, calls `applyLoggedOrder` and retains every emitted event before final advancement. The replay path starts from the other decoded world with a separate registry and the same initialization hook.

The activity premises are substantive: exactly three positive-time `order_delivered` events must match all three unique order IDs/addressees; arrivals and combat fire must be nonzero with positive-time activity. A rejected order throws. Complete `EngineState` and complete ordered emitted-event arrays are compared, rather than just winner/time. The outcome must occur at the observed50-minute point within the60-minute requested bound. Both the retained input and a fresh copy remain equal to their original seed1815 definition.

This addresses the prior empty-log weakness. The paths intentionally share the production order-application and advancement functions: the test checks JSON pin reconstruction, replay orchestration, full deterministic state/RNG/queue data and event preservation, not an independent implementation of combat rules. All orders are at time0; the suite makes no additional claim about delayed/interleaved commands, rate variants, turn resolution or AI behavior. The fixed Blue outcome is functioning evidence for these orders/seeds, not balance certification.

“Durable” here means the private pin survives JSON serialization/decoding. Headers/log entries remain in memory. There is no file-backed game, actor, HTTP request, DB, parser/model invocation, modern persisted-header wiring or reopen-service acceptance.

## R7-N2: creator validation and pre-loader budgets

The three new creator negatives call `createNativeScenarioPin` directly with invalid raw placement, HQ or objective. They have no contradictory stored world that could mask a missing loader check. Each asserts the actual engine `ScenarioError` class and exact message: impassable unit position, impassable HQ and an objective not centred on a bridge. A creator that silently accepts invalid placement, or a different earlier validation failure, does not satisfy those assertions.

The aggregate-point test establishes five geometries of1024 points each, hence5120 points against4096. The placement-work case establishes4096 terrain points,64 units, eight shape samples per unit and zero depots; `(64*(8+4)+2)*4096 = 3,153,920` exceeds2,000,000. Both fixtures stay within their intended per-collection raw-schema bounds. They are dense budget fixtures, not claimed playable content.

Both tests install a loader sentinel and require the specific native budget error and zero loader calls. A missing/misordered budget gate cannot pass through an incidental later engine error. The sentinel bounds accidental work if a gate regresses. Each spy is restored in `finally`, preserving later tests even if an assertion fails. The green combined run also retains the earlier placement/roundtrip/registry tests.

No existing assertion was removed or weakened. The handoff records an initial new-test expectation corrected from undefined to the engine's null initial outcome. This reviewer checked the current source/runtime and did not treat that authoring correction as a product regression or independent red result. No reviewer source mutation or independent mutation/red run was performed.

## Checks actually run

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/native-scenarios/open-bridge-v1.test.ts src/game/native-scenario-pin.test.ts src/game/native-battlefield-registry.test.ts src/game/native-scenario-replay.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**33 tests / 4 files passed; non-emitting server typecheck passed.** This includes the five new creator/budget tests and six new replay cases alongside the22 earlier native tests. No socket permission or other infrastructure failure occurred in this run. Typecheck includes the combined snapshot compilation unit without accepting or attributing disjoint files to H.

Manifest/blob/snapshot/dependency comparisons, original-test-body preservation and `git diff --check P H` passed. No independent style/build, full-server/root suite, CI, HTTP, browser, physical raster or AI check was run. Author style/typecheck claims were not used instead of the independent test/typecheck runs above.

## Renderer restack disposition

Also verified renderer H `e0644f57194e5610b0efe5da3e7029d0f8dcea98`, tree `db37052f5bd0e340c028551608aa4c74523dc245`, parent this native H, against `/private/tmp/lobby-map-render-restacked-candidate.json`. All six renderer blobs/hashes are identical to accepted R9 `89eaab162ca15f7a218e709a5b0176d4c10f28c1`. Complete client tree `2b3d81cf9949c7f4af82168657e6df37cebe1052` and packages tree `7d8b3d9b8ff95ba988599abdf5d7d98999637523` are identical between the old and restacked heads. The retained ref `refs/lobby-map/reviews/render-89eaab1` resolves to that old head.

The complete old-renderer-to-restacked delta is only the two reviewed native test files, execution log, completed R7 report and completed R9 report. Relative to its native parent, the renderer adds exactly the six accepted client files plus the completed R9 report. No renderer/package/production-native source changed. Restack diff checks passed. R9's checks and bounded acceptance therefore carry by verified identity; they were not rerun or relabeled as new executions. The exclusively owned renderer report receives an append-only rebind record; its original R9 history is preserved.

## Release limits

Accept the permanent regressions at native H and record R7-N1/N2 addressed at this later revision. R7's original report remains historically accurate and unchanged. R9's pure adapter acceptance carries to the exact restacked head. These results introduce no new writer ownership, live availability, API/create/receipt/adoption/persistence/recovery or renderer-integration acceptance.

The sole writes are this exclusive report and the authorized append to `docs/lobby-map-selection-render-review.md`. R7/R8 reports, product source/tests/config/Git, servers, browser, panes and permissions remain unchanged. No agents, external actions, merge or deployment occurred. Actual browser Start-to-live approval is still pending; no retry or workaround was attempted.
