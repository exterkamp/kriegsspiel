# HQ review and test effectiveness implementation plan

Prepare PR #193 for a commit-specific independent review with evidence that important regression tests detect broken behavior. Establish a small reusable workflow for later PRs. This plan preserves the accumulating Epic 4 PR, the fixture/live-client boundary and the separate map-generation checkout. Execution ends with a reviewed PR and green checks; merging, deployment and Epic closure remain separate actions.

## Planning baseline

Snapshot on 2026-10-10:

- HQ checkout: `/Users/dominic/code/kriegsspiel-hq`, branch `feat/hq-interface`, published head `8502df520b7d61fb6e6871773081b8dc4d546f20`.
- That head passed independent integration review, 1,748 tests plus one optional skip, lint, types and build; [CI run 38102192707](https://github.com/exterkamp/kriegsspiel/actions/runs/38102192707) succeeded. Its integrated main was `4714b73`.
- Fetched main has since advanced to `148cd1e1bd2200e05fce8cebe60effa625d0a0ff`, accepting parser #209, pause UI #219 and roles #217. A read-only merge check finds conflicts in `AGENTS.md`, `client/src/desk/Desk.svelte`, `client/src/main.ts` and `docs/decisions.md`. No integration was performed during planning.
- PR #193 contains 131 changed files. GitHub's combined-diff endpoint returns HTTP 406 because the diff exceeds 20,000 lines. Build the complete inventory and bounded review diffs from fetched Git objects; use paginated PR-file metadata as a cross-check.
- Original `docs/hq-feedback.md` and `docs/hq-feedback-assets/` are local, untracked capture records. Preserve their ownership and content. The plan is a separate documentation artifact.

The conventions are observed practices, not a repository PR template. [Orders #212](https://github.com/exterkamp/kriegsspiel/pull/212) demonstrates structured verification, screenshots, integration re-review and tracked follow-ups. [Reconnect #214](https://github.com/exterkamp/kriegsspiel/pull/214) and [in-tray #206](https://github.com/exterkamp/kriegsspiel/pull/206) demonstrate tests that passed after a critical guard was removed, followed by repairs that made the same mutation fail. The workflow below adopts those review practices without claiming fixture evidence completes live-game acceptance.

## Deliverables and ownership

Reuse the existing HQ panes. The planning inventory finds all three named HQ agents idle. Verify identity, idle state and effective model/effort again before execution; pane IDs are observations, not permanent identifiers.

| Role | Existing agent and last verified selection | Exclusive implementation ownership |
| --- | --- | --- |
| Coordinator | Current HQ coordinator | Git/baseline integration; `AGENTS.md`, `package.json`, lockfile, ESLint/Vite/CI configuration; shared composition; this plan and execution log; PR description; evidence capture/publication |
| Workflow implementer | `hq-continuous`, w3:p2, GPT-6.1-Sol high | New `scripts/review/**`, `test/review/hq-mutations.json`, `test/review-workflow.test.js`; later one explicitly released correctness-repair packet |
| Documentation implementer | `hq-shell`, w3:p4, GPT-6.1-Sol medium | New `docs/review-workflow.md`, `docs/review/review-template.md`; later one explicitly assigned UI/test repair packet |
| Independent reviewer | `hq-review`, w3:p3, GPT-6.1-Sol high | Read-only inspection of design, code, coverage and evidence; returns findings/verdicts to coordinator; no product, test, manifest or Git edits |

Use high effort for mutation-result classification, persistence conflicts, time precision, plotting/modal interactions and independent review. Medium is suitable for documentation and ordinary UI repairs. Verify native effective selections; do not infer settings from prompt text. Retain the existing model policy rather than introduce a new model or pricing assumption.

At execution kickoff, preserve completed review records, then clear only idle HQ agents' chat contexts using native controls. Preserve saved histories and files. Provide each packet with the exact head/base, owned paths, relevant contract, evidence location and acceptance gate. Keep one coordinator, at most two writers and one reviewer. Start with one serialized mutation operator; parallel operators would need separate disposable checkouts and explicit ownership. No map pane, checkout or server control.

## 1. Reconcile and freeze the source to review

The coordinator refreshes accepted main, active dependency owners, PR head and dirty/untracked inventory. Preserve local records before integration. Consume committed main only; overlapping open PRs retain their owners.

Resolve the known conflicts through the existing composition split: preserve the HQ fixture router, put accepted main's live entry in `liveClient.ts`, preserve canonical live desk/auth/roles/pause/Orders/catch-up behavior, and retain both sets of decisions. Check actual incoming routes and contracts before copying; do not assume new roles or protocol fields make the HQ live adapter available. Review the actual resolution independently, including automatic merges.

Run the relevant integration checks and full lint/types/tests/build before freezing a candidate. Use `.nvmrc` Node 22 and required loopback permission for server tests. Managed browser servers use `devrun`. Recheck fixture/live routing and affected interactions when runtime code changes; use an isolated validation origin for saved-data writes.

Record full candidate head H, accepted main B, merge-base M, their Git tree IDs and the complete changed-file list. Freeze H for each review/mutation round. Agents do not test mutable branch names or another agent's dirty source. A later commit starts a new round or an explicitly justified carry-forward of unchanged file content.

**Gate:** independently accepted integration, passing ordinary checks, and a complete frozen file inventory. The older green CI is historical evidence, not clearance for the newly advanced baseline.

## 2. Freeze the review protocol and coverage matrix

The coordinator and independent reviewer agree the record format before writers build tooling. The documentation writer implements the agreed protocol/template in parallel with the workflow writer after this gate.

Every changed file gets exactly one primary review packet and a coverage row: path/change type, production/test/docs/asset classification, reviewer, reviewed SHA and content digest, inspection performed, acceptance claim, test/browser evidence, findings and resolution. Mechanically reconcile the rows with the complete current NUL-delimited Git diff, rejecting missing, duplicate-primary and unexpected entries. Regenerate the inventory at each candidate, including new workflow files; the original 131 files are an observation, not a fixed target. Identify boundary files needing a second integration check. Account for renames, deletions and binary files. Generated screenshots/artwork need provenance and accurate claims; they do not need artificial mutation tests.

| Review packet | Principal paths and concerns |
| --- | --- |
| Contracts and coherent publication | `hq/contracts/**`, `hq/data/common.ts`, `fixture.ts`, `presentation.ts`, `hq/sessionActions*`, Shell publication paths and App wiring; scope, stale completions, atomic presentation |
| Persistence and recovery | Preference repository, `hq/data/marks/**`, Orders repository, journal notes and their callers; validation, revisions, quota errors, scope isolation and reload |
| Renderer and plotting | `hq/data/continuousSurface*`, fixture renderer/helpers, shared table changes, `hq/interactions/**`, placement bridge/ports; lifecycle, cancellation, provenance and input isolation |
| Desk views and accessibility | `hq/shell/**`, `hq/ui/**`, `hq/views/**`, `hq/testing/**`, shared time presentation; visible behavior, semantics, keyboard/modal behavior and evidence limits |
| Composition and tooling | Main/live entries, bootstrap tests, changed canonical desk files, HTML, Vite/Svelte/ESLint/package configuration; preservation of accepted live features and clean setup |
| Documentation and assets | All remaining docs, handoffs, README and assets; delivered versus pending claims, source/asset provenance and reviewer navigation |

Expand these principal paths into a disjoint inventory before dispatch. Assign overlapping files one primary reader and named secondary concerns. No file is omitted because the combined diff is too large. Existing packet reviews may be carried forward only with identifiable evidence and unchanged content plus checked integration context; otherwise re-review.

Review records use `[review rN] <full SHA>`, an explicit verdict, what was inspected/run, acceptance criteria, blocking and non-blocking findings, file coverage, mutation evidence and limitations. A bounded packet verdict is not a whole-PR LGTM. The final verdict covers the declared fixture PR scope; live/device/performance Epic criteria retain their actual pending status.

## 3. Pilot three test-effectiveness checks

Before building general tooling, run three small manual probes in a disposable source checkout extracted from H. Each probe changes one production behavior while leaving tests intact. Use existing meaningful tests first.

| Pilot | Deliberate fault | Expected evidence |
| --- | --- | --- |
| Exact time metadata | Replace integer-second/remainder formatting with a precision-losing millisecond division | An existing `gameTime.test.ts` boundary assertion fails for exact duration; the original implementation passes |
| Closed Settings failure | Hide preference failures when Settings closes | `Shell.test.ts` fails the closed-dialog failure visibility assertion, without relying on a footer/CSS snapshot |
| Modal Escape isolation | Remove plotting's open-dialog Escape guard | The integrated `App.test.ts` Settings/placement test fails because the first Escape cancels placement or consumes the event |

Confirm each replacement is syntactically valid and changes the intended behavior. Record the mutation, exact source/test names, passing baseline, expected failing assertion, restored bytes and passing restored test. These candidate recipes are not assumed to work until independently validated.

Create unique disposable checkouts under `/private/tmp/`, containing committed source only. Install locked dependencies there with `npm ci`; build engine/protocol workspace outputs if the focused test requires them. Never symlink repository-owned source or workspace dependencies back to the live HQ/map checkout. No dev server runs against mutated source.

Keep durable evidence outside the reviewed Git tree under `/Users/dominic/code/.hq-review-evidence/193/<H>/<run-id>/`. Use separate directories for each round and retain failure diagnostics. The coordinator captures the reviewer's response into the record; request a temporary file from the reviewer only if the completed response cannot be recovered through Herdr.

**Gate:** independent reviewer accepts all three genuine assertion failures, isolation/restoration evidence and result classification. A surviving probe is investigated before extrapolating the workflow.

## 4. Implement the small runner and selected manifest

Build a Node-based serial runner using existing Git, npm and Vitest capabilities. Add a coordinator-owned `review:mutations` package command. No broad mutation framework, new model service or percentage target is required.

The runner pins a full source SHA, creates its own disposable checkout, runs a passing unmodified baseline, applies one reviewed recipe, invokes a fresh focused test process, classifies structured results, restores original bytes in `finally`, verifies restoration, and runs the restored test again. On timeout/interruption, terminate and reap the owned test process and its children before restoration; incomplete execution cannot succeed. It stops on setup/restoration failure. It never modifies the HQ checkout, commits/pushes a mutant or treats an arbitrary nonzero exit as proof.

Manifest entries contain: stable case ID, invariant, source path/content digest, unambiguous before/after replacement, focused test files/names, expected assertion failure, result timeout and review rationale. Reject paths outside the disposable root and unmatched or ambiguous replacements. Require fresh reports for each process and unchanged selected-test identities/counts across baseline, mutant and restored runs; zero selected tests is invalid. Use installed Vitest's JSON reporter and output-file support; verify its actual output shape during implementation. The installed reporter omits top-level unhandled errors: explicitly capture them through a supported runner API/custom reporter or equivalent structured channel. Missing error information is inconclusive, not permission to infer a clean run from assertion JSON or exit status.

| Result | Meaning and handling |
| --- | --- |
| Detected | Baseline passed; the valid mutant ran the same designated tests and failed the expected behavioral assertion; no collection, hook, unhandled or unrelated errors occurred; restoration and rerun passed |
| Survived | The designated tests passed with a meaningful fault; open a coverage finding and assign a bounded repair |
| Invalid or unmatched | Syntax/type/collection failure, wrong/missing tests, unrelated failure or recipe mismatch; replace/repair the probe, never count it as detected |
| Timeout or infrastructure failure | Inconclusive; retain evidence and diagnose the environment/recipe |
| Restore failed | Stop the run, preserve diagnostics, and discard the owned scratch checkout after recovery; no subsequent cases |
| Equivalent | Independent reviewer explains why behavior is unchanged; withdraw or replace the case, never add it to a success count |

Tests for the runner must prove that invalid mutants, zero tests, stale reports, changed test identities/counts, unrelated failing assertions, timeouts and interrupted restoration cannot create a false success, and that normal execution leaves the original checkout unchanged. Include an expected assertion failure accompanied by an unhandled error: it must not count as detected. Verify child termination precedes restoration. Put these checks in `test/review-workflow.test.js` so the existing root `test/*.test.js` command includes them.

Each evidence bundle records H/B/tree digests, manifest digest, Node/dependency versions, commands and selected tests, baseline/mutant/restored results, assertion details, logs, durations and original/restored file hashes. Do not record secrets. Measure actual elapsed time and retries; token/cost figures remain unknown unless exposed.

After the pilot, approve a bounded initial set of at most ten meaningful cases. In addition to the three pilots, select faults for invalid-time handling, hours beyond 24, actual repository revision rejection, successful preference recovery, modal shortcut isolation, stale publication rejection and terminal renderer disposal. Persistence probes must exercise the real repository; mocked failure responses alone cannot prove a storage guard. Add cases only when a reviewed risk or finding justifies them. Visual layout remains a real browser gate.

**Gate:** runner implementation and classification tests pass independent high review; approved manifest cases each have demonstrated applicability and expected assertions.

## 5. Audit the PR and repair real coverage gaps

Review the six packets against H, using bounded local diffs and surrounding source. The independent reviewer inspects the runner evidence as well as code/test behavior. The workflow operator runs the agreed manifest serially in scratch. The documentation writer can prepare the protocol/template and PR-description draft while these checks run.

A surviving meaningful mutant becomes a finding with the changed behavior, the missing observable assertion and a named owner. Release the affected canonical files before dispatching a repair. Medium handles ordinary view/presentation tests; high handles time, persistence, renderer and modal correctness. `App.test.ts`, Shell and shared repositories remain serialized. Authors strengthen tests against intended behavior; they do not alter correct product behavior merely to satisfy a mutation score.

After one failed substantive repair, the reviewer revisits the proposed invariant/test before another attempt. Do not weaken the assertion or relabel a meaningful survivor equivalent. Recheck the repaired mutant, restored original and affected ordinary suite; independently review the repair diff. Broaden checks when source changes or unresolved interactions justify it.

**Gate:** complete file coverage, no unresolved blocking findings, and every selected meaningful fault detected by its intended assertion. Track accepted non-blocking gaps against existing issues where applicable; avoid duplicating other owners' stories.

## 6. Add bounded CI evidence

Once the pilot/runner is accepted, the coordinator adds a separate `test-effectiveness` job to the existing CI workflow. Keep the ordinary clean-install/lint/types/tests/build job. The mutation job runs the committed approved manifest in disposable source, emits structured results and uploads its evidence. Run the selected set on PRs; do not silently skip surviving/inconclusive cases to make the check green. A docs-only change may reuse the same source cases, without implying that docs require mutation testing.

Record H/B/M and the actual CI checkout commit/tree: a pull-request checkout can be a synthetic merge. Configure both jobs to check out the full candidate H explicitly, or prove the checkout tree equals H's tree before accepting its results. The final source branch includes the accepted base. A synthetic merge with different source requires independent integration review and fresh checks; passing checks on it do not clear H. No automated LGTM, model calls, PR messages, merge or deployment belongs in this CI job.

Verify the job once with a valid passing manifest and once with a controlled surviving/invalid probe that must fail the job. The current workflow runs on PRs and pushes to main; a diagnostic branch push alone cannot trigger it. During authorized workflow implementation, use a temporary draft diagnostic PR from an owned branch based on H, changing only its diagnostic manifest, with no issue-closing references. Preserve its failing run URL and artifacts, close the diagnostic PR without merging, and remove the owned diagnostic configuration afterward. Never commit a deliberately broken product to the HQ branch. Upload evidence with an unconditional `if: always()` step, including setup/test failure diagnostics, and request 30-day artifact retention subject to repository limits. No branch-protection changes are part of this plan.

**Gate:** CI result classification matches local evidence, failures are surfaced, artifacts are available, and the ordinary job remains green.

## 7. Publish the exact-head review and concise PR description

Commit accepted workflow/test repairs, push, and obtain green ordinary and test-effectiveness checks on final H. Reconcile any newly accepted main changes through independent delta review and relevant checks before the final verdict. Reuse prior evidence only for demonstrably unchanged code with recorded justification; re-run affected mutations after integration changes. Revalidate the full selected set on the final candidate.

The coordinator prepares the consolidated record from the independent reviewer's actual findings. Publish a GitHub review with `event: COMMENT` and `commit_id: H`, identifying the authenticated publishing account separately from the independent agent's name, verified model/effort and review scope. Include the complete coverage matrix, reviewer response, findings/resolutions and compact pilot results in the review body; split supporting records into numbered commit-bound review records if they exceed GitHub's size limit. Link the final CI run's `test-effectiveness` artifact bundle for raw baseline/mutant/restored logs, source/manifest hashes and results; include bundle SHA-256 hashes and its requested 30-day retention/expiry. Local evidence remains staging and is never presented as a collaborator-accessible URL. If durable archival is required, use a separately authorized destination before artifact expiry. This records the reviewed commit and verdict without impersonating exterkamp or claiming a human approval. No publication occurs during this planning pass; it is an execution deliverable. Prepare exact text in a file/structured argument and verify the published record and links.

Keep final evidence outside the reviewed commit to avoid a self-referential SHA loop. Commit the reusable workflow/template and historical execution notes before freezing H; publish the final verdict and immutable evidence after H exists. Do not commit a purported final-H report that would itself create a new head.

Simplify #193 to What changed, Verification and Remaining acceptance. Link the complete coverage/review record and execution log; use commit-pinned screenshots and CI links. Keep the story/evidence matrix and fixture/live limits. Do not add `Fixes #4` or closure references for incomplete criteria. Herdr/token/process history stays in the execution log.

Immediately before handoff, verify remote PR head is still H, accepted main is the reviewed B or has an independently checked delta, mergeability is clean, both checks are successful, and blocking findings are resolved. A changed head invalidates the final verdict until its delta is reviewed. A changed base triggers a fresh merge/integration check. Leave the PR open.

## First execution packet

Start with coordinator baseline reconciliation and independent resolution review. Next, freeze the protocol/coverage format and validate the three manual probes before commissioning the runner. The documentation packet may run alongside the accepted runner packet. This ordering establishes trustworthy evidence and isolation before introducing CI automation or publishing a final LGTM.

Workflow completion means #193 has complete review coverage, demonstrated selected test effectiveness, successful exact-source CI evidence, an accurate commit-bound review record and a readable PR description. Full Epic 4 live-game/device/performance acceptance remains governed by the existing implementation plan and open story criteria.
