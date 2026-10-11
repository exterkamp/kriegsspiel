# Load generated maps onto the table

## Outcome and owner scope

**Owner directive, 2026-10-10 PDT:** plan the implementation before making code changes. Use Astra through Herdr. Deliver small, independently reviewable PRs that show progress toward the roadmap. Focus on loading generated maps onto the board so the owner can judge how they look; a general polish effort is not the goal.

**Subsequent execution authorization:** after plan acceptance, implement through Herdr and merge PRs incrementally after their gates pass. Deployment is outside the requested action. PR1 is the required outcome; convenience remains separate.

The required outcome is **generate/export JSON → load that saved JSON → inspect the same geography on a flat Three.js table**. The first product PR must provide that complete flow, including replacement and failure recovery. Contract work belongs at the beginning of that packet, rather than in a separate invisible scaffolding PR.

**Proposed default:** a standalone `/map-table.html` inspection page using the existing table machinery. The page starts empty, loads saved map JSON, identifies the displayed map and its metre extent, and provides Fit map, Top-down, Oblique and existing pan/zoom controls. Loading has Cancel, progress/status and actionable errors. A link opens map authoring. It carries public map geography without game pieces or game controls.

Memory is sufficient for this slice. Reload returns to an empty table; the saved JSON is the durable artifact. A catalog, browser persistence, automatic reload, new layers, marks, interactive ruler tools, scenario assembly, armies/objectives, engine conversion, server/protocol changes and live game integration are deferred. Existing table dressing may remain; improving it is not a deliverable.

This bridges **M3c's authored-map export to M3b's table display**, as defined in [roadmap.md](roadmap.md) and [map-gameplay-handoff.md](map-gameplay-handoff.md). It does not complete a playable generated scenario, Epic 4 or the broader table-polish story. Historical roadmap checkboxes are not current completion evidence.

## Planning snapshot

Read-only audit: **2026-10-11 05:10:52 UTC / 2026-10-10 PDT**.

