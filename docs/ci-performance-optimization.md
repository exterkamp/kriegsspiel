# CI performance optimization

## Scope and ownership

Optimize the existing validation critical path without removing tests, assertions,
source verification, builds or effectiveness evidence. No merge, deployment or
branch-protection changes are authorized.

Accepted baseline: `a86a661c82002bb9680b13ca427742a11caa26a3` (2026-10-11 Pacific).
Coordinator owns `.github/workflows/ci.yml`, CI tooling/tests and this report in
`worktree-workflowoptimization`, on `perf/ci-critical-path`.
Herdr coordinator: `wD:p1` (`ci-coordinator`); read-only reviewer: `wD:p2`
(`ci-reviewer`, verified GPT-6.1-Sol high). Only two task agents; unrelated panes and
previews are preserved. The inherited caller pane ID was stale; live inventory
resolved the coordinator before any control action.

The starting `kriegsspiel-map-table` checkout has dirty map-table HTML/page,
decisions/guide and an untracked landing plan. Active Angular landing work owns
its dirty execution log and new local-board files. Other worktrees retain their
untracked captures/cache. None of those files or preview processes are task-owned.
Open PRs at inventory: #311, #303, #300, #298; none optimizes CI.

GitHub inspection returned main protection HTTP 404 and repository rulesets `[]`.
Preserve existing `check` and `test-effectiveness` status names anyway; do not
modify protection. Refresh measurements before changing the workflow.

## Measurement method

Use successful comparable CI runs, full source SHAs and attempt numbers. Queue is
job creation to start; runtime is job start to completion; green wall time is run
creation to latest required completion. Sum job runtime for runner minutes, and
report rounded billing separately. Repeat the same source rather than treating
unrelated pushes/rebases as replicates. Runner setup metadata and step/test logs
are the authority. Local sleep/timeout failures are not runner performance data.

