# R1 independent battlefield contract review

**Verdict: Accepted for the chunk 1 default-only metadata prerequisite. No blocking findings.** This verdict permits dependent UI work against this descriptor; it does not accept the completed chooser, alternative pairing creation, storage, rendering agreement, or the whole feature/PR.

## Frozen source and scope

- Review date: 2026-10-14. Independent reviewer: the assigned R1 review agent, separate from the metadata author. Native model/effort settings were not independently verified through Herdr.
- Checkout: `/Users/dominic/code/kriegsspiel-game-init-landing`.
- Candidate H: `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Accepted base B and merge-base M: `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`.
- Candidate tree: `ee778d9f42f6f14e007e69c231102c3c964c8997`.
- Base tree: `86cbd309c8c88eebfac8957089a4b6741f81b3fc`.
- HEAD equalled H and the checkout was clean at initial and intermediate checks. Final verification still matched H for all product paths, with this report untracked and a concurrent modification to `docs/lobby-map-selection-execution-log.md`. That log delta was read and preserved; its new snapshot/build claims are outside this review's evidence. No fetch, checkout, commit, source edit, dependency install, preview operation, permission change, or agent creation was performed by R1.
- Reviewed the local committed H-versus-B metadata diff and surrounding callers. Author statements in the execution log were context, not validation evidence. No remote head or CI result was verified.

The complete B-to-H inventory also contains the approved UX design and its illustration assets from the preceding design commit. This packet reviews the metadata contract and its integration boundaries, not the illustration generator or a new visual-design acceptance. The sole authorized durable output is this report; it is outside H and must not be mistaken for a report committed in its own reviewed revision.

## Inspected paths

| Paths | Inspection |
| --- | --- |
| `AGENTS.md`, `docs/decisions.md` (especially D7/D8/D41/D43), `docs/lobby-map-selection-execution-log.md`, `docs/lobby-map-selection-ux-design.md`, `docs/lobby-map-selection-ux-design/inspection.md` | Repository rules, approved behavior, packet boundary and historical evidence limits. |
| `packages/protocol/src/battlefield.ts`, `packages/protocol/src/index.ts` | Entire DTO, public export, geometry units and absence of engine imports/master types. |
| `server/src/game/battlefield.ts`, `server/src/game/battlefield.test.ts`, `server/src/game/registry.ts`, `server/src/game/registry.test.ts`, `server/src/api/battlefield.test.ts` | Complete implementation/diff, identity hashing, projection, registration and assertions. |
| `packages/engine/src/scenario.ts`, `packages/engine/src/scenarios/holdTheBridge.ts`, `packages/engine/src/types.ts` (terrain declarations), `packages/engine/src/terrain.ts` | Validated effective scenario, actual coordinates, feature shapes, widths/radii and layer precedence. |
| `server/src/api/app.ts` (CreateGame, `/scenarios`, creation, start, side/role resolution), `server/src/api/lobby.test.ts` (existing setup/flow) | HTTP serialization, authentication and unchanged scenario-only creation path. |
| `server/src/game/host.ts` (create/open), `server/src/game/store.ts` (persistence declarations), `server/src/game/replay.ts`, `server/src/game/replay.test.ts`, `server/src/game/replayCli.ts`, `server/src/admin/replayView.ts` (replay loading/calls) | Header/snapshot and replay inputs; no new metadata dependency. |
| `client/src/legacy/shell/newGame.ts`, `client/src/legacy/shell/newGameApi.ts`, `client/src/app/shell/shell-api.ts`, `client/src/app/shell/new-game.component.ts` | Scenario transport, existing form types/defaults, creation request and component consumption. |
| Root/server/protocol package scripts, server/client Vitest configs, root/server/protocol TypeScript configs | Check selection, source aliases and non-emitting verification. |

All changed product files in the metadata candidate are covered above. Design PNG/SVG files and `render_wireframes.py` were inventoried, not independently rendered or visually validated in R1.

## Contract assessment

**Terrain fidelity.** The registry calls `loadScenario` on the same `holdTheBridge` definition used by `loadScenarioById`. The preview projects every validated feature, preserving IDs, kinds, names, layers and array order. Coordinates, full polyline widths and point radii divide engine millimetres by 1000 without coordinate inversion. Independent assertions compared all five features, including both asymmetric woods, the 20 m road at x=2050, the 200 m river at y=1500 and the 110 m bridge radius at (2050,1500). Extent is the actual 4000 × 3000 m scenario, not the standalone local-board map. The three geometry variants cover the current engine terrain model. Consumers must honor layer precedence and width-versus-radius semantics when drawing; this packet does not verify an actual renderer.

**Immutable identity and initial-scenario binding.** The terrain hash covers the complete loaded `TerrainMap`, including gameplay attributes and optional crossing/road data, rather than the public projection. Recursive object-key sorting makes key insertion order irrelevant; array order remains significant. The versioned SHA-256 strings are full digests. The scenario/pairing revision hashes the entire loaded initial world, so armies, HQs, objective/victory settings and seed participate. Display renaming does not change that binding. This identifies normalized effective engine data, not original JSON bytes or an engine executable version. The existing caller supplies a freshly validated initial world; see N2 for the helper's narrower guard.

`map.id` and `pairing.id` are stable logical default IDs, not content addresses. Consumers must retain the revisions/terrain identity when exact identity matters. Reusing `scenarioRevision` as the default pairing revision is sufficient here because that world includes its terrain. It supplies no assembly/conversion version or historical resolution service for future alternative maps.

**Privacy.** The implementation constructs fresh allowlisted objects at every preview/geometry/point level. It does not spread world or feature objects into the DTO. The public shape contains geography labels, dimensions and opaque hashes; it omits units, sides/HQs, observations, objectives, terrain attributes, road class, crossing capacity and ford risk. Hashing private initial inputs does not serialize those inputs. Current authored terrain IDs/names were inspected and contain only geographic descriptions. Returned geometry is detached in both directions; TypeScript `readonly` is not runtime freezing, but mutating a response does not mutate the source scenario. This is a specific public-geography projection under D43, not a route for general master state.

**Compatibility.** `/scenarios` gains one additive property per scenario; existing fields and top-level capability flags remain intact. The current client transport preserves the returned scenario objects and does not strictly reject extra keys. Its `ScenarioInfo` declaration still lacks the new property, so the coordinator must update that type for UI integration. Existing form submission builds the same scenario-only request. Authenticated injection verified immediate game creation and waiting-lobby creation; the live world's terrain hash matched the advertised default. Strict CreateGame parsing still rejects `map`, `pairing` and `battlefield` input fields. This endpoint is descriptive, not new map-selection authorization.

Creation still loads by scenario ID. The host writes scenario ID/seed/settings to the log header; snapshot reopening restores serialized engine state. CLI/admin full replay still loads the registered scenario by header ID. None consumes this descriptor. These unchanged paths preserve current behavior, but a descriptive hash alone does not pin historical scenario revisions across future authored changes. No later pairing persistence/reopen/readiness claim follows from this review.

**Performance and DTO limits.** The current public descriptor measured **1492 UTF-8 bytes**, and the complete default `/scenarios` response measured **1935 bytes**, with five features and thirteen point entries. Projection/hash/load work runs synchronously each time `scenarioList()` is called, including existing create-validation calls. For this fixed small registered scenario, the inspected work and measured payload give no blocker. This is not a load benchmark or a guarantee for arbitrary maps; see N1.

**Minimal chunk 1 sufficiency.** The DTO supplies everything needed for an actual-default summary, extent, geography preview, default-only candidate/Use no-op and truthful unavailable-Add explanation. The scenario name/public briefing already travel alongside it; no army composition disclosure needs inventing. `capabilities.addMaps` is explicitly false, with no catalog/local-board import or generated-map certification claim. Chunk 1 still needs client type/integration work and desktop/390/320 browser evidence for focus, cancellation, form preservation and absence of create/auth/WebSocket side effects from Choose/Add/View. None of that UI acceptance is established here.

## Findings

**Blocking: none within R1's frozen default-only contract scope.**

**N1 — Nonblocking: no general DTO/work bounds or runtime schema.** `battlefield.ts` defines interfaces, while the producer maps the whole feature list and hashes the complete initial world on every call. There are no explicit maximum feature/vertex/name/response-byte limits, and the existing scenario parser has no such upper bounds. The only current producer is trusted fixed authored data of the small measured size above. Before using this contract for large catalogs, imports or owned maps, the coordinator must define/enforce input and response work/size budgets and runtime boundary validation; caching a validated static descriptor may then be appropriate. Do not advertise this candidate as meeting those future limits.

**N2 — Nonblocking: `time === 0` is a guard, not initial-state provenance.** `describeDefaultBattlefield` accepts `GameState` and checks only its time. A changed or otherwise noninitial world at time zero can therefore receive a descriptor. The only production caller reviewed constructs a fresh `loadScenario(raw)` inside the registered scenario list, so this does not create a present approval bypass. Keep the helper internal to trusted scenario registration; before reusing it as an approval API, require validated assembly/provenance and explicit version semantics. No generated or caller-supplied world is approved by this review.

Both follow-ups belong to the existing coordinator's later contract/assembly work. Neither requires expanding the chunk 1 UI packet or changing its current creation request.

## Checks actually run

All checks used Node **v22.23.3** at `/private/tmp/game-init-landing-node/node_modules/node/bin/node` against clean H product source. Vitest used `--no-cache --configLoader runner`; no dependency reconciliation or build was performed.

| Working directory / command | Result |
| --- | --- |
| `server`: Node + `../node_modules/vitest/vitest.mjs run src/game/battlefield.test.ts src/api/battlefield.test.ts src/game/registry.test.ts src/game/replay.test.ts --no-cache --configLoader runner` | 4 files, **18 tests passed**. API used in-process injection; replay tests include temporary-file fixtures, not production storage. |
| `packages/protocol`: Node + `../../node_modules/vitest/vitest.mjs run --no-cache --configLoader runner` | 3 files, **81 tests passed**. Existing protocol suite; it does not add runtime validation for this interface-only DTO. |
| `client`: Node + `../node_modules/vitest/vitest.mjs run src/legacy/shell/newGame.test.ts src/legacy/shell/newGameApi.test.ts --no-cache --configLoader runner` | **1 file, 15 tests passed**. Only `newGame.test.ts` exists/matched; there was no separate API test suite to count. |
| `server`: Node + `../node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed. |
| `packages/protocol`: Node + `../../node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed. |
| Root: independent inline Node/assert source probes using in-memory TypeScript transpilation/module hooks, without emitted files | Passed complete geometry/allowlist and registry agreement; recursive key-order stability; feature-array-order sensitivity; identity changes for cover/layer/coordinate/roadClass/capacity; pairing changes for seed/HQ/unit coordinate/formation/victory duration/objective; response-to-source detachment; display-rename stability; nonzero-time rejection. These are in-memory sensitivity probes, not acceptance of the modified worlds as playable scenarios. |
| Root: independent inline Fastify injection/assert probes with memory stores and captured test mailer | Passed repeated identical anonymous GET/no Set-Cookie; exact serialized descriptor agreement; authenticated rejection of three unsupported map/pairing fields; scenario-only lobby and live creation; live terrain identity agreement. No network listener, external mail, existing game or preview was used. |
| `git diff --check B H` | Exit 2 for four deliberate Markdown two-space line breaks in the approved design, lines 40–43. No product whitespace errors reported; not a contract blocker. |

An initial combined inline probe completed its geometry/identity assertions but failed its API rejection assertion with 401 rather than 400 because the review harness indexed a string Set-Cookie header as an array. The harness was corrected to handle either header representation; the separate geometry and API probe reruns above passed. This was a reviewer harness error, not a candidate finding. Ordinary source discovery also encountered two nonexistent guessed log filenames; the actual persistence declarations were then inspected in `server/src/game/store.ts`.

Root lint/typecheck/test/build, Angular component tests, real browser interaction, headless alternative-map completion, durable owned storage and CI were **not run** by R1. Author-reported results are not substituted for those missing checks. Passing focused tests does not establish complete product or PR readiness.

## Coordinator handoff

`HERDR_ENV=1` was verified and the installed Herdr CLI help/agent syntax was read under the [Herdr skill](/Users/dominic/.agents/skills/herdr/SKILL.md) and [Herdr PR review skill](/Users/dominic/.codex/skills/herdr-pr-review/SKILL.md). `herdr agent list` failed with `PermissionDenied: Operation not permitted`. No escalation, prompt, focus change, pane mutation or message delivery was attempted after that failure. Direct reporting to `lobby-map-ux` is therefore unavailable from this session; this durable file and the final response are the handoff. No public review was published.

The coordinator can freeze this H interface for W1's default-only component while retaining ownership of integration and later pairing/storage contracts. A changed product revision requires delta review; this acceptance is bound to H above.
