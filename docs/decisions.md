# Decision log

Short records of decisions made, why, and what is still open. Newest at the bottom. Detail lives in the linked docs.

## D1: LLM umpire on a server, hybrid adjudication
**Decision.** A deterministic engine owns state, movement, line of sight, combat and dice. The LLM parses free-text orders, makes bounded judgment calls, and narrates per-side reports. It never edits state directly, and dice are rolled by a seeded server RNG.
**Why.** A pure LLM umpire is inconsistent and unauditable (the free-Kriegsspiel failure mode). Related LLM wargaming work also converges on this pattern.
**See.** [design.md](design.md), [research.md](research.md)

## D2: The player's interface is a general's HQ
**Decision.** Players see no HUD or minimap. Everything arrives as paper: dispatches, reports, rosters, a journal. Their map shows only what they or their staff marked.
**Why.** It makes fog of war, stale information and delegation the game, and it matches the original Kriegsspiel.
**See.** [hq-interface.md](hq-interface.md)

## D3: Hybrid rendering: Three.js table + Svelte desk
**Decision.** A Three.js scene with a **flat** historical map on a table and 3D wooden-block pieces, plus a Papers Please-style 2D desk built in HTML/Svelte. Phaser is dropped.
**Why.** The game is mostly documents plus one map. A DOM UI is much better for text and drag-and-drop, and a 3D table gives the physical Kriegsspiel feel. A flat map avoids needing elevation data.
**Alternatives considered.** Phaser, PixiJS, Babylon.js, Godot web export, full 3D room, fully 2D desk.
**Consequence.** The earlier Phaser prototype is abandoned and removed from the repo. The new engine and client are written fresh against the continuous-clock design. (The old code is kept outside the repo as a reference only.)
**Client structure.** `client/src/table/`: `buildSceneState(view, map, facings)` is a pure `SideView` to `SceneState` function; `TableScene` reconciles the Three.js scene to it (idempotent); picking is pieces by mesh raycast, then the map plane. Facing is not yet on the wire, so the client takes it as a side input (default N). Runs from a fixture with no server.
**See.** [hq-interface.md](hq-interface.md), [architecture.md](architecture.md)

## D4: Continuous game clock with an adjustable ratio, not turns
**Decision.** Game time is tied to wall-clock time at a per-game ratio (1:1, 4:1, 12:1, custom). Couriers and battles take real hours at 1:1. The engine is a continuous-time event simulator that never reads the wall clock. Manual-step and fast-forward modes are required, for testing and for optional turn-based play.
**Why.** It makes order lag and delegation real, and one engine supports every pace. An earlier turn-based design with deadlines was superseded.
**Consequence.** An **LLM barrier** stops game time from advancing past an unresolved LLM result. Inputs are logged for deterministic replay.
**Open.** The default ratio is chosen after the first scenario's pacing is measured.
**See.** [architecture.md](architecture.md), [gameplay.md](gameplay.md)

## D5: Pause by unanimous vote
**Decision.** All human players across all sides can vote to pause. One "no" or a timeout cancels it (hosts may allow a majority). A paused game allows reading and drafting, but signed orders dispatch on resume. After server downtime the game restarts paused.
**Suggested, not confirmed.** Emergency hold: a short, limited, single-player clock stop that lapses unless ratified.
**See.** [architecture.md](architecture.md), [gameplay.md](gameplay.md)

## D6: Collaborative play with roles and shared drafts
**Decision.** Each side is a group of roles (commander, chief of staff, intelligence, quartermaster, subordinate commanders). Orders are shared drafts that anyone can propose to and the commander signs and stamps. An LLM staff check shows how a subordinate would read a draft. Empty roles are filled by the LLM.
**Open.** Default hierarchy is assumed to be shared HQ, with chain-of-command as an option. Command level is assumed to be brigades and battalions.
**See.** [gameplay.md](gameplay.md)

## D7: Wire format is zod schemas in `packages/protocol`
**Decision.** Every command and server message carries a version field `v` and is validated with strict zod schemas (unknown fields rejected). Types are inferred from the schemas. The package exports no master-state types.
**Why.** One source of truth for server and client, and strict parsing keeps hidden state from leaking onto the wire.
**See.** [architecture.md](architecture.md), `packages/protocol/README.md`

