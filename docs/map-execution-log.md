# Procedural map execution log

Owner resumed implementation on 2026-10-10; delivery is review PRs, without merge or deployment.

## Baseline and tooling

- Kriegsspiel branch `feat/procedural-battlefield-maps`, base `074bf7aa5857cf5fb3a25eb6804e45a5272ac3a9`.
- SettleMaker branch `feat/elevation`, base `d5cf3590cf59e1d382110d25a6910f12507299e2`.
- Baseline backup: `/Users/dominic/code/kriegsspiel/.local/map-run-baseline/20261010-105130`; binary tracked patches, untracked copies and hashed manifest retained locally.
- Initial Kriegsspiel changes: `.gitignore`, `AGENTS.md`, `docs/decisions.md`, `docs/hq-interface.md`, `docs/roadmap.md`; untracked `docs/map-implementation-plan.md`. These are preserved planning input.
- Initial fork changes: `src/index.ts`, `src/village/render.ts`; untracked `src/terrain/`. These remain experimental and must not be included accidentally.
- Herdr verified (`HERDR_ENV=1`). Caller inherited pane handle was stale; live inventory identified coordinator `w1:p5`. Sibling implementation `w1:p6`, review `w1:p7`, same tab/cwd, no focus changes.
- Configured default `gpt-6.1-sol`, medium reasoning. Cached available models: gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-reserve, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, codex-auto-review. CLI supports `-m` and reasoning config. Architecture/geometry/review use gpt-6.1-sol/high initially. No owner cost ceiling supplied; measured usage/cost unavailable at kickoff.
- GitHub available through sandbox escalation; Herdr socket also requires escalation. No account spending settings changed.
- Node requirement `.nvmrc`: 22. Exact runtime and browser recorded at verification gate. `devrun` absent from PATH; discovery pending before browser smoke.

## Checkpoints

| Issue | Agent / pane | Owned paths | Prerequisite | State | Accepted revision / evidence | Next |
| --- | --- | --- | --- | --- | --- | --- |
| #133 | map-implementer / w1:p6 | docs/map-architecture.md; scripts/maps-assessment/ | initial bases above | Accepted | Five analytical tests; 16 flat/constrained comparisons; fresh-process replay; clean install/build; independent review passed | #134 |
| #133 review | map-reviewer / w1:p7 | read-only | initial bases above | Accepted | Independent source and final artifact review: no material findings | Review #134 contract |

Coordinator exclusively owns root workspace/lockfiles, decisions, integration commits and GitHub tracking. No more than two writers and one reviewer.

## Coordinator prerequisite checks

- Baseline `npm test`, `npm run typecheck` and `npm run build` passed on Node v22.22.2. Existing jsdom canvas and Vite bundle-size notices remain.
- Baseline lint traversed ignored `.local/settlemaker` and failed on external source. Added `.local/**` to ESLint global ignores; external fork checks remain independent.
- Verified all ten native sub-issue relationships through GitHub REST. Project inventory is inaccessible because the installed GitHub token lacks `read:project`; no token scopes changed. This does not block implementation.
- `devrun` discovery found no launcher in PATH, local bin, dotfiles or repository. Requested launcher/setup location from owner while headless work continues.

- Public fork pin verified: `d5cf3590cf59e1d382110d25a6910f12507299e2`, tree `ee7db196403a98c5a2ab2378fcaed7c757080250`. Pristine committed archive installed with `npm ci --prefix .local/map-clean-source/settlemaker` and built successfully. Compatibility suite running.
- Initial independent #133 source review recommends physical village planner and identifies numerical terrain, complete footprint/corridor, exact entrance topology, structured water diagnostics and bounded work as required #138 extensions. Final artifact review pending.
- GPL-only fork and undeclared Kriegsspiel license create a distribution gate. Owner decision requested; no license change made. Source development continues under the plan.

- Pristine fork `npm run build` and `npm run build:lib` passed. Baseline full compatibility run: 139/140 files, 1504/1505 tests passed; one 60-second roads-reach-the-edge test timeout and two worker RPC timeouts under parallel execution (260.96 s total). Focused serialized rerun assigned to distinguish resource contention from behavior; no test expectation or source changed.
- Coordinator independently ran four assessment geometry tests (pass), ESLint on assessment scripts (pass), and fresh-process replay on pristine assessment build (16 hashes and diagnostics match). The replay runner requires its generated provenance sidecar; direct use of the raw clean npm build without the sidecar fails explicitly.

## Accepted gate A — #133

- Implementer `map-implementer` and independent reviewer `map-reviewer`, gpt-6.1-sol/high. Selected physical village; all four APIs compared with flat/constrained cases and seeds 2/7. Five analytical tests, sixteen repeats, complete diagnostic replay across fresh processes, scoped ESLint/Prettier passed.
- Coordinator verified immutable public source, clean lockfile installation, ESM/browser builds. Upstream timeout rerun remains in progress and is baseline resource evidence, not a terrain implementation failure.
- Source/coordinate/placement gaps are bounded in #138. Distribution remains gated pending owner license decision.
- Accepted story integration commit follows; #134 receives that revision and exclusive initial `packages/maps/` ownership.
