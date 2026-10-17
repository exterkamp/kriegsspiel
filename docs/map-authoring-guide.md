# Standalone map authoring guide

Map authoring produces a public, local-metre battlefield asset for inspection and later scenario work. It runs independently of a game, server umpire or LLM. A generated map contains terrain, water, cover, connected infrastructure and settlements; it does not contain armies, objectives, orders, fog of war or a balanced playable scenario. See [the gameplay handoff](map-gameplay-handoff.md).

This guide describes the verified source workflow. Independent source review, actual Chromium authoring/replay and measured default/maximum resource evidence are recorded in the [verification report](map-verification-report.md). The source-review distribution restriction below remains in force; following these steps does not publish a release.

## Fresh local setup

Use the Node version in `.nvmrc` (currently Node22.22.2, with npm10.9.7) and run these commands from the Kriegsspiel repository root, in this order:

```sh
npm run setup:map-source
npm ci
npm run build
```

`setup:map-source` verifies the attributed SettleMaker snapshot, installs its separately locked build dependencies and produces the exact local package tarball required by the root lockfile. It must precede root `npm ci`. The full rebuilt tar payload must match the pinned SHA; setup verifies and stages the original canonical gzip encoding to preserve exact package integrity across platform-specific zlib versions. The build verifies the source payload again. Neither setup nor generation depends on `.local/settlemaker`, its dirty prototype or a separately running game. See [current bootstrap instructions](../vendor/README.md) and [immutable snapshot notes](../vendor/settlemaker/README.md) for the immutable source, archive identity, notices and retrieval/build details.

Start the local client through the configured launcher, with a name:

```sh
devrun up --name map-authoring -- npm run dev --workspace @kriegsspiel/client
devrun url map-authoring
```

