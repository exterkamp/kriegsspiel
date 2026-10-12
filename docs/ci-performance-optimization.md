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
attempt 2 is also measured below. Both use GitHub-hosted `ubuntu-latest`,
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
