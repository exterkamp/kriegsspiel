# Preparatory #141 authoring controls

Reusable DOM module under the M3c plan, against frozen contract `78b918a` and controller checkpoint `41522f6`. This is source-only E/F preparation. It supplies no generator, complete validator, worker entry or placeholder successful asset; it is not mounted in the preview. #141 remains open for G/H integration and real authoring/browser acceptance.

## Public API

`index.ts` exports `createAuthoringPanel(document, controller, options?)`, the panel/callback/preset types, `defaultParameters()` and pure `editOverrides(parameters, edit)`.

The returned panel exposes:

- `element`: detached labelled DOM section; the integration owner chooses where to mount it and supplies styles.
- `getParameters()` / `setParameters(input)`: detached schema-valid seed, complete settings and ordered overrides. Invalid programmatic input throws without replacing the draft.
- `applyOverride(edit)`: append, replace, remove or reorder an entry. `OverrideEdit` is a typed discriminated union; edits are descriptor-checked, strict in shape and bounded to 256 overrides. Operations preserve input geometry, winding, ring starts, holes and list order. Rename and move remain separate ordered operations; no implicit resolution or regeneration occurs.
- `generate()`: validate the entire displayed recipe before calling the injected controller; returns its ID or null with a recoverable panel error. It can replace an active request. Invalid settings never reach the worker factory.
- `cancel()`: cancel controller work and pending saved-file acceptance, preserving its last validated preview.
- `loadText(text)` / `loadFile(file)`: direct saved-asset loading and complete validation through the controller, never regeneration. Text loading returns the controller operation ID immediately. File loading returns an ID after reading, or null for read failure/supersession; observe controller state for complete validation.
- `exportJson()`: returns `{ filename, mimeType: 'application/json', text }` only for the live validated asset matching the displayed seed/settings/ordered overrides. Text uses the frozen `canonicalizeAsset` API; serialization failure returns null and explains the error.
- `dispose()`: abort native file reading, invalidate late read acceptance, unsubscribe and remove the panel. It does **not** dispose the injected controller; its owner manages that lifetime separately. Repeated disposal is safe; further panel operations throw.

The UI exposes seed, explicit preset selection, extent and elevation spacing, relief/roughness, all frozen water/cover fields, village/farm counts and populations, site suitability and every configured road/contour/settlement/resource limit. Literal versioned policies are visible read-only. Settings groups use collapsible native DOM controls; schema and relational validation use the frozen `parseReplayParameters`/`parseSettings` boundary. The water control is the actual upstream-sample selection threshold, not an invented density parameter.

The default draft is seed 17 plus a detached `DEFAULT_SETTINGS`, without any asset or generation call. An existing last-validated controller asset supplies its complete recorded recipe when mounting without an explicit initial draft, even during subsequent pending/failed work. A newly ready asset updates the fields only if no newer local draft edits superseded that request. Editing a draft disables export of a previous map until the displayed recipe matches a current validated result.

Presets are injected `{ id, label, settings }` entries (unique bounded IDs, at most 32); the default picker has only "Default settings" and custom/recorded mode. Selecting a preset explicitly replaces the complete settings while keeping seed and overrides. Preset names are presentation only and add no unsupported canonical fields. Invalid prior settings can be recovered by selecting a valid preset. Loading never resets advanced fields to preset defaults.

## Integration callbacks

`PanelOptions` accepts:

- `initialParameters` and `presets` for the integration's supported draft/preset catalog.
- `checkReplaySupport(recordedProvenance, recipe)` returning `{ supported: true }` or `{ supported: false, reason }`. This must check supported generator, stage and fork versions before regeneration of a loaded/existing recorded asset. Without it, those recipes can still be loaded and exported after complete validation, but regeneration is disabled. Compatibility is resolved from live controller state before generation, independently of queued render notifications, and saved replay intent is captured synchronously when loading. The full recorded provenance remains visible and is passed unchanged; no version is silently substituted. The callback must be synchronous and pure because rendering also checks availability. Throwing or malformed callback results are programming errors.
- `onDraftChange(recipe)`: detached frozen schema-valid draft for later integration. Invalid drafts report input errors without invoking it.
- `onValidatedAsset(asset)`: immutable last-validated asset for future renderer loading. It receives each new asset once; failure does not replace it with a candidate.
- `onFocusOverride(override, index)`: enables "Show on map" buttons; actual picking, dragging and overlay rendering remain later work. Future map interactions can call `applyOverride` with typed operations.
- `onExport(file)`: optional export sink, synchronous or asynchronous. Otherwise the export button creates a native JSON Blob download and releases its object URL. jsdom tests inject a sink; they do not claim native browser download acceptance.
- `readFileText(file, abortSignal)`: optional file-reader adapter. Otherwise a native `FileReader` is used. Injected readers should honor the signal; acceptance remains guarded even if they ignore it.

