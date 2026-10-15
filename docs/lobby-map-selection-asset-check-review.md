# R35 independent unused worker verifier review

**Verdict: Accepted at `52e00f32087132d3d1759648e518d8d1a0128c7c` as an unused verification dependency. No blocking or nonblocking source finding.** Application attachment, actual module-worker loading and browser performance remain separate gates.

## Exact source and complete coverage

- H `52e00f32087132d3d1759648e518d8d1a0128c7c`; tree `0b06e18e752fd49c3be351bac5f91edad0e45809`.
- P `cd1d1ae6c9d23aa018084f4c198f7712fd735b55`.
- Manifest `/private/tmp/lobby-map-asset-check-candidate.json`, SHA-256 `6158a034b40c7f326fe1b12ca187ce424811d4a4a2f7c597ff19b48cdc57494c`.
- Handoff `/private/tmp/lobby-map-w12-asset-check-handoff.md` was context, not independent evidence of correctness.

Verified explicit Git H/tree/parent/ref, the complete three-new-path delta, manifest hashes against Git blobs and the same three snapshot files. No whole-snapshot identity is claimed. Read all three files, surrounding existing JSON preflight, map schema/parser/canonicalization/full-identity/current-complete-validation boundaries, worker configuration, accepted library contract, AGENTS, relevant decisions and execution log. Application import search found no caller outside the new files.

| Path under `client/src/shared/lobby-map-library/` | Git blob | SHA-256 |
| --- | --- | --- |
| `asset-check.ts` | `6ef95b89fb04feb2436c9b2c83c1b8cec5ba80c9` | `aba44180089b22b377672d897cff2ba3a6422198cf03f91b85d8e4f6a54a9492` |
| `asset-check.worker.ts` | `8d193f640bb8c1f59ac7f8c13c8ae0b0298d9323` | `a78a19e94fe318addca5a141ce6c840af7dece8d78b2eaba3810032a93b40bb0` |
| `asset-check.test.ts` | `aa631fd3aafc3790c3b946eea83c5925a63523dc` | `aee351c201b60ec207531a0c5d53cec8c06271c8418a4aff5e555ea461a7b3a7` |

## Boundary and implementation assessment

The public API takes exactly four own enumerable data fields (`canonicalJson`, full `assetIdentity`, `widthM`, `heightM`), a caller signal and an optional trusted fresh-worker factory, and returns `Promise<MapAsset>`. Before allocation it captures the scalars, rejects extra/accessor/custom-prototype input, malformed Unicode/hash/dimensions and excessive actual UTF-8 bytes. Pre-abort and invalid admission allocate no worker. The default factory requests a same-origin module worker using the local worker URL.

The worker's actual exported handler validates the strict versioned envelope, opaque UUID, announced byte count and input fields. It executes the current real `importAsset`, exact canonical-text equality, NW-zero/exact dimensions, full `assetIdentity(asset, 'asset')` and complete `validateBattlefield`. A supported geography succeeds only with all those checks; unsupported or incomplete geography is not converted or substituted. Failure output has a fixed code and correlation field, without raw diagnostics. The real entry installs the same handler and accepts one verification only.

Main checks the current request ID, version/type, digest metadata, dimensions, byte count and exact envelope. Existing `checkJson` bounds object bytes/depth/nodes before the schema clone; feature/entrance/override and sample aggregates are checked. `AssetSchema.parse` validates structural shape and detaches the result. It does not repeat canonicalization, full hashing, topology or complete certification. This is a trusted same-origin worker boundary: matching digest metadata is correlation, not cryptographic proof that an arbitrary injected worker returned the canonical asset. A malicious structurally coherent replacement worker is outside the factory contract. No hidden engine state or private native pin is imported or exposed by these files.

Ownership is per call. A30s timer starts for worker acquisition/lifetime; deadline checks surround synchronous handoffs and output processing. Settlement marks the call done before cleanup, clears the timer/caller listener, removes worker listeners and attempts termination once. Partial listener/post failures, worker error/messageerror, synchronous factory abort/reentrancy, timeout and malformed output settle through cleanup. A resource returned after factory-triggered abort is terminated without posting. Retained late callbacks cannot publish or retire a newer call. Signal checks during and after handoff prevent an abort during termination from returning success. Cleanup exceptions are contained. Browser `terminate()` has no exit acknowledgement here; acceptance covers the termination request and ownership release, not an independently observed thread-exit event.