| Item | Observed state / ownership |
| --- | --- |
| Planning checkout | `/Users/dominic/code/kriegsspiel-hq`, branch `main` |
| Accepted base | Local HEAD, `origin/main` and GitHub main: `6a9ac70243e0733b8356db1710d08d693e134c22`, merged PR #193 |
| Baseline CI | [Run 38112129366](https://github.com/exterkamp/kriegsspiel/actions/runs/38112129366), completed successfully on that exact head |
| Existing untracked material | `docs/hq-feedback.md`, `docs/hq-feedback-assets/`; feedback-recorder-owned, preserve |
| Protected map checkout | `/Users/dominic/code/kriegsspiel`, `319ad9e`, branch `docs/pr-and-work-conventions`; no switching, resetting or writing |
| Retained managed services | `hq-web` port 41161, `hq-api` 41271, older `hq-review-web` 41412, all up in the HQ checkout; retain as requested |
| Herdr | Coordinator `w3:p1`; task planning panes `w3:p5` and `w3:p6`. Unrelated `w6` and `w9` are protected |
| Planning actions | Source/issue/PR/CI/model inspection and this plan artifact only. No implementation, test execution, preview changes, issue mutations, commits or publication |

Baseline CI is evidence for the accepted base, not for future work. Node/npm and source setup follow `.nvmrc`, root scripts and D23. Existing `devrun` is available; older statements that it or GitHub access are unavailable are historical.

### Dependencies and other owners

| Prerequisite or related work | Verified state / owner | Effect on this plan |
| --- | --- | --- |
| [Epic 9 #132](https://github.com/exterkamp/kriegsspiel/issues/132) | Closed; dfezzie | Accepted map authoring/export is available in the base |
| [#22 table](https://github.com/exterkamp/kriegsspiel/issues/22) / [#118 continuous table](https://github.com/exterkamp/kriegsspiel/issues/118) | Closed; #22 unassigned, #118 exterkamp | Existing metre transforms, camera and table machinery are available |
| [#49 table polish](https://github.com/exterkamp/kriegsspiel/issues/49) | Open, unassigned | Related renderer context; its 60-piece/60fps and broader polish acceptance is excluded |
| [#129 vector table follow-up](https://github.com/exterkamp/kriegsspiel/issues/129) | Open, unassigned | Its body describes a historical tile stopgap; current source already uses continuous vectors. Do not duplicate the old migration or close it from this slice |
| [#90 scenario generator](https://github.com/exterkamp/kriegsspiel/issues/90) | Open, unassigned | Scenario/objective/OOB/balance work is excluded and does not block visual loading |
| Open PRs [#238](https://github.com/exterkamp/kriegsspiel/pull/238), [#239](https://github.com/exterkamp/kriegsspiel/pull/239), [#240](https://github.com/exterkamp/kriegsspiel/pull/240), [#229](https://github.com/exterkamp/kriegsspiel/pull/229) | All exterkamp-owned | Preserve conference, staff, drafts and opponent work; refresh before implementation |

Audited #238 head: `3cda5457b2d46c8629988514ffd37fc0a27b135e`; its files include `AGENTS.md`, desk Conference/Desk/store and staff-conference docs. Audited #240 head: `a15837b95954524effd035a03facb9fbec0c72e0`; its files include client/net, protocol, server/drafts and shared decisions/architecture docs. These are outside the writer packet. Shared documentation remains coordinator-owned and serialized.

No issue is created, assigned or closed during planning. Future PRs reference related stories without closing keywords unless their full criteria are actually delivered. If a tracking story is later requested, search existing/native sub-issues before choosing its parent and number.

## Observed source seams

| Source | What exists | Consequence |
| --- | --- | --- |
| [Authoring app](../client/src/map-authoring/authoring-app.ts) | Exports require current certified files and a matching valid draft | A retained old preview cannot authorize a new handoff |
| [Saved-load controller](../client/src/map-authoring/generation/controller.ts), [runtime](../client/src/map-authoring/runtime/adapter.ts), [validation worker](../client/src/map-authoring/validate.worker.ts) | Saved imports undergo complete validation in a fresh worker, without regeneration; superseded replies are rejected | Reuse this path rather than adding another validator |
| [Map identity](../packages/maps/src/canonical.ts), [export](../packages/maps/src/composition/export.ts) | Canonical JSON is authoritative; asset and geometry identities differ; SVG is derived | Preserve original geometry/provenance. Names can change without changing geometry identity |
| [Authoring renderer](../client/src/map-authoring/renderer.ts) | Canvas2D draws holes, independent cover/water, contours, road widths, crossing decks and buildings | Reuse its cartographic drawing for the table texture |
| [Table types](../client/src/table/types.ts), [texture painter](../client/src/table/mapTexture.ts) | BaseMap polygons have one ring without holes | Do not flatten generated geometry into BaseMap features |
| [Fixture scene](../client/src/table/FixtureTableScene.ts) | Staged scene replacement; artwork restricted to `/hq-preview.svg`, 1200×900, under the 4096/device cap | Add an explicit bounded preview seam; keep fixture defaults and restrictions |
| [HQ surface](../client/src/hq/data/continuousSurface.ts), [main](../client/src/main.ts), [live composition](../client/src/liveClient.ts) | HQ artwork/bounds/scopes are fixed; live authority and renderer are separate | Leave those compositions intact for this slice |

Read `AGENTS.md`, D3/D18–D25 in [decisions.md](decisions.md), [hq-contracts.md](hq-contracts.md), [map-authoring-guide.md](map-authoring-guide.md) and the handoff before execution. Reuse cartographic drawing only; the whole authoring preview/controller is not a drop-in game renderer.

## C0: architecture and contract gate

**Contract checkpoint, requiring coordinator and independent engineering review before dependent writing.** This is a prerequisite within PR1, not another product PR. The owner has authorized execution after plan acceptance. Routine contract review does not add a separate human approval gate to each implementation packet.

1. **Input and validation.** Accept supported `kriegsspiel/local-map` JSON only. Check file bytes before reading; reuse bounded import and complete worker certification, exact supported provenance checks and the existing finite watchdog. Expose saved loading only; an unused generation factory fails if invoked. Parsing or replay support alone does not certify a map. Initially consume the existing certified-export runtime without changing its worker protocol to remove unused SVG output.
2. **Ownership.** The importer owns immutable accepted assets and request identity. The raster helper owns candidate drawing data. The scene owns committed GPU resources and framing. The page owns file reads, workers, listeners, observers, cancellation and teardown. The renderer receives extent/artwork/registration data and no engine state, synthetic SideView, units, objectives or gameplay attributes.
3. **Raster and registration.** Draw from the accepted asset with `MapRenderer` and existing cartographic layers, omitting the screen-space scale overlay from the baked texture. Map the entire metre extent onto the entire paper. Do not use `fitViewport` unchanged: its 88% fit margin would bake an incorrect map offset. Define a uniform pixels-per-metre transform, content rectangle and UV mapping explicitly.
4. **Fractional sizes.** Integer canvas dimensions must not stretch or clip a rectangular map. A proposed sizing policy uses `scale = limit / max(widthM, heightM)`, content dimensions `widthM * scale` and `heightM * scale`, canvas dimensions rounded up, and UVs registered to the content rectangle. Account for texture Y orientation. Independent asymmetric/corner tests must establish the exact convention before acceptance.
5. **Scene seam.** Add a construction-time `public-map-preview` mode to `FixtureTableScene` and a separate `applyPreviewRaster` operation. Default construction retains current fixture image validation. Preview mode accepts only locally prepared bounded canvas/registration data and a source key; it contains no pieces, ghosts or marks and accepts no arbitrary URL/SVG input. Mode is fixed for the instance lifetime. Reuse private staged map replacement, board geometry, camera, picking and disposal; do not copy the scene or extract a general renderer framework.
6. **Metres.** North-west `(0,0)`, x east, y south; world X = x − width/2 and world Z = y − height/2. Use an extent-only BaseMap, with empty feature/piece/mark arrays internal to the preview adapter. There is no tile scaling or elevation mesh.
7. **Commit and cancellation.** Distinguish requested and displayed maps. Publish name, extent, identity and canvas only after current-request validation, raster preparation and a synchronous candidate-frame render succeed. Keep prior scene resources through this render checkpoint; on failure restore the prior scene/camera and attempt its render before reporting retention. If restoration rendering fails or the context is lost, report an unavailable display rather than claiming the old map is usable. This acknowledges a rendered frame, not a guarantee against future GPU/context failure. Late file reads, workers and queued preparations cannot replace a newer request or revive a disposed page.
8. **Identity and camera.** Track operation identity and full asset identity where needed; seed, filename or a geometry-only hash is insufficient. Fit a different accepted map once, including equal-sized replacements. Reapplying the same accepted map and resizing preserve camera position. Import/navigation never mutate saved geometry, settings, ordered overrides or provenance.
9. **Resource limits.** Determine `min(4096, device.maxTextureSize)` before allocating a candidate canvas. Bound pixel area and staging/cache count; cap anisotropy to device capability. Release replaced/failed candidate textures, materials, geometries and raster references once. Close/revoke any bitmap/blob intermediates if introduced. No browser storage or cross-window transfer is needed for PR1.
10. **Typed seam and reentry.** Construction options select `mode: "public-map-preview"`; default mode remains fixture. `PreviewRaster` supplies a local `HTMLCanvasElement`, immutable full-asset `sourceKey`, positive `widthM`/`heightM`, and positive fractional `contentWidthPx`/`contentHeightPx` within integer canvas bounds. The scene checks these against its device cap, registers UVs to that rectangle and returns a displayed acknowledgment from `applyPreviewRaster` only after the render checkpoint. Errors distinguish retained versus unavailable display. A synchronous apply guard rejects nested replacements for the entire preparation/render/cleanup transaction; it never silently accepts a nested candidate. Terminal disposal remains allowed and aborts publication. A disposal callback attempting another replacement must leave committed texture, identity, metadata and camera consistent, with each rejected/replaced resource released once.

C0 evidence is the exact typed seam, registration policy, lifetime/error rules, targeted test cases and reviewer acceptance recorded in the execution log. It unblocks PR1's importer, raster and table composition only. Changing an existing runtime/renderer API outside the assigned seam requires explicit coordinator ownership release and renewed boundary review.

The frozen construction/apply signature is:

```ts
type PreviewRaster = Readonly<{
  canvas: HTMLCanvasElement;
  sourceKey: string;
  widthM: number;
  heightM: number;
  contentWidthPx: number;
  contentHeightPx: number;
}>;
// Existing constructor options gain mode?: "fixture" | "public-map-preview".
// Preview-only methods; fixture instances reject these operations.
previewTextureLimit(): number; // min(4096, GL maximum), checked before CPU allocation
applyPreviewRaster(raster: PreviewRaster): void; // successful return acknowledges rendered frame
fitPreview(): void; // explicit fit without replacing the current asset
// PreviewApplyError extends Error: display: "retained" | "unavailable".
// No asynchronous acknowledgment, external image, scene state or URL accepted.
```

Raster UVs are `(0, 1)` at north-west, `(contentWidthPx / canvas.width, 1)` at north-east, `(0, 1 - contentHeightPx / canvas.height)` at south-west, and the corresponding pair at south-east with CanvasTexture's default flipY. The drawing transform has zero origin and uniform scale. The map plane rotates -π/2, preserving north at world -Z. Tests must verify these values and observed orientation rather than only repeating their calculation.

### Usable inspection and resolution gate

A whole-map raster has a practical detail limit. These are arithmetic estimates at 4096 pixels, not browser measurements:

| Metre extent | Ideal content pixels | Metres per texel | Illustrative 10 m footprint |
| --- | --- | --- | --- |
| 5×5 km | 4096×4096 | 1.22 | 8.19 texels |
| 10×10 km | 4096×4096 | 2.44 | 4.10 texels |
| 15×15 km | 4096×4096 | 3.66 | 2.73 texels |
| 5×10 km | 2048×4096 | 2.44 | 4.10 texels |
| 15×5 km | 4096×1365⅓ | 3.66 | 2.73 texels |

The footprint is illustrative, not an asserted minimum. D24's 0.8 m access corridors are subpixel even at 5 km. A 2048 device cap halves these feature widths; oblique viewing and mipmapping can reduce detail further. Zoom cannot recover geometry lost during rasterization. One 4096-square RGBA raster is 64 MiB before GPU mipmaps, CPU copies, assets, workers, staging and driver overhead; a texture cap is not a total-memory guarantee.

**First-product criterion:** the owner can inspect map orientation, extent, terrain arrangement, settlements, roads and crossings, with representative building detail shown honestly at each tested scale. Preserve geometry in the drawing path without promising every track/footprint is distinguishable at 15 km. Record pass/fail visual comparisons against the authoring view at overview, oblique and close-up scales. If screenshots show the preview is not useful, loading alone does not pass acceptance. A scoped follow-up does not satisfy a failed gate: complete the necessary bounded repair before claiming the inspection outcome delivered.

## PR strategy and packets

**PR1 and PR2 are authorized:** the owner explicitly accepted the direct authoring handoff during PR1 implementation. PR3 exists only if concrete visual evidence justifies it. No accumulating epic branch or overlapping PRs from one branch.

| Packet | Observable delivery / demo | Dependencies | Proposed model / effort |
| --- | --- | --- | --- |
| **PR1: Load saved battlefield JSON onto the Three.js table** | Generate/export, open `/map-table.html`, load JSON, pan/zoom/top-down/oblique, replace with another map, recover from a failed load | Refreshed accepted base and isolated execution location; C0 engineering gate | Writer Sol/high; independent review Sol/high |
| **PR2: Inspect the current authored map on the table** | A current validated result opens an in-memory board view without download/reimport; saved JSON loading still works | Accepted/merged PR1 implementation; direct handoff explicitly authorized | Writer Sol/medium; eligibility/lifecycle review Sol/high |
| **PR3: Resolve a demonstrated map-detail limitation** | A named failed close-up case becomes inspectable with unchanged coordinates and bounded resources | PR1 evidence plus a specifically scoped remedy; prioritize before convenience if needed for usability | Writer Sol/high; architecture review Astra/high if uncertainty remains |

### Exclusive paths and integration ownership

| Packet / role | Writable paths | Reserved / read-only boundaries |
| --- | --- | --- |
| PR1 single writer | New `client/map-table.html`, `client/src/map-table/**`; narrow `client/src/table/FixtureTableScene.ts` seam; `fixtureScene.test.ts` and dedicated preview-scene tests | Authoring renderer/runtime, maps package and picking are read-only consumers initially; no HQ/live/server/protocol edits |
| PR1 coordinator | `client/vite.config.ts`; this plan, future execution log and scoped map-table guide; justified decisions/handoff/roadmap documentation | Shared docs/config edits serialized with other owners; no lockfile/dependency change expected |
| PR2 single writer | `client/src/map-authoring/authoring-app.ts`, its tests, new handoff module and explicitly released reusable preview-mount API files | No worker protocol rewrite, catalog or persistence; table scene stays with its accepted owner |
| PR3 | Exact paths assigned only after evidence identifies the remedy | No blanket ownership of table/authoring directories |
| Reviewers | None | Read-only source, contracts, diff and evidence inspection |

PR1 internal sequence: C0 contract checkpoint → importer/raster → scene seam and page composition → focused failures/regressions → actual browser evidence → independent review and ordinary/current-head CI gates. These checkpoints are story-sized commits within one bounded product PR. Documentation and relevant tests ship with the behavior.

PR2 should prefer a same-document preview mount and immutable snapshot over browser storage or cross-window messaging. The click-time guard must recheck current certification, exact files and valid matching draft. Later edits do not silently replace an already opened board. Freeze a small handoff/mount contract before releasing those files.

For PR3, investigate a single bounded detail raster/local redraw before proposing tiling or a vector-mesh system. Its registration, cache and replacement policy need their own contract gate. Do not prebuild that infrastructure in PR1.

The critical path is sequential. One writer plus one independent reviewer is sufficient; parallelism is not needed to fill panes. PR2 cannot depend solely on an open PR1. Default future branches/PRs each target an accepted main base; stacking requires an explicit recorded exception and revalidation when the base changes.

## Model and Herdr policy

Initial planning selection, before investigation: **user-requested `gpt-6-astra`, high reasoning**, for the map-validation, cartographic-registration and renderer-lifetime boundaries. The live `/status` screen verified Astra/high and **Read Only (Approve for me)** immediately before dispatch. Planner: `map-board-plan`, `w3:p5`, session `01a1295d-c202-7a91-b980-ddff5d40afce`. The coordinator actually uses `gpt-6.1-sol`; it has not switched itself to Astra.

Independent planning reviewer: `map-board-plan-review`, `w3:p6`, session `01a12963-42ac-7ca1-9fdb-76e2cccf1614`; live `/status` verified **Sol/high, Read Only (Approve for me)**. Both agents retain cwd `/Users/dominic/code` and inspect the requested checkout by absolute path.

The installed `codex debug models` catalog lists `gpt-6-astra`, `gpt-6.1-sol` and `gpt-6-luna`, with high/medium supported. Future packet assignments in this plan remain proposals; actual session settings must be verified after any context reset and immediately before dispatch. Use Sol for bounded implementation/review, Astra for unresolved architecture, and Luna/medium only for sufficiently specified guide/evidence indexing. Task cost and future effective settings remain unknown; no spending settings or paid services change. See [official reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) and [approval configuration](https://learn.chatgpt.com/docs/config-file/config-reference).

Before escalating a failed packet, inspect the failure and improve its boundaries or acceptance evidence. Increase model/effort for a remaining well-specified difficult problem, not to compensate for overlapping ownership. Use fresh bounded context after preserving handoffs; do not erase active/blocked ownership or evidence to reduce tokens.

Follow the installed Herdr skill: verify `HERDR_ENV=1`, inspect live CLI syntax/inventory, use returned exact pane IDs, sibling topology and `--no-focus`. Inherited caller IDs currently say `w1:p1` but the verified live coordinator is `w3:p1`; re-inventory rather than using stale IDs or another client's focus. Planning agents are read-only even with automatic review. Future writers receive explicit bounded authority; automatic review is not permission to exceed it.

## Verification, review and recovery

These are **future gates**, not checks performed during planning:

- **Import:** real supported certified JSON succeeds; schema-valid but composition-invalid geometry, unsupported provenance, malformed/oversized input, read error and worker error fail visibly. Saved loading never invokes generation.
- **Lifecycle:** A→B→C selection, cancel during read/validation/preparation, timeout, late replies and disposal; only the current request publishes. Failure retains the last displayed asset without relabelling it as the failed file.
- **Registration and identity:** asymmetric landmarks, four corners/off-map points, square and rectangular maps, fractional raster/UV extents, CSS resize/DPR, top-down/oblique. No mirror, fit-margin offset or picking drift. Rename-only replacement updates artwork despite equal geometry identity; original canonical data is unchanged.
- **Cartography:** even-odd water/cover holes, dry islands, road-through-cover overlap, crossing decks, buildings and contours. Analytical/render fixtures may isolate these cases but must be labelled as fixtures; real end-to-end loading uses fully certified generated assets.
- **Resources:** lower/4096 device caps, invalid raster sizes, unavailable Canvas2D/WebGL, candidate allocation/render failure, equal/different-size replacement and teardown. Explicitly test failed replacement render and failed restoration render. Reject nested replacement from an old-resource disposal callback; verify texture, source identity, metadata, camera and exactly-once cleanup agree. Callbacks cannot restart a disposed scene. Do not claim recovery from an unusable/lost GL context.
- **Regressions:** default fixture still rejects unsupported blob/data/off-origin/incorrect imagery and preview canvases. Preview mode cannot import fixture pieces/marks. Existing fixture scene/surface and bootstrap/live routing tests remain valid.

Structural parsing and `MapRenderer` drawing are currently synchronous. Timers cannot interrupt synchronous JavaScript. Measure parse/raster stalls and distinguish cancel-before/after from interruptible worker work. Make a targeted change if representative use blocks; do not promise a hard wall-time bound or refactor all workers in advance.

Browser evidence uses actual generation/export/import on the tested source: 5 km flat seed17, wooded-hills31 and river-valley97; documented default 10 km seed17; maximum 15 km flat17; and certified 5×10 km/15×5 km recipes. Record settings, seed and identity rather than stretching a square JSON. An infeasible recipe is a generator result, not successful table evidence; obtain a supported certified rectangle without changing the generator scope and document its recipe.

Capture overview, oblique and close-up views, representative holes/crossings/road-through-cover details, replacement/error recovery, desktop and narrow viewports. Record browser, device/GPU texture cap, viewport/DPR, source head/tree, texture dimensions, parse/validation/raster timing and repeated replacement/teardown trends. Verify this page makes no game/API/WebSocket request. [Historical map verification](map-verification-report.md) supplies recipes and prior Canvas2D evidence, not acceptance of the new Three.js display. This is a bounded usable-preview gate, not #49's 60-piece/60fps project.

After focused checks, run root `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. A fresh environment uses the pinned source setup before `npm ci`. Obtain independent boundary review and targeted test-effectiveness evidence where meaningful, then inspect all required GitHub jobs on the exact current PR head, including the existing effectiveness job. Existing HQ probes alone do not establish effectiveness of new map tests. Use **herdr-pr-review** for that execution workflow rather than copying its procedure into this plan.

Failed gates produce a bounded repair packet with exact paths and findings, followed by affected checks and independent re-review. Registration, stale-result and dropped-hole failures need tests that would detect those actual faults. New integration/base changes invalidate affected evidence even if Git merges cleanly. Do not repeatedly broaden passing checks without a new change or unresolved concern.

Each PR description leads with its resulting behavior, includes the hands-on demo and exact-source verification/screenshots, and states practical resolution/acceptance limits. No broad closing keywords. Merge each accepted PR only after current-head CI, complete independent review, appropriate test effectiveness and visual acceptance; refresh main before the next packet. No deployment. D23's distribution boundary remains unchanged; local verification and source PR merges do not resolve it.

## Execution location, log, restart and cleanup

**Execution isolation:** use `/Users/dominic/code/kriegsspiel-map-table` as a task feature worktree, with its own managed preview. Implementation authorization now covers kickoff of this planned isolated work. Preserve the existing main checkout/services and the separate map-generation checkout. Task agents remain sibling panes with cwd `/Users/dominic/code`, operating on the feature path explicitly; no new Herdr workspace/tab is needed. Record the actual worktree, branch and preview URL before dependent browser work.

Create `docs/map-table-execution-log.md` when implementation is authorized. The coordinator records C0 acceptance, accepted base/head/tree, owner and exclusive paths, pane/agent/cwd, actual model/effort, packet state, checks, screenshot/evidence locations, findings/repairs, accepted checkpoint, blockers and next action. Planning does not invent accepted implementation entries.

On resume, reconcile the log with Git, current issue/PR owners, live agents, managed services and artifacts before redispatch or cleanup. Preserve dirty/untracked work and previous accepted evidence. Use `devrun` for later browser validation; obtain its actual URL rather than choosing ports. Existing services remain retained as requested. No service start/stop is part of this planning task.

**Final cleanup packet, coordinator-owned:** after required implementation/review checks finish, save each task agent's handoff, source/evidence locations and unresolved findings. Confirm the relevant agents are idle/done and no pending packet needs them. Close only task-owned worker/reviewer panes; retain the coordinator/user pane, unrelated workflows, source/evidence and owner-requested previews. Stop only a task preview whose feedback purpose is finished. Never close or schedule termination of the current coordinator. Planning specialist panes can be closed once their reports/review are preserved here and their work is settled.

## Planning review and first handoff

Status: **Independent plan delta and C0 engineering signature accepted by Sol/high.** No product gates are satisfied by those engineering reviews.

The independent Sol/high review required explicit preview isolation, a candidate-frame render/recovery boundary, rejection of reentrant replacement, and completion of repairs for any failed inspection gate. These revisions address all four; the reviewer must accept the delta before dispatch.

The first implementation packet is PR1. After delta acceptance, refresh the exact base and ownership, create the isolated execution worktree, record C0 engineering acceptance, then dispatch one Sol/high writer with its exclusive paths, protected boundaries, saved-file demo and failure/browser/check evidence. PR2 and PR3 remain separate proposals until their prerequisites and scope are accepted. No implementation agent has been dispatched at this planning checkpoint.