## D8: Engine world model and scenario data
**Decision.** Game time is an integer count of game milliseconds. The map is a row-major tile grid (open, wood, river, bridge, road). Scenarios are plain JSON-compatible data, and `loadScenario` validates them and builds the initial `GameState` at t=0. "Hold the Bridge" is 40x30 tiles, with 3 units per side. Blue wins by holding the bridge for 180 game minutes, and Red wins by taking it. A test greps the engine sources for wall-clock and ambient-random calls.
**Why.** Integer time keeps replay exact, and validated plain data keeps state JSON round-trippable.
**See.** [architecture.md](architecture.md)

## D9: First scenario (proposed, maintainer to confirm)
**Proposal.** Ball's Bluff, 21 October 1861, recommended over Podol (1866) and Wissembourg (1870).
**Why.** Smallest of the three, the only one with a period map and order of battle already located, public-domain English sources, and a river-crossing bottleneck that exercises couriers and fog of war.
**Map.** Verified for #84: the 1861 Corbett seat-of-war map at the Library of Congress is public domain with no usage terms beyond a credit line. Scan, holder, URL and licence are in `assets/maps/sources.json`.
**Open.** The maintainer has not confirmed. The Lander/Gorman order-of-battle conflict must be checked.
**See.** [scenario-candidates.md](scenario-candidates.md)

