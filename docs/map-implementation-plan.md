# M3c implementation and agent execution plan

This is the execution guide for [Epic 9 #132](https://github.com/exterkamp/kriegsspiel/issues/132), subordinate to its story acceptance criteria, `AGENTS.md`, and D15. The project plan defines what must ship; this document defines how to build and verify it. The owner resumed implementation on 2026-10-10. [The execution log](map-execution-log.md) records active work and accepted gates. This document does not install a background scheduler.

## Execution objective

An active coordinator should be able to take the ten stories through implementation, independent review, integration, and milestone validation without asking the owner about routine engineering choices. Run through the dependency graph until the milestone completion conditions hold or a specific external blocker prevents progress. Keep a durable record so another coordinator can resume after interruption.

Use `feat/procedural-battlefield-maps` as the Kriegsspiel integration branch. The local SettleMaker checkout is on `feat/elevation`; its current base is `d5cf3590cf59e1d382110d25a6910f12507299e2`. Existing uncommitted prototype files are experimental input, not accepted story work. Inventory and preserve both repositories' initial changes before assigning writers. Do not reset them or include unrelated work in a commit.

## Defaults agents may use

These are proposed configurable implementation defaults, not owner-approved gameplay rules. Story 9.1 may revise them based on the planner fixture and measured costs, recording the evidence in the architecture note and decision log. Routine revisions need no owner checkpoint.

| Parameter | Initial choice | Verification / revision rule |
| --- | --- | --- |
| Map extent | 10 × 10 km default; 5–15 km per side supported initially | Test minimum, default, and maximum; reject unsupported dimensions before allocating |
| Height samples | 25 m spacing; at most 400,000 samples | 15 km square is 601 × 601 samples; reduce supported limits if measured memory requires it |
| Elevation | Metres relative to a local datum; x east, y south; z up | One shared convention for queries, geometry, preview, and exports |
| Contours | 10 m minor / 50 m index intervals | Configurable; cap extraction work and output vertices independently |
| Road grade | 10% maximum, measured along segments | Configurable generation constraint; not a unit movement rule |
| Building suitability | 8% maximum terrain gradient across the footprint | Check covered sample cells and interpolation boundaries; no centre-only acceptance |
| Settlements | 4 villages and 6 farm sites by default | Configurable bounded counts; report infeasible requests rather than silently reducing them |
| Adjustment scope | Rename places; move settlement anchors; exclude settlement-placement regions | Deterministic overrides; move/exclusion regenerates dependent settlements and roads |
| Generation target | Default map ≤10 s; maximum supported map ≤30 s; peak generation memory ≤512 MiB | Provisional benchmark targets, measured on a documented machine; tighten implementation or explicitly revise supported limits |
| Preview target | Pan/zoom frame time p95 ≤33 ms at 1440 × 900 | Measure after load on a documented browser/machine; use geometry detail levels |

The editable workflow deliberately has no terrain brush, arbitrary road drawing, building editor, or hydrology editing. Land-cover density and relief changes are generation settings and trigger regeneration. Naming overrides do not affect geometry. Require stable place IDs so overrides survive deterministic replay; reject references to missing IDs.

## Architecture and ownership

Create `packages/maps` (proposed package name `@kriegsspiel/maps`) for the portable contract, numerical terrain, geography generation, validators, canonical serialization, and a headless CLI. Add it to the root workspace and required checks. Keep it independent of `GameState`, protocol side views, clock, LLM, and Three.js. Share coordinate types only if doing so does not force a gameplay migration. Story area labels describe ownership, not mandatory filesystem paths.

Suggested modules:

| Boundary | Responsibilities |
| --- | --- |
| `contract/` | Versioned asset/settings/override schemas, units, stable IDs, canonical serialization, resource limits |
| `geometry/` | Bounds, intersections, polygon validity, spatial indexing, coordinate transforms |
| `terrain/` | Seeded height field, interpolation, slope, contours, drainage, water and cover |
| `planning/` | Suitable sites, road graph, route search, crossing choice, bounded reconciliation |
| `settlements/` | Adapter to the pinned fork; world/local transforms; constraint and diagnostics translation |
| `generation/` | Stage composition, independent random streams, operation budgets, progress, deterministic failure |
| `validation/` and `export/` | Whole-map invariant checks, canonical asset, vector layers, provenance |
| `client/src/map-authoring/` | Dedicated preview, worker bridge, controls, overrides, import/export |

SettleMaker owns generic settlement terrain/entrance constraints and placement changes. Kriegsspiel owns battlefield hydrology, regional geography, map schema, composition, and authoring. Do not duplicate elevation generators in both repositories. The earlier fork terrain experiment may supply algorithms after review; move/adapt suitable parts without assuming its renderer wrapper is the final architecture.

Prefer the physical `createSettlementModel` pipeline for inspection because it already exposes metre-based scene/building geometry and diagnostics. Story 9.1 must compare the physical village/city presets with both legacy village and legacy city APIs using a comparison matrix and one flat and one constrained fixture for viable candidates. Record coordinate/scale conversions and constraint-extension limitations for rejected candidates. If the selected planner cannot satisfy terrain constraints, extend its placement stages; do not accept an unconstrained layout after drawing contours over it or filtering buildings into an unusable settlement.

The fork receives a terrain context with height/slope queries, prohibited-area tests, site bounds, and explicit approach endpoints/bearings. It returns stable geometry plus diagnostics. Validate transforms with asymmetric coordinates and a known plane. External entrances are authoritative joins, not decorative direction hints. Keep unconstrained upstream calls compatible where promised.

Do not make `.local/settlemaker` a clean-build dependency. Story 9.1 selects a reproducible source strategy: preferably an immutable fork revision with a documented build/install path; otherwise a committed, attributed source snapshot. Prove a fresh checkout can build it. Include lockfile integrity, exact source revision, notices, and source retrieval instructions. Inspect GPL-3.0-only notices and the main repository's licensing before distributing a combined build; technical separation alone is not a licensing conclusion. Prepare source/notice compliance documentation. If distribution requires an owner licensing decision, continue unblocked development and record that as a distribution gate.

## Algorithms and invariants

1. **Contract first.** Define an asset envelope with schema/generator/fork versions, seed, settings, overrides, bounds, elevation samples, independent cover/infrastructure layers, and diagnostics. Preserve overlapping layers. Validate imports before use; cap file size, samples, features, and vertices. Local metre vector output must explicitly identify its coordinate convention and must not be presented as longitude/latitude GeoJSON. A georeferenced RFC 7946 export is outside scope.
2. **Determinism.** Derive independent streams from the root seed and versioned stage/place identifiers. Sort ties explicitly and use stable IDs. Serialize finite numbers under a documented precision policy. Include every content-affecting version and setting; exclude elapsed time and timestamps from canonical identity. Define identity for the supported JS runtime/version; prove fresh-process replay rather than promising arbitrary cross-platform float identity.
3. **Elevation.** Start with seeded multi-scale noise plus configurable ridge/valley shaping. Bilinear height queries and analytic interpolation derivatives define slope. Document edge/clamp/error behavior. Extract stitched contours consistent with that bilinear surface, with deterministic saddle/exact-level rules and a measured contour-height tolerance; do not reuse the prototype's triangular contour surface without reconciling it with queries. Test a plane, flat field, saddle, and boundary intersections. Rendering hillshade is derived data. A 25 m field models coarse terrain, not surveyed foundation detail; footprint checks are exact against the declared sampled/interpolated model, not a claim of real-world accuracy.
4. **Drainage.** Use a deterministic priority-flood depression treatment and acyclic flow graph with stable tie-breaking on flats. Store any filled drainage surface separately from original ground. Rivers must follow a documented physically consistent surface: either carve/update ground and regenerate dependent contours, or represent standing water/backwater explicitly. Never let a filled surface hide an unexplained uphill river. Use accumulation thresholds, bounded widths, explicit outlets, and declared sink/lake policy. Flat maps may have no river with a clear diagnostic unless a river is required by the preset.
5. **Cover.** Generate coherent woods/fields/open regions from slope, water distance and separately seeded spatial noise; polygonize and simplify within stated tolerances. Crop to bounds and preserve holes. Settlement agricultural allocation may refine suitable fields, without erasing roads or water constraints.
6. **Sites and regional roads.** Rank dry suitable regions with spacing and site-area constraints. Build a deterministic connected candidate graph, beginning with a spanning network and optional bounded extra links. Use terrain-cost A* on an internal planning lattice with stable tie-breaking and bounded expansions. Roads cross water only through explicit feasible crossing candidates. Simplification/smoothing must be revalidated for grade and water intersections; accepted routes cannot rely on sample-centre tests alone.
7. **Crossings and settlements.** Model crossing endpoints, traversable span, river identity, and linked road edges. Prefer bridges initially; only emit fords if depth/width suitability is actually modelled. Pass regional approach geometry to the fork; terrain constraints affect lot/street placement before acceptance. Inspect complete footprints and street corridors against water and slopes. Bound retries per site and global reconciliation, and return infeasibility rather than a false successful empty village.
8. **Composition.** Generate terrain → water/cover → sites/roads → local layouts → reconciled joins → whole-map validation → exports. No circular unbounded replanning. Geometry diagnostics have stage, constraint, feature ID, location, and remediation. Expected infeasibility is a typed result; programmer errors remain distinguishable.
9. **Preview and requests.** Render canonical vectors in a dedicated top-down Canvas2D preview with contour/cover/water/road/building layers, place names, scale, pan/zoom and high contrast. Use an SVG vector export for sharing. Start generation in a worker; tag requests and ignore stale results. Cancellation terminates/replaces work when needed; deterministic operation limits remain in the generator. Retain the last valid map on failure, clearly distinguish failed candidate diagnostics, and prevent invalid candidates from being exported as validated assets. Loading an asset does not regenerate it. Regeneration uses its recorded versions/settings/overrides or reports unsupported versions.

## Dependency-aware work packets

Dependencies in GitHub remain authoritative. Fixture-based scaffolding may be prepared early, but a dependent story cannot be accepted until its implemented prerequisites are available and tested.

| Wave | Story / agent packet | Concrete output and gate |
| --- | --- | --- |
| A | #133 architecture implementer | Planner comparison fixtures, source pin/build strategy, coordinate adapter design, configured limits and edits; reviewer verifies source evidence and gaps |
| B | #134 contract implementer | `packages/maps` skeleton, schemas/queries, fixture, canonical identity and adversarial import tests; freeze v1 interfaces before parallel writers |
| C | #135 terrain implementer | Height/slope/contours with analytical tests, fixed seeds and work caps; no renderer-owned geometry |
| D | #136 geography implementer | Drainage, water, cover and crossing candidates; verify downstream rule, flat/sink cases and valid polygons |
| E | #137 planning implementer | Sites and connected regional road graph; demonstrate constrained routes across river and steep terrain |
| F | #138 fork implementer | Terrain-aware local layout with entrance joins, whole-footprint checks and compatibility tests; pin accepted fork revision |
| G | #139 integration implementer | Composed multi-village assets, strict validation, headless CLI and canonical/vector export; fresh build cannot depend on the ignored checkout |
| H | #140 preview implementer | Real generated assets in standalone overview/detail preview; screenshot and responsiveness evidence |
| I | #141 authoring implementer | Settings, worker lifecycle, named overrides, anchor/exclusion adjustment, save/load/export; prove stale requests cannot replace current map |
| J | #142 verification implementer | Clean setup, seed corpus, performance report, user guide and gameplay handoff; coordinator verifies epic end-to-end conditions |

After B, a client agent may prepare a preview shell against the frozen fixture while C/D proceed. After C, a reviewer may specify independent terrain cases without editing files; a writer with exclusive test-path ownership implements them. During E/F, a client agent may prepare worker/control scaffolding against typed interfaces. These are preparatory packets, not a reason to close #140/#141 early. Keep no more than two writers plus one reviewer active; the coordinator integrates. The core geography chain remains mostly sequential.

Each packet specifies the issue, allowed files, exact prerequisite revisions, deliverable, tests, and exclusions. A fork packet must link `exterkamp/kriegsspiel#138` explicitly; cross-repository PRs do not automatically prove closure of the tracking issue.

## Model selection

The owner delegates model selection to the coordinator within the available, configured model set and any owner-supplied cost limits. Choose per work packet without routine approval. This policy concerns development agents, not the game's umpire model.

| Work | Selection policy |
| --- | --- |
| Ordinary implementation | Configured default model |
| Architecture, difficult terrain/geometry, independent review | Stronger reasoning model or higher supported reasoning effort |
| Bounded documentation and mechanical changes | Faster, cheaper available model when the task is sufficiently specified |
| Substantive failed attempt | Inspect the failure, improve the packet, then escalate model/reasoning if it is likely to help |

At kickoff, record the available model IDs, configured default and any cost ceiling in the execution log. No specific model allowlist or numerical spending ceiling has been supplied yet; use the existing configured access and limits rather than inventing one or blocking kickoff. Do not enable new paid services or alter account spending settings. If alternative models cannot be selected through the installed agent tooling, use the configured default and record the limitation.

Use installed agent help to verify model/reasoning selection arguments; do not assume CLI flags or hard-code model names that may become stale. Record the selected model, reasoning setting when supported, selection reason and any later escalation in each packet's execution-log entry. Record usage/cost when available, distinguishing measured usage from estimates. Respect supplied limits and continue independent work where possible if a limit blocks a packet. Model choice does not replace independent review or acceptance checks.

## Herdr orchestration

Use the [Herdr skill](/Users/dominic/.agents/skills/herdr/SKILL.md). Verify `HERDR_ENV=1`, read the installed CLI help, inspect live agents and caller layout. Create sibling panes in the current tab/current directory using `--no-focus`; obtain IDs from returned JSON. Do not create additional workspaces/worktrees or change agent cwd unless the owner requests that topology. Agents can address fork files using `.local/settlemaker` while retaining the shared cwd.

Roles are coordinator, implementer, optional parallel client implementer, and independent reviewer. Reuse idle agents between packets. Start with `herdr agent start <unique-name> --kind codex --pane <returned-id>`, then submit a bounded packet through `agent prompt`. For asynchronous submission, poll `agent get` and inspect `agent read --source recent-unwrapped`; verify that activity actually started. Short waits keep the coordinator responsive. Do not interpret a submission response, timeout, `unknown`, or `done` badge as proof that a deliverable exists. Verify files, diff, and checks.

All agents share this checkout. Assign exclusive paths before concurrent writing. The coordinator alone owns root workspace/lockfiles, common contract changes, commits, branch changes, and GitHub tracking. Workers do not commit, reset, switch branches, or overwrite one another's outputs. Reviewers are read-only. Serialize dependency installation, repository-wide format/build operations, integration, and common-file edits. If file ownership overlaps, queue the packet rather than hoping merges will fix it.

Agent packet template:

```text
Implement [issue] under docs/map-implementation-plan.md and AGENTS.md.
Read the issue, decisions, architecture note and prerequisite revisions [list].
Own only [paths]. Shared paths [list] belong to the coordinator.
Deliver [bounded artifact] with acceptance checks [list].
Model/reasoning: [selection]; reason: [task complexity]; cost limit: [if supplied].
Do not commit/push/switch branches, start other agents, or edit unowned files.
Preserve the initial dirty files recorded by the coordinator.
Resolve ordinary choices using documented defaults and record deviations.
Return changed paths, verification results, limitations and dependencies needed next.
If blocked, identify the concrete blocker and continue independent authorized work.
```

The coordinator checks a completed packet, obtains an independent review, delegates fixes, and reruns only affected checks. Record the accepted checkpoint before issuing dependent work. Review is an automated engineering gate, not a routine owner approval step. Inspect queued agent questions and resolve routine engineering decisions under the owner's instruction to proceed without routine questions. Actual permission or approval dialogs still require the owner unless existing session authorization already covers the action; never bypass permission controls. Reduce avoidable dialogs with explicit bounded packet authority.

## Durable execution state and recovery

At implementation kickoff, create `docs/map-execution-log.md` with an initial dirty-file inventory and checkpoint table. Before any writers start, save binary-capable tracked-file patches and copies of all untracked source files from both repositories under a timestamped `.local/map-run-baseline/` directory, with a manifest of paths, hashes and base revisions. Record its absolute location in the log and retain it throughout the run. The ignored backup stays local; a coordinator moving machines must transfer it before resuming. Record issue, agent/pane, owned files, prerequisite SHA, current state, accepted commit/fork SHA, checks/evidence, and next packet. Keep the latest state in the repository; transient pane output is not the sole record. Update after assignment, integration, or a blocker, rather than writing a transcript of every command.

Resume by reading that log, `git status`, both repositories' histories, open PRs, and live Herdr agents. Recover ongoing work before dispatching replacements. Inspect timeouts/stalled prompts before resubmitting: they may have been delivered. Keep partial artifacts and diagnostics. Attempt a focused fix, then simplify within scope or reduce documented limits if the benchmark permits it; do not repeat the same failed approach indefinitely or quietly weaken acceptance criteria.

Herdr maintains terminals and recognizes agent states; it is not itself an issue scheduler or an assurance that this coordinator will keep running after its turn/session ends. The autonomous run needs an active coordinator session. Ending planning does not launch that run. No recurring job, detached scheduler, or notification integration is introduced by this plan.

Escalate only when required information/authority cannot be inferred: inaccessible credentials/services, an actual approval dialog, a distribution/licensing decision, destructive action outside the branch, or a product tradeoff that would change the epic boundary. Continue independent packets while blocked. Report the specific decision and a recommended option once; no routine owner checkpoint between waves.

## Validation and integration gates

Use deterministic fixture tests for numerical/geometry invariants, not implementation-shaped snapshots alone. Begin with hand-authored plane, saddle, narrow-river crossing, steep building footprint and disconnected-entrance cases. Maintain flat countryside, wooded hills, and multi-village river-valley presets. Choose and record fixed seeds rather than cherry-picking only attractive maps. Add infeasible settings and malformed imports.

- **Component gate:** focused tests plus typecheck/build for the changed package; fork packets run its existing compatibility suite plus new placement tests.
- **Terrain gate (A–D):** height/slope tolerances, consistent contours, acyclic drainage, valid cover, repeatable independent streams and bounded excessive requests.
- **Composition gate (E–G):** required villages/farms exist, road network connected, crossings explicit, building/street constraints hold, no orphan joins, canonical replay passes in a fresh process.
- **Authoring gate (H–J):** inspect overview/detail screenshots for all presets; generate → adjust → validate → save → reload → export → replay has the same canonical geometry. Exercise invalid settings, infeasible moves, cancellation, rapid consecutive requests and unsupported versions.
- **Runtime replay gate:** record the exact supported Node version from `.nvmrc` and tested Chromium version in the architecture note. Generate identical recipes and overrides through the Node CLI and browser worker, comparing canonical geometry. If numeric differences occur, implement and document a versioned normalization policy at the generation/serialization boundary and rerun numerical tolerance checks. Do not simply scope reproducibility to one path while both paths generate assets.
- **Resource gate:** benchmark default/maximum sizes and difficult seeds; record generation time, memory measurement method, geometry counts, browser frame time, machine and software versions. Deterministic budgets bound algorithms; worker watchdogs bound user wait and are excluded from canonical data.
- **Integration gate:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, fresh-source setup, fork tests/build, and documented CLI/browser smoke steps. Start servers through `devrun`; discover the installed setup because the referenced `~/CLAUDE.md` is currently absent and `devrun` is not currently on this shell's PATH. Resolve setup before browser smoke tests; continue headless work in parallel. Do not substitute a bare long-running dev command.

The final seed suite should include at least 20 fixed seeds across the three presets, plus analytical and infeasible fixtures. A seed may terminate with a documented bounded infeasibility result where allowed; the representative milestone fixtures must succeed. Export validation must detect invalid content independently of the generator rather than trusting its success flag.

Integrate accepted work in story-sized commits on the feature branch. Use one accumulating epic integration PR from `feat/procedural-battlefield-maps` to `main`, with a story-to-commit/evidence checklist; do not open overlapping story PRs from the same branch. Include exact validation, limitations, and `Closes #...` for each completed story only when its acceptance criteria hold. The fork has its own PR for #138; link that PR and its pinned accepted revision from the epic PR, and verify the tracking story is closed through the Kriegsspiel integration PR rather than assuming cross-repository auto-closure. The coordinator verifies project enrollment/status and records dependencies. Do not merge into `main`, publish a package, or deploy as a side effect of planning; use the authorized delivery scope of the implementation run. Until that scope includes merging, leave PRs ready and issues open. Project `Done` closes issues, so it cannot stand in for review-ready status.

Milestone completion requires the epic's working end-to-end authoring flow and evidence, independent of PR count. Document adapters for later scenario/gameplay work without implementing movement, LOS, hidden-state delivery, objective generation or the player table.

## First implementation dispatch

When implementation resumes, the coordinator inventories dirty work and verifies tool/build prerequisites, then assigns #133 to an implementer and the architecture review to a read-only reviewer. Accept the architecture note and reproducible source strategy before dispatching #134. After the contract gate, proceed through the waves automatically using the defaults and recorded evidence. The owner should receive progress and a final usable result, with intervention reserved for the concrete blockers above.
