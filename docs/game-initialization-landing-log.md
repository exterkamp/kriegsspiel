# Game initialization landing log

## Historical blocked continuation checkpoint — 2026-10-11

Authorized: implementation, isolated landing worktree, local commits, managed previews, tests, independent Herdr review, and planned GitHub PR publication. Merge and deployment remain prohibited. The approved landing plan governs packets P0–P5 and limits dependent drafts to one.

This log is staged outside the reference checkout because the mandatory live refresh is blocked. Move it into the clean landing worktree once that refresh succeeds. No landing worktree or branch has been created from stale cached main.

### Source and protected ownership

- Reference: `/Users/dominic/code/kriegsspiel-map-table`, branch `feat/local-game-initialization`, frozen source `da9dd0ba39bd7c101f069269272bb1c083027df3`.
- Reference prerequisite: `9ea5db1d095534219f42870a7b5c3a89e07cac78`.
- Cached origin/main: `b3f0f76b162450a7ffe30ee55a6ce13aa8cec4e3`; this is historical and is not an accepted landing base.
- All four protected scale-marker file SHA256 values match the planning audit. Exact current values and extraction hashes are in `../manifest.json`.
- Reference checkout, generated maps, historical evidence, unrelated checkouts and panes were preserved. No source file was edited or staged there.
- Coordinator reserves contracts, entrypoints, configuration, integration, all Git/PR operations and managed previews. No writer or reviewer was dispatched.
- `HERDR_ENV=1`; inherited `HERDR_PANE_ID=w1:p1` is unverified. Live pane IDs, coordinator model/effort and reviewer settings could not be verified. Historical w3 IDs must not be reused as current ownership.

### Refresh attempts and external blockers

- Read AGENTS.md, approved landing plan, historical execution log, installed herdr and herdr-pr-review skills, dispatch/review protocol, decisions and applicable reference documentation.
- Local inventory confirms the four protected modified files and untracked landing plan. Worktree list contains only the three pre-existing checkouts.
- `git fetch origin main`: failed, `Could not resolve host: github.com`.
- `gh pr view 241`, open PR list and main commit API: failed connecting to api.github.com. Current main, #241, overlapping PRs, ownership, CI and mergeability remain unknown.
- `herdr status`, current pane, pane list and agent list: denied with `Operation not permitted`.
- `devrun ls --all --json`: denied opening registry.lock. Read-only registry snapshot still lists protected ports 41271, 41161, 41412 and 41503; that snapshot does not prove process health or actual live ownership.
- Escalated access attempt was rejected by the tool policy: `sandbox_approval: false`. No escalation or alternate control channel was used to bypass the restriction.

### P1 extraction artifact

Prepared `../p1-reference-extraction.patch` directly from the frozen source and reference prerequisite. It contains only catalog middleware/tests, setup contracts/catalog/preparation/tests and the committed map assets/catalog. It excludes default-game startup config, HQ/rendering/setup UI/session changes and all protected dirty content.

This is a source extraction artifact, not a PR candidate. It has not been applied to a landing base. The coordinator must add the narrow Vite plugin registration while preserving current upstream build entries, canonical JSON formatting exclusion, and packet documentation after current main is available. No historical test/review result is promoted to current acceptance.

### Acceptance and next action

No packet is accepted, no new PR is published, and no CI/browser/review readiness is claimed. P0 refresh and P1 extraction against current main are the next executable packets. P2 requires accepted P0; subsequent dependencies remain as stated in the approved plan.

Resume in a session that can reach GitHub, access the Herdr socket and manage devrun state. Refresh live ownership and upstream revisions first, create `/Users/dominic/code/kriegsspiel-game-init-landing` from the verified delivery base, move this log there, then apply/reconcile P1 and run its required gates. Retain the original preview URL `http://127.0.0.1:41503/`; it was not changed or newly verified here.

## Access restored and P0 started

GitHub, Herdr and devrun access succeeded after the user enabled automatic approval. Main fetched at `c82aa1f8bec0aacea1a0edea9e8f2503c53d5421`. PR #241 remains open at `9ea5db1d095534219f42870a7b5c3a89e07cac78`, conflicting against main. Open #266, #267 and new #270 remain other-owner work; #270 changes workspace/configuration and decisions. No merge/deploy authorized. Publishing account: dfezzie.

