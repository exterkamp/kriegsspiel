# R24 independent native API lifecycle delta review

**Verdict: Accepted at `1fa53df66b348cca14e4bd7963778036969169d6` for the bounded native API/composition source dependency. R23-B1/B2/N1 are resolved. No new blocking or nonblocking finding.** Production remains default-only; alternative enablement, client/browser acceptance and owned-library implementation remain separate gates.

## Exact binding and complete inspected delta

- H `1fa53df66b348cca14e4bd7963778036969169d6`, tree `f7b6b079cd691e8cc8e38a9dfd01fb3a289d85c9`.
- P `df194df13b1c5a85f622412bc5e1d0419192d0d3`.
- Manifest `/private/tmp/lobby-map-api-race-repair-candidate.json`; scoped source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`.

Independently verified actual Git H/tree/parent, complete five-path delta, all manifest/Git-blob/scoped-snapshot SHA-256 values. Read every changed source/test and D44 amendment, the surrounding record/list/receipt/private-window/WS admission and account lifecycle paths, and historical R23. The accepted native/core/Host boundaries remain prerequisites; no author conclusion substitutes for source inspection.

| Path | SHA-256 |
| --- | --- |
| `server/src/api/app.ts` | `5574b04d017b722309048d816ed0f28a5e7f20a8e8dff45ea5c7444dbb886218` |
| `server/src/api/battlefield-selection.test.ts` | `4bd2e3d23a4d95f01b1a363ea387a6cab63920e2815bff605568c353e2056e24` |
| `server/src/lobby/creation-store.ts` | `520e904c15a20ab065c005a78c0c6e33b844fb967d8c350fd848f0d8ada18ab1` |
| `server/src/lobby/pinned-game.ts` | `43881734e0337e4173342369fae2709a49dacbbbb25adfd70a0b276616b35fec` |
| `docs/decisions.md` | `513bcb4d1f23b2a47b9f1b4f9577fb890114ebcbb5c749b21983b01a1223434a` |

## Findings disposition and policy

**B1 resolved:** asynchronous header/snapshot reads finish before the synchronous resolver reads current lobby/receipt. A removed/tombstoned allocation cannot be authorized by pre-await detached copies. The evidence-backed `freshRecord` repeats reconciliation after a caller's await. GET/join/ready/start/leave/kick handlers recheck their current principal before effects. Lists resolve every retained ID and recheck principal/current membership after progress reads. Private postgame paths recheck record and seat after replay reads, with a further check after asynchronous critique work; WS admission rechecks after reopening. There is no asynchronous gap between the final synchronous route check and its synchronous seat/lobby mutation.

**B2 resolved:** account deletion/expiry finds pending activation ownership separately from seats, so hot-seat is covered. Pending retirement calls Host.close and is tracked through application shutdown. Activation failure distinguishes an actually removed allocation from unknown/recoverable persistence failure: removed allocations retire their actor, whereas an owned receipt whose status transaction failed keeps the actor for the same-key recovery path. Host/core identity checks and the original game ID remain in force.

**N1 resolved:** POST `/games` now has a route-level16KiB body limit in addition to decoded object preflight. The whitespace regression requires413 before reservation and checks no lobby was allocated.

Retirement provenance is private receipt data. Tombstones require both retiredOwnerId and a boolean retiredOwnerGuest; live receipts may carry neither. Missing/partial provenance fails closed. `creationLobby` and allocation validation use the retained former owner only for the supported already-started regular-owner continuation; tombstones never restore owner-key lookup. Deleted guest allocations resolve unavailable and retire their actor, preserving private invite behavior. Already-started regular-owner games may remain accessible to remaining seated players, under the prior policy, with their exact pin/header retained; unstarted removed rooms cannot be revived. This is not a general new sharing policy.

The packet states that no old private-v1 receipts have been served on protected previews. Acceptance of the stricter private decoder uses that release condition; the reviewer did not inspect or migrate protected databases. No compatibility claim for previously persisted provenance-free tombstones is made.

## Regression effectiveness and independent execution

Inspected all ten added API cases: delayed private GET/join deletion, blocked initial save deletion for co-op/hot-seat, actual wire overflow, regular started-owner deletion with surviving GET/WS, deleted guest started invite privacy, recoverable status-write failure keeping the same actor, and actual idle-guest sweep for co-op/hot-seat. Fault gates wait for the actual asynchronous boundary; assertions include state/seat/actor/timer outcomes rather than only response messages.

Read the retained red log `/private/tmp/lobby-map-api-races-red.log`: the five initial cases failed at old source (5 failures/12 passes), observing200 instead of404, a registered actor instead of absence, and201 instead of413. These are the original defects. That red run is author evidence; the reviewer did not revert source. The subsequent regular-owner/provenance, sweep and recoverable-status cases supplement those regressions without weakening them.

Pinned Node v22.23.3, scoped snapshot `server/`, independently ran:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/api/battlefield-selection.test.ts src/lobby/creation-store.test.ts src/lobby/creation-intent.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**59 tests /3 files passed:22 API,18 receipt and19 intent. Server noEmit typecheck passed.** These use disposable stores/actors, Fastify injection/injected WS and FakeTime; no managed server/browser/game was used. Node's experimental SQLite notice remains. Scoped identity checks passed. Disjoint maps worker/schema/config and compilation context are outside H and not accepted by the typecheck. No independent lint/build/full-root/CI or listener-dependent legacy suite rerun was performed; R23's listener EPERM limit is not silently reclassified as green.

Historical `docs/lobby-map-selection-native-api-review.md` remains unchanged at SHA-256 `5698d8d758eefbb3f3e14d811fb078b766f51c4f6ed9862e7ac554d78274192e`. No whole-snapshot identity is claimed. Only this exclusive R24 report was written; source/tests/config/contracts/Git, managed processes/browser/panes and protected data were not changed. No agent, external action, merge or deployment occurred. R25/R26 are separate packets. Browser Start/create-to-live remains pending approval; no workaround or implicit library release follows from this verdict.
