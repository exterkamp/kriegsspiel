# R3 bounded chunk 1 delta review

**Source verdict: accepted for the bounded B1/N3 repairs.** B1 is resolved in the inspected source and independently rerun focused tests. N3 has the intended source correction and coordinator-reported passing mobile measurements. **Combined packet verdict: Changes needed / no final acceptance**, because the coordinator subsequently reproduced Use-map focus loss (B2 below). Final browser evidence is pending.

## Frozen binding and review limits

- H: `6081bb550d444d8d2d0c3439c7b57f7cf471ee72`.
- Tree: `2fb837a88115c351f9f06cbaa829fb3050c885c4`.
- Verified parent / delta base P: `347e7c5645f1d476916cc711de7e0eeb03184e5d`.
- Overall accepted base/merge-base from R2: `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`; metadata prerequisite R1: `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`. HEAD was verified still at R1; H was read explicitly through Git objects, never checked out.
- Reviewed existing R1, frozen R2 (including B1/N3 and historical-evidence warnings), and the execution log, including its H-only repair/evidence entries. R1/R2 remain unchanged.
- Historical execution source: `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`. At the R3 check, manifest `/private/tmp/lobby-map-chunk1-candidate.json` named H/tree above; all 14 manifest digests matched H blobs, and all seven P-to-H changed paths were covered. The manifest's `base` remains R1, so the actual bounded delta was obtained from verified Git parent P.
- Before the next repair announcement, compared all **1316 regular tracked H files** against snapshot bytes. Only the R1 report and execution-log snapshot copies differed/missed; all product/config/test source matched H. Those two docs were read from canonical/H as appropriate. These are **historical checks only**: after the coordinator announced the B2 repair, the snapshot again became a mutable writer workspace. Nothing in this report asserts that its later bytes equal H.
- User reports native footer verified GPT-6.1-Sol High. No model reset/settings operation was performed by the reviewer. No source/test/config, Git, server, browser-input or pane mutation, agent creation, dependency install, external message, merge or deployment was performed. The sole new durable output is this exclusive report.

## Complete repair delta inspected

Entire P-to-H diff reviewed, plus the surrounding parent pending/recovery, child open/history/finish paths and prior test setup. The seven changed H blobs are:

| Path | H blob | Review |
| --- | --- | --- |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.css` | `ebfe94e1bd36bab1d261d41e47210b88b351951e` | Narrow-only scroller growth and surrounding dialog/header/footer constraints. |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.html` | `28f68936b960d94f96f87a3843ded22d3f4b8940` | All three entry-button disabled bindings; unchanged button types/dialog controls. |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.spec.ts` | `29ed95d9faefe62ff18d7270056745a5e9602532` | Stable parent-signal callback fixture; pre-render entry attempts and post-clear opening/cancel recovery. |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.ts` | `e47ed0c6da4dd2d62409d4d4f1b0e76b17c4efd2` | Optional `canOpen`, computed live gate, handler order before side effects; unchanged focus/history retirement surrounding it. |
| `client/src/app/shell/new-game.component.spec.ts` | `57f4774f81200e843eea68812eb96ed337096547` | Actual-child unresolved-create test, stale DOM ordering, history/native-open assertions and definite-failure recovery. |
| `client/src/app/shell/new-game.component.ts` | `6c4bf834c9b7225b01093f04dbead4bddb7610cf` | Stable callback binding, every pending settings fieldset, existing synchronous `busy`/`starting` transitions and request/error path. |
| `docs/lobby-map-selection-execution-log.md` | `3ea989650159610e931ce8ddefa165042cc6d32f` | Repair ownership, prior failures and check/evidence qualifications; claims distinguished from reviewer results. |

The delta does not change protocol/server metadata, terrain preview geometry/layers/units, transport/request construction, auth/guest/live/replay callers, shared shell source or library capability. R1 and unaffected R2 source assessments carry forward by unchanged Git objects, with their recorded scope limits. This does not clear R2 N1/N2 or broader draft-retention/later pairing/storage work.

## Repair assessment

**B1 resolved at H.** The parent supplies one stable arrow callback reading its current `starting()` signal. The child computes `entryEnabled` by invoking that callback, so Angular tracks the actual signal dependency. Setting `starting` invalidates the computed value synchronously, without waiting for input rebinding or disabled-attribute rendering. `open()` checks it before recording an opener, incrementing a visit, emitting activity, pushing history or opening the native modal. The same gate disables Choose/Add/View after render. Pending form fieldsets disable native settings controls, while existing `busy` guards still protect synthetic changes and duplicate submission. Disabled controls do not alter the request body: submission uses existing signal/form rules rather than DOM FormData.