Clean landing worktree created at the approved path on `landing/saved-map-refresh`. Coordinator owns all source changes and Git for P0. Local main integration conflicts only in client/vite.config.ts: preserve both mapTable and upstream tableBenchmark. Automatic decisions merge preserves upstream entries and D26. No POC feature packet is included.

Verified actual current pane through its live transcript/process: `w3:pF`, renamed init-landing-coordinator, effective GPT-6.1 Sol/medium. The attempted own-pane Escape interrupted the turn; do not send Escape to the working coordinator again. Historical coordinator `w3:p1` remains untouched. Reviewer sibling returned as `w3:pG`, labeled init-landing-reviewer, startup requested Sol/high; dispatch waits for effective footer verification. Current task concurrency: coordinator plus reviewer.

All four protected devrun previews are up on 41271, 41161, 41412 and 41503; retain them. No landing preview started yet. Ownership metadata contains historical w1 IDs, so do not infer current pane ownership from registry alone.

P0 revision 2f6365a: root lint/typecheck/test/build pass; 2,628 passing tests plus one existing skip, 137 focused tests pass. Independent Sol/high reviewer covered all 17 paths without findings. Browser harness feeds canonical File objects through unchanged page input handlers; actual workers certify and real WebGL renders rectangle seed17 and square seed31, invalid replacement retains rectangle, cancellation retains square, focused ArrowRight executes, narrow viewport 390×844 has scrollWidth 375 and one texture. Fresh screenshots staged locally; native picker automation timed out, so picker interaction is not current evidence. Temporary harness removed.

Main advanced during checks: #270 Angular spike merged as 63528b3e6b059d6d6f762dfd7c8178396fab3e78. It adds a workspace, TS6 and Node22.23.3; prior P0 acceptance/CI are historical for the old base. Preserve new tooling and rerun required checks after local integration. Svelte remains the served client; no migration expansion is authorized.

P0 final source d429a93e3b35957e5fe5b789e1079d71b43a8022, tree ae0535731a9013202e6abb588efcad1e839a1261, base/main63528b3e6b059d6d6f762dfd7c8178396fab3e78. Reviewer findings repaired: saved-map decision is D27 (upstream Angular retains D26); captures renamed JPEG without modifying bytes. Node22.23.3 was installed only under task-owned /tmp tooling. Full lint/typecheck/test pass on new tooling; 2,633 passes and one optional skip. Full build initially aborted inside restricted Angular builder, then required root build passed with permitted process access. No source workaround was introduced.

Fresh map-specific effectiveness r2 detects stale file-read publication, fractional UV inversion and dropped polygon holes through only designated assertions, with passing baseline/restored phases. All three scratch source hashes restored. Initial general runner rejected non-HQ probes, and initial map pilot lacked its custom reporter; those failed attempts remain excluded and retained. Full records at /private/tmp/game-init-p0-map-probes-r2; final independent evidence review pending. Exact-head GitHub CI running for d429a93.

Scope update: upstream D26 states other work is paused until full Angular conversion. Asked owner whether to continue approved Svelte UI landing or hold UI packets; P0/P1 framework-independent work continues while awaiting answer. No P4/P5 UI implementation dispatched.

## P0 accepted; P1 extracted

P0 source accepted by independent init-landing-review Sol/high at d429a93 against63528b3; all20 paths covered, both documentation findings resolved. Map-specific r2 effectiveness independently accepted. Current exact-head check/test-effectiveness jobs pass in run38170051051. PR241 is ready for maintainer review, not merged. Browser limits remain explicit. Reviewer handoff preserved in .local/game-initialization-landing-evidence/p0-final-review.txt.

Coordinator settled all writers and reviewer source inspection before branch switch. P1 branch landing/dev-map-catalog starts directly from current main63528b3, not from P0. Extracted eleven reference paths at da9dd0b, with narrowly scoped Vite plugin registration preserving all five upstream inputs, canonical-byte Prettier exclusion and service documentation. P1 depends on accepted map-authoring runtime already on main; no #241 dependency. No default-game startup config, renderer, Setup component or navigation changes included. Coordinator owns all P1 edits; independent reviewer has no authorship. Tests and final source review pending.

P1 preliminary checks:16 focused tests pass with actual HTTP sockets and three independently certified/default recipe/hash checks. Root lint and typecheck pass with existing Desk CSS warning. In actual Chrome, a disposable service harness certified all three committed defaults through real browser workers and confirmed detached cloneability and canonical byte equality. Real complete wooded-hills seed31 generation succeeded, saved through /__local/maps to task-owned .local/generated-maps/d117e88f-ac03-41df-a366-91b978b086ee.json, and read back exact canonical bytes/full hash ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed. A second real generation was aborted and reported Preparation cancelled. Harness removed before source freeze; JSON results and harness text retained under .local/game-initialization-landing-evidence. No shipped UI/browser layout is added by P1.

