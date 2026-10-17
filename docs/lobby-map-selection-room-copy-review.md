# R44 independent room copy follow-up review

**Verdict: Accepted at `d6b1eafbb1b1965df1083bc0869e4d4ca8b755ee`. R41-N1/N2 are resolved in source. No remaining or new blocking/nonblocking finding in this delta.** This is copy/retained-label acceptance, not actual room/live browser acceptance.

## Exact binding and coverage

- H `d6b1eafbb1b1965df1083bc0869e4d4ca8b755ee`; tree `0573f1c954faa6a3962fa82255d0a195d9bbf63f`.
- P accepted delivery rebind `0af4feaaa5d20c203546ed4a1bb86a292ea9e947`.
- Manifest `/private/tmp/lobby-map-room-copy-candidate.json`, SHA-256 `15d3f643b47ced43309ee0bb8476ad55a19006019d54c3a041cf96689d1b5403`.

Verified explicit H/tree/P/ref, complete three-path inventory, manifest hashes against Git and scoped snapshot, and diff whitespace. Read the complete delta and surrounding room/preview template, unchanged Escape key handling, retained descriptor/invalid-modern/legacy and polling boundaries, approved design room requirement and historical R41/R43 findings. No ancestor-wide or whole mutable-snapshot acceptance is inferred.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/app/lobby/room.component.ts` | `2f409ab14839c7aced2033768d69f6620b9a5010` | `ea4257ab1ea60bb44277a1b945d75f2a58db90f146c2c75ba2e1bf0d20fd2abc` |
| `client/src/app/lobby/room.component.spec.ts` | `3660a40c26fba34f377906db5c75b1c1e2f55c6f` | `1d0b1b128a25cd9638e999d3dd390d6bc2187613c85e46bf2610b3d8ad4b61e6` |
| `client/src/app/lobby/battlefield-map/battlefield-preview.component.html` | `2a11e6c01020eda3a75bee716cd648097ed44b19` | `b15ff4c9f9e968e3482b0b2ea6712f6578df4a67b4990ffc6eaada5935c847f6` |

These room component/spec bytes are exactly the later unreviewed hashes recorded at the end of R41. They are reviewed and accepted here at this new H; the historical report remains unchanged.

## Finding disposition

**R41-N1 resolved.** The panel now displays `Scenario: {{ info().scenario }}` before map details, sides and invite. It uses the retained public scenario ID as an honest fallback label. Angular text interpolation escapes the value; no fabricated display name, mutable catalog lookup or new request is introduced. This works for modern and legacy rooms and does not weaken modern descriptor parent binding or Start gating.

**R41-N2 resolved.** The shared caption now says “Escape fits the map when zoomed.” This matches the unchanged preview key handler and its focused-map instructions in both room disclosure and chooser contexts. It no longer promises outer closing behavior where none is implemented. No new modal/history owner, shortcut, focus transfer or close behavior is added.

The only test change adds three exact content assertions to the existing room case. Existing retained map/extent, DOM ordering, no-catalog, malformed-modern rejection, synthetic Start, retry, legacy, join/ready/leave/invite/hot-seat checks remain. The copy assertions are content regressions, not proof of browser keyboard or layout behavior.

## Independent checks actually run

Pinned Node v22.23.3 PATH, existing dependencies; Angular used `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`.

- Snapshot client `ng test --watch=false --include=src/app/lobby/room.component.spec.ts --include=src/app/lobby/battlefield-map/battlefield-map.component.spec.ts`: **99 tests /2 files passed**. `/private/tmp/lobby-map-r44-review-tests.log`.
- Focused ESLint on both changed TS files: passed. `/private/tmp/lobby-map-r44-review-lint.log`.
- Prettier `--check` on all three changed paths: passed. `/private/tmp/lobby-map-r44-review-format.log`.
- Read-only TypeScript AST comparison against P: all27 original room assertion expression statements retained, exactly3 added. `/private/tmp/lobby-map-r44-review-assertions.log`.
- Explicit Git/inventory/scoped hashes and `git diff --check`: passed.

No full suite/typecheck/build/CI or actual HTTP/browser/game execution was added for this small text/template delta. The Angular build exercised the actual room/shared preview template; existing source-type and native/backend coverage remains in earlier reports with its original limits. Concurrent W17 parent/shell work is outside this candidate and not accepted by these checks.

## Remaining gates and preservation

Coordinator reports task-only real main now runs on41590 with the same DB and actual15km full reload/list/read/canvas, Cancel/opener restoration and no remaining canvas. That is supplemental coordinator runtime evidence, not a reviewer operation, room browser test or Start acceptance. The reviewer did not control the process/browser or query the managed database. Room/live browser and ordinary Start approval remain open; no workaround was attempted.

Only this reserved R44 report and other specifically authorized review reports are written. Historical R41/R43 findings and drift records remain intact. No source/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment occurred. R45 draft retention is a separate packet.
