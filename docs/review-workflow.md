# Commit-specific review workflow

Use this workflow for a bounded independent review of committed source. The [HQ review rollout plan](hq-review-workflow-plan.md) defines the initial rollout; the [review template](review/review-template.md) records each round. This document describes the reusable procedure and tooling. Actual acceptance belongs to source-bound review and CI records; the presence of a command or job does not establish a passing result.

## 1. Establish ownership and source

Read `AGENTS.md`, [decisions](decisions.md), the task plan and relevant contracts. Record authorized implementation/publication and exclusions. The coordinator owns Git, integration, shared configuration, evidence and publication; writers own explicitly assigned paths; the independent reviewer inspects without editing. A mutation operator owns disposable source and evidence only. Release overlapping paths before repairs. Record effective model/effort and who verified it; prompt text is not verification. An author's own review cannot be presented as independent.

Reconcile accepted dependencies and main before freezing a round. Preserve concurrent work, dirty files and local captures. Record full candidate head **H**, accepted base **B**, merge-base **M**, each tree ID, inventory range and evidence run ID. Final claims use committed H; preliminary dirty-source inspection needs content hashes and later reconciliation.

The coordinator generates a complete NUL-delimited inventory, for example `git diff --name-status -z B...H`, from fetched objects and cross-checks paginated hosted file metadata. State whether review covers PR changes from M, integration differences against B, or both. Hosted diff truncation never excuses missing coverage.

## 2. Assign and reconcile complete file coverage

Expand review packets into one row per changed file, with exactly one primary reviewer. Include production, tests, tooling/configuration, docs, assets and generated files; represent both rename paths and deleted/binary object identities. Name secondary boundary checks without duplicating primary ownership.

| Required coverage field | Record |
| --- | --- |
| File identity | Path, change type, category; previous path/object for rename or deletion |
| Ownership | Primary packet/reviewer; secondary integration concern |
| Reviewed source | Full H and content digest with algorithm; prior object identity where needed |
| Inspection | Actual diff and surrounding contracts/code inspected; asset origin/licence and claim checks |
| Acceptance | Specific behavior/criterion; ordinary/browser evidence IDs and limitations |
| Findings | Severity, owner, repair revision, independent re-review and disposition |

Mechanically reconcile the matrix with the regenerated inventory at every candidate: no missing files, duplicate primary assignments or unexpected stale rows. Assignment alone does not establish inspection. Carry forward review only with identifiable prior evidence, unchanged content and checked integration context. Documentation and assets require appropriate inspection/provenance, without artificial mutations.

## 3. Verify observable behavior

Record exact commands, environment/tool/dependency versions, tested commit/tree, exit results, test selection/counts and raw evidence. Ordinary gates are the applicable clean install, lint, typecheck, tests and build; state skips and failures. A green historical run does not validate a new integration.

For UI acceptance, record real browser scenarios with expected and observed outcomes, route/fixture, browser/OS, viewport/device, input method, screenshots and console/network observations. Check behavior such as focus return, modal shortcut isolation, errors visible after closing Settings, recoverable saved data and fixture/live routing where affected. Unit/axe assertions do not establish visual layout, browser contrast, device playthrough or performance. Use managed `devrun` servers and an isolated origin for saved-data writes; preserve other previews and user data.

For HQ, delivered fixture scope includes scoped local preferences, notebook, tray, drafts and personal marks, explicit unavailable actions, and the fixture renderer/clock contracts. Review against [HQ contracts](hq-contracts.md) and current decisions. The accepted live composition remains separate: fixture evidence does not establish HQ live transport/coherent reconnect, shared annotation authority, signing/delivery, conference or arbitrary-time replay. List actual outstanding browser/device/performance story criteria; PR readiness does not complete Epic 4.

## 4. Demonstrate selected test effectiveness

Use targeted probes when requested or justified by a reviewed risk, with no mutation percentage target. Pilot a few meaningful production faults before automation. The initial HQ plan names time precision, closed-Settings failure visibility and modal Escape isolation; those recipes require observed validation. Persistence claims must exercise the real repository guard, not merely a mocked error response.

Run serially in uniquely owned disposable source extracted from H, with locked dependencies installed there. Never mutate/serve canonical source, link repository-owned source/workspace dependencies into scratch, or commit/push deliberate faults. Store evidence outside the reviewed tree. Each manifest case records stable ID, invariant/rationale, source path/digest, unique before/after replacement, focused test files/names, expected behavioral assertion and timeout.

For each case:

1. Verify H/source hashes and run the unmodified focused baseline successfully.
2. Apply one unambiguous, valid production fault; keep tests unchanged and validate path containment.
3. Run a fresh process with fresh structured reports; require the same nonzero selected test identities/counts across all phases.
4. Capture assertion details plus collection, hook, unhandled and infrastructure errors. Verify the installed reporter schema; assertion JSON or exit status alone cannot establish absence of unhandled errors. Missing error information is inconclusive.
5. Restore original bytes in cleanup, verify hashes and rerun the restored tests. On timeout/interruption, terminate and reap owned processes/children before restoration. Incomplete execution cannot succeed; setup or restoration failure stops the run.

