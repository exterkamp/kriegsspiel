# CI performance optimization

## Scope and ownership

Optimize the existing validation critical path without removing tests, assertions,
source verification, builds or effectiveness evidence. No merge, deployment or
branch-protection changes are authorized.

Accepted baseline: `a86a661c82002bb9680b13ca427742a11caa26a3` (2026-10-11 Pacific).
Coordinator owns `.github/workflows/ci.yml`, CI tooling/tests and this report in
`worktree-workflowoptimization`, on `perf/ci-critical-path`.
Herdr coordinator: `wD:p1` (`ci-coordinator`); read-only reviewer: `wD:p2`
(`ci-reviewer`, verified gpt-6.1 high). Only two task agents; unrelated panes and
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
source-selection controls. A cancelled workflow also cannot pass the aggregate.
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
