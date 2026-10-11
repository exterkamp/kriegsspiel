# The HQ interface

For current user instructions and a hands-on validation checklist, see [HQ getting started](hq-getting-started.md).

Implementation ports and capability gates are recorded in [HQ contracts](hq-contracts.md), with packet evidence in [HQ execution log](hq-execution-log.md). The current HQ composition is an explicitly identified fixture demonstration; its continuous-metre table consumes accepted #118. Local order drafts autosave in this browser; signing and delivery are unavailable in HQ. Explicit report placement supports a chosen pin location with frozen provenance; its contract and review status are recorded in [report placement](hq-plotting-proposal.md). Browser rendering/performance and live-server acceptance remain pending. Opening the client without session parameters shows the HQ fixture. Existing `/?new=1&side=blue&rate=12` and `/?game=<id>` URLs select the accepted live desk, shared marks and transport with cookie authentication and a game seat; live HQ composition awaits its contract gate.

The game is played from a general's headquarters. There is no HUD and no minimap. The screen is a **desk in a tent or requisitioned farmhouse**, and everything you know arrives as paper.

## Principles

1. **The map is the main interface.** A period topographic map fills the centre of the experience. Everything else orbits it.
2. **Paper is the only sensor.** Reports, dispatches, sketches, and prisoner interrogations arrive on the desk. The map shows what you or your staff have *marked* on it, nothing more.
3. **Several views, one world.** You move between views to assess the battle, the way a commander would turn from the map table to the message pile to the order of battle.
4. **Everything is diegetic.** Time, fatigue, weather, and staff quality are expressed as objects and prose, not bars and numbers (with a toggle for "rigid" mode, see `design.md`).
5. **Your picture can be wrong.** Markers you placed from an old report stay where you put them. The server never silently corrects your map.

## Views

| View | What it is | Used for |
|------|-----------|----------|
| **Map table** | Large historical map with a transparent overlay layer. Pins, unit counters, arrows, pencil lines, range rings, the time each mark was made. | Situational awareness, planning movements, drawing intent |
| **In-tray** | Stack of incoming dispatches, sorted into piles (Urgent / Scouts / Subordinates / Staff / Intelligence / Rumour). Each memo has a sender, time written, time received, and a reliability the umpire tracks secretly. | Reading, triaging, and placing information on the map |
| **Orders desk** | Blank order forms, addressed to a named commander. Write free text, pick a courier (fast and risky, or slow and safe), and see a staff estimate of delivery time. | Issuing orders |
| **Order of battle** | Your formations as a staff roster: commanders, last-known strength, supply, morale as *last reported*, with dates. | Knowing what you have and how stale your knowledge is |
| **Staff conference** | Chief of staff, intelligence officer, quartermaster, engineer. Ask questions and get in-character advice. Advice quality depends on their traits and on what they have been told. | Consulting, decision support, the "umpire consultation" feature |
| **Terrain studies** | Zoomable detail of a locality: sketches, ford and bridge notes, local guide reports. | Detail beyond what the base map shows |
| **Journal / war diary** | A chronological record of orders sent and reports received, plus your own notes. | Reconstructing what happened, and the after-action reveal |
| **Umpire's window** (post-game) | The same map with the true positions and every ruling revealed. | Learning from the game |

