# R22 independent live-render repair review

**Verdict: Accepted at `559271129e6172373c6e2ebe982eab909a05d7b0` for the bounded live-render source packet. R20-B1 and R20-N1 are resolved; no new blocking or nonblocking finding.** Historical R20 remains unchanged at its original revision. Browser/physical rendering and actual create-to-live acceptance remain separate, unestablished gates.

## Exact binding and complete delta

- H `559271129e6172373c6e2ebe982eab909a05d7b0`.
- Tree `9cb542f59cea1ea7982e9d9fb955aa0b6f57170b`.
- P `7886d4b65513875dd81b4b3e6ed7c9844c8b0c12`.
- Manifest `/private/tmp/lobby-map-live-render-repair-candidate.json`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Independently verified actual Git H/tree/parent, complete three-path inventory and each manifest/Git-blob/scoped-snapshot SHA-256. Inspected all changed source/tests, surrounding current-visit/timeout/socket/page-cache/disconnect code, and the full scene-factory fault fixture.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/app/game/game.service.ts` | `a2b1be53d74c4261550b5c238fb873d2b70e6dc5` | `bcbe1e54627c7b9f7ff10c945a35006859f72eb0a3e6e1efd783f4bf521a5965` |
| `client/src/app/game/game.service.spec.ts` | `f01bbc80b92e3a8b09f3df4a94fe557ec03453f7` | `a059d113c42ae3fc65a69bd7b2ce864056c05df8454e5e1166c72509526b2804` |
| `client/src/app/game/game.component.spec.ts` | `29173f9523eb72196e24ad57fc32bad868f714ac` | `60a1708d613884adbdc6191693aa282f349e34cff2abf996d4a3de48f7fb0877` |

The eleven other paths in the original R20 manifest were independently compared across P/H and scoped snapshot and remain identical. Nine surrounding HUD/fetch/connection/adapter/TableScene/Angular/TypeScript paths also match H. R20's consumer geometry/lifetime review carries by that identity and the current tests, not by the author's handoff conclusions. Parent/API/library and W7 transport are disjoint; no whole-snapshot identity is asserted. Native High verification is packet-supplied; no pane/settings operation occurred.

## B1 resolution: failure retirement without expiring success

The only production change calls `request.abort()` in the current visit's catch branch, before stopping/clearing connection state and before finally removes the30s timer. Either first-failing parallel loader therefore cancels its pending sibling. Promise.all already observes both promises, so the sibling's abort rejection does not become a separate unobserved failure. The map/error/Retry behavior and visit guard remain intact.

The successful branch does not abort its signal; this matters because established socket callbacks use that signal in their current-lifetime check. Its load timer is removed on success, and explicit disconnect still aborts the lifetime and stops its connection/listeners. A stale failed visit is ignored after the existing disconnect/visit invalidation and cannot cancel a successor through the new line.

The new parameterized regressions cover both terrain-first and info-first failure, with an abort-aware sibling that stays pending until canceled. They require the shared sibling signal to be aborted, loading false and no socket. The additional fake-timer case stalls a load through its30s deadline, checks error/zero timers, retries successfully, advances another30s and checks the successful signal remains live, link open and no timer; disconnect then aborts it. Existing same-game stale resolution/callback and disconnect cases remain and pass.

Read `/private/tmp/lobby-map-live-review-red.log` directly: the two first-failure cases failed at `sibling.aborted === true`, observing false, with17 tests passing. That is detection of the original lifecycle defect, not compilation/setup failure. This is author red evidence; the reviewer did not modify/revert source to reproduce it.

## N1 resolution: the fixture reaches the named start failure

The inherited half-built-scene test now spreads the complete recording `fakeScene`, overrides its tracked `start` to throw, and requires exactly one start call. Earlier apply/glide calls therefore succeed and cannot accidentally supply the tested failure. Existing once-only disposal, absent published scene and visible fallback assertions remain. The independent current test run exercises this corrected case as well as the dedicated TableHost start-failure suite; no assertions were weakened.

## Independent checks actually run

Pinned Node **v22.23.3**, snapshot `client/`, supported SQLite Angular cache and two workers:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2 node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include=src/app/game/flat-board.component.spec.ts --include=src/app/game/table-host.component.spec.ts --include=src/app/game/marks.service.spec.ts --include=src/app/game/table.service.spec.ts --include=src/app/game/game.service.spec.ts --include=src/app/game/game.component.spec.ts --include=src/app/hud/hud.spec.ts
```

**84 tests /7 files passed.** From snapshot root, pinned `npm run typecheck -w client` passed app/spec/worker checks. Typecheck sees the combined compilation context without accepting or attributing disjoint files to H. Manifest/blob/snapshot/dependency comparisons and read-only `git diff --check P H` passed. Angular emitted the existing deprecated splitting and experimental SQLite notices. Author green/typecheck/lint logs were read separately; they are not counted as reviewer executions. No independent lint/production-build/full-root/CI or additional framework-free rerun was performed for this one-line source repair.

## Preservation and acceptance limits

Historical `docs/lobby-map-selection-live-render-review.md` remains SHA-256 `e549200f6396f19c99250f68847370849e28db630be906e3376a9c8897fcb363`. R21 receipt-core acceptance is separate; no receipt/API conclusion follows from this client repair. Current scoped R21/R22 source hashes were rechecked after tests and still matched their respective manifests.

Accept the repaired live-render source dependency. Physical canvas/SVG alignment, real GPU/pointer capture/camera behavior, desktop/narrow loading/fallback presentation and pinned create-to-live browser flow remain unverified here. Prior chunk1 browser evidence is not silently extended to these new paths. Actual browser Start approval remains pending and no workaround was attempted. Public alternative enablement, parent pending-create behavior, W7 transport, API recovery and owned-library Add remain separate packets/gates.

Only this reserved R22 report was written. All historical reports remain unchanged. No product source/test/config/Git mutation, managed server/browser/HTTP/game/pane control, new agent, external action, merge or deployment occurred.
