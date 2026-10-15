# R19 independent creation receipt-core review

**Verdict: Changes needed at `82df633f68393717f3d051a9267e19215b56dbfa`. One blocking finding, B1.** The normal reservation/retry/adoption paths and focused tests are sound, but a poisoned transaction can still supply an uncommitted authoritative receipt through `forGame`. API, actor activation orchestration and pinned-game consumer integration are outside this packet and are not accepted here.

## Exact source and complete inventory

- H `82df633f68393717f3d051a9267e19215b56dbfa`, tree `080057c565bac984a51ef74b493f79259bfd4084`.
- P `2cbfb79a20869754631fe4ca7a2a247d5b5e1662`, manifest `/private/tmp/lobby-map-creation-core-candidate.json`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; source snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified Git H/tree/parent, complete five-path P..H inventory, each blob's SHA-256 against the manifest and the scoped snapshot bytes. Read every changed source/test file, the complete auth diff, surrounding transaction/lifecycle and lobby ownership methods, accepted pairing receipt contract and shared-DB review. The five paths and hashes are:

| Path | SHA-256 |
| --- | --- |
| `server/src/auth/store.ts` | `a2f863849789e7e84af33d966774fd8433a3a2474cc35cec5803207540f2eec2` |
| `server/src/lobby/creation-intent.ts` | `fd9685b288dab6c605e17496f16a4ce5cc9e690ea77a0a04f45262357c904ab4` |
| `server/src/lobby/creation-intent.test.ts` | `22d6082b7a4eca58d747214641fb114290c24900ec9cb9e11df5c3ea5a9aad48` |
| `server/src/lobby/creation-store.ts` | `6d6c632ca86409f923606ee2e9b5e1ca1daaa512bcfc249d866147ea201b18f1` |
| `server/src/lobby/creation-store.test.ts` | `69e6f4b9ab4ebd462b8a9b661af644cb4ffde691a56859d7f0d7f3f3ef55c27f` |

### Borrowed-DB prerequisite rebind

Independently verified P `2cbfb79a20869754631fe4ca7a2a247d5b5e1662`, tree `578012ffa88c69cb2ebb2c343435329170b87a0b`, parent accepted Host `41b89ca06c655b8eecf397d637911a9ad9509a0e`. Its complete delta is exactly auth/store.ts, lobby/store.ts and lobby/shared-database.test.ts. All three blobs are byte-identical to accepted `941d07df9fe308cdd24f3b74cf55d65da1ae68fd` and match `/private/tmp/lobby-map-db-restacked-candidate.json`. Retained ref `refs/lobby-map/reviews/shared-db-941d07d` resolves to that old H. The source-identical restack is accepted by identity; R8 report remains unchanged, SHA-256 `ac4dd6da8784b8ad918b2f9eddb84442007fe3da331e81cd3632615bda3f5ba4`. R19's additional auth participant changes are reviewed here, not carried from R8.

## Blocking finding

### B1 — `forGame` bypasses the failed-transaction recovery guard

`server/src/lobby/creation-store.ts:217` marks the store failed if rollback throws. `lookup` then refuses reads with `creation_recovery_required`; reservation/activation also refuse through the transaction guard. However, the server-only identity lookup at line288 has no such guard.

Independent isolated probe: let reservation write its seat/lobby/receipt, inject a COMMIT failure before execution, then inject a ROLLBACK failure before execution. The store throws AggregateError and SQLite remains in a transaction. `lookup(owner,key)` correctly rejects, but `forGame(allocatedGameId)` returns the tentative `state: 'reserved'` receipt from that uncommitted transaction. This is a valid decoded receipt, so normal schema/pin checks do not catch it. A consumer can therefore mistake an allocation requiring recovery for an accepted allocation. No API or actor was needed to reproduce the core boundary failure.

**Required repair:** make `forGame` fail with `creation_recovery_required` once the store is poisoned, consistently with the other receipt entrypoints. Preserve the guard through cleanup/recovery rather than continuing to serve tentative identities. Add a permanent fault regression that proves the failed commit/rollback, still-open transaction, and rejection from `forGame` as well as owner lookup/reserve/activation. Test cleanup may restore rollback and close its disposable database. No source repair was performed by the reviewer.

