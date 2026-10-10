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

## Active gate C and preview preparation

- Contract checkpoint `28a611c`. #135 assigned map-implementer / w1:p6, gpt-6.1-sol/high for bilinear contours/geometry. Exclusive `packages/maps/src/terrain/**`, `packages/maps/tests/terrain*.test.ts`, `packages/maps/docs/terrain.md`; frozen common source/index remains coordinator-owned. Analytical oracle packet includes determinant saddles, exact four-way saddle, complete-segment height deviation and deterministic work caps.
- Second writer map-client / w1:p8, gpt-6.1-sol/medium (configured default, bounded UI), owns `client/src/map-authoring/**` and `client/map-authoring.html`. Prepares #140 fixture preview only; no acceptance until #139. No worker/control generator yet. Coordinator integrated maps dependency, source aliases and root lockfile offline.
- Reviewer map-reviewer / w1:p7 remains read-only, preparing #136 drainage/geography oracles; final #135 review follows implementation. Two writers plus one reviewer; same cwd/tab, no additional worktrees.

- #136 independent preparation: minimax bowl-fill oracle, deterministic flat rank/acyclic paths, distance-aware receiver rule, exact Y-junction accumulation, lake dry-island holes, complete river surface/area policy, buffered dry-abutment crossing candidates and coherent cover. Additive geography output/candidate types are needed because frozen HydrologyOutput intentionally has no final road links/cover. These are later implementation handoffs, not accepted geography.
- #135 source/in-memory independent review started as terrain modules became available; writer retains all source/test ownership and compiled-artifact checks.

- #140 fixture shell handoff: focused client typecheck and 9 viewport/geometry tests pass. Coordinator added production multi-entry Vite configuration alongside the player entry. No browser/real-map acceptance yet. Client writer resumed exclusive owned paths for concrete preview lifecycle/DPR, crossing contrast and stroke-culling fixes identified by its preparatory inspection.

## Accepted gate C — #135

- Versioned independent terrain and bilinear contour graph with determinant saddles/exact-level branches, adaptive refinement, canonical precision preconditions and complete-segment independent height certification. D17 records this numerical policy. Writer gpt-6.1-sol/high; independent reviewer final PASS, no material findings remain.
- Focused 35/35 tests; coordinator integrated public exports and reran full maps suite: 97/97 pass. Build/typecheck and scoped lint/format pass. 5/10/15 km terrain-only probe combined 1.33 s, 201.64 MiB peak process RSS; maximum certified contour error .024983 m against .05 m. Full composition/browser performance remains later evidence.
- Client preparatory fixes pass 15 focused tests/typecheck. Coordinator production client build passes with both entries; existing player bundle has Vite's size advisory. Preview remains unaccepted until real maps/browser gates.
- Next: story-sized terrain commit, then #136 drainage/water/cover/crossing candidates. Normalize modified ground before dependent contours. No implicit acceptance of complete geography or public distribution.

## Active gate D — #136

- Accepted terrain checkpoint `27bbce4`, pushed to integration PR #151 with closure references only for #133–#135. No merge/deploy.
- map-implementer / w1:p6, gpt-6.1-sol/high, owns `packages/maps/src/geography/**`, `packages/maps/tests/geography*.test.ts`, `packages/maps/docs/geography.md`; common files remain coordinator-owned. Drainage, physical water policy, coherent cover and separate crossing candidates with analytical/fixed-seed/work-cap checks. Reviewer / w1:p7 remains read-only and prepares complete-water-area/dry-abutment oracles. Client writer idle after preview fixes.
- Browser prerequisite discovery still finds no devrun launcher in shell/config/bin locations and `~/CLAUDE.md` remains absent. Owner setup question is pending; headless dependency work continues. Installed Chrome executable exists, but browser smoke must follow the launcher requirement.

- D ownership split acknowledged by primary writer before dispatch: map-client / w1:p8 (configured default gpt-6.1-sol/medium, isolated cover scope) owns only `src/geography/cover/**`, `tests/geography-cover.test.ts`, `docs/geography-cover.md` inside maps. `generateCover(elevation,bounds,water,settings,seed)` returns independent `Cover[]`; imports frozen helpers only. Primary writer retains all other geography/type/index/integration paths and sole compiled artifact ownership. Two writers plus one reviewer, no path overlap.

- Owner licensing reply: **keep distribution gated; prepare review PR**. No root licence change, public combined build, package publication or deployment is authorized. Continue source implementation and local validation, preserve fork corresponding-source/notices and record the gate in review PRs. This resolves the question for this delivery scope; do not ask again.

- D independent review reproduced and verified fixes for omitted water-query sample-copy work, leaked generated corner-contact topology errors, tangent dry-abutment acceptance, interior crossing-hole misses and caller-mutable query bounds. Valid masks may use exact rectangle fallback; no wet/dry area is dropped.
- Default 10 km/seed17 geography probe exposed conservative cover-mask budget failure: reservation 3,523,132 exceeds remaining 1,048,709 of 5,000,000. Reassigned exclusive cover writer to bounded row-scanline interior classification and edge-local boundary traversal; preserve resolution/holes/shoreline semantics/caps/seeds. Primary writer continues own docs/checks and waits before combined rerun. This is a substantive resource correction, not a reason to weaken the default gate.

- E lookahead: river97 first geometric crossing has outward25m grades1.166/1.086 against0.10. D candidates are proposals, not routed bridges. Primary writer investigates viable candidate connectors before freeze; if impossible, bounded versioned shoulder grading must change authoritative ground and dependent contours, never relax road grade. E/G still independently certify full directional segment grade and network connectivity.

