# R5 independent final chunk 1 focus delta review

**R5 verdict: accepted for the B2 source repair and evidenced default-map inspection UI at H below; no remaining source/inspection-UI blockers found.** B1, B2 and N3 are closed within that bounded scope. **Full chunk 1 end-to-end acceptance remains incomplete: actual browser Start game → live play was blocked before execution and is unverified.** This is not whole-PR/product acceptance or permission to merge/deploy. R1/R2/R3 remain unchanged and their historical failures remain recorded.

## Exact candidate and evidence binding

- H: `7716cc8a60f4603f43708037a8e45a97ebe93b09`.
- H tree: `a69d2634313980dc125e56f4278091dfbf1bf836`.
- Reviewed documentation/artifact head A: `5e8425de9c95a5b07ebd0a0e062181b0cd9cfa9b`, tree `2f40fe3ccf71e8c611bcf0ec4ef0c185dc944b7d`, verified direct parent H. All source/test claims remain bound to H; A adds documentation/evidence only.
- Verified parent / bounded delta base P: `6081bb550d444d8d2d0c3439c7b57f7cf471ee72`.
- Overall accepted base/merge-base carried from R2: `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`; metadata R1: `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`: HEAD verified still at R1. All candidate claims use explicit H Git objects; no checkout/index/ref mutation was performed.
- Execution snapshot: `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`. At the R5 check, `/private/tmp/lobby-map-chunk1-candidate.json` named H/P/tree above; all 14 manifest SHA-256s matched H blobs. An in-memory archive comparison checked all **1316 regular tracked H files** against the snapshot. Only the R1 report and execution-log copies differed/missed; all product/test/config source agreed with H. Those docs were inspected from canonical/H as appropriate. This is a time-bound comparison, not permission to reuse later mutable snapshot bytes as H evidence.
- Packet reports native GPT-6.1-Sol High verified. The reviewer performed no reset/settings/pane operation. No source/test/config/Git/server/browser mutation, dependency install, agent creation, external message, publication, merge or deployment was performed. Only this exclusive report was written during the chunk 1 review; R1/R2/R3 are untouched.

## Complete P-to-H coverage

| Changed H path | H blob | Actual inspection |
| --- | --- | --- |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.ts` | `c02d46f58d167c992979be5c649a0139b3487667` | Entire delta plus open, parent-entry gate, input replacement, history/pop, close/cancel/use, render callback and destruction paths. |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.spec.ts` | `969ef903f6bb037eef19e6a7c3057635f6331387` | Entire delta, native shim/deferred-close helpers, unchanged prior cases and new ownership regressions. |
| `docs/lobby-map-selection-execution-log.md` | `6d55b86b5a1bcc3b55bc0df4027183d27363a075` | Entire delta: earlier focus failure, ownership/evidence qualifications and coordinator publication record. No publication was performed or independently verified by R5. |

**Complete H-to-A artifact delta also reviewed:** `/private/tmp/lobby-map-ui-artifact-candidate.json` lists exactly the 13 paths returned by Git, without omissions/extras. They comprise the existing frozen R2/R3 reports (two additions to Git, byte-identical to the preserved canonical reports), the ten-line execution-log supplement, the evidence README, and all nine JPEGs inspected below. All 13 A blobs match the inspected canonical artifact bytes. `git diff H A -- client server packages` is empty. The log accurately retains the blocked Start action and incomplete browser create gate; its publishing/check claims remain coordinator evidence. The pairing-contract document is not included in A and has its own independent hash-bound review.