The orders desk is built: a form addressed to a named commander, free text, an optional annex of table arrows, a fast or steady courier with a staff estimate for each, an autosaved draft, and a sign-and-stamp animation; sent orders show delivery progress in the journal (D16c). Navigation is by clicking desk objects, plus hotkeys (T table, I in-tray, O orders, R order of battle, J journal, C conference, Esc back to the table). The in-tray is built: six piles (newest arrival first, with unread counts), a dispatch viewer with sender, written and received times and the attached facts (unit, strength, a "Show on table" button for the place), a filed drawer, and discard. Read, filed and discarded marks are local and persist per game in the browser; reliability and sender confidence are never shown. The desk shell is built; moving to a desk view dollies the camera down to the desk and fades the canvas, and the canvas keeps rendering and keeps its state. The order of battle lists the formations in the SideView with strength, supply and morale, each dated by the view and aged in game time (fresh under 30 min, aging under 2 h, then stale, shown fainter); figures that are missing show as "unknown", never zero; clicking a formation pans the table to it. The SideView carries no commander and no per-figure report dates yet, so the roster shows the formation name and one date per row. The journal is built (`desk/Journal.svelte`): a persistent per-game diary in the browser of orders sent, dispatches received, pauses and resumes, and the player's own notes, newest first, with search, filters by kind and an export as a text file; the post-game critique (Epic 6) can read the same entries. It is local to the browser, like the in-tray marks. A small clock on the desk and a "new papers" indicator avoid a constant need to check every view. The desk clock (`desk/DeskClock.svelte`, pure logic in `desk/clock.ts`) sits above the view buttons and shows game time, the rate, a Paused or Stopped badge and "Staff at work…" while the umpire holds game time. It is compact at the table and full size on a desk view, and it runs forward locally from the last `ClockState`.

## App shell and main menu

`client/src/main.ts` starts the shell (`client/src/shell`), which decides what the page shows. The shell has explicit screens, a small typed state machine in `shell/screens.ts` (pure functions, unit tested): `sign-in`, `menu`, `new-game`, `game`, `game-over`, plus `fixture`.

| URL | Screen |
|-----|--------|
| `/` (no parameters) | `sign-in` when signed out, otherwise `menu`. Never a half-loaded game. The emailed `/auth/verify` link redirects to `/`, so it lands on the menu. |
| `/?lobby=1` | `new-game` (today the lobby form from `client/src/lobby`; the new game form task replaces it) |
| `/?new=1&side=&rate=` | `game`, creating a game first |
| `/?game=<id>[&side=]` | `game`; a reload returns to the same game |
| `/?game=<id>&over=1` | `game-over` (served by the live client until the game over screen task) |
| `/?mode=fixture` | The offline HQ fixture. Reached only by this URL, with no account. |

Signed-out visitors are held at `sign-in` for every screen but `fixture`. Browser back and forward follow the URL. The live client (`liveClient.ts`, the 3D table and desk) is the game screen and cannot be unloaded, so a move to or from a live screen after it has loaded is a fresh page load.

**Main menu** (`shell/Menu.svelte`, aged paper and serif to match the desk): New game; Continue, the player's unfinished games with scenario, side, game time and last played (hidden when there are none); the signed-in email with Sign out; and About, a paragraph on how the game works with a link to `docs/gameplay.md`. `GET /games` supplies `finished`, `gameTimeMs` and `lastPlayedMs` for each game, and Continue lists only started games that are not finished (`shell/continueList.ts`). Multiplayer entry points are not on the menu.

**In-game menu** (`shell/GameMenu.svelte`): a Menu button, and Esc when the table is showing (in a desk view Esc still returns to the table). It offers Resume, Leave to main menu and Sign out. Leaving closes the WebSocket, then loads the menu; the game keeps running on the server. It is a modal dialog: focus starts on Resume and Esc closes it.

## Game over screen

When the server sends `gameOver` (on the spot, or again when a finished game is opened by URL, since the server resends it on connect) the desk drops back to the table and shows a paper over it (`client/src/desk/GameOver.svelte`, logic in `gameOver.ts`):

- A headline for the player's side: Victory, Defeat or Draw (no winner), from the payload's `winner` and the side of the SideView.
- The reason in words, from the payload's `reason` code and `atGame` ("Red held the objective at ..."), and the game time elapsed.
- **View the umpire's window** (closing it returns to the screen), **Read the journal** (Escape returns to the screen), **Play again** (a new game with the same scenario, rate, session type and side, then enters it), **New game** (`/?lobby=1`) and **Main menu**.

