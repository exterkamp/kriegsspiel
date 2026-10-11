# Architecture (proposed)

The server runs a **continuous-time event simulation**. The game clock is tied to wall-clock time at a configurable ratio (1:1, 4:1, 12:1, any value), can be paused by player vote, and can be driven manually or run flat out for tests. "Turns" are not a core concept. A turn-based game is just a clock that only advances when told to.

```
┌────────────┐  commands (orders,   ┌───────────────────────────────────────────────┐
│ Client A   │  votes, drafts)      │ Game server (one actor per game)              │
│ Three.js + │ ───────────────────► │                                               │
│ Svelte     │ ◄─────────────────── │  API / WebSocket ─► Command queue (serial)    │
└────────────┘  fog-filtered views, │                          │                    │
┌────────────┐  clock state,        │   ┌──────────────────────▼────────────────┐   │
│ Client B   │  dispatches          │   │ Scheduler  ◄── GameClock (rate, pause)│   │
└────────────┘                      │   │   │                                   │   │
                                    │   │   ▼ pops next event ≤ game "now"      │   │
                                    │   │ Engine.advanceTo(t)  (pure, seeded)   │   │
                                    │   │   │            ▲                      │   │
                                    │   │   ▼            │ results (barrier)    │   │
                                    │   │ Umpire service (LLM, async):          │   │
                                    │   │   parse · judge · narrate             │   │
                                    │   │   │                                   │   │
                                    │   │   ▼                                   │   │
                                    │   │ Visibility filter ─► per-side views   │   │
                                    │   │ Notifier (push/email/WebSocket)       │   │
                                    │   └──────────────────────┬────────────────┘   │
                                    │                          ▼                    │
                                    │   SQLite/Postgres: event log, snapshots,      │
                                    │   per-side views, LLM I/O log, clock history  │
                                    └───────────────────────────────────────────────┘
```

## Core idea: game time is the only time the simulation knows

The engine never reads the wall clock. It takes a game time `t` and advances the world to it. The server decides *which* `t` to advance to, based on the clock. That separation gives us:

- every rate (1:1, 4:1, 12:1, custom) with the same code
- pauses without special cases (game time just stops)
- fast, deterministic tests (advance to any `t` instantly)
- replay from a log of inputs

## The game clock

```ts
type ClockState = {
  gameMsAtAnchor: number;   // game time when the anchor was set
  wallMsAtAnchor: number;   // wall time when the anchor was set
  rate: number;             // game seconds per wall second: 1, 4, 12, ...
  status: 'running' | 'paused' | 'stopped';
};
// running: gameNow = gameMsAtAnchor + (wallNow - wallMsAtAnchor) * rate
// paused:  gameNow = gameMsAtAnchor
```

Changing the rate or pausing **re-anchors** the clock at the current game time, so game time never jumps. Every clock change is logged with its wall time.

Implemented in `server/src/clock.ts` (`GameClock`, with an injected wall-time source). `wallDueFor(gameMs)` and `gameMsAtWall(wallMs)` convert in both directions for the scheduler. `wallDueFor` is `Infinity` when paused or manual, and "now" in fast-forward.

Clock modes (all required, since tests need them):

| Mode | Behaviour | Used for |
|---|---|---|
| **Real-time** (rate = 1) | Game time equals wall time (optionally offset so game night matches local night) | Serious long campaigns |
| **Accelerated** (rate = 4, 12, any) | Game time runs faster than wall time | Weekend and evening games |
| **Manual / stepped** | Advances only when told: `advanceTo(t)`, `step(dt)` | Unit tests, debugging, turn-based games |
| **Fast-forward** | Runs events as fast as the CPU allows until a target | Replay, simulation tests, balance runs, AI-vs-AI soak tests |

## Scheduler and event queue

