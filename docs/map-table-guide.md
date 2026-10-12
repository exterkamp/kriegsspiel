# Inspect an authored map on the table

Open `/map-authoring.html` in the local client, choose a preset, and generate it. Wait for a validated result and export its **JSON**. The JSON preserves geography, settings, seed and provenance; an SVG or screenshot cannot be loaded as a map.

Open `/map-table` on the same local client (`/map-table.html` redirects here). Select the exported JSON and wait for validation and preparation to finish. The displayed map information identifies the accepted map and its metre extent. The page validates saved composition independently; it does not regenerate the map.

Use **Fit map**, **Top-down** and **Oblique** to inspect the paper. Scroll to zoom, drag to orbit and right-drag to pan. For keyboard panning, focus the map and use plain arrow keys. On touch devices, one finger orbits and two fingers pan and zoom. Compare settlements, terrain, roads and crossings with the authoring preview. Loading another valid JSON replaces the paper and fits the new map. A failed or cancelled load retains the previous display when it remains usable; its information continues to identify that previous map.

The table is flat and shows public static geography. It has no armies, orders, marks, objectives or live game connection. Reload starts empty. Keep the exported JSON to load it again.

The inspector is a standalone Angular page: template bindings and signals show load state, accepted metadata and controls. A component-scoped service owns its scene, certification loader, observer and window listeners. Template HMR retires the old canvas and starts an empty inspector; load the saved file again. Leaving the route releases them; a browser back/forward-cache suspension stops rendering and cancels work, then restores the retained display on return. The route is independent of the main menu, guest login and live games.

## Detail limits

The paper uses a whole-map raster, up to 4096 pixels on its longest side and limited by the browser's GPU. At 5 km that is about 1.22 metres per pixel; at 15 km it is about 3.66 metres per pixel. Very narrow tracks and small footprints can be indistinct, especially in an oblique view. Zoom enlarges the available raster; it does not add geometry detail. Use the authoring view for closer vector inspection.

## Local development

Follow `AGENTS.md` and use `devrun` to start the client. Obtain its allocated URL with `devrun url`; append `/map-authoring` or `/map-table`. Preserve other running previews and checkouts.

For a reproducible saved map, build the maps workspace and export through the existing CLI:

```sh
npm run build -w packages/maps
npm run maps:cli -- --preset river-valley --seed 97 --output /tmp/river-valley.json
```

Load `/tmp/river-valley.json` using the table's file control. Browser authoring and this CLI use the same map contract and certification pipeline. Unsupported generator provenance or invalid composition produces a load error; repairing the saved JSON by hand can invalidate it.

The [implementation plan](map-table-implementation-plan.md) records the boundaries and PR strategy; the [execution log](map-table-execution-log.md) records verification and review checkpoints. [Map gameplay handoff](map-gameplay-handoff.md) describes the separate future path to playable scenarios.

## Fixed local boards with personal marks

`TableScene` supports an immutable `local-hq-board` mode for a certified, fixed raster with render-only personal marks. It rejects fixture/game state, external artwork and public preview replacement. `localBoardTextureLimit()` uses the same device/local cap as the saved-map preview. The first successful raster binding cannot change; mark updates reuse that paper and texture. Failed mark frames retain the previous marks for retry, and disposal releases owned resources.

`applyLocalBoard(raster, marks)` and `renderLocalBoardFrame()` acknowledge an actual synchronous rendered frame, including after camera framing. They do not acknowledge GPU completion or add simulation. This renderer capability is separate from HQ adapters and the later development New game interface. Existing fixture and standalone preview modes keep their original boundaries.
