# R25 independent scenario/create transport review

**Verdict: Accepted at `9e4d437ca2e296b917d7ca330a889504c16a73f9` as the bounded transport dependency. No blocking or nonblocking finding.** This is not acceptance of the disjoint parent pending-create integration, server durability/authenticity or browser creation flow.

## Exact binding and complete inventory

- H `9e4d437ca2e296b917d7ca330a889504c16a73f9`, tree `4e0eda54dc68181544aec384c73d65403d55be8d`.
- P accepted live-render repair `559271129e6172373c6e2ebe982eab909a05d7b0`.
- Manifest `/private/tmp/lobby-map-transport-candidate.json`; handoff `/private/tmp/lobby-map-w7-transport-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified actual Git H/tree/parent, complete three-path delta and all manifest/Git-blob/scoped-snapshot SHA-256 values. Read the complete helper, new tests and additive type diff, existing request builder/error mapping and accepted catalog/receipt boundaries. The handoff is context, not evidence of correctness.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/legacy/shell/newGameApi.ts` | `5addfea634f66143266c65730637a5b6bf6918b3` | `ad36ce7e9d32513e38fdef5f8145e06ad8064539b2d842aedb72b3edd6867bc7` |
| `client/src/legacy/shell/newGameApi.test.ts` | `553299b4d184730bea871330f52795c58d6401ae` | `64b36601f964d4a762944884e2b95b063eeca0c56911902de1a9e106fbaae83d` |
| `client/src/legacy/shell/newGame.ts` | `a288bae9fb033c008a650bfe62bed5677bb9d0c5` | `6e1565213b6a456045e0b0b0e69f2ae52229514fba0ee9832b5b57dd8f2a8299` |

## Source and test assessment

- Reads count actual streamed UTF-8 bytes into fixed buffers:256KiB scenarios and64KiB create/error/receipt bodies. Strict decoding and JSON parsing occur only after bounded completion. Content-Length cannot waive the limit. A finite chunk counter includes empty chunks; there is no convenience `.json()`/`.text()` fallback. Readers, timers and listeners are released on completion/failure/abort; uncooperative cancellation is observed without blocking the public operation forever, and late responses are discarded.
- Each HTTP phase has its own30s controller/deadline covering fetch and body, with one lifetime abort race. Caller abort is relayed and pre-aborted calls do no fetch. A timed-out keyed POST can be followed by one independently bounded reconciliation GET, so the two-phase operation may take approximately60s; there is no automatic POST retry.
- Scenario projection keeps known base/legacy fields and checks parent identifiers. A present modern collection is decoded against the independently read scenario ID and cannot be erased into legacy readiness when invalid/null/foreign/private. Optional invalid legacy preview metadata remains available for the existing legacy UI's own checker and does not change scenario-only request building. Returned modern metadata is detached, and unrecognized root/scenario fields are omitted.
- Create captures the exact JSON body and key before dispatch. Valid success IDs are bounded; modern success checks known key/game-ID aliases/status. Ambiguous network/read/5xx/invalid-success results reconcile owner-only by the same encoded key. A receipt must be HTTP200, match that key and any known POST game ID, and report lobby/started. Contradictory aliases, pending/recovery/foreign/malformed receipts and404 do not authorize fresh allocation. Known create409/410 stays pending even if its body cannot be read; it cannot accidentally recover a conflicting intent as success.
- `CreationPendingError` retains its public shape and exact original key. Caller abort after keyed dispatch remains pending without a further GET, while pre-abort remains AbortError. Keyless legacy calls retain their error behavior and never reconcile. Additive ScenarioInfo/CreateRequest fields do not alter the existing `toRequest` result by themselves.

Tests use actual Response/ReadableStream objects, boundaries and one-byte Unicode chunks, malformed UTF-8/JSON, parent-binding contradictions, detached mutation, fake timers and cancellation sources that never acknowledge. They check exact POST/GET method/body/key, no second POST, conflicts, late fetch/EOF abort, reader locks/listeners and zero outstanding timers. These are effective transport/lifetime tests rather than unconditional successful mock validators. They do not prove server ownership/persistence or parent key retention across owner/navigation changes.

## Independent checks actually run

Pinned Node v22.23.3, snapshot `client/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/legacy/shell/newGameApi.test.ts src/legacy/shell/newGame.test.ts src/legacy/lobby/battlefield.test.ts --no-cache --configLoader runner
```

**130 tests /3 files passed**, including73 transport cases. From snapshot root, pinned `npm run typecheck -w client` passed app/spec/worker checks. Typecheck sees the combined compilation context, not a claim that disjoint parent/Add/picker work belongs to H. Manifest/blob/scoped identity checks passed. No independent lint/format/build/full-root/CI, real HTTP or browser execution was performed. Author checks and fixture/timing corrections were inspected but not counted as reviewer executions or a meaningful red product-regression run.

## Acceptance boundary

The caller still owns stable UUID/intent retention, authentication-owner lifetime, same-key user retry and navigation state. The helper never generates a new key or starts a replacement request automatically. Server receipt authority and native metadata authenticity remain server gates; an HTTP projection validator cannot establish them. R24 server acceptance is separate, and browser Start/create-to-live remains pending approval. No owned-library or arbitrary-scenario readiness follows.

Only this reserved R25 report was written. Prior reviews remain unchanged. No source/test/config/Git mutation, managed server/browser/game/pane control, new agent, external action, merge or deployment occurred. No whole-snapshot identity is claimed. R26 portable Add child is a separate packet.
