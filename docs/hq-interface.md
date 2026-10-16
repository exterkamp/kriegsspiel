# The HQ interface

> **Note (D28, #278):** the HQ fixture demonstration described in the status paragraphs below was retired. `client/src/hq/` and `/?mode=fixture` no longer exist; the live desk is the interface. Statements about the fixture are historical.

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

The orders desk is built, with a shared drafting panel above the form (D6g): the side's drafts, edited together with the staff, with comments, a who-wrote-what view, read indicators, presence and forks. The form below is addressed to a named commander, free text, an optional annex of table arrows, a fast or steady courier with a staff estimate for each, an autosaved draft, and a sign-and-stamp animation; sent orders show delivery progress in the journal (D16c). Navigation is by clicking desk objects, plus hotkeys (T table, I in-tray, O orders, R order of battle, J journal, C conference, Esc back to the table). The in-tray is built: six piles (newest arrival first, with unread counts), a dispatch viewer with sender, written and received times and the attached facts (unit, strength, a "Show on table" button for the place), a filed drawer, and discard. Read, filed and discarded marks are local and persist per game in the browser; reliability and sender confidence are never shown. The desk shell is built; moving to a desk view dollies the camera down to the desk and fades the canvas, and the canvas keeps rendering and keeps its state. The order of battle lists the formations in the SideView with strength, supply and morale, each dated by the view and aged in game time (fresh under 30 min, aging under 2 h, then stale, shown fainter); figures that are missing show as "unknown", never zero; clicking a formation pans the table to it. The SideView carries no commander and no per-figure report dates yet, so the roster shows the formation name and one date per row. The journal is built (`desk/Journal.svelte`): a persistent per-game diary in the browser of orders sent, dispatches received, pauses and resumes, and the player's own notes, newest first, with search, filters by kind and an export as a text file; the post-game critique (Epic 6) can read the same entries. It is local to the browser, like the in-tray marks. A small clock on the desk and a "new papers" indicator avoid a constant need to check every view. The desk clock (`desk/DeskClock.svelte`, pure logic in `desk/clock.ts`) sits above the view buttons and shows game time, the rate, a Paused or Stopped badge and "Staff at work…" while the umpire holds game time. It is compact at the table and full size on a desk view, and it runs forward locally from the last `ClockState`.

**The desk in turn mode (D39, 11.10).** A turn-mode game uses the same desk; only these parts change, and only when the client knows the game is played in turns: from a `turnState`, or from the game's settings in `GET /games/:id` (so a reload after the game has ended keeps the turn desk, #429; the short window on join before either arrives is #427). The settings are authoritative: opening a real-time game afterwards drops turn mode. Until the first `turnState` arrives the clock says "Waiting for the turn", never "Game over", which only the server's `gameOver` brings. The clock shows the open turn, "Turn 3: 08:20 to 08:40", with where the side stands ("Writing orders", "Orders sent", "Turn being decided") and no rate. The pause panel is replaced by a **turn panel** in the dock: who has sent ("Blue (you): writing, Red: sent", from `turnState.sent` and the game's sides), the deadline if the game has one, and a button to the orders desk ("Send orders (2 held)"). While the turn is decided it says "The umpire is considering the turn."; when the next turn opens it says "Turn 2 has been decided: 7 new papers in the in-tray." with Read the reports (opens the in-tray) and Dismiss. On the **orders desk** the form is the same (addressee, words, annex, courier) but its button is **Hold for this turn**: the order goes to the server as `holdTurnOrder` with the addressee as `to` and is listed above the form under "Held for this turn" with Edit (back into the form; holding it again replaces it under the same id) and Withdraw. **Send orders for this turn** asks once ("Send these 2 orders for the turn? This is final for your side.", and warns of words still in the order box) and sends `sendTurn`. The question is put away whenever the turn moves on (the side sends, the deadline closes the turn, the next turn opens), and so is an order being edited: its words stay in the box and holding them makes a new order. A hold the server refuses gives the words back to the box with the staff's reason. After the side sends, the list is read-only, the form is closed and the desk waits for the other sides. A side may send no orders; its units keep their last ones. The sent orders join the journal as sent orders, and each turn adds a line to the diary ("Turn 1 decided. Turn 2: 00:20 to 00:40 opens.", its own "Turns" filter). On the map table, and on the flat board when there is no WebGL, pieces glide from where they stood to where the turn left them over 1.5 s (`legacy/table/glide.ts`; none with reduced motion, and none for the umpire's window or the way back from it to the live picture). The turn's reports are the engine's dispatches in the in-tray until the umpire's turn reports (11.9, #405). When the game ends the turn that decided it is the last; its last paper is the umpire's ruling on the outcome, and the clock shows the final time, the turn length ("20-min turns") and "Game over" (#429). A real-time game shows none of this.

## App shell and main menu

`client/src/main.ts` starts the shell (`client/src/shell`), which decides what the page shows. The shell has explicit screens, a small typed state machine in `shell/screens.ts` (pure functions, unit tested): `sign-in`, `menu`, `new-game`, `game`, `game-over`.

| URL | Screen |
|-----|--------|
| `/` (no parameters) | `sign-in` when signed out, otherwise `menu`. Never a half-loaded game. The emailed `/auth/verify` link redirects to `/`, so it lands on the menu. |
| `/?lobby=1` | `new-game` (the New game form, `NewGameComponent`) |
| `/?new=1&side=&rate=` | `game`, creating a game first |
| `/?game=<id>[&side=]` | `game`; a reload returns to the same game |
| `/?game=<id>&over=1` | `game-over` (served by the live client until the game over screen task) |

Signed-out visitors are held at `sign-in` for every screen. Browser back and forward follow the URL. The live client (`liveClient.ts`, the 3D table and desk) is the game screen and cannot be unloaded, so a move to or from a live screen after it has loaded is a fresh page load.

**Main menu** (`MenuComponent`, aged paper and serif to match the desk): New game; Continue, the player's unfinished games with scenario, side, game time and last played (hidden when there are none); the signed-in email with Sign out; and About, a paragraph on how the game works with a link to `docs/gameplay.md`. `GET /games` supplies `finished`, `gameTimeMs` and `lastPlayedMs` for each game, and Continue lists only started games that are not finished (`shell/continueList.ts`). Multiplayer entry points are not on the menu. A quieter **Developer tools** section ("For development; not part of the game") links the map editor (`/map-authoring`), the map and table benchmarks and the admin view (`/admin/`, which still asks for the token) as plain links that open in the same tab; the map editor and the benchmarks carry the tool header (`ks-tool-header`: "← Main menu", a "Developer tools" line and the title) and the admin view a "← Main menu" bar. The server's `DEV_TOOLS` setting (default on outside production) decides whether the section renders, read by the client from `GET /auth/features`; the routes work by URL either way (see `docs/deployment.md`).

**New game** (`NewGameComponent`, pure rules in `shell/newGame.ts`): Scenario (title, briefing, sides and expected length, from `GET /scenarios`; the client hard-codes none of it), Your side (only sides the scenario leaves to people when the server has a computer opponent), How the game is played (Real time, or Turns, umpire decides, D39), Clock rate for a real-time game (1:1, 4:1, 12:1 or a custom ratio, with a line such as "12:1 means one hour of battle passes in five minutes"), or for a turn game the game minutes per turn (5 to 60, default 20) and an optional deadline in hours, with the dial's text saying who decides each turn and a note on who plays the other side (scripted opponent or AI commander, as reported by `/scenarios`). Defaults are the first scenario, Blue and 12:1. Start posts `POST /games` and opens the game; a double click makes one game, and a validation or server error (signed out, game limit, bad rate) is shown above the buttons with the form intact. Back returns to the menu. Multiplayer seats are not on this screen.

**In-game menu** (`GameMenuComponent`): a Menu button, and Esc when the table is showing (in a desk view Esc still returns to the table). It offers Resume, Leave to main menu and Sign out. Leaving closes the WebSocket, then loads the menu; the game keeps running on the server. It is a modal dialog: focus starts on Resume and Esc closes it.

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

### Design system (#327)

One look for every page of the Angular client. The audit that led to it is in [visual-audit.md](visual-audit.md).

- **Tokens** are CSS custom properties in `client/src/styles/tokens.css`, the only file where colours and font families are written: paper and ink (`--ks-ink`, `--ks-paper*`, `--ks-rule*`), accents (`--ks-brass`, `--ks-wax`, `--ks-ok`, `--ks-warn`, `--ks-info`, and `*-on-dark` variants for the dark table), type (`--ks-font`, `--ks-font-mono`, `--ks-font-hand`, `--ks-text-*`), space (`--ks-space-1..6`), shape and elevation (`--ks-radius`, `--ks-shadow-*`) and motion (`--ks-move*`). Semantic roles (`--ks-text`, `--ks-surface`, `--ks-control`, `--ks-primary`, `--ks-danger`, `--ks-focus`) point at them.
- **High contrast** is `html[data-contrast='high']`: black on white, a yellow brass, no gradient. The main menu and the style guide have a toggle, saved in `localStorage`; `prefers-contrast: more` darkens the muted text and rules without a toggle. `src/styles/design-system.test.ts` checks every text pair for 4.5:1 in both variants.
- **Accessibility checks (#59).** `src/app/a11y.spec.ts` runs axe-core over every desk view, the game-over dialog, the flat board and the style guide in both variants (jsdom cannot run axe's contrast rule; the token test covers text contrast). Dialogs (`ks-modal`, game over) move focus in and trap Tab (`ui/focus.ts`). The desk has a polite live region that announces a new dispatch or a staff answer (`legacy/desk/announce.ts`), and the clock status is a status region. The flat board is an image described by a text list of units, sightings, fights and couriers (`legacy/table/boardText.ts`); enemy pieces have a dashed outline so side is not colour alone. Reduced motion: the CSS rules plus a zero-length camera dolly. The 3D table itself stays a canvas; keyboard play uses the desk views and the orders form.
- **Controls** are in `client/src/styles/ui.css`, scoped under a `.ks-theme` element (the shell, admin view, style guide, map editor and benchmarks put it on their host): buttons (default, `.ks-primary`, `.ks-quiet`, `.ks-danger`, `aria-pressed` for a selected one and for tabs), fields (`.ks-field` with `.ks-hint` and `.ks-error`; bare `input`, `select`, `textarea`, `fieldset` are styled too), `.ks-panel`, `.ks-paper`, `.ks-overlay` (dark strip over the table), `.ks-row`, `.ks-badge`, `.ks-status` (info, `.ks-ok`, `.ks-warn`, `.ks-error`), `.ks-tabs`, `.ks-stack`, `.ks-cluster`, `.ks-muted`, `.ks-sr-only`. Element rules sit under `:where()`, so a component's own selector always wins.
- **Round 2 (#344).** Radios and checkboxes (`appearance: none`, ink dot or tick) and selects (drawn chevron) are redrawn from their element selectors, so no screen shows a native blue control; `.ks-choice` lays out a radio or check with its label, `.ks-actions` makes a row of buttons one size (a primary beside Back), `.ks-row.ks-link` is a whole-row link or button with a bold title and a line under it (Continue games, Developer tools), `.ks-section-h` is a ruled section heading, and `.ks-dense` (plus `.ks-mono`) is the operator console's smaller layout on the same tokens; the admin view sits in a paper panel with a "← Main menu" bar and keeps mono only for data. Two surfaces are deliberate: paper for documents (pages, desk views, dialogs) and the dark `.ks-overlay` for instruments on the table (clock, tools, pause panel); the in-canvas unit labels are part of the table. Full-page screens fill the viewport (`min-height: 100dvh`), every desk paper has one height, and on a phone the desk bar is a 3-column grid, the HUD leaves room for the Menu button, the umpire's window starts below them, and the Tools panel hides under the game-over paper.
- **Components** in `client/src/app/ui`: `ks-page-frame` (the page, a title and an optional "← Main menu" back control), `ks-tool-header` (the header of a full-viewport developer tool: "← Main menu", "Developer tools", the title and the page's status) and `ks-modal` (scrim, labelled dialog, focus moved in, Tab trapped).
- **Style guide** at `/style-guide` (linked from Developer tools) shows the tokens and every control in each state.
- **Adopting it**: put `class="ks-theme"` on the page's host, use `ks-page-frame`, `ks-tool-header` or the tokens for the page, and replace local hex colours and `font-family` with `var(--ks-*)`. `design-system.test.ts` lists the exempt folders (map table, local board, the framework-free `legacy` modules); remove a folder from `EXEMPT` once it is converted.
- **Map tools (#308).** The map editor (`/map-authoring`) and the map and table benchmarks adopted it: `ks-tool-header` over the page, the paper side panel with shared fields, sliders, checkboxes (`.ks-choice`), Simple/Advanced tabs (`.ks-tabs`, `aria-selected`), Generate as `.ks-primary`, the status line and diagnostics as `.ks-status` with their tone (`.ks-ok`, `.ks-warn`, `.ks-error`), and the shared focus ring (inset on the map canvas). The legacy modules (`controls/panel.ts`, `authoring-app.ts`, `benchmark.ts`) only add these class names; the styles are in the Angular hosts. With the app in high contrast the map preview starts in its own high-contrast drawing. The rendered map keeps its own palette (`renderer.ts`), and the table benchmark's canvas still fills the viewport, with the header and result floating over it.
- **The Three.js table** and its in-canvas labels keep their own look (map textures, piece colours) but use the paper and ink palette.
- Rule: no hex colours, `rgb()` or `font-family` in component styles; the test fails on them.


## Rendering decision: hybrid 3D table + 2D desk

**Decided:** Three.js for the map table, and a DOM UI for the desk. Phaser is dropped.

- **Map table (Three.js).** The scene is a table with a **flat** map texture on it (the scanned or redrawn historical map). No 3D terrain, no elevation mesh. Hills, woods and rivers are read from the map art, as on a real Kriegsspiel table. On the flat map sit:
  - 3D unit pieces (low-poly wooden blocks sized to frontage, with a colour, a facing, and a paper tag showing the formation name and when the position was reported)
  - ghost pieces for stale or uncertain contacts
  - the player's pencil lines, arrows, range rings and pins
  - table dressing: ruler, dividers, inkwell, lamp, which also give a sense of scale
- **Camera.** Orbit and zoom within limits, with a "top-down" snap for precise plotting. Tilts away from the table to the desk.
- **Desk (HTML/CSS over the canvas).** In-tray, orders desk, order of battle, journal and staff conference are 2D Papers Please-style screens. Papers can be dragged, stamped and filed, and text stays crisp and selectable. A transition (camera dolly plus fade) moves between table and desk. Dragging a report from the desk onto the table to place a marker is a core interaction, so the two layers share a drag-and-drop system.
- **UI framework for the desk:** Angular (D29; it was Svelte before the cutover). Vanilla Three.js for the scene, with no react-three-fiber unless the scene gets complicated.
- **Picking.** Raycast against the flat map plane to convert pointer position to map coordinates. Pieces are picked by raycasting their meshes. Because the map is flat, coordinates are plain (x, y) in metres with no height, which is what the engine's continuous plane uses (D15). Pieces stand at any position and facing and are drawn at their footprint; there are no cells to snap to.

The map remains flat, with no elevation mesh. Numerical elevation is planned in M3c for contour rendering, terrain-aware generation and future height/slope queries. Connecting it to gameplay line of sight and movement is separate work; existing annotated terrain and per-feature height tags remain relevant. A flat display does not remove the need for numerical topography.

## Implications for the build

- The engine's vector terrain is the **truth layer** and a debug view only. The player never sees it.
- The player-facing client is the Three.js table and the Angular desk, built fresh.
- Info panels are diegetic: terrain notes and sketches for places, the journal and roster for units.

## Open questions

- Single shared desk per player, or a physical-feeling "room" that you walk between? (I'd start with a flat set of tabs styled as desk objects.)
- How much auto-plotting should the player get? The more automatic it is, the less the interface says about uncertainty, so this is a main difficulty knob.
- Do we want player-drawn orders (arrows on the map) as well as text? Suggest: arrows are *attached to* the written order as an annex, as a general would send a marked map to a subordinate, and the umpire reads both.
- Mobile: the map table works on a tablet, and the in-tray works on a phone, since turns are slow.
- First historical scenario: pick a small, well-mapped engagement from the Kriegsspiel era (a Napoleonic or 1860s action). To be decided together.
