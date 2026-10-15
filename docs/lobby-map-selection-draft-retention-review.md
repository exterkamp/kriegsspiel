# R45 independent ordinary draft retention review

**Verdict: Accepted at `f8fb3e4bba04a384c593745fd95bf41dd51b39f1` for ordinary owner-scoped New game→menu→New game retention and public briefing disclosure. No blocking or nonblocking finding.** Independent source/fixture acceptance is supplemented by the attributed coordinator browser evidence below. Start/create-to-live, actual room behavior and measured performance remain separate gates.

## Exact binding and complete inspection

- H `f8fb3e4bba04a384c593745fd95bf41dd51b39f1`; tree `032539ae6158c945d2ec9b86ea30368573f8b13a`.
- P `d6b1eafbb1b1965df1083bc0869e4d4ca8b755ee` (R44 accepted separately).
- Manifest `/private/tmp/lobby-map-draft-retention-candidate.json`, SHA-256 `4f1fa1bbe71465c5491b3ec97b1511eb1272a2cbf501c910982acd3649e0b9b9`.
- Handoff `/private/tmp/lobby-map-w17-draft-retention-handoff.md` and raw red/check logs were read as author evidence, not substituted for independent source/tests.

Verified actual H/tree/P/ref, complete four-path inventory, each SHA against Git and scoped snapshot, and diff whitespace. Read the full production/test delta, whole affected initialization/navigation/owner/snapshot paths, pending decoder/request/storage precedence, form/side/default helpers, picker history/Use and shell auth/live/room routing boundaries. Read current AGENTS, relevant decisions/log and approved design, particularly ordinary Back/Main menu and public briefing requirements. No other product path is part of this candidate.

| Path under `client/src/app/shell/` | H blob | SHA-256 |
| --- | --- | --- |
| `new-game.component.ts` | `f700a92f8645d5dcbac9ddb76292d667a523cf53` | `c9ed063a5c9fd14cf318c4d256d9bbc7e152ad4913aa10f28aaa27ef6521c99f` |
| `new-game.component.spec.ts` | `274e3d582c5704354b95af688109254ef9794f36` | `8ad88943c0f03b0e173a50839b946891ef56380c1fdc10a6cef8600c6c216e9b` |
| `shell.component.ts` | `f166b4b11dde12a4feadf8e9f493f76978756104` | `22a2557b8b63af9e36b728e696862f6e8c2f24e81476788d56db4562fa69b1f9` |
| `shell.component.spec.ts` | `26d582f059f950f3759d0b01efbf92a1a0ce7f0a` | `7627d2f091e80507ba9eec2463e4a8ff6f029e80d263f580f030ca7810ec21e6` |

These include the later unreviewed parent/shell bytes observed during R40–R43; they are reviewed here at this exact new H. Historical drift notes and source verdicts are preserved.

## State, identity and recovery assessment

The draft is an internal same-Shell owner-scoped value. It explicitly copies the nine ordinary Form fields plus optional committed pairing ID/revision. It contains no descriptor/catalog, geography/asset/canonical JSON, library ref, request UUID or pending-create state. Copies at snapshot and restore prevent form/selection alias mutation. It adds no ordinary draft storage, cookie or history payload and makes no across-reload persistence promise.

`snapshotDraft()` refuses absent/stale owner, destruction, missing ordinary form, busy/starting/pending request or recovery state, blocked evidence and active modal/history gate. An implicitly selected valid modern default is captured with its actual current revision. Restoration keeps that identity: changed/removed pairing or revision blocks Start, and absence of modern catalog metadata cannot turn an explicit retained selection into a legacy scenario-only request. The unavailable-preview copy no longer promises a default in that invalid-selection state.

Existing retained creation is read/strictly decoded first. Valid pending intent and malformed retained evidence both take precedence over an ordinary draft; its request/storage/UUID is neither replaced nor auto-dispatched by restoration. The existing pending recovery path remains usable without current catalog options. A later manual retry still uses its exact request. Ordinary retention is not an alternative allocation-recovery mechanism.

