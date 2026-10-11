# Real-asset preview diagnostic harness (J preparation)

Root owns `client/map-benchmark.html`, which mounts `<main id="benchmark">` and imports `benchmark.ts`. The standalone module mounts its own diagnostic form, canvas and result DOM. It is served by the existing coordinator-owned devrun at `/map-benchmark.html`. No normal product UI is instrumented, no fixture is loaded, and no generation or run begins automatically. The G public API/implementation must be present; there is no fallback generation/validation success.

## Operator workflow (native browser controls)

1. Open `/map-benchmark.html` in the supported foreground Chromium browser. Record exact browser version and machine model/CPU/RAM in **Operator machine metadata**. The harness also records user agent, platform, logical hardware concurrency, device-memory hint if available, focus, visibility and DPR. Those browser hints are not a measured memory peak or an exact hardware inventory.
2. Choose the real flat-countryside, wooded-hills or river-valley preset. Selection sets its authoritative G seed; an explicit custom seed remains possible. Choose width/height in metres (5–15 km) and 60–600 measured frames (240 default, plus 30 warmup). Choose high contrast if desired. Initial values are controls only; no asset exists until real worker success.
3. Press **Run real benchmark** (`#benchmark-run`). `#benchmark-status` reports generation/validation and final diagnostic state. Keep the page visible with unchanged browser viewport/DPR. **Cancel run** (`#benchmark-cancel`) terminates workers and pending frame waits. Backgrounding, resizing or DPR change invalidates the run rather than producing an apparently accepted performance sample.
4. Read/copy the JSON from `#benchmark-result`. It contains the exact requested settings/seed/overrides, produced provenance, metadata, geometry/sample/population/export-byte counts, timing summaries and every measured frame. No browser JavaScript evaluation or asset mutation is required. Failed/infeasible/timeout runs show explicit failure data, replacing any prior result; they publish no performance success.

The canvas viewport is fixed at **1440×900 actual CSS pixels** and checked before and during sampling. The browser's `innerWidth/innerHeight` are separately recorded; they are not relabelled as canvas dimensions. The container permits scrolling if the browser is smaller. Record browser dimensions and visible clipping when interpreting compositor responsiveness: the entire canvas still receives drawing commands, but a clipped browser viewport may not present every pixel. Renderer backing dimensions and the actual capped render DPR are recorded separately. All default layers remain enabled. Canvas pointer input is disabled during the diagnostic page's deterministic script; normal authoring pointer behavior is unchanged.

## Measurement boundaries

The real runtime creates a generation worker and then a fresh complete-validation/export worker. `generationValidationExportMs` spans request submission through controller acceptance, including synchronous main-thread transport/import parsing and the worker's full validation plus canonical/SVG export. The existing 30-second total wait watchdog stays unchanged. G's generator validates internally; the validation worker validates independently and its export API validates again. Report this whole path, rather than timing just one generator function.

`previewSynchronousSetupMs` includes preview contract parsing/detachment, cached Path2D creation, authoritative-ground query setup and capped hillshade creation. `previewLoadAndFirstFrameMs` additionally includes the wait for the first Canvas2D draw. Those setup costs are reported separately from steady-state percentiles.

After the first frame, 30 warmup frames precede the selected 60–600 measurements. Every third command fits a translated detail rectangle along a repeating 120-step triangle path in metre coordinates; intervening frames zoom by 1.04 and its reciprocal around a fixed CSS-pixel anchor. The translation is expressed through existing `fit(bounds)`, and zoom uses the existing `zoom(factor,anchor)` API. It is a deterministic scripted translated-fit/zoom workload, not a simulated drag event or recorded user session. Geometry, settings and canonical assets are never edited by that trajectory. No simplification, fixture geography or artificial frame delays are introduced.

Every operation waits for the actual preview RAF observer before issuing the next. The form/status/result DOM is not updated inside the measured loop. Samples remain bounded to 600; full-run wall watchdog is 120 seconds and any individual missing frame fails after 2 seconds. Browser RAF timestamp differences form the **frame interval** distribution; retain long frames and outliers. Percentiles use nearest-rank (`ceil(n*p)-1`) with raw finite samples; no trimming, interpolation or refresh-rate subtraction.

The optional third `MapPreview` constructor callback receives one frozen timing record after each draw, with no asset or view references and no retained history:

- `drawMs`: time inside `MapRenderer.render` (Canvas2D command submission, text/culling and synchronous work that the browser performs there). It excludes bitmap/GPU presentation that the browser defers after the call.
- `workMs`: RAF entry through backing-canvas sizing, drawing and preview state publication. It excludes the observer callback itself.
- `requestToStartMs` / `requestToEndMs`: first coalesced preview redraw request through RAF entry/end, including scheduler waiting. They use monotonic `performance.now`; RAF timestamps supply intervals independently.
- `operationToObservedEndMs`: benchmark viewport command through observer delivery/microtask resumption. It includes command overhead, request wait and observer bookkeeping.

Without that optional callback, MapPreview reads no timing clocks and retains its previous APIs/behavior. Normal authoring supplies no observer. Renderer/geometry data remain immutable. Counts/report assembly occurs after sampling, with its own time; `warmupAndMeasuredWallMs` ends when the frame loop ends. Total diagnostic time excludes final result JSON formatting/DOM display. This harness does not measure worker peak RSS, whole-map peak memory, GPU completion, input latency, screenshot correctness or a representative visual gate. Those need coordinator measurements and review. No automatic PASS against the 33 ms target is emitted: the result is evidence for interpretation, not story acceptance.

## Focused source checks

```sh
node_modules/.bin/vitest run client/src/legacy/map-authoring/benchmark.test.ts client/src/legacy/map-authoring/preview.test.ts
node_modules/.bin/eslint client/src/legacy/map-authoring/benchmark.ts client/src/legacy/map-authoring/benchmark.test.ts client/src/legacy/map-authoring/preview.ts client/src/legacy/map-authoring/preview.test.ts
node_modules/.bin/prettier --check client/src/legacy/map-authoring/benchmark.ts client/src/legacy/map-authoring/benchmark.test.ts client/src/legacy/map-authoring/preview.ts client/src/legacy/map-authoring/preview.test.ts
node_modules/.bin/prettier --ignore-path /dev/null --check client/src/legacy/map-authoring/benchmark.md
npm run typecheck --workspace @kriegsspiel/client
```

Source tests cover analytical nearest-rank/outlier/immutability cases, translated trajectory coordinate/aspect cases, stable-ID detail selection, mocked-clock observer bounds/asset immutability/no-observer clock isolation, and event-latched interruption/final-frame rechecks with success/error/cancel cleanup. Analytical timing samples are test oracles, not published benchmark measurements. Final coordinator source verification is **672 passing root tests and 137 passing client tests**; client source typecheck, scoped lint and source formatting pass against G's real public exports. These checks do not measure real harness performance. No fake declarations or implementation exists. The coordinator's real benchmark runs are ongoing; their measurements, browser report and acceptance status will be added separately. Sources remain frozen; this documentation update performs no run, build, server launch, install, distribution or commit.