The coordinator identifies A as the pushed documentation head of draft [PR #463](https://github.com/exterkamp/kriegsspiel/pull/463), stacked on metadata [PR #462](https://github.com/exterkamp/kriegsspiel/pull/462). R5 independently verified the local Git/artifact binding, not remote PR status, checks or publication account. This final review itself is outside A; it does not claim to be committed in the head it names.

Inspected `/private/tmp/lobby-map-w1-focus-handoff.md` and its supplied red-run log as author evidence. R1/R2/R3 coverage carries forward for unchanged product paths. In particular parent `NewGameComponent`/its actual-child unresolved-create test, modern entry callback and narrow `.scroller` correction are unchanged from P; preview geometry, protocol/server, transport/create request, live/auth/guest/replay callers and shared shell source are unchanged. This is not a fresh claim that any later pairing/storage contract is implemented.

## Independent source assessment

**B2 has a credible bounded correction.** After owned history traversal is acknowledged, `finish` now retains a visit-bound return destination and renders cleared waiting/disabled state before native `dialog.close()`. It waits for that close acknowledgement instead of relying on one immediate focus call in `popstate`. Restoration runs through Angular `afterNextRender` with the component injector, then rechecks destination object identity, visit, URL, activity, pending traversal, destruction and the live parent `canOpen` gate. It focuses the connected enabled original opener, or the summary heading fallback, and restores the recorded scroll position. The destination is not discarded before the native-close/render boundary.

**Queued close ownership is explicit.** Each component-issued native close records its visit. `nativeClose` consumes those acknowledgements in order and refuses an old visit or an event arriving while a newer native dialog is open. Reopening destroys the previous render callback, clears its destination and starts a fresh visit; old acknowledgements cannot settle the newer visit's pending close. There is no timer/polling loop or unbounded active resource allocation in the repair. The acknowledgement queue relies on the native one-close-event-per-close ordering represented by the tests; fabricated duplicate native events are not a new authorization boundary.

**Teardown and pending creation remain guarded.** Destruction marks the instance destroyed, destroys a scheduled render callback and removes its return destination before existing native/history cleanup. A callback cannot move focus back from another connected view. If creation becomes pending between native-close acknowledgement and the render callback, the live gate suppresses map-entry focus. Existing dialog/parent activity gates stay active until owned history acknowledgement, so the repair does not restore B1's overlapping creation/history path. The native close itself occurs before activity is released. Callback cancellation plus visit/URL checks prevent a settled prior visit from stealing a new dialog's initial heading focus.

**B1 and N3 carry forward unchanged.** The stable callback reads the parent's `starting()` signal synchronously, before history/modal effects even when enabled DOM is stale; native pending fieldsets and error recovery remain. Narrow scroller flex growth preserves the full-height footer/internal-scroll model. R3 accepted their source corrections and independently ran their behavior tests; R5 reruns them alongside the focus repair. Native mobile acceptance still belongs to the browser evidence below.

No new source blocker was identified in these three changed paths. R2's nonblocking parent-scenario binding, invalid-metadata copy/final-action distinction and broader draft-retention scope gap remain; this default-only repair does not claim to close them.

## Test effectiveness and checks actually run

Pinned Node v22.23.3 PATH and `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2` were used in the checked snapshot `client` directory:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false \
  --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' \
  --include='src/app/shell/new-game.component.spec.ts' \
  --include='src/app/shell/shell.component.spec.ts'
```

**91 tests / 3 files passed**, including actual Angular compilation: 40 child tests plus parent/shell cases. `git diff --check P H` passed. Independent manifest/full tracked-file comparison results are recorded above. Full-root suites, typecheck/build/lint and native browser operations were not independently rerun by R5; those remain separately identified coordinator/writer evidence.

The added tests hold the native close acknowledgement explicitly while retaining real same-document history. They assert the opener is enabled at native close, the exact final opener after queued close/render settlement, no duplicate activity transitions, and parent history restoration. Paths include Choose → Use, Choose → Cancel, browser Back and direct Add → Back to maps → Use. Additional cases acknowledge an older close while the next visit is open or already closed; change creation-pending state before the render callback; and destroy the instance before it runs. Prior focus assertions now wait for Angular stability, consistent with deliberate asynchronous restoration; none was relaxed to allow BODY as the final result.

The supplied `/private/tmp/lobby-map-w1-focus-red-tests.log` was inspected directly: **4 failures / 32 passes**. Three assert an enabled opener at the close boundary and fail with `[false]` versus `[true]`; browser Back detects premature restoration before the deferred close acknowledgement. These are meaningful assertions, not collection/compiler failures. R5 did not recreate that red run by changing source or independently prove its old-source identity; it is an inspected author effectiveness artifact. The current 91-test green result is reviewer-run against independently matched H source.

Native dialog/top-layer and browser event scheduling remain shimmed in jsdom. The deferred shim models a legitimate BODY-focus fallback and delayed close event; it does not establish the final Chrome result. The new checks protect lifecycle ordering and ownership rather than mirror a function's implementation, but real browser evidence remains necessary for B2 closure.

## Final browser gate

The final coordinator report now exists at `/private/tmp/lobby-map-chunk1-browser.md` and canonical [implementation evidence](lobby-map-selection-implementation-evidence/chunk1/README.md). R5 read both and independently verified byte equality, report SHA-256 `dea28e80731f694ac3b082d30bbadb604ff1f2667f11e73e5359614c69c31adf`, all nine listed JPEG digests and explicit H/tree/P binding. Product source binding is independently established above. Provisional screenshots were not substituted for these captures.

R5 independently opened and visually inspected all nine canonical captures: desktop entry/chooser/confirmed; 390 entry/chooser/Add; 320 entry/chooser/Add. They show actual default geography, a desktop two-column chooser, wrapping narrow controls/readable text, internal long-content clipping/scrolling with actions visible, and bottom-anchored short Add footers. The desktop confirmed capture visibly focuses Choose map. The coordinator report supplies the actual settled native Chrome observations that still images cannot prove: Choose → Use returns Choose map; direct Add → Back to maps → Use returns Add map; Cancel/browser Back preserve the draft and opener; nested Back unwinds to the chooser; View Escape fits before closing; heading Shift+Tab stays inside. It reports 390/320 width/overflow/footer metrics matching the visual captures. Those are reviewed coordinator runtime observations, not browser actions independently performed by R5. Combined with the source/meaningful lifecycle tests, they close B2 and N3 for the map-inspection UI.

**Outstanding acceptance gate:** the coordinator's final Start game pointer action was rejected by automatic approval review **before execution**, on the stated ground that the earlier design-only no-create scope still applied. The coordinator has an explicit owner-approval question pending for a disposable task-only game. No browser/API workaround was attempted, and R5 performed none. The coordinator reports zero `POST /games` entries in the task API request log; R5 did not independently audit that raw log. Existing exact scenario-only request, shell-route, pending/recovery tests and R1 injection checks remain valid but **do not establish actual browser create → live acceptance**. Do not label that flow passed, whole chunk 1 complete, or the PR fully accepted until separately authorized execution/evidence closes it.

Chrome viewport emulation does not establish physical touch-device/software-keyboard testing. The earlier shared-127.0.0.1 cookie-isolation incident remains disclosed; later task-host isolation does not prove the original local sign-in cookie was preserved. Full CI/publication/accessibility claims are outside this bounded review.

The R5 source/focus/visual inspection gate is now complete with that explicit end-to-end exception, allowing the independent contract-document review to proceed while the owner-approval question remains pending. No new implementation/writer release follows automatically from either document review.

### Subsequent snapshot scope notice

After R5 acceptance, the coordinator reports adding snapshot-only `server/src/game/native-scenarios/open-bridge-v1.ts` and its test as independent authored-content work. These untracked files are outside source H/artifact A and were not inspected or accepted by R5. The snapshot is therefore no longer the frozen chunk 1 execution source as a whole; the earlier comparisons/test runs are historical checks of the recorded H paths. The coordinator reports chunk 1 product paths unchanged, with no registry/API/public exposure changes. This notice does not independently validate the new content digest, corrected test, headless/replay results or later readiness, and does not alter R5's outstanding browser create-to-live gate.