- **Event queue**: a priority queue keyed by game time, persisted. Events include order dispatched, courier arrives, unit reaches waypoint, contact begins, combat tick, scheduled/timed orders, weather changes, and report delivery.
- **Scheduler**: sleeps until the next event is due in wall time: `wallDue = wallAnchor + (eventGame - gameAnchor) / rate`. It wakes early whenever the queue, the rate or the pause state changes. When running, it advances the engine through each due event in order.
- **Lazy simulation**: when a player command arrives, the server first advances the world to "now", then applies the command. Quiet stretches cost nothing.
- **Combat ticks**: while units are in contact, the engine schedules short ticks (every 2 game minutes in the engine, see D13) so a fight resolves in finer steps. Outside contact it jumps between events.
- **Event ordering (implemented in `packages/engine`)**: events fire in ascending `(time, seq)`. `seq` is a per-game counter assigned at scheduling, so same-instant events fire in the order they were scheduled. `advanceTo(state, t)` fires every event with `time <= t` (including ones handlers schedule for `<= t` during the call), then sets the clock to `t`. Scheduling before the current time is an error. Chunking `advanceTo` never changes the result. State (clock, RNG, queue, `nextSeq`, world) is plain JSON for snapshots. Handlers are registered by event type in an `EventRegistry`; all dice come from the seeded RNG passed to the handler.
- **Single writer per game**: each game runs as one serial actor, with a command queue. Commands are applied in arrival order. No locks and no races, and the log is a total order. Many games can share a process.
- **Implemented in `server/src/game`**: `GameActor` (queue, scheduler, snapshot after every command), `GameHost` (many games, reopen paused), `GameStore` with `MemoryGameStore`. Timers and wall time are injected for tests. See D14.

## The LLM barrier

LLM calls take real seconds, and game time keeps flowing. At high rates, a short courier trip can complete before the order has been parsed. To keep the simulation correct:

- Work that depends on an LLM result is recorded as a **pending dependency** with the game time at which it is needed (for example, the time the subordinate receives and reads the order).
- Parsing starts at issue time, in the background, while the courier travels.
- The engine **does not advance past an unresolved dependency**. The effective game time is `min(clockNow, earliestPendingDependency)`. If the LLM is slow, game time briefly stalls, the clock re-anchors when the result arrives, and the client shows a short "staff at work" indicator.
- Under normal use the parse finishes long before the courier arrives, so the barrier rarely engages. It exists so correctness doesn't depend on timing.
- Implementation: `GameClock.setBarrier(t)` holds game time at `t`; lifting or raising it re-anchors the clock, so game time resumes where it stopped. The actor keeps the registry of pending dependencies, sets the barrier to the earliest, and emits a `staffAtWork` message when the set changes. Today the only dependency is an order parse, needed at the signing time (the addressee comes from the parse), so a parse stalls game time for its duration; the architecture above (parse overlapping the courier ride) needs addressing split from intents.
- LLM failures retry, then fall back to a conservative interpretation ("unit holds and awaits clarification") and log it.

## Pause and voting

A pause stops game time. It is a game-wide state machine:

```
running ──request──► pause_proposed ──all humans yes──► paused ──resume vote──► running
                          │                                │
                          └── timeout / any no ─► running   └── pause timeout (optional) ─► running
```

- **Voters** are all human players in the game, across all sides.
- **Proposals** show who asked and an optional reason ("someone at the door"). Votes are yes or no, and any no (or a timeout) cancels the proposal. Hosts can set whether a majority is enough instead.
- **Resume** needs all humans to mark themselves ready, or a host-set maximum pause length after which the game resumes on its own.
- **While paused**, players can read reports, write drafts and sign orders. Newly signed orders are stamped with the paused game time and the courier leaves when the clock resumes, so nothing new is learned and a pause cannot be used to gain information.
- **Emergency hold** (suggested): any single player can call a short hold of a few wall-clock minutes, a limited number of times per game, which ends on its own unless ratified by a vote. This avoids a stuck game when a real emergency comes up and others are away.
- **Server downtime**: if the server was down, the game resumes **paused** and asks the players to confirm. We never silently skip game time. The downtime is recorded in the journal as a `restart` entry and players get a notice when they connect.
- A **ratio change** is voted on the same way (`proposeRate`, `rateVote`): the same voters and rules, one open proposal, and on a pass the clock re-anchors at the current game time before the new rate applies.
- **On the wire**: `proposePause`, `proposeResume` and `vote` commands; `pauseState` and `pauseResult` server messages (see D14). A voter who is offline does not block forever: the proposal times out and cancels.
- All pauses and votes are recorded in the journal, and the post-game critique can mention them.

## Components