Owner-provided historical sample: 17 successes, median 4m22s (3m16s–4m57s);
eight inspected queues 2–3s, test step 1m59s–3m04s. Representative
[run 38199171816](https://github.com/exterkamp/kriegsspiel/actions/runs/38199171816).
Latest current-main [run 38199508028](https://github.com/exterkamp/kriegsspiel/actions/runs/38199508028)
was successful; detailed baseline replication and implementation evidence follow.

## Refreshed baseline and selected change

Unchanged workflow on current main: run 38199508028 attempt 1, H
`a86a661c82002bb9680b13ca427742a11caa26a3`, green 287s, ordinary
job 285s, effectiveness 41s, 326 runner-seconds (6 rounded job minutes).
Test step 179s, lint 18s, typecheck 30s, build 31s. Queues 1–2s.
The docs-only baseline PR H `a9e5fe88a529d1f4c9d3a61489c841185bec785a`
changes no validation/product source: [run 38200062794 attempt 1](https://github.com/exterkamp/kriegsspiel/actions/runs/38200062794/attempts/1)
green 297s, 328 runner-seconds, test step 182s. Main's same-source repeat
attempt 2 took 305s, 344 runner-seconds (7 calculated rounded job minutes),
with a 186s test step. Both use GitHub-hosted `ubuntu-latest`,
image `ubuntu-24.04` version `20261004.327.1`, Node 22.23.3/npm 10.9.7.
Runner names: original 1000002560/2561; PR 1000002566/2567;
main repeat 1000002568/2569. These are separate attempts, not new source revisions.

Selected change: three ordinary groups with isolated checkouts/install/output:
static/build (serial lint, typecheck, build); maps (workspace build/tests, then
catalog); application (engine, protocol, server, both client test runners, then
all repository/review-workflow/maps-assessment Node tests). Root `npm test`
retains its original selection/order through a shared repository-test script.
A coverage control fails if a workspace is added without assignment.
`check` requires explicit success from the complete non-fail-fast matrix and
unchanged effectiveness job. Its actual shell is tested against all 36 pairs
of success/failure/cancelled/skipped/empty/unknown results.

Map profiling shows 58.71s Vitest wall time plus compilation. Repository Node
suites take 44.78s: the slowest review control spends 6.49s checking restoration
failure/reaping; two bookkeeping controls take 3.90s and 3.58s. These execute
real process/error/cleanup boundaries. Scheduling them independently removes
serialization without touching assertions, geometry fixtures, timeouts or
production code. No speculative caching or test-internal optimization is used.

Superseded PR runs cancel by workflow/event/PR number. Main and merge-group runs
use unique run IDs and do not cancel; merge-group is now explicitly supported.
No branch protection, path exclusions, dependency artifacts or shared build cache
are introduced. Each ordinary artifact adds its group to the existing name;
review consumers must inspect all three checkout records. Retention remains 30 days.

Local first-pass lint and typecheck passed. Initial tests could not bind sockets
(`listen EPERM`) and Angular tests/build rejected shell Node 22.22.2 (the repo pins
22.23.3). These are local environment failures, not CI timing evidence or assertions
relaxed for performance. Pinned temporary tools and socket-enabled rerun follow.


## Integration and first independent review

Main advanced to `d15d21b5b4ed7c923c6c8f1161e34105b0f448a6` via #303.
An append-only decisions conflict prevented GitHub from scheduling the original
failure probe. It was resolved by retaining both decision entries and integrating
accepted main. No unrelated implementation was modified. Earlier baseline results
remain historical; final comparisons repeat this new main's identical product and
test source. New-main original run 38200188722 attempt 1 took 299s, 334 runner-seconds
(6 calculated rounded job minutes), with a 185s test step.

Independent reviewer `ci-reviewer` inspected all six implementation files at
`083699fd5cf3082747f694bcf3956d0eb70ce56f` against the original base and returned
Changes needed: merge-group base provenance incorrectly fell back to its head.
Repair selects `merge_group.head_sha`/`base_sha` and adds distinct PR/queue/push
source-selection controls. A cancelled-workflow guard also rejects cancellation when its step condition is true the aggregate.
The reviewer confirmed unchanged coverage/build ordering, runner isolation,
all 36 dependency-result combinations, source/artifact preservation, and PR-only
cancellation policy. A minor baseline-forward-reference error was corrected.
Final reconciled source and hosted evidence require independent re-review.

The local pinned full lint/typecheck/test/build sequence passed on pre-integration
source. Full validation is repeated on integrated source; no test timeout or
assertion was changed. CI workflow failures are injected only as temporary workflow
steps on this isolated task branch, never as faults in product source or previews.

## Hosted failure propagation

[Run 38200700804](https://github.com/exterkamp/kriegsspiel/actions/runs/38200700804)
validated H `45586b0e9e3038eb609b6f42d690bf376d0dcdde` against new main. A temporary
`exit 1` step followed the unchanged application test command. All application
assertions passed, then its matrix child failed; maps, static/build and effectiveness
completed successfully. The downstream `check` ran and failed with
`VALIDATION_RESULT=failure`, proving GitHub matrix failure propagation, not only
shell behavior. All four source/effectiveness artifacts were downloaded and retained.
The probe is removed before the successful review candidate. Failed/cancelled/skipped
result rejection is also covered by the shell controls; live cancellation/skip and
merge-queue execution are not claimed from this failing run.

Failure run wall 129s, 345 runner-seconds, 9 calculated rounded job minutes. It is
excluded from successful performance statistics. Runners 1000002578–1000002582,
image/version unchanged. The application group took 122s (95s tests), maps 109s
(81s tests), static/build 78s and effectiveness 33s. Artifact upload/post steps and
aggregate scheduling are included in job/wall measurements.

The first repaired candidate `559ddb2` was rejected before jobs started in
[run 38200926270](https://github.com/exterkamp/kriegsspiel/actions/runs/38200926270):
`cancelled()` is unavailable in step `env`. This is a workflow-authoring failure,
not a performance run. Official actionlint 1.7.12 confirmed the restriction.
The guard is now a `cancelled()` conditional failing step; the result evaluator
runs with `always()` so prior failure cannot suppress it. Actionlint and all five
CI controls pass after this correction. The unchanged full validation remains
required; the rejected run clears no gate.


## Complete negative controls and matched baseline

The first live cancellation attempt (38201092426, H `9ca6b92`) also had a lint
failure from two test regular expressions; it is mixed failure/cancellation
 evidence, not isolated cancellation proof. The regexes were corrected without
relaxing lint. Full lint, actionlint and the five controls pass afterward.

[Isolated cancellation run 38201259553](https://github.com/exterkamp/kriegsspiel/actions/runs/38201259553)
at H `15a4fb9e328d69cd6ec07163f9d5231758fbe28d` started every workload without a
failure, then was deliberately cancelled. All four workload jobs concluded
cancelled; `check` ran with both dependency results `cancelled` and failed.

[Skipped dependency run 38201349259](https://github.com/exterkamp/kriegsspiel/actions/runs/38201349259)
at H `d33ee0ea3e4676b91fc415f661eea57dfb6dba95` temporarily disabled the ordinary
matrix. `validation` concluded skipped, effectiveness passed and `check` failed
with `VALIDATION_RESULT=skipped`. Actionlint correctly warns about the diagnostic
constant-false condition. It is removed from the measured candidate, where
 actionlint passes. Neither diagnostic counts as a successful validation or timing
sample. All deliberate failing/skipping steps are removed before final review.

The refreshed comparable baseline repeats exactly the same accepted source
`d15d21b5b4ed7c923c6c8f1161e34105b0f448a6`, run 38200188722:

| Attempt | Wall to green | Runner seconds | Calculated rounded job minutes | Test step |
| --- | ---: | ---: | ---: | ---: |
| [1](https://github.com/exterkamp/kriegsspiel/actions/runs/38200188722/attempts/1) | 299s | 334s | 6 | 185s |
| [2](https://github.com/exterkamp/kriegsspiel/actions/runs/38200188722/attempts/2) | 300s | 332s | 6 | 188s |
| [3](https://github.com/exterkamp/kriegsspiel/actions/runs/38200188722/attempts/3) | 300s | 333s | 6 | 183s |

Rerun wall time starts at the attempt's `run_started_at`, rather than the original
run creation timestamp. Original-attempt wall time starts at the event/run start;
job completion includes artifact/post steps. Rounded minutes are estimates from
per-job ceilings, not an inspected invoice. Raw logs/JSON remain task-owned local
staging; run links and retained GitHub logs/artifacts are collaborator-accessible.


## Successful matched-source results

All three successes below tested exactly
`c4c1ce44679d5604dfdd1889c03b70e6e0962bc2`, tree
`0fe5eade22c404ec7f3a08c85c168912a381e355`, with accepted base/merge-base
`d15d21b5b4ed7c923c6c8f1161e34105b0f448a6`. The complete diff contains only six CI,
tooling/control and documentation files: no product/test-source revisions from
unrelated PRs participate in this comparison. The added five CI controls strengthen
the ordinary root suite. No unsuccessful run is included.

| Attempt | Wall to green | Runner seconds | Calculated rounded job minutes | Static/build | Maps | Application | Effectiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [1](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/attempts/1) | 126s | 372s | 8 | 118s | 108s | 107s | 36s |
| [2](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/attempts/2) | 128s | 332s | 8 | 119s | 67s | 101s | 42s |
| [3](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/attempts/3) | 123s | 344s | 8 | 90s | 112s | 114s | 26s |

**Observed result:** median green time 300s → 126s (58% shorter), range
299–300s → 123–128s. Median runner time 333s → 344s
(3.3% higher); mean runner time 333s → 349.3s.
Per-job rounded estimates are 6 → 8 minutes per successful run (33% higher),
not an invoice. Repeated independent installs and the short aggregate account for
extra runner overhead; the lower elapsed time is not claimed as a faster test
implementation. This modest raw runtime increase and two rounded minutes buy a
consistent reduction of almost three minutes without additional caching/sharding.

All runners use `ubuntu-latest` / `ubuntu-24.04`, image `20261004.327.1`,
provisioner `20261002.596`, Node 22.23.3/npm 10.9.7. Job queues are 1–3 seconds,
including the aggregate's 2-second queue; queues do not explain the improvement.
The aggregate takes 2–3 seconds. Specific runner IDs below are ephemeral GitHub
Actions runner names, not evidence of identical physical hardware.

| Source/attempt | Runner names (GitHub Actions suffixes) |
| --- | --- |
| baseline 1 | 1000002570, 1000002571 |
| baseline 2 | 1000002575, 1000002574 |
| baseline 3 | 1000002585, 1000002586 |
| optimized 1 | 1000002599, 1000002600, 1000002601, 1000002602, 1000002605 |
| optimized 2 | 1000002607, 1000002608, 1000002606, 1000002609, 1000002610 |
| optimized 3 | 1000002614, 1000002611, 1000002613, 1000002612, 1000002615 |

Remaining critical path varies between static/build and application/repository
controls; maps/catalog can also approach it. Internal maps and real cleanup/error
controls remain intact. Further test-internal optimization lacks evidence for this
focused PR; more runners or caches would increase overhead/complexity.

### Independent review and coverage

The independent GPT-6.1-Sol/high reviewer inspected the complete six-file scope,
re-reviewed provenance/cancellation/lint repairs, and accepted first-success source
and effectiveness evidence with no remaining code finding. It independently
recomputed source inventory hashes, error/classifier results, process reaping,
restoration and unchanged canonical source. Final integration/evidence acceptance
is recorded against the final SHA in the PR after that SHA exists.

| Suite | Before | After |
| --- | ---: | ---: |
| Engine | 358 | 358 |
| Protocol | 64 | 64 |
| Maps | 262 | 262 |
| Server | 677 pass, 1 existing skip | unchanged |
| Angular | 241 | 241 |
| Client Vitest | 673 | 673 |
| Catalog | 21 | 21 |
| Repository Node | 47 | 52 (five new CI controls) |
| Selected effectiveness cases | 3 detected | 3 detected |

All 47 original Node test names remain. No existing assertion/test file or timeout
was modified by this PR. Full source-bound local lint/typecheck/test/build passed
on c4 with before/after SHA/tree records and pinned tools. Hosted repeats retain
all static checks, map bootstrap/source verification and workspace/catalog builds.

### Accessible artifacts and retention

Third-attempt artifacts were downloaded, and original ZIP SHA-256 values were
independently recomputed to match GitHub metadata. All four checkout records
match c4's head/tree and the distinct accepted base/merge-base. The effectiveness
bundle contains the complete 881-entry committed inventory and three detected
cases with original/restored equality, fresh baseline/restored phases, no extra
assertion/collection/hook/unhandled errors, no retries or timeouts, and reaped
children before restoration.

| Artifact | Download | Verified ZIP SHA-256 |
| --- | --- | --- |
| `hq-ordinary-application-38201468808-3` | [artifact 11725796808](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/artifacts/11725796808) | `6483e42095b7774e7aad95cf5bcdba97adbe774e50a947e1ef805d3cd2a30667` |
| `hq-ordinary-static-build-38201468808-3` | [artifact 11725638123](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/artifacts/11725638123) | `6483e42095b7774e7aad95cf5bcdba97adbe774e50a947e1ef805d3cd2a30667` |
| `hq-effectiveness-38201468808-3` | [artifact 11725428433](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/artifacts/11725428433) | `e6b9c8898036f189db66ee316868e462dd1906dda339637536653b9d92cfa303` |
| `hq-ordinary-maps-38201468808-3` | [artifact 11725234014](https://github.com/exterkamp/kriegsspiel/actions/runs/38201468808/artifacts/11725234014) | `bf041909a7ae4fab6939408c521e6b236a256d91c59a339dd7cd6aaa9258e7ba` |

These artifacts expire on 2026-11-11 UTC; download/retain needed evidence before
expiry. The ordinary bundles contain checkout metadata (as before), not test logs
or build products; those assertions/results remain in accessible job logs.
GitHub's artifact listing and archive endpoints exposed only the newest rerun's
artifacts during this experiment. The first successful bundle was preserved locally
before repeating; earlier attempt timings/source verification remain in job logs.
Do not assume earlier-attempt ZIPs remain available after rerunning a workflow.
The final-head validation uses a fresh pushed run and is left intact, with its
accessible source-bound evidence recorded in the PR.

## Final integration and operational requirements

After freezing the comparison, accepted main advanced to
`6d85099a9e0b44a3113c1e4ede2a833e601675c9` through #311. The task branch integrates
those engine/server changes without modifying them. Full final-head checks and
independent integration/delta review follow; their results are separate from the
matched d15/c4 performance sample above. A new source is never described as a
benchmark replicate or validated by an old green run.

No branch protection changes are needed or made. Existing `check` and
`test-effectiveness` names remain; `check` is now strictly stronger by including
effectiveness. Consumers of ordinary evidence inspect all three group artifacts.
Only PR runs cancel automatically; main and merge-group concurrency groups are
unique per run. Merge-group provenance is controlled with distinct head/base
fixtures; a live merge queue is unavailable because main is unprotected with no
rulesets, so no live queue execution is claimed. Cancellation can interrupt
cleanup/upload; missing evidence stays incomplete and cannot clear the gate.

Task-owned reviewer evidence is preserved before closing its pane. Coordinator
`wD:p1` and unrelated panes/previews remain. No merge into main or deployment is
performed. The final source-bound verdict, run and artifact links belong in the PR
rather than a self-referential final-SHA commit to this report.