On definite failure, the existing catch resets `busy` and `starting`; the same callback/computed boundary becomes available again. No game request is canceled and no server semantics change. Success leaves the gate closed until the existing route transition destroys the parent. The stable callback avoids a per-render input identity replacement that could otherwise trigger the child's `ngOnChanges` lifetime retirement.

**Tests meaningfully address the original ordering.** The new child test first sets pending, explicitly confirms the DOM buttons are still enabled, then clicks all three before change detection and verifies no modal/activity/history changes. It later opens/closes all three after pending clears. The parent test now uses the real child, starts an unresolved create, and clicks all three before `detectChanges`/`whenStable`; it checks one create call, zero history pushes and a closed dialog. It then verifies native pending-disabled state and definite-failure recovery. `await Promise.resolve()` after externally rejecting the promise allows the actual existing catch continuation to run before Angular stability assertions; it does not remove the original before-render ordering assertions. Existing exact request-body and successful-route checks remain unchanged from R2.

**N3 source repair accepted; mobile results supplied by coordinator.** Only the narrow media query adds `.scroller { flex: 1 1 auto; }`. The dialog keeps its full viewport height, `min-height: 0`/overflowing content area and nonshrinking header/footer. Short Add content can grow into spare space; long chooser content can still shrink and scroll. No absolute positioning, content overlap or desktop layout change is introduced. The subsequent coordinator supplement reports footer bottoms 843/844 and 719/720 at widths 390/320 with no overflow, plus heading Shift+Tab → Use passing. R3 did not independently measure or operate those browser states; final screenshot/report provenance is still required for complete visual acceptance.

## New blocking runtime finding

### B2 — P2: Use map does not retain focus on the original opener after settlement

**Affected unchanged H paths:** `battlefield-map.component.ts:268` (`use`), `:174` (`onPop`) and `:351` (`finish`), with the corresponding dialog Use action in `.html`.

After the source checks, the coordinator reported reproducing Choose → Use ending with focus on `BODY` after the dialog closed and history fully settled, using both normal pointer interaction and native accessibility activation. Direct Add → Back to maps → Use reportedly has the same outcome. The expected destination is the actual original entry button (Choose map for the first path, Add map for the second), with the existing heading fallback when that opener is gone.

This is a **coordinator-reproduced runtime finding**, not an independently executed R3 browser reproduction. The report does not yet exist at `/private/tmp/lobby-map-chunk1-browser.md`, so raw browser evidence remains outstanding. It is nevertheless an explicit observed acceptance failure and prevents final acceptance of H. It does not reopen the independently verified pending-create B1 repair.

Source inspection confirms H attempts one immediate restoration inside `finish`, after closing the dialog, emitting `activeChange(false)` and forcing child change detection; it clears `opener` immediately afterward. This is an attempted focus handoff, not proof that focus survives native close/history/render settlement. The exact native root cause is **not established** by this source review. Existing jsdom dialog stubs cannot establish it, and the Use/reopen test does not assert settled native-browser opener focus.

Required bounded follow-up: preserve a correct focus handoff through actual native/history/render settlement, without stealing focus from a newer dialog, changed route or destroyed/replaced component. Verify both reported paths after settlement, correct actual-opener restoration, announcement, unchanged draft and no game effects. Retain Cancel/Escape, repeated Use, stale-close, input replacement and teardown protection. The writer owns that repair; R3 made no source changes and will require a new exact candidate for its delta.

## Checks actually run by R3

- Explicit Git parent/tree/complete seven-path diff/blob inspection and `git diff --check P H`: passed.
- Independent manifest SHA-256 and historical 1316-file snapshot comparison: results and documentation exceptions recorded above. No post-B2-repair snapshot equality is claimed.
- In snapshot `client`, with pinned Node v22.23.3 PATH and `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`, ran:

  ```sh
  node ../node_modules/@angular/cli/bin/ng.js test --watch=false \
    --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' \
    --include='src/app/shell/new-game.component.spec.ts' \
    --include='src/app/shell/shell.component.spec.ts'
  ```

  **83 tests / 3 files passed**, including actual Angular compilation. These tests ran while the checked product source matched H, before the next repair announcement. jsdom/native primitive limits remain as described above.

No full ordinary suite, independent build/typecheck/lint rerun, mutation testing, live creation or browser-input exercise was performed by R3. The coordinator's repair typecheck/build/lint reruns and broader historical suite results are separate evidence, not reviewer-run checks. The repository-without-`.git` limitation, server timing retry and browser cookie-isolation incident remain honestly recorded in R2/execution log; this repair does not erase them.

## Handoff state

R1 and frozen R2 findings remain unchanged. R3 accepts the bounded B1/N3 source repair, records B2 as the outstanding runtime blocker, and awaits a new exact repair candidate plus the final browser report. No final chunk 1/PR/whole-product acceptance or later pairing/storage readiness is asserted. This file and the final response are the handoff; no external messages were sent.