- **Engine** (`packages/engine`): pure, deterministic, no network or clock access. Continuous-space map (vector terrain features in metres, no grid, see D15), units with free position, facing and footprint, orders-as-intents, movement (visibility-graph routes played out as per-leg step events, formation-aware crossings, umpire placement validation, see D10), courier-delivered orders (D11), line of sight, combat, morale, supply, seeded RNG, and `advanceTo(t)`. Fully unit-tested.
- **Umpire service**: wraps the LLM with strict JSON schemas (tool use / structured outputs). Stages: `parseOrders`, `judge`, `narrate`, plus the staff-check, staff-conference and deputy calls. Prompts are versioned files. Results are recorded.
  The parse seam is the async `OrderParser` interface in `server/src/orders/orderParser.ts`: `parse(orderText, context)` resolves to intents, a clarification request or a rejection, and always carries the original wording. The server depends on the interface only; a rule-based `StubOrderParser` stands in until the LLM umpire exists. Parsers are scored against a golden corpus by the harness in `server/src/orders/eval`, see [order-eval.md](order-eval.md).
  The model seam is `UmpireClient` in `server/src/umpire/` (`call(request)` returns schema-validated output plus a call record). It is provider-agnostic (D14, [llm-providers.md](llm-providers.md)): `ProviderUmpireClient` routes each stage to a configured `{provider, model, params}`, sends it through an `LlmProvider` adapter (Anthropic, OpenAI-compatible, Ollama), validates the result against the schema, retries transport errors, timeouts and schema-invalid output with backoff (with a repair message for models without native structured output), and sums tokens and cost across attempts. Rate limit and budget are `UmpireClient` decorators, and `PlaybackUmpireClient` serves recorded calls with no provider, so replays cannot reach the network. Each accepted call goes to a `CallRecorder` (provider, model, prompt version, system, input, raw output) for the input log. Only the adapters know about a vendor SDK or wire format. `MockUmpireClient` serves hand-written JSON fixtures (with configurable latency and failure injection) for all non-LLM tests, see [umpire-fixtures.md](umpire-fixtures.md).
- **Visibility service**: from master state and a side, produces that side's knowledge: seen units, stale contact reports, received messages. The *only* path from master state to a client. See D12.
- **Clock and scheduler** (server): the `ClockState`, the scheduler, and pause voting.
- **API** (server, `server/src/api`): Fastify. `POST /games` creates a game; `GET /games/:id/ws` is the WebSocket of the side the signed-in user holds a seat on (D17), speaking the `packages/protocol` messages. Inbound frames are validated with the protocol schemas, and the hub sends only `SideView` data built by the visibility filter. See D16.
- **Notifier**: pushes dispatch arrivals and clock events over WebSocket, plus email or web push for players who are away. Players set thresholds (all dispatches, urgent only, contact only).
- **Persistence**: an append-only event log of *inputs* (commands, clock changes, votes, LLM outputs, seeds), plus periodic snapshots for quick recovery. Implemented as `SqliteGameStore` (D14b): recovery is the latest snapshot plus replay of the later inputs, and the game resumes paused. Stores the model, prompt version and raw output of each LLM call.
- **Client**: a Three.js map table (flat map, 3D pieces) and a Svelte desk, showing a desk clock with the rate and any pause. It renders only what the server sends. See [hq-interface.md](hq-interface.md).

### SideView contents

An `EngineSideView` (engine type, `viewFor`; not the protocol `SideView`, see D12) may contain only:

- `side`, `time`, `mapWidth`, `mapHeight`. All lengths in a view are metres; master state is integer millimetres (D15).
- `ownUnits`: the side's own units in full (id, name, kind, position, facing, formation, footprint, loose-formation shape, strength, morale).
- `visibleEnemies`: enemy units in sight now, as id, position, facing, formation, footprint (rounded to the nearest 10 m, since an exact one would give the strength away), any loose shape, and a coarse `sizeEstimate` phrase. Nothing else: no strength, morale, intent or name.
- `lastKnownContacts`: enemy units seen earlier and not in sight now, as id, the position where seen, `facing` (coarse), `seenAt`, `ageMs`, `uncertaintyRadius` (metres, growing with age) and the size phrase from the sighting.
- `reports`: contact, unit-lost and order-delivered reports whose courier delay has passed, each with kind, `observedAt`, `deliveredAt`, `ageMs`, reporting unit name, location, a plain-language `place` and `uncertaintyRadius`, size phrase, confidence and template prose.
- `documents`: enemy dispatches this side took from couriers whose capture has reached HQ, each with `capturedAt`, `deliveredAt`, `ageMs`, `issuedAt`, the enemy unit it was `addressedTo`, location, `place` and the order's original `text`. Nothing about the sender's route, courier or the garbled version.

Adding a field means updating this list and the leak tests in `visibility.test.ts`.

### Reconnect and catch-up