## Accepted gate D — #136

- Priority flood/metric D8/ranks/accumulation, conservative lake cores and drainage-derived carved backwater with bounded Manhattan shoulder grading. Separate source/authoritative/filled surfaces; contours regenerate after ground changes. Whole-water numerical certificate, complete dry crossing proposals, detached suitability queries and independently seeded coherent cover. D18 records the policy.
- Primary writer gpt-6.1-sol/high plus isolated cover writer gpt-6.1-sol/medium. Independent reviewer final PASS; all reproduced issues corrected. Optimized cover preserves exact mask parity and caps. River97 has123 geometric candidates; all pass the tested25m connectors, with first grades .03535528, though complete regional routes remain E.
- 57 geography tests; coordinator repository lint/typecheck/test/build all pass: 442 Vitest plus18 Node tests (460 total), including154 maps tests and15 preparatory preview tests. Logs `.local/map-gate-d-{lint,types,tests,build}.log`. Existing Canvas test notices and player-bundle size advisory remain non-failing.
- Default10km seed17 geography succeeds under unchanged caps in763ms; benchmark process peak285.30MiB. Diagnostic24-seed corpus retains explicit river1 topology infeasibility; representative flat17/hills31/river97 succeed. Full composition/maximum complex water/browser performance remain J.
- Next: story-sized geography commit then #137 sites and grade-constrained regional network. No source/fork distribution or gameplay integration authorized.

## Active gate E — #137 and worker preparation

- Geography checkpoint `78b918a`. Primary map-implementer / w1:p6 (gpt-6.1-sol/high) owns maps `src/planning/**`, `tests/planning*.test.ts`, `docs/planning.md` and focused compiled artifacts. Sites, real connected regional graph, directional-grade/corridor validation, explicit linked bridges, authoritative entrances and bounded reconciliation. Representative river97 must use a crossing, not merely export unused candidates.
- map-client / w1:p8 (configured default gpt-6.1-sol/medium) owns only new `client/src/map-authoring/generation/**`. Preparatory typed controller/runner with injected generator and complete validator, cancellation/stale/error/watchdog tests; no fake generator or acceptance claim. Actual worker/controls integration waits for G/H.
- Reviewer / w1:p7 read-only: preview preparation source review first, then E independent numerical/topological oracles/source review. Two disjoint writers plus one reviewer; common files/commits/GitHub remain coordinator-owned.

- Independent reviewer PASS for fixture preview preparation: detached/frozen loading, hole/coordinate/width rendering, retained valid candidate and lifecycle source checks; coordinator15 tests pass and gate D root build includes both player/authoring entries. Integrate this preparation separately; no closure for #140 until real assets/screenshots/browser performance. New generation subdirectory remains worker-owned and unreviewed.

- Coordinator inspected and answered the implementer’s queued engineering question: expose shared-budget crossing validation so repeated checks cannot reset the cap. Added `validateCrossingCandidateMetered` and aggregate-budget regression; all 8 crossing tests pass. Agent was continuing other work, not blocked on permission. The plan now distinguishes routine engineering questions from actual approval dialogs, consistent with the owner’s instruction. Live implementer UI reports gpt-6.1-sol/xhigh; this was observed, not changed by the coordinator.
- Worker lifecycle preparation passes coordinator 35 focused tests. Independent review caught nonstring error-kind coercion; writer assigned explicit string validation and regression before preparation acceptance. Read-only fork API preparation queued after that fix; F remains dependent on accepted E.

## Accepted worker lifecycle preparation — #141 remains open

- Isolated `client/src/map-authoring/generation/**`: strict typed request transport, injectable one-request runner/controller, immutable candidate retention, mandatory complete-validation callback, cancellation, global operation IDs, stale event/async-result isolation and total-wait watchdog. Saved loading validates recorded data without generation. Export is enabled only for the current fully accepted operation.
- Writer gpt-6.1-sol/medium; independent reviewer preparation PASS after nonstring error-kind fix. Coordinator 36 focused tests, client source typecheck and scoped ESLint pass. Dense contract-scale message and terminal transport-exception regressions included.
- This supplies no actual generator, full validator, worker entry, controls or browser acceptance. #141 stays open pending G/H/I. Client writer completed read-only F seam/regression inventory; fork implementation still waits for E acceptance.

- Devrun prerequisite resolved: `/Users/dominic/.local/bin/devrun` now exists (installed13:26) and `devrun doctor --json` passes with authorized local state/socket access. Use the absolute executable; inherited pane context is stale, so launch with explicit coordinator pane `w1:p5` / tab `w1:t3`. No server started yet. This supersedes the earlier missing-launcher discovery.

- Accepted additive geography seam: caller-owned crossing budget also meters descriptor preflight per node and reserves schema traversal before parsing; invalid candidate checks cannot repeat uncharged work. Independent reviewer PASS, exact-cap repeat rejection and getter-safety probes. Coordinator59 affected contract/import/crossing tests and scoped lint/format pass. E independent review identified malformed deck tuple/path acceptance and omitted actual site-area constraints; fixes delegated before E acceptance.
- Local fixture preview started through devrun as `map-review`, URL `http://127.0.0.1:41660/map-authoring.html`, explicit coordinator pane context. Chrome automation reaches its native blocked page (`ERR_BLOCKED_BY_CLIENT`); owner asked to allow this local page. No browser security settings changed; headless work continues.
