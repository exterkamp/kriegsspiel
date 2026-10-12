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