## D10: Movement is step events over A* paths
**Decision.** A move order plans an A* path (4-connected, deterministic tie-breaks) from where the unit stands when the order fires, then schedules one `move.step` event per tile, firing when the unit finishes entering it. Costs to enter a tile: road 0.5, open 1, bridge 1, wood 3; river is impassable, so the bridge is the only crossing. Units have a `kind` (infantry, cavalry, artillery) with a march rate in game ms per cost-1 tile (a tile is taken as 100 paces: infantry 1 tile/min, cavalry 3, artillery 2/3). Orders are queued events (`intent.move`, `intent.halt`) so they replay. A newer intent makes pending steps stale (they check the unit's `move` intent `startedAt`), and an interrupted unit stays on the last tile it completed. An order that cannot be carried out (unreachable destination, or an unknown unit, which emits `order.rejected`) is reported and leaves any march already under way alone.
**Why.** Event-driven steps keep quiet marches free and give the same result under any `advanceTo` chunking.
**Open.** A new order replans from the last completed tile, so progress on the tile being entered is lost (re-issuing an order more often than a tile takes would pin a unit in place); carrying over an unchanged first step is future work. A* uses a linear open-list scan, which is fine for small maps; switch to a binary heap if maps or order bursts grow. Units may share tiles for now (no collision or stacking rules yet). Diagonal moves, slopes and pace (march/quick/forced) are not modelled. Rates are a first pass, not the 1824 movement table.
**See.** [architecture.md](architecture.md)

## D11: Orders are couriers carrying intents
**Decision.** An `Order` (id, side, target unit, issue time, original text, parsed `OrderIntent`s) is queued with `issueOrder` as an `order.issue` event. When it fires, a courier route is planned from the side's `hq` (a new `Side` field, validated on passable ground) to where the unit stands, using the same A* as movement; delivery time is the route cost times `COURIER_MS_PER_TILE` (4 tiles/min on open ground, so 8 on roads). An `order.deliver` event fires then and the unit adopts the intent: `move`, `withdraw` (a retreat that marches and then idles) or `hold` (march to the point if elsewhere, then hold). Until delivery, and after it, the unit keeps its standing intent. Orders to a missing, destroyed (strength 0) or enemy unit, or with no courier route, emit `order_failed` with a reason and change nothing; delivery emits `order_delivered`. The unit is checked again at delivery, so a unit destroyed in the meantime also fails.
**Why.** Orders lag by real game time, and everything stays an event, so replay and chunking guarantees hold.
**Open.** `order_delivered` is emitted even if the unit then cannot march (`unit.moveBlocked`, destination unreachable from where it stands); the two events are not linked yet. The courier route is fixed when the order is issued from the unit's position then, not chased as the unit moves, and couriers cannot be intercepted. Only the first parsed intent is adopted; conditional and timed intents, and `attack` (from 1.7), are not yet modelled. Strength 0 stands in for "destroyed" until combat decides how units are removed.
**See.** [architecture.md](architecture.md), [gameplay.md](gameplay.md)

## D12: Visibility is a pure filter over per-side intel
**Decision.** `viewFor(world, side, now)` in `packages/engine/src/visibility.ts` is the only function that turns master state into an `EngineSideView`. A unit sees an enemy within its sight range (infantry and artillery 6 tiles, cavalry 8) when no wood tile lies on the Bresenham line between them; a unit in or looking from a wood sees or is seen only within 2 tiles. A repeating `intel.scan` event (every game minute) records sightings in `GameState.intel[side]` (last-known contacts and reports), and files a contact report the first time an enemy comes into sight. `intel.report` events file unit-lost and order-delivered reports. Every report is delivered `COURIER_DELAY_MS` (10 game minutes) after it happened, and the view shows it with its age. Enemy size is a coarse phrase, never a number. Last-known contacts show the position where the enemy was seen, its age, and an uncertainty radius in tiles that grows one tile per minute of age, capped at the map's longer side.
**Why.** Keeping memory in state makes stale contacts replayable, and one filter function makes the leak tests meaningful.
**Open.** The `EngineSideView` is not yet mapped to the protocol `SideView` (no clock, dispatches or supply); tracked in #109. The courier delay is a flat constant, not distance to HQ. Sight ignores facing, weather and night. Contacts are never pruned, not even for destroyed enemies; tracked in #110.
**See.** [architecture.md](architecture.md)

## D14: Server game actor, scheduler and store
**Decision.** `server/src/game/`: a `GameActor` is the single writer for one game and owns the engine state, a `GameClock` and a serial command queue. Commands (`order`, `setRate`, `pause`, `resume`, `setMode`, `advanceTo`) run in arrival order. Each one first advances the engine to the clock's "now", then applies itself, then saves a snapshot. The scheduler sleeps until the next queued event is due (`clock.wallDueFor`) and re-plans after every command, so rate, pause and mode changes wake it. It sleeps not at all when paused, stopped, in manual mode or with an empty queue; fast-forward jumps to the next event with a zero delay. Orders are parsed through `OrderParser` and the result is awaited before the order enters the engine: the engine is not advanced during the parse, the order is stamped with the game time of signing, and the world catches up afterwards at the same game times. `GameHost` runs many actors in one process; `open` brings a stored game back **paused**. `GameStore` is the persistence seam (latest snapshot plus an append-only input log of commands and parse results); `MemoryGameStore` is the only implementation until SQLite (Epic #2). Timers and the wall clock are injected, so tests run on a fake clock, and `close`/`shutdown` clear every timer.
**Why.** One serial writer gives a total order with no locks, and lazy advancement keeps quiet stretches free.
**Open.** The full LLM barrier is Epic #3: here the clock keeps running during a parse and the engine catches up afterwards, so a slow parse is invisible to game results but not yet shown to players as "staff at work". `attack` intents are refused as not modelled. The snapshot is rewritten after every command and tick; a log-plus-periodic-snapshot scheme is for the SQLite store. The input log is written but replay from it is not built yet. Pause voting is not modelled: `pause` and `resume` are plain commands.
**See.** [architecture.md](architecture.md)

## Open questions
- Default clock ratio (decide after the first scenario).
- Command level and default hierarchy (assumptions above).
- Emergency hold: keep or drop.
- First historical scenario and map source: Ball's Bluff proposed in D9, awaiting maintainer decision; map licence verified (D9).
- How much auto-plotting of reports onto the map players get.
- Rules tables (march rates, frontage, fire, casualties): first pass recorded in `src/data/` with citations (see `docs/rules.md`). Still missing: full movement table, Die 4 row, artillery tables other than 12-pdr 1500-2000, cavalry and artillery frontages.

## D13: UmpireClient wraps the Anthropic SDK behind a transport seam

**Decision.** All LLM calls go through `UmpireClient`. The Anthropic implementation uses structured outputs (`output_config.format` with a JSON schema) rather than forced tool use, which newer models reject. The SDK's own retries are off; the wrapper owns retry, backoff and the per-attempt timeout so behavior is testable with a fake transport. Playback matches recordings on stage, prompt version and input (key order ignored) and fails loudly on a miss rather than calling the model.

**Failure handling.** A `Retry-After` longer than four times `maxBackoffMs` fails the call at once instead of sleeping. Output truncated at `max_tokens` is terminal (retrying the same request would truncate again). A failed call throws `UmpireError` carrying the summed `usage` and `costUsd` of its attempts, so spend on failures is visible, but nothing is recorded for it.

**Open.** The price table in `pricing.ts` is hand-maintained. Recording to the persistent input log is behind the `CallRecorder` interface; the log itself is not built yet. Prompt files and the `OrderParser` adapter that uses this client are separate work. A failed live call leaves no recording, so on replay it surfaces as `missing-recording` rather than the original `schema` or `transport` error; callers must treat all `UmpireError` kinds alike when falling back, or failures need recording too (open).