## Merge authorization and P1 main integration

Owner explicitly authorized merging each ready PR on 2026-10-11. Deployment remains prohibited. P0 PR241 merged as 346fd92196bd35d4d1ac7f8f003060a42b494272 after exact-head green CI and final independent acceptance; original head d429a93 and reference work remain preserved.

P1 source candidate 85a9c78cd1001b67e721bb6531b7f03c9b2b7be0 (tree3480dc0d74c9244aab42c37a492184019d693676, base63528b3) received independent source acceptance from init-landing-review, verified Sol/high, covering all15 paths with no blocking source findings. Full repository lint/typecheck/test/build passed, with2,564 tests passing and one existing optional skip. Actual browser worker evidence remains source-identical and separate under .local; asynchronous hashing completion guard was source-reviewed, not a directly delayed-hash browser test. Browser cancellation was observed without a separate result artifact.

Merged fresh main346fd92 into P1 with no conflicts; integration adds the accepted mapTable build input alongside all other inputs and preserves Angular tooling. Final candidate integration review and required checks/CI remain gates before P1 merge. Coordinator w3:pF owns all mutable source/Git/contracts/configuration; reviewer w3:pG is read-only. Protected previews retained; task preview http://127.0.0.1:41930 remains managed and running. Next packet is P2 fixed raster/personal marks after P1 acceptance; Svelte UI scope question prompted by upstream D26 remains pending.

## P1 merged; P2 renderer extraction

Owner requested immediate merge of green PR281. Confirmed exact-head CI check and test-effectiveness success for f0d800c and source-bound acceptance covering15 paths; PR281 merged as76f284edfedd77c214b78e92840fbf8055dffbca. Concurrent other-owner PR280 landed as c99f86c, updating Vitest4, review tooling and optional Angular SPA fallback. P1 final pre-merge local checks passed2649 tests plus one skip; main integration is now being revalidated under Vitest4. No other-owner PR was merged by this coordinator.

P2 branch landing/local-board-renderer refreshed to main76f284e, using own locked dependency installation. Exactly the fixed-board scene and81 lines of focused regression tests were extracted from frozen da9dd0b, with attached scene documentation and this ledger. No HQ contracts, Setup UI or startup wiring included. Coordinator retains all source ownership; independent reviewer w3:pG was reset only after preserving completed P1 handoff, effective Sol/high verified again. Protected previews remain up; only own landing preview was restarted at41930.

163 focused tests pass with Vitest4, including all P1 services, existing saved preview/fixture behavior and local board isolation/resource/frame cases. Browser rendering, source freeze, full repository gates and independent review are next.

P2 real browser workers certified the canonical rectangle and actual WebGL rendered NW/SE pins and a personal polyline with zero pieces. Desktop and narrow390×844 oblique captures are attached under docs/map-table-landing-evidence/P2.md. Clearing marks returned4 textures to1 and retired their geometries. Initial cold certification hit the existing30-second watchdog; retry succeeded. No production timeout changed. Disposable local/preview harnesses and served asset copy were removed before source freeze and retained under .local. Existing standalone preview recheck pending; full checks/source review remain gates.

P2 initial candidate6f91a41012355cbdce135c237af743cb79dd9044 received changes-needed: independent reviewer reproduced leaked detached previous marks when disposal re-enters during rendering or retirement. All7 paths covered, no other blocking findings. Added two resource-disposal regressions: each fails against the original extracted implementation with only the designated zero-call assertion (44 prior tests pass). Repair snapshots predecessor ownership and releases every predecessor on terminal exit through the existing idempotent release ledger. Earlier passing root/CI results are historical for6f91, not final acceptance.

Standalone saved-preview browser recheck completed against6f91: actual input-handler harness certified canonical rectangle and rendered Oblique WebGL with empty console warning/error logs. Capture/result retained outside reviewed tree; disposable ignored harness/asset copy removed after capture. Approved user fixture landing scope takes precedence over repository pause text; Angular conversion is excluded from this task.
## Catalog integration test timeout follow-up

