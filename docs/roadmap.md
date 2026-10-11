# Roadmap

Each milestone should end in something playable.

## M0: Foundations (now)
- [x] Earlier Phaser/Vite prototype abandoned and removed from the repo
- [x] Background research and design docs (`docs/`)
- [ ] Decide server stack (TypeScript recommended) and set up workspace (`packages/engine`, `server`, `client`)
- [ ] Pull real rules tables (march rates, frontage, fire ranges) into data files

## M1: Deterministic engine, headless
- [ ] Map, units, orders and movement in `engine`, written fresh against the event-queue design
- [ ] Seeded RNG, event log, replay
- [ ] Unit types: line infantry, skirmishers, cavalry, artillery; formations (column/line)
- [x] Line of sight and per-side visibility function
- [ ] Combat v1 with simple fire + melee tables, fractional casualties, morale
- [ ] CLI to run a scripted two-side scenario and print the event log
- [ ] Event queue and `advanceTo(t)`; the engine never touches the wall clock
- [ ] `GameClock` with rate, pause and re-anchoring; manual, fast-forward and real-time modes
- [ ] Tests: identical outcomes at rates 1, 4, 12, 1000; pause/resume is neutral

## M2: LLM umpire v1 (order parsing + narration)
- [ ] Umpire service with structured output schemas
- [ ] `parseOrders`: free text → intents, with clarification/rejection for impossible orders
- [x] `narrate`: fog-filtered field reports per side from the validated event list (`narrateReports`; not yet run by the scheduler, see D14 Open (narrate))
- [ ] Prompt-injection and leak test suites
- [ ] Record all LLM calls for audit

## M3: Two-player hot-seat game
- [ ] Server: per-game actor, scheduler, persisted event queue, LLM barrier, crash recovery
- [ ] Server with game/turn/orders API
- [ ] Client sends orders as text, receives side-filtered state + narrative
- [ ] Courier delays, lost/garbled orders, report-driven map (stale contacts)
- [ ] One handcrafted scenario, playable start to finish

## M3b: HQ interface (see [hq-interface.md](hq-interface.md))
- [ ] **Spike:** Three.js table with a flat map plane, a few block pieces, camera orbit/zoom and picking; plus one Svelte desk screen with a draggable report that places a pin on the table
- [ ] Map table: flat historical base map + 3D pieces + player marks layer (Three.js)
- [ ] In-tray, orders desk, order of battle, journal as Svelte views over the canvas; table ↔ desk transition
- [ ] Reports carry structured data (location, size, confidence, time) beside the prose
- [ ] First historical scenario: hand-annotated map feeding the engine's vector terrain features
- [ ] Decide on an annotation editor for future maps

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
- [ ] Lobbies, clock ratio chosen in the lobby (1:1, 4:1, 12:1, custom), mid-game ratio change by vote
- [ ] Pause voting (server state machine done in #63; WebSocket wiring and client pending), emergency hold, resume rules, safe restart after downtime
- [x] Notifications (WebSocket, web push, email) with per-player thresholds (D18)
- [ ] Deputy mode: LLM staff officer acting within standing orders
- [ ] Roles per side, with LLM filling empty staff roles
- [ ] Shared order drafts: comments, tracked edits, sign and stamp, LLM staff check
- [ ] Shared HQ and chain-of-command modes
- [ ] AI opposing commander (fog-respecting)
- [ ] Scenario editor / procedural scenario generator

## Later
Campaigns, multi-player per side, spectators, voice orders.

## First concrete steps (suggested next session)
1. Confirm stack: TypeScript monorepo with `engine`, `server`, `client`.
2. Port `TurnSystem`, `OrderSystem`, `Pathfinding`, map data into `engine` with tests.
3. Define the `Intent` schema and write 20-30 sample orders as the parsing test corpus.
4. Spike the `parseOrders` LLM call against that corpus to measure accuracy and cost.
