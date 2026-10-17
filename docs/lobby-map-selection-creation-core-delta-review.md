# R21 independent creation-core repair review

**Verdict: Accepted at `9aee88ee3c7a7fc50311ab8d2a4dd55efe180253` for the bounded receipt-core prerequisite. R19-B1 is resolved; no new blocking or nonblocking finding.** Historical R19 remains Changes needed at its original H. API/actor activation and receipt/header/snapshot consumer integration remain separate gates.

## Exact binding and inspected delta

- H `9aee88ee3c7a7fc50311ab8d2a4dd55efe180253`.
- Tree `0c930ba99f2ea80c0091f04cb073b33533230cae`.
- P `82df633f68393717f3d051a9267e19215b56dbfa`.
- Manifest `/private/tmp/lobby-map-creation-core-repair-candidate.json`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified actual H/tree/parent, complete two-path delta and each Git blob/manifest/snapshot SHA-256. Read the entire delta, surrounding failed-transaction/read/reservation/activation code, new regression and cleanup, historical R19, execution log and relevant decision/contract boundaries.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `server/src/lobby/creation-store.ts` | `90e8bd7608cb631becd3e37a0f46d26adfca505d` | `74ea21cd919cbfc19280ed8f80a43038f970ff676dcb87117736d35a20b66e0a` |
| `server/src/lobby/creation-store.test.ts` | `be4b0c2cd54ed5728bff19f7855e3e480521a0e4` | `fb381253424570316b2a3985cfeded274e86702589e1c7083985165c4eb4b3e9` |

Ten named intent/auth/lobby/native/config dependency paths were independently compared with P/H and scoped snapshot and were unchanged: creation-intent.ts/.test.ts, lobby/store.ts, auth/store.ts, auth/auth.test.ts, shared-database.test.ts, native-scenario-pin.ts, native-battlefield-registry.ts, server/vitest.config.ts and server/tsconfig.json. No whole-snapshot identity is asserted; client/API/library work is outside H. Native High verification is packet-supplied; no pane/settings operation occurred.

## B1 resolution and regression effectiveness

The only production change adds the same sticky `failedTransaction` rejection at the beginning of `forGame`, before preparing its SQL query. It cannot return tentative, previously committed or missing-game identity after the store has entered recovery-required state. Reservation/owner lookup/activation retain their existing guards. The repair does not clear the poison flag after rollback or silently retry allocation.

The new permanent test injects COMMIT and ROLLBACK errors **before execution**, requires AggregateError and an open SQLite transaction, and obtains the tentative game ID from the raw lobby test seam. It then requires `creation_recovery_required` from `forGame`, `lookup`, `reserve` and `activationResult`. Finally it restores the SQL execution method and rolls back; existing afterEach closes the disposable store. It does not obtain the ID through the very receipt lookup under test or substitute a missing-row case.

Read `/private/tmp/lobby-map-core-review-red.log` directly: the regression reached its `forGame` rejection assertion and failed there, with17 other tests passing. This detects the original missing guard rather than a setup/compilation error. That red execution is author evidence, not an independently recreated red run; no source was reverted by the reviewer.

## Independent checks actually run

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/lobby/creation-store.test.ts src/lobby/creation-intent.test.ts src/lobby/shared-database.test.ts src/auth/auth.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**71 tests /4 files passed; server noEmit typecheck passed.** The typecheck sees the combined compilation context without attributing disjoint source to H. Manifest/blob/snapshot/dependency checks and read-only `git diff --check P H` passed. Node emitted its existing experimental SQLite warning. Author green/typecheck/lint logs were read separately and are not counted as reviewer executions. No independent lint/build/full-root/CI run was performed.

An additional inline Node/assert probe imported matched source through in-memory TypeScript transpilation and used one isolated Memory SQLite store, no actor/listener/network. It verified a healthy committed `forGame` lookup, then injected failed COMMIT+ROLLBACK and confirmed all four receipt entrypoints rejected. A prepare-call counter proved `forGame` queried no SQL for tentative, already committed and unknown game IDs. After restoring SQL and manually rolling back, all four entrypoints still rejected and the read counter stayed zero. Cleanup restored methods and closed the store. This supplements the permanent test's open-transaction checks with an independent sticky-after-cleanup check; no source/test file was added.

## Preservation and acceptance limits

R19's historical report remains unchanged at SHA-256 `d34c42ba1a323e2aab2af3682bd378a084e0041d76340f2cf3dc6056f38f354f`. Its normal receipt/retry/adoption coverage carries through the unchanged implementation plus current tests; its B1 finding is resolved only at this new H. The earlier guest WebSocket `listen EPERM` gate remains unchanged. That suite was not repeated here; neither the author's permitted baseline nor this71-test run is represented as a new independent guest/socket pass.

Accept this exact repaired receipt dependency. API admission/ownership projection, actor activation/recovery, actual durable deployment composition, browser Start/create-to-live and disjoint client/library work are not accepted by this packet. Only this reserved R21 report was written. No product source/test/config/Git mutation, managed server/browser/HTTP/game/pane control, new agent, external action, merge or deployment occurred. R20 repair is a separate review; no workaround for pending browser Start approval was attempted.