For an ordinary draft, current same-owner fields are restored before a slow/offline catalog. Start still needs current options. Once loaded, an unavailable side is reconciled only to a current allowed/default side while other edits remain. A removed scenario displays a visible replacement selector rather than endless loading or an automatic scenario switch. Explicitly choosing a new scenario retains the existing `chooseScenario` behavior and resets its pairing only through that deliberate action. Empty/offline catalog state retains the snapshot without claiming readiness.

Owner checks around loading, create completion and synchronous stale rendered actions remain. The new ordinary path does not bypass epoch/destruction or the prior pending-storage guards. Its input is trusted in-memory Shell output, not a replacement public/untrusted storage decoder.

## Navigation and public content

Shell captures the live child's snapshot before replacing its New game screen with menu. Form Back, Main menu and browser popstate all use that transition. Same-URL picker overlays keep the New game case alive; sole native modal/history/focus ownership stays with the picker. Snapshot refusal during its active/handoff state avoids capturing unconfirmed candidate or in-flight map work.

The shell retains only a draft matching current auth identity. Identity replacement, explicit signout, live/game/sign-in transitions, home/reload paths and destruction retire it. A fresh Shell starts without the old ordinary draft, even for the same owner. Actual reload/assign ownership for game-route changes remains unchanged. Pending creation can outlive an ordinary form departure only through its existing retained request mechanism; late departed results still cannot publish into a new owner.

The briefing is the same existing server-supplied public `scenario.briefing`, now in an initially open native **Armies and objectives** disclosure. Sides/length remain visible. No unit counts, private placements, new objective facts or scenario policy is invented. The44px themed summary target is bounded UI styling; actual narrow browser/keyboard presentation remains unverified here.

## Test effectiveness and independent checks

New parent tests exercise allowlist/detachment, foreign owner, slow/offline/empty catalogs, pending/blocked recovery precedence with exact retained request, stale identity/default revision, absent modern metadata, unavailable side/scenario and snapshot rejection during active modal/start/owner replacement/destruction. Shell tests exercise real Angular NewGame/picker radio→Use selection and same-document history, then Back/Main menu/browser Back and fresh/auth-replaced Shell behavior. They wait for both dialog close and cleared parent modal gate before ordinary navigation. Only jsdom's absent native top-layer `showModal`/`close` methods are simulated; they do not prove Chrome top-layer/focus behavior. API/game calls remain injected fixtures and are asserted absent during navigation/restore.

Read-only TypeScript AST comparison against P retained every195 original assertion expression:65 parent and130 shell. New totals119/163 add87 assertions without replacing the old ones. Raw author red log reports4 failures before implementation: the three navigation modes lose edited turn mode, and briefing disclosure is absent (47 filtered cases). Those are meaningful author red premises; no reviewer source mutation/red run was performed.

Pinned Node v22.23.3 PATH, existing dependencies; Angular used `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`:

| Check | Actual reviewer result | Log |
| --- | --- | --- |
| `ng test --watch=false --include=src/app/shell/new-game.component.spec.ts --include=src/app/shell/shell.component.spec.ts` |90 tests /2 files passed | `/private/tmp/lobby-map-r45-review-tests.log` |
| Client `npm run typecheck` | App/spec/workers passed | `/private/tmp/lobby-map-r45-review-typecheck.log` |
| ESLint on all four owned files | Passed | `/private/tmp/lobby-map-r45-review-lint.log` |
| `vitest run --configLoader runner --no-cache src/styles/design-system.test.ts` |5 tests /1 file passed | `/private/tmp/lobby-map-r45-review-style.log` |
| AST assertion preservation |195 retained,87 added | `/private/tmp/lobby-map-r45-review-assertions.log` |
| Git/inventory/scoped source hashes and diff whitespace | Passed | Tool output |

A routine attempted Git diff from the non-Git snapshot printed usage; the complete diff was then read from the canonical repository's explicit objects. No source/Git state was changed. Coordinator's format/full-root checks are separate; no independent full suite, production build, format, remote CI, actual HTTP/browser/game or profiler was added here. Compiling the combined workspace does not accept unrelated source solely through typechecking.