The hub remembers the game time of the last view pushed to each side and saves it (`GameStore.saveSeen`, table `side_seen`) when the side's last connection closes. When a connection opens and the side has none open, the hub sends the full view as always (so nothing is missed, and papers in it are not pushed again) and then one `catchUp` message: `sinceGame`, `atGame` and the ids of dispatches delivered after `sinceGame`. A side that has never visited, or opens a second tab, gets none. After a hard crash the saved time may be older than the true last visit, so the catch-up can over-report but never under-report. The HUD shows it as a notice. It carries only ids already in the filtered view.

## LLM load and cost at continuous time

- LLM calls fire on discrete triggers: an order issued (parse), an order delivered (interpretation), an ambiguity (judge), and a report due (narrate). Quiet stretches cost nothing.
- Narration is **batched in short game-time windows**, so a burst of events yields one set of reports per side. Window size scales with the rate.
- Per-game rate limits and a budget cap (`GameUmpireClient`, `gameBudget` in the umpire config), with a clear "staff overloaded" fallback. A capped game is refused before any call is sent, so stages use their conservative fallback at once and game time never waits on it. Narration then returns the engine's template text plus `STAFF_OVERLOADED_NOTICE`. Each call and refusal is logged as a metric, and `report()` gives the cost of the game.
- Parsing defaults to the cheap model (`claude-haiku-5-5`); judgment keeps the strong one.
- Cheaper model for parsing, stronger for judgment and narration.
- Deputy mode (the LLM acting for an absent player) only runs when the player has enabled it, and only when a trigger in their standing orders fires.

## Determinism and replay

The simulation is a function of: scenario, seed, and the **ordered log of inputs with their game timestamps** (commands, LLM outputs, pause and rate changes). Replaying that log through the engine on a manual clock gives identical state, regardless of the wall-clock rate used during the original game. LLM outputs are recorded and played back, so replays never call the model. Implemented in `server/src/game/replay.ts` (see D14a); run it with `npm run replay -w server -- <logfile>`.

## Scripted opponent

A scripted side is a `SideAgent` run by the `GameActor`. Every `intervalMs` of game time the actor advances the engine to that instant, builds `viewFor(world, side)` and calls `think(view)`; the orders it returns are issued at once through `applyLoggedOrder`, then travel by courier like any other. The agent never sees `GameState`: its input type is `EngineSideView` and `assertFogOnly` checks it at runtime. Each order is logged with `agent: true` and its parse result, so replay needs no agent and no model call. See decision "Scripted Red opponent".

The server turns the opponent on by default: `main.ts` passes `scriptedOpponents: scriptedOpponentsFromEnv(process.env)` to `buildApp`, which hands it to `GameHost`. Set `SCRIPTED_OPPONENTS=0` (or `false`/`off`) to disable it, for tests or human-vs-human games. `GameHost` itself defaults to off.

## Debug trace