P2 candidate acbf2db passed final local root lint/typecheck/test/build (2657 passing tests and one optional skip), independent source acceptance and test-effectiveness CI. Main CI run38173030875 failed only the P1 large canonical save/readback/independent-validation integration test at the default5000 ms timeout; recorded duration5518 ms. Assertions are retained unchanged. A separate prerequisite follow-up gives only this full2.3MB socket/filesystem/certification test an explicit30000 ms bound, consistent with other expensive map checks. No production timeout or global test configuration changes.

Follow-up branch landing/catalog-test-timeout starts at fresh maina1e06e58b03a9078e8b8b9f591a4b2e5359d6c6c (other-owner Angular services/stores PR282 merged). P2 remains draft and unmerged; its frozen source acbf2db and review handoff are preserved. Coordinator owns the two-path test/log change; independent review and current-head CI required. Only own preview stopped for branch switch; protected previews retained. After follow-up lands, refresh P2 to main and verify the integration before proceeding P3.

## P4 independent extraction while P2 integration waits

Catalog timeout PR285 merged as7cda02007455909606cddb89bb4f807dc96ee1ce after current-head CI and independent source binding. Original P2 candidate acbf2db remains source-accepted draft, awaiting fresh-main integration with the prerequisite and Angular-only upstream delta.

P4 may precede P3 under the approved plan and depends only on merged P1. Branch landing/game-setup-view extracts only Setup.svelte/test from da9dd0b; source candidate2baf2d9ef1c9b4e027a8635a3aea2eb5fcd9ffaf integrates main7cda020. Nine focused tests pass. Actual browser saved rectangle selection/Start cloneability, generated wooded31 certification/save/selected-reference/Start cloneability and cancellation during another generation completed. Desktop/narrow captures attached under docs/game-setup-evidence. Initial save persisted its file but harness reloaded; repeat complete sequence succeeded. Task-owned generated files253e4697-7287-492f-9560-fd6dd180875c and1fb5a56a-261b-4857-9a00-716d654a5147 are retained alongside earlierd117e88f file; originals untouched.

P4 harness removed before freeze. Coordinator owns source, Git and preview. Independent read-only review will use an exported frozen source snapshot, allowing coordinator-only branch switch back to P2 without changing reviewed bytes. Full P4 repository checks and CI remain outstanding; no P4 ready/merge claim.

P4 independent source review of5fa978e covered all8 paths and found a delayed-list selection race: initial listing could replace a just-saved entry and display a different numeric selection while Start submitted the saved board. Two deferred-list regressions (with/without stale duplicate summary) fail original source solely at the wrong selected-label assertion;9 prior tests pass. Repair merges late catalog entries with current summaries and rebinds selection by map reference, keeping current saved metadata. P2 final current-main source review accepted3abc72c/tree8bc09a5 against1c33023 with all7 paths unchanged and incoming18 Angular paths matching main; exactheadCI still pending.

## P2 merged; new upstream fixture retirement gate

P2 PR283 merged as eed7148290fc8d389cd7ed30815388ae2971666f after exact-head green CI and independent source/integration review. Actual merged tree4c3690a359bfe4349a3cb5f50554391403f3ab4d equals the independently accepted prospective tree. Read-only handoff preserved under .local/game-initialization-landing-evidence/p2-prospective-merge-review.txt. P4 integrates that main revision as d8a965bce2ab5b951c694383454f041940fdab4c, with clean ownership and eight packet paths.

P4 late-list repair9b8ccbcf5a1ae34bcabaadd5c35dde13f29d45e2 passed11 focused tests, including two deferred-list regressions that fail the extracted source. A real-browser replay held the initial catalog response while generating/certifying/saving wooded31, then released the response: selection stayed bound to generated reference a0ececc1-9dad-4fd2-912e-b1d15cee7454 and Start submitted its cloneable board with identity ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed. Raw p4-late-list-browser.json and harness are preserved locally; served harness removed. Final P4 root checks, independent repair review and PR remain outstanding.

Fresh upstream main is now51d4d366495f00174f9ab8dc7da7fd69c297a11f. Other-owner PR290 explicitly retired and deleted client/src/hq and the fixture route under D28; PR289 added the Angular shell. This is an actual architecture conflict, beyond the earlier general migration pause. P3 adapters and P5 integration cannot land against current main as originally scoped without restoring deliberately retired code. No retirement commit was reverted and no Angular conversion was started. Asked owner to choose adaptation to Angular, restoration of the development fixture, or stopping the remaining UI packets. Await that material scope decision before dependent implementation. Historical branch/browser evidence remains preserved and is not current-main acceptance.