## Test effectiveness and independent checks

The54 helper cases exercise actual current map computation as well as worker doubles. A real supported500m seed17 asset establishes the positive complete-certification premise. A canonical, full-hash-matching asset that passes import but fails current complete certification establishes a meaningful negative premise; the worker rejects it. Other cases cover BOM/whitespace, geometry-only identity, unsupported geography, exact UTF-8 admission, strict fields, detached aliases, foreign/malformed output, aggregate limits, deadlines, abort, reentrant replacement, late listeners, partial acquisition and final-handoff abort. Main-only spies assert zero calls to the heavy import/hash/topology/certification functions. The entry test invokes the installed one-shot worker handler through a simulated worker scope. These tests do not instantiate a real browser Worker.

Independently ran with Node v22.23.3 (`/private/tmp/game-init-landing-node/node_modules/node/bin` prefixed to PATH):

| Check | Actual result | Reviewer log |
| --- | --- | --- |
| Snapshot `client`: `node ../node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/shared/lobby-map-library/asset-check.test.ts src/shared/lobby-map-library/http.test.ts src/styles/design-system.test.ts` |141 tests /3 files passed:54 helper,82 HTTP,5 tokens | `/private/tmp/lobby-map-r35-review-tests.log` |
| Snapshot `client`: `npm run typecheck` | App/spec/existing-worker checks passed | `/private/tmp/lobby-map-r35-review-typecheck.log` |
| Snapshot root: explicit `tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,WebWorker --skipLibCheck client/src/shared/lobby-map-library/asset-check.worker.ts` | Passed | `/private/tmp/lobby-map-r35-review-worker-typecheck.log` |
| Snapshot root: ESLint on all three changed files | Passed | `/private/tmp/lobby-map-r35-review-lint.log` |
| Explicit Git/manifest/scoped SHA comparison and P..H `git diff --check` | Passed | Tool output |

These typechecks see combined snapshot context; only the three manifest files are source-bound to H. The final current typecheck pass does not erase the earlier in-progress W12 failures honestly recorded in R33. Author format/check claims were not counted as reviewer executions. No independent build, format, full-root suite, remote CI, actual HTTP, real worker/thread or browser execution was performed.

## Release limits

No application imports or capability wiring are accepted here. The existing worker tsconfig includes the older authoring workers; the separate WebWorker typecheck proves the new graph's types, not Angular URL bundling or actual worker boot. Integration must verify the compiled worker loads and that owner cancellation reaches it.

Main still scans UTF-8 and performs structured copying, bounded traversal and a deep schema clone. Those costs scale with input;64MiB is not a browser memory or responsiveness guarantee. The timer cannot preempt synchronous main-thread preflight/shape work, and it begins after input preflight. Representative/near-limit browser measurements of worker boot, transfer, main-thread long tasks, shape latency and memory remain necessary before attachment acceptance. The helper creates one worker per call; the integrating owner still controls concurrent requests and stale UI publication.

Only this reserved report and the separately authorized delivery-rebind report are written for this task. Historical reviews remain unchanged. No product/test/config/Git mutation, managed runtime/browser/game/pane operation, new agent, external action, merge or deployment occurred. Browser Start/create-to-live remains unverified and pending the existing approval gate.

## Final snapshot drift notice

The three manifest files matched H at source inspection, independent checks and subsequent identity verification. During the later R36/final preservation check, all three snapshot files had changed externally. Observed SHA-256 values are now `7d28e73841fd0183eb8fbec10d913b8db07a42df77faf5d9f1f10db0de1a3958` (`asset-check.ts`), `9ee4230a5ca1ae19675511a444004becab9a308a43d9b6c1cad023500053aef6` (worker) and `1c12c2fe8dbabeb9c1f28ebde556a7f1a820c5375b2cb4e4c53b6c90ecd562c8` (test). These later bytes were not reviewed or accepted. This verdict and141-test evidence remain bound to frozen H, not the current mutable files. No source was repaired or restored by the reviewer. R36 was subsequently authorized as a separate packet/report.