`server/src/debug/` holds the debug trace store behind the admin view (Epic #119). It is read-only diagnostics: the engine never reads it and no game client ever receives it.

- Entries have a `kind` (`request`, `command`, `engine`, `clock`, `error`, `llm`), a wall timestamp, the game id and a **correlation id**. `traceRequest` assigns the id to each inbound HTTP request or WebSocket message and carries it through `AsyncLocalStorage`, so the commands, engine events, clock changes and LLM calls it causes share it. Work the scheduler starts on its own gets a fresh id per tick.
- `TraceStore` keeps a bounded ring buffer per game (`maxEntriesPerGame`, default 2000) and can append every entry to a JSON Lines file.
- Everything passes through `Redactor` before storage: secret-named keys, key-shaped strings (`sk-ant-...`, bearer tokens) and any exact secret values registered at startup. Token counts are not treated as secrets.
- When the admin view is off the server passes `NOOP_TRACE` (or nothing). Producers check `trace.enabled` before building a payload, and `traceUmpire` returns the umpire client unwrapped, so a disabled trace costs nothing and stores nothing.

## Admin API

`server/src/admin/` serves the trace and master state to the debug page (Epic #119). It is development tooling, not part of the game.

- **Routes**, all `GET` under `/admin/api`: `games`; `games/:id/state` (unfiltered engine state and clock, plus each side's current `SideView` under `sideViews`); `games/:id/entries` (`kind`, `correlationId`, `after` cursor, `limit`; `next` is the cursor for the following page); `games/:id/stream` (server-sent events of new entries, `after` replays the backlog first); `games/:id/replay` (timeline of the input log: `endMs` and `marks` of kind `input`, `event`, `contact`, `order`, `llm`); `games/:id/replay/at?at=<gameMs>` (master state, each side's view and the events up to that game time).
- **Replay.** `server/src/admin/replayView.ts` runs `replayLog` on a manual clock over the stored input log (running games up to now), so it waits on no wall clock and has no parser or umpire to call; orders use the recorded parse result and `llmCalls` is always 0. The side views come from the same `viewFor` filter as live play but are returned only by this admin route.
- **Gating.** The routes exist only when `ADMIN_ENABLED` is `1`, `true` or `on`; otherwise `buildApp` never registers them, so every `/admin` path is a plain 404, and the trace is the no-op sink. When enabled, a request must come from a loopback address or carry `ADMIN_TOKEN` (`Authorization: Bearer`, or `?token=` for `EventSource`). With no token set, only loopback gets in. The check uses the socket address, and a request that carries `X-Forwarded-For` or `Forwarded` is never treated as loopback, so callers behind a same-host reverse proxy, or across a container bridge, need the token.
- **Read-only and separate.** Only `GET` routes are registered, none calls an actor command, and the module never touches `api/hub.ts`. It reads `api/sideView.ts` only so `/state` can show what each side is sent; nothing flows the other way. Master state leaves the process only through these routes.

## Admin page

`client/admin/index.html` with `client/src/admin/` is a standalone page at `/admin/`, built by the same Vite config as the game client (a second entry) and sharing no code with it. It is a shell (story 8.3): a game picker fed by `GET /admin/api/games`, a live indicator, and State, Events, Requests, LLM and Replay panels under one filter bar. The Replay panel (story 8.7) is a scrubber over game time with step by mark and jumps to the next or previous contact, order delivery or LLM call (an order's recorded parse); it shows master state, both side views and the events up to the chosen time.

- **LLM panel** (story 8.6, `client/src/admin/llm.ts`). Fed by the `llm` entries on the game's SSE stream (the stream replays the backlog, so there is no second fetch). One row per call: stage, provider, model, latency, tokens in/out, estimated cost, retries, status and a `live`/`playback` badge; a totals line (calls, tokens, cost, retries, errors) sits above it, and the shared filter matches stage, provider, model, mode and error. Selecting a row shows the system prompt, input, schema, raw response and parsed result (`output`, recorded by `TracedUmpireClient`), each collapsible when long and with a copy button. All values are rendered as text. API keys never reach the page: the server's `Redactor` scrubs them before an entry is stored.
- **Live indicator.** `live` while the selected game's SSE stream is open (or the game list polls fine when there are no games); `reconnecting…` when the stream errors or the list request fails (retry backoff 1s to 10s, and the stream is reopened on recovery); `admin disabled` on a 404; `unauthorized` on a 401. Pass `?token=` on the page URL to send `ADMIN_TOKEN`.
- **Serving.** In dev, Vite proxies `/admin/api` to the server and redirects `/admin` to `/admin/`. In the container the static handler serves `dist/admin/`. The page is static and holds no game data; with the admin view off, only the API paths 404 and the page shows `admin disabled`.
- **Events and Requests panels (story 8.5).** Both read one `EntryStore` per selected game, filled from the SSE stream (the server replays the backlog; a reopened stream resumes with `?after=<last seq>` and duplicate seqs are dropped). Events lists `engine` entries with game time, type, side, unit and summary, filtered by type, side, unit, game-time window and the shared text search. Requests lists `request` entries with transport, method, path, status, duration and size, filtered by transport, status and minimum duration. Rows are virtualised (fixed height, only the visible window is in the DOM). Selecting a row shows its raw JSON and every entry sharing its correlation id (request, command, engine, clock, LLM, error); "show chain in table" restricts the table to that id across all kinds. `none` is not a correlation id and links nothing. Scrolling up pauses the list (new entries are counted, not shown) and scrolling back to the bottom, or the resume button, catches up.
- **State panel (story 8.4).** The god view: game time, clock and rate, the LLM barrier, seed, RNG state and next seq, the event queue, every unit with all its master fields, and both `SideView`s as sent to clients. Each unit field says which sides' views carry it; a field in no view is highlighted amber as **master only**, and an enemy no side has sighted is badged `unseen by <side>`, so a leak or a visibility bug stands out. The `intel`, `rulings`, `combatActive`, `sightFactor` and `victory` world fields are listed as master only, and `seed` and `outcome` are marked in the header. It refetches `/state` on every trace entry (debounced 250 ms) and on each list poll, and the shared filter hides units whose text does not match. Read-only; the page only issues GETs.
- **Keys.** `1`-`5` switch panels, `←`/`→` move along the tabs, `/` focuses the filter.

## Tech choices (suggested, open to change)

| Concern | Choice | Why |
|---------|--------|-----|
| Server | Node.js + TypeScript (Fastify) | Shares engine code and types with the client; Node 22 (see `.nvmrc`) |
| Packages | `packages/engine`, `packages/protocol` (shared types), `server`, `client` | One source of truth for types |
| DB | SQLite (WAL) to start, Postgres later | Zero-ops prototype; the log is simple |
| Timers | In-process scheduler with a persisted queue | Rebuilt from DB on restart |
| Client 3D | Three.js (vanilla), Vite | Table, flat map plane, low-poly pieces, raycast picking |
| Client UI | Svelte over the canvas | Documents, forms, drag-and-drop, accessible text |
| Realtime | WebSocket for clock, dispatch and vote events | Needed now that play is continuous |
| Notifications | Web push and email | Players are away most of the time |
| LLM | Anthropic API, structured outputs | Cost split by stage |
| Auth | Magic-link email login, cookie sessions, per-game seats (D17) | No passwords to store or reset |
| Hosting | Single container, docker compose | Matches the other self-hosted services |

## Key data shapes (sketch)

The implemented wire schemas live in `packages/protocol` (see its README). Each message also carries a version field `v`, omitted from the sketch below.

```ts
type Command =                          // everything a player can send; all are logged
  | { kind: 'issueOrder'; orderId: string; draft: DraftId }   // or `text` (wording sent directly) until drafts exist
  | { kind: 'vote'; proposal: ProposalId; yes: boolean }
  | { kind: 'proposePause'; reason?: string }
  | { kind: 'setReady'; ready: boolean }
  | { kind: 'draftEdit'; draft: DraftId; ops: EditOp[] };

type Order = {
  id: string; side: Side; to: UnitId;
  issuedAtGame: number;                 // game time of signing
  text: string;                         // original wording, preserved
  parsed?: Intent[];                    // filled by the umpire service
};
type Intent =
  | { kind: 'move'; to: Coord; route?: Coord[]; pace?: 'march'|'quick'|'forced' }
  | { kind: 'hold'; at: Coord; posture?: 'defend'|'screen' }
  | { kind: 'attack'; target: Coord|UnitId }
  | { kind: 'withdraw'; toward: Coord }
  | { kind: 'report' }
  | { kind: 'when'; trigger: Trigger; then: Intent[] }   // conditional
  | { kind: 'at'; gameTime: number; then: Intent[] };    // timed

type Ruling = {                          // an umpire judgment call, always recorded
  atGame: number; question: string;
  modifiers: { target: UnitId; kind: string; value: number }[];
  rationale: string;
};
// Placement rulings (D15) are kept in GameState.rulings as
// { id, time, proposal, verdict: accept|clamp|reject + reasons, rationale, narrative }.
```

## Testing strategy

- **Engine**: ordinary unit tests plus property tests (no teleporting, strength never negative, determinism under identical input).
- **Clock and scheduler**: tests on the manual and fast-forward clocks. Property tests that the outcome is identical at rates 1, 4, 12 and 1000, and that pause and resume do not alter results.
  Implemented in `server/src/game/clockInvariance.test.ts`: seeded random pause, resume and rate-change schedules (signing some orders while paused) must match an uninterrupted run; seeds and hand-written schedules live in `clockInvariance.corpus.json`, add a seed there when one finds a bug.
- **LLM barrier**: tests with a deliberately slow mock umpire to confirm game time stalls and the result is unchanged.
- **Pause voting**: state-machine tests for unanimous, single no, timeout, emergency hold, and a pause during an LLM wait.
- **Umpire**: golden tests of order parsing on a corpus of sample orders (including nonsense and injection attempts). A mock umpire with fixtures for all non-LLM tests.
- **Leak tests**: scripted games checking nothing from the other side's private state appears in a side's payload or narration.
- **Replay**: a recorded game replays to an identical state with no model calls.
- **End to end**: `server/src/game/endToEnd.test.ts` plays Hold the Bridge headless (scripted Blue orders against the scripted Red, on a fake wall clock) at rates 1, 4, 12 and in fast-forward, checks the final states and event logs are identical (a failure prints the first divergence) and that replay from the log matches.
- **Crash recovery**: kill the server mid-game, restart, and check the game comes back paused with state intact.