No current code mounts the panel or creates a worker. G must provide the real generator/complete-validator adapters through `GenerationController` and implement version-compatible replay. A plain frozen contract parse is not composition certification. Topological exclusion validity, duplicate exclusion IDs, stable-site references, in-bounds moves, resolved final names/anchors and dependent road/settlement revalidation remain generator/complete-validator obligations. The panel does not create a second geometry validator or treat schema-valid edits as accepted placement.

## State, files and export safety

Status/progress/candidate diagnostics come from the controller and remain outside canonical data. Expected infeasibility is displayed separately from programming, worker, protocol, timeout and import failures. Diagnostic text, names and metadata are rendered with `textContent`, never injected HTML. The last valid map remains available to the preview after failure; changed/invalid drafts and failed file reads explain their disabled export state.

Export queries `controller.exportAsset` and the live draft at the instant of action; a delayed/coalesced subscription or still-enabled old button cannot authorize an obsolete result. Pending validation, replacement, cancellation and failed requests produce no JSON export. Draft changes during delayed validation remain intact and cannot export the older candidate as that newer draft.

Saved content is passed directly to `controller.loadSavedAsset`; its descriptor/resource-safe parser and injected complete validator remain the authoritative boundary. The panel checks `File.size` against the frozen 64 MiB import cap before reading. Replacement, draft edits, generation, cancellation and disposal abort native reads and invalidate late asynchronous text/errors. An injected reader that ignores cancellation may continue its own work, but cannot load a stale asset. Failed reads retain the old validated preview and block export until another validated request. Exclusion JSON is separately byte-capped before parsing and then schema/resource-preflighted with the whole recipe; no rounding/repair is applied to edit geometry.

## Focused checks and remaining gates

Run from the repository root with existing dependencies:

```sh
node_modules/.bin/vitest run --config client/vite.config.ts client/src/map-authoring/controls
npm run typecheck --workspace @kriegsspiel/client
node_modules/.bin/eslint client/src/map-authoring/controls
node_modules/.bin/prettier --check client/src/map-authoring/controls
node_modules/.bin/prettier --ignore-path /dev/null --check client/src/map-authoring/controls/README.md
```

Results on 2026-10-10: **21/21 jsdom tests**, client source typecheck, scoped ESLint and source/README Prettier checks exit 0. Files are limited to `panel.ts`, `recipe.ts`, `index.ts`, `panel.test.ts` and this README. No build, dist write, installation, server, commit, shared configuration or preview modification was performed.

Coverage includes every settings group, schema/relational errors before worker creation, rapid replacement/cancel/stale errors, safe progress/diagnostic text, expected infeasibility versus programming failure, loaded advanced settings and versions, existing-controller recipe preservation, explicit preset recovery, ordered rename/move/exclusion edits with holes, immutable callback data, delayed validator/draft mismatch, live export gating before notifications, one-microtask saved replay gating with an explicit-adapter control, older validation readiness during a newer file read, actual jsdom FileReader loading and abortion, size rejection before read, stale/cancelled/disposed readers and callback defects. Hand-authored contract fixtures and unconditional test validators are test doubles, not composed generation success or representative map evidence.

Integration owner still supplies real generation/validation/version adapters, mounting/styles, worker bundling, renderer callbacks, map adjustment interactions, actual saved-replay geometry identity and browser download/responsiveness evidence. The existing fixture server is coordinator-owned. These passing preparation checks do not accept or close #141.