No additional blocking or nonblocking finding was established. Real simultaneous-process contention, disk failure/recovery and API admission remain unverified integration concerns, not passing claims of this packet.

## Inspected behavior and test effectiveness

- Request parsing is strict, non-coercing and resource-preflighted at16KiB. Pairing selection requires UUID/capability1; unknown map payloads are rejected. Effective intent captures public scenario/pairing, side/session, timing, dial/persona, hierarchy, lobby and pause choices under retained defaults. Realtime ignores turn-only settings and hot-seat uses its effective initial side; operation key/capability are excluded from playable fingerprint.
- Accepted identical retry resolves before latest registry/default/limit callbacks, comparing with the stored acceptance context. Changed effective intent conflicts, and another owner can independently use the same UUID. Receipt decoding recomputes intent/fingerprint, checks raw/pin identity and index/body consistency, and returns detached decoded data. SQL bounds the2MiB receipt before JavaScript materialization.
- One synchronous `BEGIN IMMEDIATE` writes reservation receipt, pinned lobby and seat. No actor starts in this transaction. Receipt insertion faults roll back earlier effects; a lost acknowledgement after actual commit retains one reconcilable allocation. UUID allocation collisions cannot replace another room. Owned/borrowed database close behavior is preserved.
- Auth adoption/deletion participants run on the shared transaction. Adoption changes current ownership, lobby and seats while retaining immutable original-owner/key/allocation. Colliding keys preserve both and produce owner-only ambiguity; deletion removes readable ownership and tombstones retained receipts. Participant failure rolls back user/seat/lobby/receipt changes. Activation result reads current ownership, checks receipt/pin binding, and atomically updates room/receipt status; failures remain recoverable.

Tests use actual disposable SQLite stores, SQL fault triggers, close/reopen and lost-commit-ack injection. These are substantive assertions about durable state rather than mocks returning success. Two-connection coverage is sequential visibility, not a concurrent-process stress test. Checked-in tests did not exercise B1.

## Independent checks actually run

Pinned Node v22.23.3, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/lobby/creation-intent.test.ts src/lobby/creation-store.test.ts src/lobby/shared-database.test.ts src/auth/auth.test.ts src/auth/guest.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**85 tests passed / 1 failed across5 files.** The sole failure is unchanged guest test “keeps a guest out of another account's game (REST and WebSocket)”: `listen EPERM: operation not permitted 127.0.0.1`. It is a sandbox listener restriction, not a receipt assertion failure; no escalation/policy change or failure hiding was attempted. The packet's86-pass author run is not counted as an independent pass. **Server noEmit typecheck passed.** It checks the combined compilation context; disjoint API/consumer work is not attributed to H.

Inline Node/assert probes imported matched TypeScript in memory and used only isolated in-memory SQLite, no actor or listener: current-owner activation after adoption passed; injected receipt-status failure rolled back the already-written lobby status; oversized receipt read rejected. The separate commit/rollback fault probe confirmed B1, restored rollback, and closed its store. These probes did not modify source or add test files. Manifest/blob/restack comparisons and `git diff --check P H` passed. No independent lint/build/full-root/CI/browser or managed-server run was performed.

## Handoff and limits

Repair B1 before accepting this receipt dependency for authoritative game consumers. This review does not certify API composition, actual actor activation/recovery, receipt-to-header/snapshot agreement, public privacy projection or live game creation. The mutable combined snapshot contains disjoint work; no whole-snapshot identity claim is made.

Only this reserved report was written. Earlier R7/R8/R16/R17 reports remain unchanged; the R18 contract acceptance is separate. No source/test/config/Git mutation, managed server/browser/game/pane control, new agent, external action, merge or deployment occurred. Actual browser Start approval remains pending; no workaround was used.

Final preservation check after completing R20 found that the mutable snapshot's `creation-store.ts` and `creation-store.test.ts` now differ from the original R19 manifest. All five frozen H Git blobs still match it. Initial scoped source verification, the test run, the fault probe and the subsequent inspected old `forGame` body established the original finding; no acceptance or review of these later mutable edits is implied. This report remains Changes needed at the exact original H and must not be used as a verdict on a repair candidate. R20's13 scoped hashes still matched its frozen manifest at that final check.
