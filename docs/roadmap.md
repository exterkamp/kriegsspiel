# Roadmap

Gameplay milestones should end in something playable. The standalone map-authoring milestone M3c ends in a usable generation, preview and export workflow; gameplay integration follows separately.

## M0: Foundations (done)
- [x] Earlier Phaser/Vite prototype abandoned and removed from the repo
- [x] Background research and design docs (`docs/`)
- [x] Server stack decided (TypeScript) and workspace set up (`packages/engine`, `packages/protocol`, `packages/maps`, `server`, `client`; lint, typecheck, test, build and CI)
- [ ] Pull real rules tables (march rates, frontage, fire ranges) into data files: a first pass with citations is in `packages/engine/src/data` (`docs/rules.md`); gaps remain (#92)

## M1: Deterministic engine, headless (done; Epic 1 closed)
- [x] Map, units, orders and movement in `engine`, on continuous vector terrain (D15, D10)
- [x] Seeded RNG, event log, replay (`npm run replay -w server`, D14a)
- [x] Unit types: infantry, cavalry, artillery; formations line, column, square, skirmish and loose (`unitTypes.ts`)
- [x] Line of sight and per-side visibility function
- [x] Combat v1 with ranged fire and melee, fractional casualties, morale, supply and fatigue (D13)
- [x] A scripted two-side scenario ("Hold the Bridge") plays headless to a result in tests (`server/src/game/endToEnd.test.ts`); there is no standalone CLI that prints the event log, only `npm run replay`
- [x] Event queue and `advanceTo(t)`; the engine never touches the wall clock
- [x] `GameClock` with rate, pause and re-anchoring; manual, fast-forward and real-time modes
- [x] Tests: identical outcomes at rates 1, 4, 12, 1000 and fast-forward; pause/resume is neutral (`clockInvariance.test.ts`)

## M2: LLM umpire v1 (order parsing + narration) (mostly done)
- [x] Umpire service with structured output schemas, on any provider through adapters: Anthropic, OpenAI-compatible, Ollama (D14); the compose file can run a local Ollama umpire (#326)
- [x] `parseOrders`: free text to intents, with clarification/rejection for impossible orders (`LlmOrderParser`, with the rule-based stub as fallback; the golden corpus and eval harness are in `docs/order-eval.md`)
- [x] `narrate`: fog-filtered field reports per side, run by the game actor once per side per window (D14, "Narrate in the actor")
- [x] Prompt-injection and leak test suites: `leak.test.ts` (#44) and `injection.test.ts` (#350)
- [x] Record LLM calls for audit (debug trace store, Epic 8; recorded outputs make replay need no model call)

## M3: Playable game, remote (done; Epic 1 and the server half of Epic 5)
- [x] Server: per-game actor, scheduler, persisted input log (JSON lines or SQLite with snapshots), LLM barrier, crash recovery (D14, D14b)
- [x] Server with game, orders, pause, ratio and window API over WebSocket and REST (D16)
- [x] Client sends orders as text, receives side-filtered state, reports and narrative
- [x] Courier delays, lost or garbled orders, report-driven map with stale last-known contacts (D11, D12)
- [x] One handcrafted scenario, "Hold the Bridge", playable start to finish in a browser: a game ends at about game minute 40 with orders, or runs the 50 minute hold (D35)

## M3b: HQ interface (see [hq-interface.md](hq-interface.md))

[HQ implementation plan](hq-implementation-plan.md) defines dependency gates, agent ownership, Herdr orchestration, model selection and end-to-end acceptance for Epic 4.

- [x] **Spike:** Three.js table with a flat map plane, block pieces, camera orbit/zoom and picking, and a desk screen over it
- [x] Map table: vector base map + 3D pieces + player marks layer (Three.js, D16b)
- [x] In-tray, orders desk, order of battle, journal and staff conference as Angular views over the canvas; table to desk transition. The client was Svelte until D29 and is now Angular 22 (signals, zoneless)
- [x] Reports carry structured data (place, size, confidence, time) beside the prose
- [x] Visual design system: tokens, shared controls and a style guide at `/style-guide` (#327, `docs/hq-interface.md`)
- [ ] First historical scenario: hand-annotated map feeding the engine's vector terrain features
- [ ] Decide on an annotation editor for future maps

## M3c: Procedural battlefield maps

[Milestone](https://github.com/exterkamp/kriegsspiel/milestone/1) · [Epic 9 #132](https://github.com/exterkamp/kriegsspiel/issues/132) · [SettleMaker fork](https://github.com/dfezzie/settlemaker)

[Implementation and agent execution plan](map-implementation-plan.md) defines module boundaries, algorithms, configurable defaults, Herdr work packets, validation gates and recovery. The owner resumed implementation on 2026-10-10; [the execution log](map-execution-log.md) records the active coordinator, assignments and accepted gates.

**Goal.** Generate, inspect, adjust, validate and export reproducible countryside maps with topography, woods, fields, rivers, connected roads, explicit crossings, villages, farms and building footprints. This milestone covers planning stages 1–5 and ends with a usable map-authoring workflow; gameplay integration is separate. Implementation proceeds through the dependency gates and ends in review PRs without merge or deployment.

**Owner decisions.** SettleMaker is the preferred settlement foundation. Use a high-level top-down map with simple building footprints; bespoke building artwork is unnecessary. Plan this as its own milestone before continuing implementation.

**Assumptions to settle in 9.1.** Initially target temperate battlefields about 5–15 km across with several villages. Confirm map size, elevation resolution, maximum road/building grades, resource budgets and limited preview-edit controls. These are planning assumptions, not owner-approved specifications or delivery-date estimates.

### Stories and dependencies

Sizes are relative scope, not estimates in hours. Each issue contains concrete scope, failure cases, acceptance criteria and implementing-agent instructions. All ten stories are native sub-issues of Epic #132 and assigned to the milestone.

| Story | Deliverable | Size / primary area | Depends on |
| --- | --- | --- | --- |
| [9.1 #133](https://github.com/exterkamp/kriegsspiel/issues/133) | Assess SettleMaker and define the fork architecture | M / docs | None |
| [9.2 #134](https://github.com/exterkamp/kriegsspiel/issues/134) | Define the versioned battlefield map contract | M / engine | #133 |
| [9.3 #135](https://github.com/exterkamp/kriegsspiel/issues/135) | Generate seeded elevation and contour geometry | L / engine | #134 |
| [9.4 #136](https://github.com/exterkamp/kriegsspiel/issues/136) | Generate drainage rivers and land cover | L / engine | #134, #135 |
| [9.5 #137](https://github.com/exterkamp/kriegsspiel/issues/137) | Plan settlement sites and connecting roads | L / engine | #134, #135, #136 |
| [9.6 #138](https://github.com/exterkamp/kriegsspiel/issues/138) | Make SettleMaker placement respect battlefield terrain | L / engine | #133, #134, #135, #136, #137 |
| [9.7 #139](https://github.com/exterkamp/kriegsspiel/issues/139) | Assemble validate and export complete battlefield maps | M / engine | #134, #136, #137, #138 |
| [9.8 #140](https://github.com/exterkamp/kriegsspiel/issues/140) | Render a readable topographic map preview | M / client | #134, #135, #139 |
| [9.9 #141](https://github.com/exterkamp/kriegsspiel/issues/141) | Add generation controls adjustments and saved maps | M / client | #139, #140 |
| [9.10 #142](https://github.com/exterkamp/kriegsspiel/issues/142) | Verify the end-to-end map milestone and document handoff | M / infra | #135, #136, #137, #138, #139, #140, #141 |

### Architecture and delivery checkpoints

Keep battlefield generation, settlement planning and rendering/export separate. A single local metre frame aligns all geometry. Elevation, land cover and infrastructure are independent layers: roads may cross woods without removing them. An internal sampled height field must not impose a public gameplay tile grid. [Story 9.1 assessment](map-architecture.md) selects the physical village planner and pins the assessed source; #138 must add numerical terrain constraints and exact joins before composed geography is accepted. The initial uncommitted experiment is not accepted implementation.

1. **Contract and terrain checkpoint (9.1–9.4):** validate the saved map contract, numerical elevation, contours, drainage and land cover with analytical and fixed-seed fixtures.
2. **Composed geography checkpoint (9.5–9.7):** one hillside village, then several villages linked across a river valley; validate buildings, road entrances, crossing geometry and network connectivity.
3. **Authoring checkpoint (9.8–9.10):** inspect overview/detail, adjust within the agreed scope, save/load/export and reproduce the geometry from versioned settings and overrides. Measure generation resources and preview responsiveness at the supported scale.

### Done when

- [ ] An author can generate, inspect, adjust, validate, export and reload a map with identical canonical geometry.
- [ ] Flat, wooded/hilly and river-valley fixtures contain connected villages and farms, explicit crossings, and buildings/roads that satisfy configured water and slope constraints.
- [ ] The map preview and exported data align in metres, with readable contours, names and scale at battlefield and village zoom levels.
- [ ] Saved assets record seed, versions, parameters and overrides; invalid or infeasible generation produces actionable, bounded diagnostics.
- [ ] Fork setup/source distribution, supported limits, measured performance and the gameplay handoff are documented; appropriate checks pass.

### Boundaries and related work

[Story #90](https://github.com/exterkamp/kriegsspiel/issues/90) retains full procedural scenario assembly, objectives, balanced orders of battle and headless balance/completion checks; it consumes this milestone's map assets. Scenario loading (#86), elevation-based movement/visibility and in-game rendering are outside M3c. Coordinate with continuous-space migration #113 (PR #131 is currently open), movement #114/#130, visibility #115 and vector table rendering #118/#129. Those issue numbers identify integration seams, not additional prerequisites for the standalone authoring workflow. Implementation must recheck their current state before gameplay integration.

Historical annotation remains #85/#88. Detailed erosion, elaborate cities, a full terrain-painting editor, seasonal hydrology and multiplayer authoring are excluded. Epics/stories remain open until their acceptance criteria hold; the epic requires end-to-end validation even if all component PRs have merged.

## M4: Judgment and personality
- [x] `judge` placement: arbitrary unit configurations validated by the engine (#117)
- [ ] `judge` stage with capped modifiers for unruled situations; case-law file
- [ ] Subordinate commander traits
- [ ] Rigid ↔ free dial; umpire personas
- [ ] Post-game reveal (full log, dice, rulings)

## M4b: Standing orders and critique
- [ ] Conditional and timed orders in the intent schema
- [ ] Post-game critique generation

## M5: Remote async play and collaboration
- [x] Accounts (magic-link login, sessions, seats; D17)
- [x] Lobbies and guest play (no email needed, D17a, D17c), clock ratio chosen in the lobby (1:1, 4:1, 12:1, custom), mid-game ratio change by vote (`ratioVote.ts`)
- [ ] Pause voting (server state machine and desk pause panel done; WebSocket wiring is #182), emergency hold, resume rules, safe restart after downtime
- [x] Notifications (WebSocket, web push, email) with per-player thresholds (D17b)
- [ ] Deputy mode: LLM staff officer acting within standing orders
- [ ] Roles per side, with LLM filling empty staff roles
- [ ] Shared order drafts: comments, tracked edits, sign and stamp, LLM staff check (server side: D6d)
- [ ] Shared HQ and chain-of-command modes
- [x] AI opposing commander (fog-respecting)
- [ ] Full procedural scenario assembly (objectives, orders of battle, balance); consume generated maps from M3c

## Later
Campaigns, multi-player per side, spectators, voice orders.

## Next
Epic 1 is closed. The work queue is tracked in the GitHub project and the open epics; the main gaps are shared drafting and roles (Epic 6), historical scenario content (Epic 7), pause voting over the WebSocket (#182), and the LLM-injection test suite.
