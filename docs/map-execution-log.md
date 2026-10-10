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

## Active gate B — #134

- Architecture checkpoint: `6d181b5`. #134 assigned to map-implementer / w1:p6 (gpt-6.1-sol/high; foundational schema and numerical design) with exclusive initial `packages/maps/**` ownership. Root workspace/lockfiles, common docs and GitHub remain coordinator-owned.
- Deliverable: strict capped versioned contract, independent layers and bridge/entrance topology, canonical identity/precision, analytical bilinear queries, positive and adversarial fixtures. Contract freezes only after component checks and independent review.
- #135–#139 blocked on accepted contract; no dependent writer yet.

- Integration draft PR: https://github.com/exterkamp/kriegsspiel/pull/151. Only #133 has a closure reference; remaining stories and epic stay open. Branch pushed at architecture checkpoint.
- Root lint passed after accepted assessment and `.local/**` exclusion; analytical tests now included in root `npm test`.
- Serialized fork road-edge rerun: all four assertions passed (153.17 s), but one worker `onTaskUpdate` RPC timeout still caused exit 1. Investigating Vitest RPC allowance before final compatibility claim; no assertions weakened.

- Independent #135 acceptance planning completed (read-only map-reviewer): analytical plane/plateau/exact-node/edge/closed-loop contours; asymptotic determinant saddles that defeat centre averaging; whole-chord bilinear quadratic error oracle; separate level/work/refinement/output caps; stage RNG independence. These are review oracles, not accepted implementation.

- Thread-pool road-edge rerun timing invalidated by confirmed host sleep: 11:06:52 Idle Sleep, 11:07:32 Maintenance Sleep (555 s), 11:16:58 Maintenance Sleep (900 s), wake at 11:31:58. First test elapsed ~1489 s; remaining three ~37–38 s. This is not accepted performance evidence. Temporary `caffeinate -i -t 14400` prevents idle sleep during this authorized run; no power settings changed. Stop the assertion at completion. Baseline RPC starvation investigation remains with read-only reviewer.

- Reviewer identified fork road-edge harness starvation: 40 synchronous generations per test prevent RPC acknowledgement service; global afterEach yield comes before final task-update dispatch. Coordinator made only `tests/village/roads-reach-the-edge.test.ts` helper async, awaited all four unchanged grids and yielded a real zero-delay timer between complete cases (same existing 60-second limits and assertions). Mirrored into clean validation archive; focused rerun pending. This new fork change is separate from the preserved initial prototype.
- Machine: Apple M3, Mac15,3, 8 logical CPUs, 16 GiB RAM; macOS 27.0.1 / 26A434; Node v22.22.2.
- Coordinator added `packages/maps` workspace and refreshed root lockfile offline, without installs/scripts; contract writer retains package-exclusive ownership.

- Corrected road-edge harness rerun passed 4/4 tests, exit 0, no RPC/unhandled errors, 148.36 s total on uninterrupted host. Same 40 cases per test, existing assertions/timeouts. Independent diff confirmation pending before fork commit.
- Preliminary #134 interface review identified artifact-vs-source identity, versioned corridor semantics, configurable site planning extents, and planning/global operation caps; relayed for resolution before freeze.

- Independent reviewer confirmed fork harness diff retains every case/generation/assertion and existing limits. Accepted isolated harness commit `30ce630917f177085aa083b3cf3cd15ce6dda4c0` on fork `feat/elevation`; prototype stays unstaged and untouched. Full compatibility acceptance still requires a final uninterrupted suite after fork work.

- Independent #134 in-memory probes reproduced hidden-getter preflight bypass, micro-scale segment intersection error, unbudgeted relationship scans, unsupported boundary exits, missing local-street join certification, vertex-only river policy check, and decimal seam ownership mismatch. Writer assigned focused fixes/regressions. Contract vs complete terrain/composition certification must be explicit; later #136/#139 gates remain mandatory. Positive bilinear/full-width crossing controls passed; no contract acceptance yet.

## Fixed verification corpus (chosen before generator implementation)

Use seeds `1, 2, 3, 7, 17, 31, 97, 55337` for each of flat countryside, wooded hills and river valley: 24 recipes. Representative milestone maps use flat seed 17, hills seed 31, river seed 97 and must succeed; do not replace them to hide failures. Remaining seeds may return documented bounded infeasibility where allowed. Analytical and impossible fixtures are additional. Default/minimum/maximum resource cases retain recorded seeds and explicit settings.

- #134 independent recheck passed robust orientation/intersection probes, early/indexed relationship work, declared exits, bilinear river interior checks and decimal seam ownership. Contract-only validation scope is explicit; local joins/connectivity/suitability remain #139. Two focused regressions remain: custom array-prototype inherited getter bypass and incorrect coupling of sample-array length to vertex cap. Relayed to writer; final README/component acceptance pending.

## Accepted gate B — #134

- Frozen v1 package: `packages/maps`, 21 files. Local-metre envelope, independent layers and stage handoff types, descriptor-safe capped imports/settings, bilinear queries, robust orientation, complete polygon/crossing coverage, explicit exits, separate drainage, ordered overrides and three canonical SHA-256 identities.
- Writer gpt-6.1-sol/high; 62 tests including review regressions and fresh-process replay pass. Independent reviewer confirmed all reproduced defects fixed and documentation/API boundary adequate; no material findings remain.
- Coordinator root checks all pass: lint, typecheck, build, 335 Vitest tests plus 18 Node tests (353 total). Logs retained locally as `.local/map-gate-b-tests.log` and `.local/map-gate-b-build.log`. D16 and architecture/docs updated with frozen contract and contract-vs-composition boundary.
- Gate B accepts contract validity only. Full connectivity/local joins/terrain suitability and authoring remain later gates; no distribution authorization inferred.
- Next: integrate story-sized #134 commit, assign #135 terrain; permit a second exclusive client writer to prepare fixture-based preview after this freeze.