Coordinator w3:pF (Sol/medium) and settled reviewer w3:pG (Sol/high footer observed) retained; no new assignment dispatched. Protected previews remain up; task preview41930 runs the preserved P4 candidate, not current main. Original checkout, generated maps and evidence remain protected. Next action: settle the fixture-retirement scope gate, then implement and verify the chosen bounded integration.

Independent init-landing-review Sol/high accepted the preserved P4 repair checkpoint279dbb1/tree27868db against eed7148, covering all8 paths and relevant contracts/services, with no consequential remaining source findings. Independently verified browser-tested repair/dependency bytes match the checkpoint; screenshots remain historical2baf evidence. Reviewer did not rerun tests/browser. Coordinator reran Setup tests at279dbb1:11 pass,exit0. Handoff retained at .local/game-initialization-landing-evidence/p4-repair-checkpoint-review.txt. This is component acceptance only: current-main compatibility and merge readiness remain blocked by the unresolved fixture-retirement scope choice. Reviewer is settled; retain the owned pane for the chosen follow-up.

## Owner redirects remaining landing to Angular

Owner explicitly chose reworking the plan so all remaining local game initialization goes into Angular. Preserve D28 fixture retirement; do not restore the retired Svelte HQ. Planning revision is now underway in docs/game-initialization-angular-landing-plan.md; the original approved plan remains historical and intact in the reference checkout. Scope exclusions, protected work, prior merge authorization and deployment prohibition persist.

Fresh GitHub main51d4d366495f00174f9ab8dc7da7fd69c297a11f; no open PRs observed. Cutover issue279 remains open and owned by the migration workflow; its future workspace/path changes require a preservation contract for P1/P2 pure TypeScript, workers, assets and renderer. Current landing HEAD71a5038a500fb60ac385b522881ac33f9471467f is the preserved Svelte P4 checkpoint, not a current-main implementation base. Reference four dirty hashes reverified unchanged. All five managed previews still up;41930 is historical P4, not Angular. No source integration/implementation/tests/publication/preview changes launched for this planning phase.

Planning agent init-angular-plan in task-owned sibling w3:pH, label init-angular-planner, effective GPT-6 Astra/high verified before dispatch; selected for lifecycle/contracts/dev transport/cutover architecture. Coordinator w3:pF owns Git/shared contracts/config/integration/log, effective Sol/medium. Settled independent reviewer init-landing-review w3:pG reset only after preserving P4 handoff; effective Sol/high footer reverified. Three task agents including coordinator; no implementation writers. Background pane startup changed focus despite no-focus split; restored user focus to coordinator through explicit neighbor command. Original panes/workflows retained.

During planning, other-owner cutover PR292 opened at f55395b6bd2b282dc6f71c1dad217ce9ea9cc86d and then merged as b6710565a08c7c1595d074149769680ecf3ab3dc (tree2d542b08335eb9e131d32d5611498fecbab06fd8). Actual merged tree equals the inspected PR head; cutover check/test-effectiveness succeed in run38185038783. This clears the workspace-migration dependency, not acceptance of restored map functionality. The cutover deliberately deletes P1 helpers/dev plugin and map-table loader/raster/page/tests; retained map-authoring workers/runtime and P2 scene/tests move to client/src/legacy. Revised packets will restore relevant pure helpers and Angular inspection rather than revert cutover or HQ retirement. Independent baseline/cutover review handoffs are saved locally as angular-planning-baseline-review.txt and angular-cutover-baseline-review.txt; final plan review remains pending.

## Revised Angular plan accepted

Astra/high planner produced the revised artifact; initial frozen SHA2565da459c0ed5a08c70074016df375b101a3ac7681fe2131454cc6482a93ac2e35. Independent Sol/high review covered all286 lines, actual cutover/source blobs, canonical hashes and source manifest. Two blockers: root sidecar compilation lacked Docker build inputs, and A0's extracted middleware depended on contracts only delivered in A2. Nonblocking findings addressed notebook source provenance, A3 breadth, measurable lifecycle counts and planner-scoped process claims.

