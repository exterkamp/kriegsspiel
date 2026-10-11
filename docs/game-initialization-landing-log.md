# Game initialization landing log

## Continuation checkpoint — 2026-10-11

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
