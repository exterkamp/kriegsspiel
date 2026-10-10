# The HQ interface

Implementation ports and capability gates are recorded in [HQ contracts](hq-contracts.md), with packet evidence in [HQ execution log](hq-execution-log.md). The current HQ composition is an explicitly identified fixture demonstration; its continuous-metre table consumes accepted #118. Local order drafts autosave in this browser; signing and delivery are unavailable in HQ. Browser rendering/performance and live-server acceptance remain pending. Opening the client without session parameters shows the HQ fixture. Existing `/?new=1&side=blue&rate=12` and `/?game=<id>&token=<t>` URLs retain the accepted live client and transport; live HQ composition awaits its contract gate.

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

Navigation is by clicking desk objects, plus hotkeys. A small clock on the desk and a "new papers" indicator avoid a constant need to check every view.

## The map layers

Layers are what let one historical map serve both sides and the engine.

1. **Base map**: a scanned or redrawn period map (hachured hills, roads, woods, villages). Both players see the same base. It is slightly *wrong* in places, as period maps were.
2. **Truth layer** (server only): the engine's vector terrain features (woods, rivers, roads, bridges, buildings, with cover, concealment and height tags), derived from the base map and corrected where needed. It is continuous: there is no grid or tile.
3. **Player marks layer**: pins and counters the player places, plus marks the staff add automatically when a report arrives. Each mark records its source report and time, and fades or greys with age.
4. **Report sketches**: scouts' sketches attached to a location, for example "bridge at Hohenau, intact, 2 companies".
5. **Overlays** (toggle): order arrows, planned routes, estimated march times, and a "last known" fog shading showing how old your knowledge is per area.

## Using historical maps: the hard part

The engine needs vector terrain features, but players should see the original map. Options:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Hand-annotate** each scenario: trace roads, woods, rivers, slope onto the scan as vector layers; they are the engine's features directly. | Accurate, controllable, great quality | Labour per map |
| **B. Semi-automatic**: use a vision model plus colour segmentation to propose features, then a human cleans up in an editor. | Faster once the tool exists | Needs an annotation editor, and maps vary |
| **C. Real elevation data** (DEM) georeferenced to the historical map. *Dropped: the table is flat, see the rendering decision below.* | Real slopes and viewsheds | Terrain has changed, and georeferencing takes work |
| **D. Procedural** (generated terrain) restyled to look like a period map | Infinite scenarios | Not "historical" |

Suggested path: **D now, A for the first historical scenario, build a small annotation editor (B) when we want a second one.** C is worth a spike for line of sight.

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

Because the map is flat, **elevation data is no longer needed** (option C above is dropped). Line of sight and cover come from the annotated terrain layer plus per-feature height tags (woods, ridges, buildings) in the engine.

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