The orders desk is already closed once the game is over (#175). Not yet shown: objectives held and losses (the `gameOver` payload carries neither; the umpire's window has the true picture), and the scenario's own wording of the reason.

## The map layers

Layers are what let one historical map serve both sides and the engine.

1. **Base map**: a scanned or redrawn period map (hachured hills, roads, woods, villages). Both players see the same base. It is slightly *wrong* in places, as period maps were.
2. **Truth layer** (server only): the engine's vector terrain features (woods, rivers, roads, bridges, buildings, with cover, concealment and height tags), derived from the base map and corrected where needed. It is continuous: there is no grid or tile.
3. **Player marks layer**: pins and counters the player places, plus marks the staff add automatically when a report arrives. Each mark records its source report and time, and fades or greys with age. Built as D16b: pins, pencil lines, arrows and range rings, stored per side on the server and never corrected.
4. **Report sketches**: scouts' sketches attached to a location, for example "bridge at Hohenau, intact, 2 companies".
5. **Overlays** (toggle): order arrows, planned routes, estimated march times, and a "last known" fog shading showing how old your knowledge is per area.

### Truth layer annotation format

The truth layer is the `map` object of a scenario: `width` and `height` in metres and a list of `features`. Each has an `id`, a `kind` (`field`, `wood`, `marsh`, `water`, `road`, `river`, `stream`, `bridge`, `ford`, `building`), one geometry (`polygon` as `[x, y]` vertices, `polyline` with a `width`, or `at: {x, y}` with a `radius`) and optional overrides of the kind's defaults: `moveCost`, `cover`, `concealment`, `height` (`low`, `flat`, `rise`, `high`: used by line of sight, so woods, ridges and buildings can be tagged), `passable`, `layer`. Kind-specific: `roadClass` (`highway`, `road`, `track`) on roads, `capacity` (metres of column frontage) on bridges and fords, `risk` (0..1) on fords. A slope or ridge is a `field` polygon with a `height` tag and a higher `moveCost`; a village is a `building` polygon. `SAMPLE_TERRAIN` in `packages/engine/src/raster.ts` is a 200 x 100 m example, and `rasterise(map, cell)` renders it as a character grid (see `raster.test.ts`) so an annotation can be checked by eye. The grid is a derived view only; the engine reads the vector features (D15, D15a).

## Using historical maps: the hard part

The engine needs vector terrain features, but players should see the original map. Options:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Hand-annotate** each scenario: trace roads, woods, rivers, slope onto the scan as vector layers; they are the engine's features directly. | Accurate, controllable, great quality | Labour per map |
| **B. Semi-automatic**: use a vision model plus colour segmentation to propose features, then a human cleans up in an editor. | Faster once the tool exists | Needs an annotation editor, and maps vary |
| **C. Real elevation data** (DEM) georeferenced to the historical map. *Deferred; outside procedural map milestone M3c.* | Real slopes and viewsheds | Terrain has changed, and georeferencing takes work |
| **D. Procedural** (generated terrain) restyled to look like a period map | Infinite scenarios | Not "historical" |

Suggested path: **D now, A for the first historical scenario, build a small annotation editor (B) when we want a second one.** C is worth a spike for line of sight.

Procedural map authoring is now planned as **M3c / [Epic 9](https://github.com/exterkamp/kriegsspiel/issues/132)**, with a terrain-aware SettleMaker fork for settlement layouts. It produces numerical elevation, terrain and infrastructure geometry, contours and a standalone top-down preview with validated export. Roads through woods retain both layers. Simple building footprints are sufficient. Map generation and preview are separate from scenario assembly, in-game table rendering and elevation-based movement/visibility; see [roadmap.md](roadmap.md) and decision **D18: Procedural battlefield maps are a standalone milestone**.

Candidate map sources to check licences for (all need verification before use): David Rumsey Map Collection, Library of Congress, Gallica (BnF), Wikimedia Commons, and national survey archives. Prefer public-domain scans of pre-1900 maps. Pick battlefields with good period maps and lots of documentation, so the scenarios have historical notes the umpire can draw on.

## What the LLM does here

- **Writes the paper**: turns validated events into period-voiced dispatches, with sender personality, errors, and hedging ("a column of perhaps two brigades, possibly more, marching east on the Albrecht road").
- **Decides what reaches your desk and when**: the engine produces the facts and arrival times, and the LLM only styles them.
- **Staffs the conference**: answers from the player's *known* information only. Staff prompts get the player-side knowledge, never the master state.
- **Assists marking (optional)**: auto-suggest a pin for each report, such as "place enemy cavalry near Hohenau?", and the player accepts or ignores. Auto-placement can be a staff-quality feature: a good chief of staff places accurately, a poor one mis-plots.

Reports should carry structured data beside the prose (location, unit, size estimate, confidence, time) so the UI can place pins and the engine can check the text against the facts.

## Visual direction

Period style, not a fantasy skin: aged paper, ink, sealing wax, pencil, brass instruments, with restrained animation (a courier arrival, a stamp). The text must stay readable. Serif for dispatches, handwriting-style only for short marginalia. Offer a plain high-contrast mode. Fixture asset sources and the pending visual review are recorded in [HQ assets](hq-assets.md).

## Rendering decision: hybrid 3D table + 2D desk

**Decided:** Three.js for the map table, and a DOM UI for the desk. Phaser is dropped.

- **Map table (Three.js).** The scene is a table with a **flat** map texture on it (the scanned or redrawn historical map). No 3D terrain, no elevation mesh. Hills, woods and rivers are read from the map art, as on a real Kriegsspiel table. On the flat map sit:
  - 3D unit pieces (low-poly wooden blocks sized to frontage, with a colour, a facing, and a paper tag showing the formation name and when the position was reported)
  - ghost pieces for stale or uncertain contacts
  - the player's pencil lines, arrows, range rings and pins
  - table dressing: ruler, dividers, inkwell, lamp, which also give a sense of scale
- **Camera.** Orbit and zoom within limits, with a "top-down" snap for precise plotting. Tilts away from the table to the desk.
- **Desk (HTML/CSS over the canvas).** In-tray, orders desk, order of battle, journal and staff conference are 2D Papers Please-style screens. Papers can be dragged, stamped and filed, and text stays crisp and selectable. A transition (camera dolly plus fade) moves between table and desk. Dragging a report from the desk onto the table to place a marker is a core interaction, so the two layers share a drag-and-drop system.
- **UI framework for the desk:** Svelte (preferred) or React. Vanilla Three.js for the scene, with no react-three-fiber unless the scene gets complicated.
- **Picking.** Raycast against the flat map plane to convert pointer position to map coordinates. Pieces are picked by raycasting their meshes. Because the map is flat, coordinates are plain (x, y) in metres with no height, which is what the engine's continuous plane uses (D15). Pieces stand at any position and facing and are drawn at their footprint; there are no cells to snap to.

The map remains flat, with no elevation mesh. Numerical elevation is planned in M3c for contour rendering, terrain-aware generation and future height/slope queries. Connecting it to gameplay line of sight and movement is separate work; existing annotated terrain and per-feature height tags remain relevant. A flat display does not remove the need for numerical topography.

## Implications for the build

- The engine's vector terrain is the **truth layer** and a debug view only. The player never sees it.
- The player-facing client is the Three.js table and the Svelte desk, built fresh.
- Info panels are diegetic: terrain notes and sketches for places, the journal and roster for units.

## Open questions

- Single shared desk per player, or a physical-feeling "room" that you walk between? (I'd start with a flat set of tabs styled as desk objects.)
- How much auto-plotting should the player get? The more automatic it is, the less the interface says about uncertainty, so this is a main difficulty knob.
- Do we want player-drawn orders (arrows on the map) as well as text? Suggest: arrows are *attached to* the written order as an annex, as a general would send a marked map to a subordinate, and the umpire reads both.
- Mobile: the map table works on a tablet, and the in-tray works on a phone, since turns are slow.
- First historical scenario: pick a small, well-mapped engagement from the Kriegsspiel era (a Napoleonic or 1860s action). To be decided together.