| Outcome | Decision |
| --- | --- |
| Detected | Baseline/restored pass; same designated tests run; expected behavioral assertion fails with no unrelated, collection, hook or unhandled errors |
| Survived | Meaningful fault passes designated tests; open a bounded coverage finding |
| Invalid/unmatched | Ambiguous/unmatched recipe, syntax/type/collection error, zero/wrong/changed tests or unrelated assertion failure; repair/replace probe, never count detection |
| Inconclusive | Timeout/interruption, stale/incomplete reports, infrastructure failure, incomplete error reporting, or expected assertion failure **plus an unhandled error**; retain diagnostics, never count detection |
| Restore failed | Stop all subsequent cases; preserve diagnostics and recover/discard only owned scratch source |
| Equivalent | Independent reviewer demonstrates unchanged intended behavior; withdraw/replace, never count detection |

The runner must independently pass classifier tests for these false-success paths, cleanup ordering and unchanged canonical source. Approve the bounded manifest only after demonstrated applicability and expected assertions; the initial HQ set is limited to ten cases. An unresolved required survivor, invalid or inconclusive probe cannot be silently skipped to clear a gate.

### Run the selected set

Use the Node version in `.nvmrc` and npm 10.9.7. Commit the accepted source and manifest before the final run. Supply full lowercase commit SHAs and a new absolute evidence directory outside the repository:

```bash
node scripts/review/run-mutations.mjs \
  --head <full-candidate-SHA> \
  --base <full-accepted-base-SHA> \
  --manifest test/review/hq-mutations.json \
  --output /absolute/outside-repo/unused-evidence-directory
```

The runner extracts pinned Git blobs into its own scratch. For current source it runs `npm run setup:map-source` **inside scratch before `npm ci --ignore-scripts`**, verifies the pinned source inventory and generated tarball against the vendor snapshot and lockfile, and rejects escaping dependency links. Legacy source may explicitly report `no-bootstrap-needed`; source requiring the tarball without a bootstrap script fails. Do not copy the canonical generated artifact or workspace dependencies into a real probe.

Review `report.json`, the manifest and source inventories, bootstrap/install logs, and every case's original/mutated bytes, phase reports, explicit reporter channels and restoration record. Non-success outcomes return nonzero. On cancellation, restoration and its fresh rerun still execute after process reaping; cancellation remains non-success even if the final restored tests pass. Keep all diagnostics. The runner uses POSIX process groups and is not a security sandbox; deliberately escaped descendants and arbitrary malicious source are outside its guarantees. Reporter compatibility is verified against locked Vitest 3.2.7.

Run the classifier/lifecycle controls with `node --test test/review-workflow.test.js`; ordinary root `npm test` includes them. These controls use artificial Git/install/bootstrap fixtures with real Vitest phases to test failure handling. They do not replace the final candidate's real extraction, map bootstrap and locked-install demonstration.

## 5. Repair and independently re-review

Record each finding's broken behavior, missing observable assertion, severity and named owner. Release affected paths and dispatch a bounded repair. Strengthen tests against intended behavior; do not change correct product behavior for a score or relabel a meaningful survivor equivalent. After one failed substantive repair, revisit the invariant/test before retrying. Re-run original/mutant/restored phases and affected ordinary checks, then independently review the repair diff. Broaden checks when source changes or unresolved interactions warrant it.

## 6. Retain CI and failure evidence

Keep ordinary CI intact. Enable the separate `test-effectiveness` job only after independent pilot/runner acceptance; it runs the committed approved manifest in disposable source. Record H/B/M, manifest digest and actual checkout commit/tree for **both** jobs. Check out H explicitly or prove tree equality. A differing synthetic merge needs independent integration review and fresh checks; its green result does not clear H.

Prove the CI gate once with a valid passing manifest and once with a controlled surviving/invalid diagnostic probe that fails the job. Follow the authorized plan's temporary diagnostic PR procedure and preserve the failing run URL; a branch push alone may not trigger CI. Keep deliberate product faults out of the canonical branch. Upload evidence unconditionally (`if: always()`), including setup/test failure diagnostics; request 30-day retention subject to repository limits. This job grants no authority for automated reviews, messages, merge, deploy or branch-protection changes.

Each bundle includes source/tree and manifest digests, versions, exact commands/selected tests, three-phase results, assertion/error details, logs, durations/retries and original/restored hashes. Retain failures without secrets; leave unavailable token/cost figures unknown. Record bundle SHA-256, run/artifact URLs, actual accessibility verification, retention and expiry. Local paths are staging only. A named destination does not prove collaborator access; durable archival needs a separately authorized destination before expiry.

## 7. Publish and hand off the reviewed candidate

Use `[review rN] <full H>` and an explicit **Accepted / Changes needed / Inconclusive** verdict. Separate packet acceptance from the complete declared PR scope. Identify the independent agent, verified model/effort and actual response separately from the authenticated publishing account; never imply a maintainer's human approval. For this rollout the coordinator publishes an authorized GitHub `COMMENT` review bound to `commit_id: H`, with complete coverage/findings and accessible evidence; verify the published content/links.

Commit reusable docs/templates and historical notes before freezing H. Keep the final-H verdict/evidence outside H or publish after H exists: committing a report naming its own final SHA creates a new head. On a changed head, independently review the delta and rerun affected checks; on a changed base, refresh integration checks. Revalidate the full selected manifest on the final candidate.

Before declaring review-ready, verify current remote H, accepted B or independently reviewed base delta, clean mergeability, successful exact-source ordinary/effectiveness checks, complete matrix and resolved blocking findings. Keep missing gates pending. The PR description should state what changed, verification and remaining acceptance, linking commit-bound records/screenshots/CI; detailed process history belongs in the execution log. Leave the PR open. Merge, deployment and issue/epic closure require separate authorization.
