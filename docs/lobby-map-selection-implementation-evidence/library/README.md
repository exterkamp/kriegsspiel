# Actual owned-library browser checkpoint

Task origin `http://lobby-map-347e7c.localhost:41564/?lobby=1`, API41590PID9959, webPID10023. Separate task guest, preserved durable `/private/tmp/lobby-map-preview-data/native-games-1.sqlite`. Protected41930 and all protected registry PIDs remain unchanged. Existing task tab reused; no new tab or game. Temporary390/320 viewports reset.

The functional source is accepted R32 backend c0daa57 plus R26/R31 Add, R27/R33 picker, R34/R36 parent/capability and R31 transport. Its source-identical linear composition is c700e0d292bdf43ef958df24c6e67ccc8b17e720. The later worker-backed read is candidate f1f1b20701d6ba26e9fc056a1fa86fe40052d376:1153 non-doc tracked files match the snapshot exactly at freeze, `/private/tmp/lobby-map-worker-read-tree-binding.json`. Root lint/typecheck/build pass at f1; final review/testing continues. Screenshots are actual Chrome, not wireframes. First-save shots precede the worker-read replacement; the separate reopened-worker shot follows it.

## Verified real flow

1. New game shows the actual4×3km Hold the Bridge terrain, its scenario supplies armies/objectives, and Your games says No games yet.
2. Add map opens the real existing preparation pipeline. Countryside5km/seed17 generated successfully, received current certification and a raster preview. Repeat this map starts collapsed. Save stays disabled until a separate display name is entered.
3. At390/320, content scrolls within the modal, controls wrap without horizontal overflow and Cancel/Save plus outer navigation remain visible. Keyboard focus and F reach/fit the canvas and scroll it into view.
4. Actual browser Back on the unsaved320px map keeps Add mounted, focuses Discard this map?, and disables editing. Keep editing preserves the same map/name and returns focus to its preview.
5. Save map writes Lobby countryside review to the real owner library, verifies exact readback, then returns to My maps and focuses the saved inspection heading. Every saved-geography row/preview says Needs a scenario, Use map is disabled, and the committed native bridge choice remains unchanged.
6. Cancel returns focus to the original Add map opener and retains the New game choices. Full page reload retains authentication and the owned map; Choose map → My maps lists it, and reopening completes current read/certification/rendering.
7. After HTTP worker integration, a fresh owned-map read loads the actual Angular module worker and reaches the real canvas with no current error. Old cached-chunk console errors from08:30/09:02UTC predate this checkpoint and are not current blockers.

[Read-only SQLite evidence](readback.json) verifies exactly1asset/1operation,0games/0creation_receipts,1598509 canonical UTF-8 bytes and fullSHA256 `6305b91faa19915eeea48e0bb473d900415ff00584fce318866d4e79e883926a`. Stored bytes exactly equal independently generated Countryside5km/seed17 bytes, not merely the same geometry hash. No private bytes or original owner IDs are included in this evidence.

## Screenshots

- [Desktop generated, named, unsaved](desktop-unsaved.png)
- [390px controls](390-unsaved.png), [390px keyboard preview](390-preview.png)
- [320px preview](320-preview.png), [320px unsaved browser Back](320-unsaved-back.png)
- [320px saved inspection/focus](320-saved-inspection.png), [390px saved inspection](390-saved-inspection.png)
- [Desktop saved inspection](desktop-saved-inspection.png)
- [Desktop reopened with actual worker-backed HTTP verification](desktop-reopened-worker-read.png)

## Timing and remaining gates

[Node generation](node-generation-measurements.jsonl) and [read stages](node-read-stage-measurements.jsonl) cover real5/10/15km Countryside assets under the existing generator/complete validator. The15km asset is8678100bytes; generation~8.4s and import/canonical/hash/complete certificate~5.0s in Node. These are not browser responsiveness or RSS measurements. Browser action-to-observation intervals include orchestration and are not benchmark latencies.

The permitted browser API exposes viewport control only; its read-only evaluation scope does not expose performance.memory. No supported heap/long-task profiler was available, so no peak-memory or frame-budget pass is claimed. Further repeated main-thread checking is being moved behind a reviewed worker boundary; largest-offered-size UX/performance validation remains separate.64MiB is a transport ceiling, not an RSS guarantee.

Actual browser Start/create-to-live is still pending explicit permission after automatic approval review rejected the action against the earlier design-only restriction. No retry, API workaround or empty sandbox substitution occurred. Native exact-identity create/reopen/replay/WS and live renderer lifetime tests are separate evidence; these screenshots do not replace that missing live-game browser action. Unpaired geography never becomes playable automatically. No merge or deployment.