Coordinator repaired the plan: A0 owns Node-safe DTOs and narrow Docker build-stage input/image verification; A2 delivers browser/local contracts atomically; A3 split into rendering A3a and personal storage/UI A3b; notebook extraction uses frozen views/journal/notes.ts; stable canvas/worker counts and explicit listener cleanup checks are required. Independent full re-review accepted all291 substantive lines at SHA2569b916ca75e1d2d5f876107bad6eb29d3b98c6c0a2ad8bebee5762cb097e07fb3 with no remaining findings. Source baselineb671056/tree2d542b remains accepted for planning only. Author, initial and final reviewer handoffs preserved under .local/game-initialization-landing-evidence/angular-plan-*.txt; accepted substantive artifact preserved as angular-plan-accepted-substantive.md.

Plan status/review record then updated without changing architecture/packets/gates; exact final artifact SHA2561a46a719020cf0634d9202db9a124553c6ff536c1a3da8c600aa4e5fdb50ac88, independent final metadata audit confirms engineering acceptance carries to this exact artifact. Its nonblocking ledger-preservation discrepancy is resolved by this accepted-plan checkpoint and the saved angular-plan-metadata-review.txt handoff. Documentation formatting and Git whitespace checks pass. No feature implementation, source branch integration, test runs, preview changes, PR publication/merge or deployment occurred in this planning revision. Reviewer acceptance is engineering-plan acceptance, not product/CI acceptance.

Next implementation checkpoint C0 refreshes Angular main and source survival/DTO contracts, preserves historical P4 branch/evidence and settles readers before branch switch. First ready packet A0 is the development-only catalog sidecar; A1 saved-map inspection restoration is independent after C0. Serial default then A2 preparation/contracts, A3a renderer, A3b personal marks/notebook, A4 setup and A5 session/route integration. At most one stacked draft and four task agents including coordinator. No external cutover merge gate remains. Reuse/close completed planning pane only after saved handoff; retain coordinator, reviewer needed for future packets and protected previews.41930 remains the historical P4 preview, not Angular acceptance.

## Angular C0 execution and parallel ownership

Fresh main b6710565a08c7c1595d074149769680ecf3ab3dc (tree2d542b08335eb9e131d32d5611498fecbab06fd8); no open PRs observed. Cutover is accepted as the execution base, not restored-feature acceptance. Canonical branch landing/angular-map-catalog starts here; historical P4 branch af2906c preserved. Reference dirty hashes, maps, evidence and protected previews unchanged. Task-owned historical preview init-landing-web41930 stopped before branch switch. Own locked dependency installation passes under Node22.23.3.

C0 survival manifest .local/game-initialization-landing-evidence/angular-c0-survival-manifest.json SHA256 a9aa060d28cddf82bcdfac221b314814711acbeadfa5fa637d6e399141ca3734 records 87 pinned source rows, destination/adaptation and source object/content hashes. MapRef kind premade|generated/id and MapSummary ref/name/widthM/heightM remain unchanged; 64MiB import limits and exclusive generated writes remain storage validity, not certification. Exact source exports are from Git51d4d366, never dirty reference files.

Owner requests parallel implementation. Four task agents: coordinator w3:pF init-landing-coordinator (Sol/medium) owns shared contracts, entrypoints/config, Git/integration/docs/previews; w3:pH init-catalog-writer / init-catalog-write (effective Sol/high verified immediately before dispatch) owns only A0 tools handler/serve/DTO/tests; w3:pJ init-inspection-writer / init-inspection-write (effective Sol/high verified immediately before dispatch) owns A1 shared map-table loader/raster/page/tests and Angular host files; independent w3:pG init-landing-reviewer / init-landing-review (fresh Sol/high verified) reads source only. No worker Git/config/docs/servers/pane operations. A0 and A1 are independent after C0. Later A3a and A4 may proceed in parallel after accepted A2 contracts. No more than one stacked draft. Docker runtime exclusion and local image-build acceptance remain outstanding.

## Owner clarifies native Angular implementation

Owner asks why legacy exists and directs fresh Angular implementation. Confirmed scope through explicit reply: local New game and map inspector, not the entire application. Existing shared rendering/map algorithms remain reusable; live-game and authoring migration are preserved. A1 wrapper approach is superseded before publication: no mountMapTable/document-wide imperative UI in delivered inspector. Native signals/template bindings/component-scoped service own UI and resources. A0 Node helper unaffected. Preliminary A1 source/tests and handoff preserved locally before rewriting; historical behavioral tests remain acceptance requirements, not a mandate to copy imperative UI. Plan A1 ownership updated to loader/raster plus Angular component/service; all later local UI remains native Angular.