If the launcher is absent from this shell's PATH, the current review machine has `/Users/dominic/.local/bin/devrun`; use that executable for the same commands. Devrun chooses/reports the port. Open `/map-authoring.html` at its reported origin; the independent diagnostic page is `/map-benchmark.html`. The coordinator's current review server is at [map authoring](http://127.0.0.1:41660/map-authoring.html) and [map benchmark](http://127.0.0.1:41660/map-benchmark.html), but 41660 is not a required fresh-setup port. Stop your named server with `devrun stop map-authoring` when finished. Reuse a coordinator-owned server while review is running; avoid restarting it during acceptance work.

## Generate and inspect

The initial **Simple** tab keeps **Generate map** and **Load saved map** at the top. The empty preview also offers these same actions and explains that no map has been generated. Choose a preset, set the seed explicitly and press **Generate map**. Nothing generates automatically. The reference preset recipes are:

| Preset           | Reference seed | Extent      |
| ---------------- | -------------: | ----------- |
| Flat countryside |             17 | 5 km × 5 km |
| Wooded hills     |             31 | 5 km × 5 km |
| River valley     |             97 | 5 km × 5 km |

The authoring preset picker replaces the complete settings, while keeping your seed and ordered overrides. Set the reference seed yourself when following this table. The initial default draft is seed 17 with the 10 km default settings; it is not an already generated map. The benchmark picker separately sets the selected preset's reference seed.

Simple offers square map sizes (5/10/15 km), with **Custom** reflecting rectangular or nonstandard settings, plus Roughness and Woodland sliders with exact numeric readouts. Size changes only width and height; sliders change only their named values. The displayed field fraction is retained, and Woodland plus fields must not exceed 1. A conflicting value blocks generation: lower Woodland or explicitly edit fields in Advanced; fields are never silently reduced. Valid settings can still be infeasible for generation.

**Advanced** contains every exact settings field, policies, resource limits, ordered adjustments and detailed provenance. Switching tabs changes presentation only: it preserves loaded precision, override order, invalid input and pending loading/validation. Invalid fields in a hidden panel still block Generate and export. Use **Fix in Advanced** to open and focus the first invalid field. The tabs support arrow keys, Home/End and Enter/Space without submitting generation.

Settings include width/height and sample spacing, relief/roughness, water selection and width policies, requested wood/field fractions, village/farm counts and populations, placement/grade constraints and configured work/resource limits. Open Advanced and expand the settings groups to inspect these fields. Literal versioned policies are read-only. Water selection is expressed through an upstream-sample threshold, not a general artistic density slider. Cover reports achieved fractions; slope, represented water and conservative shoreline masking can prevent exact requested fractions. Changing constraints can make a recipe infeasible.

Pressing Generate starts a fresh worker, then independently validates and prepares exports in a second worker. The status distinguishes generating, validating, ready and failure. The synchronous generator currently supplies start progress rather than a continuous percentage estimate. Settings must pass schema and relational checks before generation. The authoring wait limit is 30 seconds across generation, complete validation and worker export; a wait timeout is separate from deterministic generator work limits.

Use **Fit map**, pan, zoom and keyboard arrows/+/-/F to inspect the result. Select a named site in the site-detail menu and press **Site detail**; selection addresses its stable ID, with no implicit first-site choice. The preview is drawn as a 19th-century staff map (#491): sepia hachures down the fall line and light shading for relief, sparse contours, lined water, tree-symbol woods, ochre settlements with hatched buildings, roads cased by class, bridge and ford symbols and serif names. Independent layer toggles expose hillshade, hachures, contours, cover, water, roads, crossings, buildings, place names and metric scale. High contrast keeps the same symbols on a white sheet with quieter relief and distinguishes crossing decks from represented water. Zoom changes presentation and label density, never canonical geometry.

## Ordered adjustments

The **Ordered overrides** panel in Advanced records changes to the generation recipe. Enter the exact stable site ID, such as `site:village:0000` or `site:farm:0000`, from the asset's `layers.sites[].id`. IDs identify kind/ordinal slots, not names or current coordinates. The JSON export is the authoritative source for them. If you reduce a site count or remove a slot, an override referring to it can fail; do not replace it with a guessed nearest name.

- **Append rename:** enter the stable ID and name. A later rename for the same ID takes precedence. A name change preserves geometry identity while changing full asset identity.
- **Append move:** enter the stable ID and anchor x/y in metres. x increases east; y increases south from the north-west origin. Regeneration must place the site at the requested anchor and revalidate its dependent approaches and settlement; impossible moves fail rather than being silently repaired.
- **Append exclusion:** enter a unique exclusion ID and a polygon JSON object. Exclusions constrain site placement; they are not a terrain paint tool or a general road-prohibition mask. Rings must close exactly and valid holes must be preserved.

For example, a local-metre exclusion polygon can be entered as:

```json
{
  "outer": [
    [100, 100],
    [300, 100],
    [300, 250],
    [100, 250],
    [100, 100]
  ],
  "holes": []
}
```

Choose coordinates for the actual map rather than treating that example as a recommended exclusion. Holes use the same closed-ring format. **Earlier**, **Later** and **Remove** operate on the recorded order; **Show on map** fits the referenced site or exclusion extent. Edits do not regenerate automatically. Press Generate to resolve them through the actual generator and complete validator. Roads, settlements and their constraints are reconsidered during regeneration. There is no canvas picking/dragging, pinch control, terrain painting or direct building editor in this workflow.

Save a validated map before trying new constraints. An edited or invalid draft disables export of the old map until the draft again matches a current validated result. Displaying the previous map does not mean the new adjustment was accepted.

## Validation, cancellation and recovery

Complete validation checks the composed physical/topological constraints independently of generator success, including connectivity, bounds, crossings, building/street suitability, site capacity, actual joins, contours and recorded overrides. A successful contract parse alone is insufficient. Candidate diagnostics identify their stage, feature/constraint and available remediation. Expected geometric/resource infeasibility is distinct from malformed imports, worker/protocol failures, programming errors and the UI wait timeout.

**Cancel** terminates current generation/validation and pending file reading. A new request replaces older work. Late replies cannot replace the current result or restore export. Failure retains the last validated map for inspection, while current export remains disabled. Correct the draft or use a supported saved map, then retry. A timeout does not change the deterministic seed, settings or geometry policy and is not permission to raise generator budgets silently.

## Save, load and replay

**Export validated map JSON** downloads the current worker-certified canonical asset. This JSON is the saved map: it includes full settings, seed, ordered overrides, exact generator/stage/fork provenance, geometry, elevation, diagnostics and population. There is no separate autosave of unfinished edits. **Export SVG** downloads the vector rendering of that same current accepted operation. SVG is for inspection/sharing under the source-review restriction; it is not a replacement for the replayable JSON asset.

Choose **Load saved map JSON** to load a previously exported file. Loading imports and independently validates the saved geometry, without starting generation. On success, its supported recorded recipe is adopted without merging current preset defaults. A pending or failed read cannot authorize an old download. Unsupported schema, coordinate/precision policy, generator stages or exact fork artifact are rejected/reported; the last validated preview is retained. Use the matching supported toolchain for that file rather than relabelling its provenance.

To check replay, save the original JSON, reload and validate it, then regenerate its unchanged seed/full settings/ordered overrides with supported recorded versions. Export the regenerated JSON and compare canonical geometry identity. Manual adjustments must survive that cycle. `canonicalGeometry`/`assetIdentity(asset,'geometry')` are the package's comparison tools; full asset identity also includes names/diagnostics/population/provenance. Supported-runtime Node/browser replay and the representative visual/resource gates require coordinator evidence; a seed alone is not enough to promise cross-version or cross-browser identity.

JSON coordinates are local planar metres: x east, y south, elevation up, north-west `(0,0)` origin and a local-zero elevation datum. They are not latitude/longitude or georeferenced RFC7946 GeoJSON. Elevation samples are a numerical field, not gameplay tiles. JSON canonicalization uses the recorded decimal-six policy and revalidates rounded geometry; it does not repair collapsed or invalid geometry.

## Headless CLI

Build first. The root `maps:cli` alias invokes `node --max-old-space-size=256 packages/maps/dist/composition/headless-cli.js`, the supported256MiB V8 old-space profile. This does not promise256MiB total heap or RSS; whole-process peaks are measured separately. For example:

```sh
mkdir -p .local/maps
npm run maps:cli -- --preset flat-countryside --seed 17 --output .local/maps/flat17.json
npm run maps:cli -- --validate .local/maps/flat17.json
npm run maps:cli -- --preset river-valley --seed 97 --output .local/maps/river97.svg
```

`--output` selects canonical JSON or SVG by its `.json`/`.svg` extension. Without it, generation writes JSON to stdout; use the direct Node entry when capturing stdout without npm's command banner. `--validate` validates the saved asset without regenerating and prints a structured validation result. Expected infeasibility returns exit 1; malformed options/imports and unexpected exceptions use exit 2.

For an explicit recipe, pass `--seed`, `--settings path/to/full-settings.json` and `--overrides path/to/ordered-overrides.json`. Settings replace the whole preset settings object; they are not a partial patch. The overrides file is the ordered array, for example:

```json
[{ "kind": "rename", "siteId": "site:village:0000", "name": "Oakford" }]
```

The CLI has no dedicated saved-map `--replay` flag. Before using extracted settings/overrides for CLI regeneration, verify supported recorded provenance with the public `supportsReplay(savedAsset)` API or use the browser's recorded-version gate. Do not regenerate an unsupported old file with current defaults and call it replay. API details are in [composition](../packages/maps/docs/composition.md) and the [map contract](../packages/maps/README.md).

## Diagnostic benchmark and current limits

Use `/map-benchmark.html` for a separate real-preset diagnostic run. Enter machine/CPU/RAM/exact browser metadata, choose extent/seed/frame count, keep the page visible and stable, then press **Run real benchmark**. Results expose raw samples, p95 summaries, geometry counts and measured canvas/browser dimensions through normal DOM controls. The target canvas is 1440×900 CSS pixels; browser viewport/clipping, backing resolution and DPR are recorded separately. Visibility, focus, page-lifecycle, resize or DPR interruptions invalidate a run, even if the original values return. See [measurement boundaries](../client/src/map-authoring/benchmark.md).

The [verification report](map-verification-report.md) records default10km generation at6.87s/268MiB and maximum15km flat generation at8.59s/355MiB under the supported Node profile, plus real representative preview p95 intervals9.2–9.3ms. These are measured recipes on one documented machine, not universal bounds. Resource limits and the conservative combined worker-message cap can produce explicit bounded failure; these do not imply every permitted recipe is feasible. Large populations/maps and full validation/export may exceed the UI wait budget. Coarse terrain/water/cover policies are cartographic numerical models, not surveyed foundation accuracy, hydrological discharge or gameplay rules.

## Source-review distribution restriction

The owner chose to keep combined-work distribution gated while preparing source review. The SettleMaker source/artifact carries GPL-3.0-only and retained notices; the rest of Kriegsspiel has no licence grant supplied by this work. Local setup, source review and private verification are authorized. Do not publish/deploy a combined application, browser worker bundle, package or generated sharing workflow as though the licensing/source-distribution decision were resolved. A worker boundary does not resolve that decision. Follow [D23 and related decisions](decisions.md), [map architecture](map-architecture.md) and the source snapshot notices.
