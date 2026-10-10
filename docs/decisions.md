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
**Open.** The maintainer has not confirmed. Map licence and the Lander/Gorman order-of-battle conflict must be checked.
**See.** [scenario-candidates.md](scenario-candidates.md)

## D10: Movement is step events over A* paths
**Decision.** A move order plans an A* path (4-connected, deterministic tie-breaks) from where the unit stands when the order fires, then schedules one `move.step` event per tile, firing when the unit finishes entering it. Costs to enter a tile: road 0.5, open 1, bridge 1, wood 3; river is impassable, so the bridge is the only crossing. Units have a `kind` (infantry, cavalry, artillery) with a march rate in game ms per cost-1 tile (a tile is taken as 100 paces: infantry 1 tile/min, cavalry 3, artillery 2/3). Orders are queued events (`intent.move`, `intent.halt`) so they replay. A newer intent makes pending steps stale (they check the unit's `move` intent `startedAt`), and an interrupted unit stays on the last tile it completed.
**Why.** Event-driven steps keep quiet marches free and give the same result under any `advanceTo` chunking.
**Open.** Units may share tiles for now (no collision or stacking rules yet). Diagonal moves, slopes and pace (march/quick/forced) are not modelled. Rates are a first pass, not the 1824 movement table.
**See.** [architecture.md](architecture.md)

## Open questions
- Default clock ratio (decide after the first scenario).
- Command level and default hierarchy (assumptions above).
- Emergency hold: keep or drop.
- First historical scenario and map source: Ball's Bluff proposed in D9, awaiting maintainer decision; licences to verify.
- How much auto-plotting of reports onto the map players get.
- Rules tables (march rates, frontage, fire, casualties): first pass recorded in `src/data/` with citations (see `docs/rules.md`). Still missing: full movement table, Die 4 row, artillery tables other than 12-pdr 1500-2000, cavalry and artillery frontages.