## Acceptance limits and preservation

Accepted for the already approved within-Shell ordinary draft behavior, preserving the pending-create authority and native map selection boundary. Browser navigation, narrow briefing disclosure, actual top-layer history/focus, measured performance and Start/create-to-live remain separate acceptance gates. The reported task-only real-main restart/library reload belongs to coordinator runtime evidence and was not controlled by the reviewer. No managed game/Start, API workaround or external action was performed.

Only the reserved R45 report and other explicitly authorized review reports were written. R44 and all historical reports remain unchanged. No source/test/config/Git/runtime/browser/game/pane mutation, new agent, checkout/worktree, merge or deployment occurred. Protected canonical HEAD stays `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`. Stop after R44/R45.

## Final source and attributed browser supplement

The later supplement does not change the accepted source verdict or expand the packet. Independently compared all 1,160 tracked non-`docs/` file blobs at H against the snapshot: zero differences. This includes the root tracked documentation files; it does not attest ignored/untracked files, compiled output or running processes. `/private/tmp/lobby-map-final-source-binding.json` and its copied evidence artifact have SHA-256 `372783a813571293e6073f894d202bd3da5f1525f5b14f9df64bb84ff01ee878`.

Read [the coordinator's real-main and Back record](lobby-map-selection-implementation-evidence/final/real-main-and-back.md), SHA-256 `eeea4eebe7de3c3ee5598ffc7a174794846b68c3c1d70121d04931bf86f00d81`, and visually inspected the five static captures below. This is attributed coordinator Chrome evidence, not reviewer browser execution. The record reports actual menu/Back and browser Back preserving confirmed Open bridge approaches, retained 4:1 rate, turn15/deadline8; full reload restores the original bridge/realtime12. The screenshots show the retained alternative, open public briefing and turn/deadline values, and the reset default map after reload. The 390/320 captures show content within the page width; reported viewport/no-overflow measurements and interaction sequences remain coordinator observations. Static full-page captures alone do not prove scrolling/focus or event chronology.

| Capture under `docs/lobby-map-selection-implementation-evidence/final/` | SHA-256 |
| --- | --- |
| `desktop-retained-draft.png` | `67adf5e30eb0fc48f1c043294a896ea9bf7cc47fc288292466d9aae08b8d5533` |
| `390-retained-draft.png` | `a4c4ce76b760b49065438c12c72fa233d858c665f7edd2ddab86d3e705945396` |
| `320-retained-draft.png` | `787f5746d6ea7b00cce7031b15c7b7946ce95ae99b8ac27fd819137bf61af689` |
| `desktop-reload-default.png` | `1ede5f48dad49799faf4b88ad703516f9d19e196da165c278f586a159ab7d570` |
| `desktop-real-main-reopened.png` | `bdcf7e03c62752d0aa48cd0e8fc17a18dce324799fc6e6861abfe44644cb6e79` |

The last capture and public response artifact (`real-main-public-scenarios.json`, SHA-256 `28a9b89b5c3d58be849951f92129a718c6f6e2f0b36bc70cd2744c9bc819a141`) supplement coordinator real-main/library readback, with no reviewer runtime request. The coordinator reports two assets/two operations and zero games/receipts. This supports bounded functional browser retention/disclosure and actual module-worker/library integration evidence; it does not establish create-to-live, actual room behavior, heap/long-task/FPS or near-limit performance acceptance. Ordinary Start approval remains pending and no workaround was used.

The coordinator additionally reports final root lint/typecheck/build passing, Angular944 tests/53 files and framework-client1,247 tests/66 files passing. Those are author execution results, distinct from the independent focused runs above; no root rerun was performed here. PR480 is reported failing an engine invariant (269mm/5ms counterexample, seed2065375889), without a fix or rerun. Independently verified that baseline and H share the identical engine subtree `e5c9063d791f451dfc120ec2de326ab2a557ccd6`; the remote CI run/counterexample was not independently executed. No whole-CI-green or full-product acceptance is asserted.
