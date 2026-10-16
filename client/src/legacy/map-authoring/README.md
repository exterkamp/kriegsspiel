# Standalone authoring integration (H/I preparation)

Entry: `client/map-authoring.html`, `/map-authoring.html`. The source entry mounts the real generation/validation adapters and authoring controls. It loads no reference fixture and does not generate automatically. G's browser-safe public exports are wired. Source verification and the coordinator's real browser/replay evidence are separate, as described below. Original fixture tests remain separate explicit oracles; passing those does not certify generated assets.

## Worker and acceptance boundary

`generate.worker.ts` forwards one request through the accepted generation runner to public `generateBattlefield`, retaining its seed, full settings and ordered overrides. Only start-of-generation progress is emitted: the synchronous G API supplies no intermediate progress callback. A fresh module worker is constructed for each request through Vite's static `new Worker(new URL(..., import.meta.url), {type:'module'})` pattern.

`validate.worker.ts` runs public `validateBattlefield` on generated and saved candidates, then public `exportBattlefield` on successful validation. Both expensive synchronous operations stay in that dedicated worker. Export performs its own complete validation, so the current path repeats independent validation; measure the complete generation/validation/export cost before changing the 30-second total watchdog. Worker termination handles cancellation outside deterministic generation. See [runtime lifecycle](runtime/README.md).

The validation worker returns an accepted outcome plus canonical JSON and SVG strings. Expected validation/export infeasibility returns diagnostics with no files; unexpected errors fail explicitly. The runtime exposes files only for the current ready request. The controller still requires complete validation and retains the last accepted asset on failure. No candidate or saved file is treated as accepted merely because contract parsing succeeds.

`main.ts` consumes G's `battlefieldPreset`, `CURRENT_GENERATOR` and `CONSUMED_FORK`. The preset catalog supplies complete settings; seed remains an explicit separate field. Compatibility checks compare every recorded generator/stage/fork identity against those authoritative G exports, never client-only version constants. The panel's synchronous provenance gate is distinct from full validation of a saved asset in the worker.

## Mounting and current export

`mountAuthoringApp(document,runtime,options)` binds existing standalone markup, adds the panel and site selector, and returns `{panel,dispose}`. Only `onValidatedAsset` loads the preview. Candidate/progress/failure diagnostics remain in the controls while the last validated map remains visible. Text uses safe DOM text nodes. No gameplay state, LLM or player/table entry participates.

Site detail requires an explicit stable ID; it does not select the first site. `MapPreview.fitSite(id)` fits the placement polygon bounds with 15 m context, returns false for a missing ID, and leaves the view unchanged on failure. Normal `fit(optionalBounds)` is unchanged. Replaced maps preserve selection only when that ID still exists. Ordered rename/move/exclusion forms call the accepted panel; regeneration revalidates dependent content through G. Show-on-map fits the referenced site or exclusion extent; no picking, dragging or pinch implementation is added.

`panel.canExport()` provides live, non-serializing availability using the existing export gate, including pending/failed file reads and recipe matching. The injected `currentCertifiedJson` provider supplies cached worker JSON without cloning or canonicalizing the asset on the main thread. The final download callback rechecks current files, readiness, recipe and exact equality with the provider payload. Standalone panels retain their default canonicalization path. SVG download requires the same live panel gate and current runtime file set. Saved loading uses controller import plus the validation worker, with zero generation starts. Replacement/cancel/disposal invalidates files synchronously, even before subscriber notification. Persisted pagehide keeps the app alive; final departure disposes panel, preview, workers and subscriptions.

Presentation remains canonical local metres with authoritative bilinear hillshade, independent hachure/contour/cover/water/road/crossing/building/name/scale layers, even-odd holes, metre road surface widths, high contrast, stroke-padded culling and label collision suppression. Rendering never modifies assets. Every colour, stroke, symbol and label font comes from one style definition in `map-style.ts` (#491): the preview uses `PERIOD_MAP_STYLE`, a period staff map whose static base (cover, symbols, shading, hachures from `hachures.ts`, lined water) is drawn into cached 256 px raster tiles per zoom band, at most six new tiles a frame; `render` returns true while tiles are outstanding and the preview asks for another frame. In the period style water fills as one nonzero union and adjoining pieces (strip lakes, the reaches of a river) draw as one body with no shore line or seam between them (`weldedBoundary` in `geometry.ts`, #502). `MapRenderer`'s default stays `CLASSIC_MAP_STYLE`, the earlier flat look, which the in-game table raster still uses until it adopts the period style. DPR is presentation-only; existing resize/DPR/back-forward-cache behavior remains intact. The page styles live in the Angular host (`client/src/app/map-authoring/map-authoring.component.css`) on the shared design system (#308); these modules only add its class names. HTML/common configuration is unchanged; fixture-only document text is replaced when the real module mounts.

## Focused verification and remaining acceptance

```sh
node_modules/.bin/vitest run client/src/legacy/map-authoring
npm run typecheck --workspace @kriegsspiel/client
node_modules/.bin/eslint client/src/legacy/map-authoring
node_modules/.bin/prettier --check client/src/legacy/map-authoring
node_modules/.bin/prettier --ignore-path /dev/null --check client/src/legacy/map-authoring/README.md client/src/legacy/map-authoring/runtime/README.md client/src/legacy/map-authoring/controls/README.md
```

The runtime and DOM integration tests use explicit hand-authored fixtures/injected workers. They cover dedicated saved validation, generated replay handoff, fresh workers, A/B/C replacement, late responses before notifications, direct cancel/dispose, retry, finite timeout retention, malformed replies, startup/runtime/transport/programming errors, expected infeasibility and no partial file acceptance. DOM tests cover validated-only preview loading, explicit ID detail selection, SVG download suppression during a newer file read and persisted/final page departure.

The coordinator reports real-worker ready/overview/detail checks for all three representative presets, validated river97 rename/move/exclusion adjustments, byte-identical save/load/reexport and fresh CLI replay, and invalid/infeasible/cancel/replacement/import/version recovery checks. The coordinator will add the detailed browser evidence and gate status separately. Real benchmark runs are ongoing; no performance acceptance is claimed here. No server, build, package installation, distribution, merge or deployment is performed by this documentation packet.

Final source verification reported by the coordinator on 2026-10-10: **672 root tests and 137 client tests pass**. Client source typecheck, scoped authoring ESLint and source formatting also pass. These are source checks, not benchmark measurements or the browser acceptance report. Native entry unit probes mock G explicitly and establish plumbing only; real browser evidence comes from the coordinator's separate runs. Integration source remains frozen.
