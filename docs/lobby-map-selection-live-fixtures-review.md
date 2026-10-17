# R38 independent live-load fixture repair review

**Verdict: Accepted at `6187fdcfd07e101930ccd52f69f8b046f83829d7` as the bounded two-spec repair. No blocking or nonblocking finding.** The fixtures now await the actual accepted terrain/metadata connection gate and retain all original behavior assertions. No production behavior is changed or newly accepted by this packet.

## Exact binding and complete inspection

- H `6187fdcfd07e101930ccd52f69f8b046f83829d7`; tree `ba43102a23616f58fcda02d75a05bd2edbac32e9`.
- P `4589aa18959b9a53714618b4cabb87ad45a0f51f`.
- Manifest `/private/tmp/lobby-map-live-fixtures-candidate.json`, SHA-256 `e6b2603d9b1fe6ba435534e1a66d5b2a5c35cc3e8c3131f2bb078fd28a7bd972`.
- Handoff `/private/tmp/lobby-map-w15-live-test-fixtures-handoff.md` and raw failure/green logs were inspected as author evidence, not adopted as independent execution.

Verified explicit Git H/tree/P/ref, complete two-path inventory, both manifest/Git/scoped-snapshot hashes and `git diff --check`. Read both full spec files and their complete delta, surrounding actual GameService load/connection lifecycle, public metadata/terrain types, descriptor decoder/adapter premises and clock/port behavior. AGENTS and prior accepted source reviews retain their existing rules and limits.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/app/game/clock.component.spec.ts` | `fa28a2b6232201d706c912bc5b4ade1f6122e003` | `789b335c0ce6bfcd9b5511817a017dedc76649686d5e35e4c8bbb1f0fcbc1d0d` |
| `client/src/app/game/ports.spec.ts` | `61578c58d8539a69396980dfdff89e1956a0d7d3` | `59e81949de88302ca974136697cb26f7a6b55417dbbe183c61e9ce786e22c0ec` |

Independently compared `client/src/app/game/game.service.ts`: identical at P, H, R39 and the inspected snapshot. No source outside these two specs belongs to this candidate. There is no whole-snapshot identity claim.

## Findings and test effectiveness

The raw root log `/private/tmp/lobby-map-f1-root-test.log` shows exactly the reported three failures: clock's loss/retry case dereferences an absent socket's `onmessage`, and both connected order cases dereference an absent socket's `onopen`. The surrounding accepted GameService waits for checked terrain and metadata before constructing its real GameConnection. Supplying no accepted loads and immediately dereferencing a socket was an invalid fixture premise.

Both replacements construct fully typed public GameInfo/GameBattlefield values. The independently supplied public scenario ID is passed to the actual `decodeApprovedBattlefield`; dimensions/descriptor/parent IDs agree, and the actual `battlefieldMap` produces BaseMap geometry. The synthetic digest strings establish valid protocol identity syntax, not private pin authenticity or engine certification; the fixtures do not claim either. No incomplete cast or fabricated connection bypass is used.

Clock resolves terrain while metadata stays pending; ports resolves metadata while terrain stays pending. Both assert zero initial sockets/map, expected game-ID arguments and the same captured AbortSignal across loaders. Each then asserts no socket with only one load resolved, releases the remaining load, and waits for the actual registered socket handlers and `mapLoading === false`. They verify the resulting map, transition the fake socket to open through its real registered handler and require actual GameService link state `open` before exercising the original clock loss/retry or order/courier/ETA behavior. The test transport is an in-process WebSocket fake; it does not prove a real network connection.

Independent TypeScript AST comparison of assertion expression statements confirms all5 original clock and12 original ports assertions are retained with identical printed syntax. Each file adds11 gate/readiness assertions (22 total). All7 original cases remain. Cleanup now disconnects and restores mocks/globals through afterEach/finally, including failed setup/assertions; the clock's prior success-only cleanup is removed from the successful path and retained unconditionally. No sleep, manual GameConnection installation, skipped case or weakened behavior expectation was introduced.

## Independent checks actually run

Pinned Node v22.23.3 PATH; Angular used `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`, existing dependencies only.

| Check | Actual result | Reviewer log |
| --- | --- | --- |
| Snapshot client `ng test --watch=false --include=src/app/game/clock.component.spec.ts --include=src/app/game/ports.spec.ts` |7 tests /2 files passed | `/private/tmp/lobby-map-r38-review-tests.log` |
| Read-only Node/TypeScript AST comparison of P and H |17 original assertions retained;22 added | `/private/tmp/lobby-map-r38-review-assertions-fixed.log` |
| Focused ESLint on both specs (batched with R39 owned files) | Passed | `/private/tmp/lobby-map-r38-r39-review-lint.log` |
| Combined-snapshot client `npm run typecheck` | Failed with2 TS2322 diagnostics in disjoint, concurrently modified W16 files | `/private/tmp/lobby-map-r38-r39-review-typecheck.log` |
| Manifest/Git/scoped snapshot identity, unchanged GameService and diff whitespace | Passed | Tool output |

The typecheck failures are at `app/lobby/map-library/library-browser.component.ts:353` and `map-library-state.ts:296`, assigning readonly prepared asset data to mutable MapAsset. Both files differ from the frozen candidates and are outside R38/R39. They were not repaired or accepted here. R39 additionally passed a source-bound, in-memory Git-backed app/spec/worker typecheck at its own H; that is separate evidence, not a claim this mutable-snapshot command passed. The first reviewer AST harness accidentally selected enclosing test-call statements containing nested assertions; correcting its traversal to direct assertion expressions produced the17/22 comparison above, without changing source.

Author full Angular log `/private/tmp/lobby-map-w15-live-test-fixtures-angular.log` records891 passed /52 files after the repair, with existing jsdom canvas notices. The raw earlier root log records engine528/protocol116/maps262/server1550 passed plus3 server skips, followed by the3 Angular failures. These are inspected author executions at their recorded context, not reviewer full-suite results. No independent full/root suite, production build, format, CI, actual HTTP/browser/game or permission escalation was performed.

## Release boundary

Accepted for the planned fixture delivery on live-terrain ancestry. Any subsequent restack has a new identity and should carry this result only by verified source identity/context. No push, lease update, branch restack, checkout, reset, merge or deployment was performed by the reviewer. Browser Start/create-to-live and library responsiveness remain separate gates. Only this reserved report and the separate R39 report were written; historical reviews remain unchanged. No product/test/config/Git/runtime/browser/game/pane mutation, new agent or external action occurred.
