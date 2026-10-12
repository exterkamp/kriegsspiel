# Angular local game initialization landing plan

Status: **accepted for engineering planning after independent source-bound review**. Planning only: this artifact was the planner's sole authorized write; the coordinator also maintains the landing log. No implementation, Git mutation, branch switch, checks, preview
change, publication, merge or issue change is launched by this plan.

## Outcome and source snapshot

Deliver the remaining approved local setup flow in Angular: a development-only `/dev/local-board` opens a certified canonical default board; Settings → New game selects or generates/saves a map; Start
replaces the entire local session; Cancel preserves it. Personal marks and a small notebook work on an empty, stopped board. Preserve the separately merged saved-map inspection behavior and all live
routes.

Owner directives: Angular only; respect D28; reuse accepted P0/P1/P2; no retired HQ UI, Svelte, simulation, scenario conversion, resume, production storage or deployment. Architecture below is the
planner's proposed default, subject to independent engineering review, not another owner scope question. Earlier ready-PR merge authorization persists for later execution; this turn merges nothing.
Port 8090 and other-owner cutover work are outside task ownership.

| Source | Pin / consequence |
| --- | --- |
| Current main, read from freshly updated `origin/main` | `b6710565a08c7c1595d074149769680ecf3ab3dc`, tree `2d542b08335eb9e131d32d5611498fecbab06fd8`; Angular cutover merged by its owner |
| Audited cutover PR #292 / issue #279 | Candidate `f55395b6bd2b282dc6f71c1dad217ce9ea9cc86d`, formerly based on `51d4d366495f00174f9ab8dc7da7fd69c297a11f`; Git diff to actual merged main is empty. Cutover wait is cleared, preservation/restoration gates below remain |
| Pre-cutover source for accepted code | `51d4d366495f00174f9ab8dc7da7fd69c297a11f`; read via Git objects, never restore that whole tree |
| Canonical landing checkout | `/Users/dominic/code/kriegsspiel-game-init-landing`, branch `landing/game-setup-view`, HEAD `71a5038a500fb60ac385b522881ac33f9471467f`; remains on old Svelte base, not current-main compatible |
| Reviewed Svelte P4 reference | `279dbb1fb6517bc18e67534a3bc024ea6f6dcd05`, tree `27868dbb5bd8d8875e4b84048b5cd873e1e1eb38`, base `eed7148290fc8d389cd7ed30815388ae2971666f`; 11 historical tests and accepted delayed-list repair are behavioral specifications only |
| Frozen original POC | `da9dd0ba39bd7c101f069269272bb1c083027df3`, protected `/Users/dominic/code/kriegsspiel-map-table` |
| Accepted earlier merges | P0 #241 `346fd92196bd35d4d1ac7f8f003060a42b494272`; P1 #281 `76f284edfedd77c214b78e92840fbf8055dffbca`; timeout #285 `7cda02007455909606cddb89bb4f807dc96ee1ce`; P2 #283 `eed7148290fc8d389cd7ed30815388ae2971666f` |

Audit date: 2026-10-11. Read current/pre-cutover AGENTS, decisions (D19/D23/D26/D28 and cutover D29), architecture, migration, Angular routes/shell/game/table/marks/build/proxy/tsconfigs, accepted
preparation/catalog/raster/scene code, and original plans/logs. Cutover CI run `38185038783` is reported green for both jobs; it establishes no acceptance for these future packets.

Historical detail remains in [landing log](game-initialization-landing-log.md) and the protected original `docs/game-initialization-{implementation-plan,execution-log,landing-plan}.md`. Independent
baseline requirements were read from `.local/game-initialization-landing-evidence/angular-planning-baseline-review.txt` and `angular-cutover-baseline-review.txt`; neither is final plan acceptance.
Coordinator owns its separate ledger update; this planner does not edit it.

## Preserved work and model audit

- Planner `w3:pH`, GPT-6 Astra/high: effective footer verified; selected before investigation for architecture, asynchronous ownership and cutover boundaries. Coordinator `w3:pF` GPT-6.1 Sol/medium,
  reviewer `w3:pG` GPT-6.1 Sol/high also verified. Reviewer was settled; coordinator focus retained. No agents dispatched or panes changed by the planner; coordinator dispatch, pane creation and focus restoration are recorded in the landing log.
- Protected reference dirty files: `client/map-table.html`, `client/src/map-table/page.ts`, `docs/decisions.md`, `docs/map-table-guide.md`. SHA256 respectively
  `94914768c2c2860a9b0e16b7083611df6f831bf45373088350a10f6a5c267204`, `f857055627e7c97aeed33e7fc4d29ec0b3ec18faea31c750be4d8be623f27849`,
  `81502467eecc8e633e113fb6c5e85ad91a2f25b821fe351bdbdb7d1da00d877e`, `2f0738ef18a67f4376c31e3348d9d339df75098e0a41d0388c8627028055fce8`.
- The decisions file includes the committed POC addition; removing only appended D27 reproduces original protected hash `4dd55ab91f76537d3aa23112dfe156224d1c65ad9286dfeef3d1f6bf8a416e3c`. All four
  protected edits match; no dirty content is an extraction source.
- Landing ledger is now coordinator-modified and protected from this planner. Preserve reference untracked plan, ignored maps/evidence, historical P4 artifacts, original source branches, unrelated
  checkouts and w6/w9 plus original `w3:p1`.
- Read-only devrun inventory and listeners show 41930 (old P4), original 41503, and HQ 41271/41161/41412 up. None is evidence for current Angular main. Preserve all during planning; stale registry
  `w1` ownership must not override verified live pane IDs.

## Cutover survival and exact restoration inventory

All new packet paths below are relative to the landing checkout **after coordinator-only execution preparation on fresh Angular main**. There is no remaining `client-ng` delivery option. #292 is
other-owner work; do not amend/revert it. Recover accepted functionality in focused successor PRs.

| Pre-cutover path at `51d4d36` | Actual merged cutover | Required destination / owner |
| --- | --- | --- |
| `client/src/game-setup/{contracts,catalog,preparation}.ts`, `{catalog,preparation}.test.ts` | Deleted | A2 restores to `client/src/shared/game-setup/` with adapted imports/worker URLs; coordinator owns contract changes |
| `client/dev/mapCatalog.ts`, `mapCatalog.test.ts` | Deleted | A0 extracts reusable Node handler/sidecar into `tools/local-map-catalog/`; no Vite dependency or plugin revival |
| `client/src/map-table/{loader,raster,page}.ts` and matching `.test.ts` | **All deleted, including raster** | A1 reuses pure loader/raster algorithms in `client/src/shared/map-table/`; the imperative page is behavioral evidence only, replaced by native Angular state/UI |
| `client/map-table.html`, `client/src/map-table/{main.ts,style.css}` | Deleted; server redirects `/map-table.html` to `/` | A1 Angular `client/src/app/map-table/map-table.component.{ts,html,css,spec.ts}` reimplements inspector with Angular signals, template bindings, component-scoped service and lifecycle ownership; coordinator restores route and bookmark |
| `client/src/map-authoring/**` | 33 retained TS files moved byte-identically under `client/src/legacy/map-authoring/`; old `main.ts` deleted | Reuse surviving modules and tests in place; keep Angular authoring wrapper and its corrected worker URLs |
| `client/src/table/**` | Pure table modules/tests survive under `client/src/legacy/table/` | Reuse P2 scene and helpers; no new scene fork or move of the whole live client |
| `data/maps/{catalog,countryside-rectangle,wooded-hills,river-valley}.json` | Retained byte-identically | Keep authoritative files here; only development build copies default rectangle as specified below |
| `client-ng/src/app/**`, build/proxy/tsconfigs | Now `client/src/app/**`, `client/{angular.json,proxy.conf.cjs,tsconfig*.json}` | Coordinator only for shared integration; preserve live shell/desk/services |
| old test runners | `client/package.json`: `ng test --watch=false && vitest run`; plain include `src/**/*.test.ts` | Retain both runners; new shared `.test.ts` are discovered; A0 owns explicit tools test runner/typecheck integration |

Minimum transitive browser graph to keep resolvable (brace lists name exact files, not permission to edit directories):

- P1 → `legacy/map-authoring/{asset.ts,generate.worker.ts,validate.worker.ts}`, `generation/{index,controller,protocol,worker-runner}.ts`, `runtime/{index,adapter,protocol,validation-runner}.ts` →
  `@kriegsspiel/maps` and its pinned SettleMaker artifact.
- Setup preview → `legacy/map-authoring/{preview,renderer,geometry,viewport,display-lifecycle}.ts`; recipes → `controls/recipe.ts` and generation protocol. Keep their `.test.ts` coverage and
  `worker-entries.test.ts`.
- Restored raster → `legacy/map-authoring/{renderer,asset}.ts` and `legacy/table/FixtureTableScene.ts`; restored loader/page → raster, runtime/workers and scene. Retain `loader.test.ts`,
  `raster.test.ts`, `page.test.ts`.
- P2 `legacy/table/FixtureTableScene.ts` → `{mapTexture,picking,framing,dressing,tagText,fixtureMarks,types,gameTime}.ts`, Three.js/OrbitControls, protocol coordinate types and zod. Keep
  `previewScene.test.ts` reentrant-disposal cases, `fixtureMarks.test.ts`, fixture/scene/table/polish tests.
- Existing live `legacy/table/TableScene.ts`, `fixture.ts`, `sceneState.ts`, `marks.ts`, `markTools.ts`, `transition.ts`, `performanceFixture.ts` and `benchmark.ts` remain other-owner live/benchmark
  dependencies; do not replace them with the local adapter. Preserve `client/public/hq-preview.svg` for benchmark use.

Coordinator records a source-bound manifest in the execution log/evidence: original path/blob → actual merged path/blob → restored path/blob, with explicit intentional adaptations, test destination
and runner. Compare actual merged blobs, not PR prose. The current cutover tree equality is verified; recheck fresh main before each packet. Review every restored import/export, relative URL and test
fixture path through to package/assets. No runtime/type import may resolve into deleted `client/src/game-setup`, `client/src/map-table`, `client-ng` or retired `hq`.

New helpers use explicit relative imports into the **surviving** `client/src/legacy` graph; they do not depend on old `@legacy` mapping to a deleted workspace. Existing cutover `@legacy/*` correctly
points at `./src/legacy/*` and may remain for upstream consumers. Renaming that surviving directory repo-wide is unnecessary scope.

## Proposed contracts and Angular boundaries

**Entry/default.** `/` continues the existing shell: auth, guest, menu, scenario New Game, lobby, invite/live and game-over remain unchanged; `?mode=fixture` remains retired. A sibling lazy
`/dev/local-board` bypasses `ShellComponent` and its API bootstrap entirely. No GameService, DeskStore, live MarksService or live TableService is provided/injected by this route. A route-local
Settings dialog exposes New game; a normal link returns to `/`.

Default/reload/recovery uses certified `premade:countryside-rectangle`, 5000×3000 m, hash `26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84`. Development assets copy its exact bytes
from `data/maps` to `/__local-default/countryside-rectangle.json`. Startup fetches that static asset and performs complete worker certification; it needs neither game API nor catalog sidecar. No
generated-map pointer, demo armies or simulation fixture is restored. Every reload/default recovery gets a fresh personal scope; generated JSON files remain discoverable through catalog.
Missing/default certification failure shows Retry and an honest error, never an uncertified fallback.

**Build exclusion.** Coordinator adds `client/src/app/development.routes.ts` exporting an empty Routes array by default and `development.routes.dev.ts` with the lazy route. Only Angular `development`
configuration replaces the former with the latter; `app.routes.ts` spreads it before wildcard. Development-only assets override retains existing public assets and adds only the default rectangle.
Production has no route import, feature action, local default asset or catalog proxy. A runtime `isDevMode` check/hidden button alone is insufficient. Angular [file
replacements](https://angular.dev/tools/cli/environments) support this compile-time boundary.

**P1 unchanged semantics.** `MapRef={kind:'premade'|'generated',id}`, MapSummary, MapCatalog list/read/save and BoardPreparation load/generate/dispose remain. CertifiedBoard is
detached/structured-cloneable: current certified asset, matching canonical JSON, full `assetIdentity(asset,'asset')`, summary/ref and NW-zero metre bounds. Generated ref stays null until successful
save. Storage import validation is never complete certification. Use exact supported recipes/settings/ordered overrides; no geometry or recipe hash substitutes for full asset identity.

**Minimal local types.** Coordinator freezes `client/src/app/local-board/contracts.ts` before A3/A4 consumers: `LocalScope` (fresh `local-UUID`, fixed local player/blue side), `LocalBoardBinding`
(full identity/revision, `local-map:<identity>`, bounds, NW registration), `LocalPresentation` (binding + validated render-only marks; stopped time 0, empty pieces/roster/papers), session key and
one-shot initialization result `{key,ok,error?}`. Capability is explicitly local. Do not restore HqDataSource/HqRepository/PublicArtwork/MapSurface unions, fixture capabilities, report placement, full
Settings or orders tree.

**Renderer adapter.** Alias the export named `TableScene` from `legacy/table/FixtureTableScene.ts` locally as `FixtureTableScene`; the identically named export from `legacy/table/TableScene.ts` is the
separate live renderer. Construct immutable mode `local-hq-board`. Recompute full identity before allocation; require asset/canonical bytes, bounds, summary, binding revision and raster
sourceKey/dimensions to agree. Use extent-only map geometry, never terrain-to-BaseMap simulation conversion. Preserve fractional content UVs and device cap (`localBoardTextureLimit`).

Prepare one raster per session, then call `applyLocalBoard(raster, sceneMarks)` for personal edits. Keep fixed binding, standalone `public-map-preview` rejection, no pieces/game state and P2
reentrancy/disposal guards. After apply, frame the camera and call `renderLocalBoardFrame()`; only a successful actual frame after framing acknowledges readiness. Mount/change-detection/queue
completion is not readiness. Retry allocates a fresh scene, including after context loss; mark edits do not rerasterize.

**Personal data.** Route/session-scoped `PersonalStore` and local repository persist only manual marks and notebook notes under a new namespace keyed by full LocalScope and map identity/revision.
Never use live `MarksService` unchanged: it reads GameService, uses live TableScene/fixtureMap and sends server marks. Never use root DeskStore's journal/tray/draft/window state. New session starts
empty even for the same map; old records are retained but have no resume selector/pointer.

Extract only relevant pure validation, scope comparison, manual mark editing and notebook serialization algorithms from frozen `hq/data/marks/{validation,controller,repository}.ts` and
`hq/views/journal/notes.ts` (not the preferences repository), adapting to the small new types. Extract relevant pure assertions from `hq/views/journal/Journal.test.ts`; preserve note/document limits, corrupt and future-version rejection, scope checks and visible storage errors in new Angular/pure repository tests. Use retained `validateSceneMarks` at the render boundary. No wholesale HQ contract/repository restoration. Storage failures remain visible; do
not silently report success or switch persistence to an undocumented memory fallback.

Minimal Angular presentation: board, stopped clock/status, Settings/New game, marks tools (manual pin/polyline/arrow/ring/symbol, label/edit/delete plus numeric placement), notebook
add/edit/search/export and return-to-table. No roster/conference/in-tray/order UI is revived. Notes/marks and unsaved notebook form survive setup Cancel and local view navigation. Escape/Delete
shortcuts ignore typing/contenteditable and are disabled behind dialogs; keyboard focus and labels are part of acceptance.

## Actual development transport, workers and assets

A0 extracts P1 filesystem/request logic to `tools/local-map-catalog/handler.ts`; `serve.ts` binds `127.0.0.1` on required `PORT`, only with explicit `LOCAL_MAP_CATALOG=1`. Module-derived repository
root is passed as absolute premade/generated directories; never depend on shell cwd. Compile with its own `tsconfig.json` (NodeNext, Node types, strict; output `.local/local-map-catalog`), importing
built `@kriegsspiel/maps`, no Angular/Vite imports. `.local` output is ignored and is not a deployed service.

A0 delivers `tools/local-map-catalog/types.ts` with Node-safe MapRef/MapSummary DTOs containing only the existing catalog fields and no Node, Angular or browser imports. C0 freezes their field/error/serialization compatibility with P1; A0 owns the DTO implementation and endpoint contract tests. The handler must not import the future A2 browser contracts or any `client/src` implementation. A2 delivers its restored P1 contracts and the minimal local-board contracts atomically with its services, with compatibility checks against A0's DTOs and actual transport. C0 is contract review, not a contracts-only commit or an uncommitted dependency.

Because root build compiles the helper, A0/coordinator also owns a narrow Dockerfile build-stage input change: copy `tools/local-map-catalog` into the builder before `npm run build`. Preserve the current production final stage: do not copy tools, `.local/local-map-catalog`, generated maps, or sidecar startup into it. A0 must run a local image build from the complete context and inspect the final image for helper absence; this does not publish or deploy the image.

Coordinator adds `build:map-catalog`, `typecheck:map-catalog`, `test:map-catalog` and explicit root build/typecheck/test chaining; A0 tools Vitest config includes
`tools/local-map-catalog/**/*.test.ts` with package aliases. Build maps before sidecar typecheck/compilation/start so package declarations exist on a clean checkout. Do not put tests under
`client/dev` and assume `src/**/*.test.ts` finds them. Sidecar source/tests must be in their TS typecheck program.

After setup/build, future managed command is `LOCAL_MAP_CATALOG=1 devrun up --name init-map-catalog --port-env PORT -- node .local/local-map-catalog/serve.js`. Start Angular through a separate named
devrun process with `LOCAL_MAP_CATALOG_URL` set to `devrun url init-map-catalog`; no fixed port or use of protected servers. Never start either during planning.

`client/proxy.local-board.conf.cjs` extends current API proxy and adds both `/__local/maps` and `/__local/maps/**` to the supplied sidecar URL, with path unchanged. Angular development serve selects
that file; production serve keeps ordinary proxy. No sidecar URL means no local proxy and visible catalog-unavailable error, not API fallback. Angular's [serve proxy
rules](https://angular.dev/tools/cli/serve) distinguish base and descendant paths. Verify GET list/read and POST save through the actual Angular origin, including non-JSON/SPA fallback rejection.

Retain P1 64 MiB/import bounds, ID-only paths, catalog allowlist, corrupt-file omission/logging, explicit read errors, exclusive `wx` UUID writes, byte-exact bodies, status/error contract and no
overwrite/delete. Save abort may leave a completed file; later list can find it. Uncertain retry may create a duplicate; no deduplication/transaction project. Production server, Docker and compose
never start or mount this helper.

A2 `shared/game-setup/preparation.ts` uses static `new Worker(new URL('../../legacy/map-authoring/generate.worker.ts', import.meta.url), {type:'module'})` and corresponding validate URL. Reuse
existing runtimeFactory injection for tests and real runtime disposal. Preserve `angular.json` webWorkerTsConfig and `client/tsconfig.worker.json` include `src/legacy/map-authoring/*.worker.ts`; add a
direct worker typecheck if ordinary app/spec checks do not cover it. Test actual emitted worker chunks, not just Worker doubles. [Angular worker
support](https://angular.dev/tools/cli/build-system-migration) requires compatible static construction syntax.

Retain `packages/maps/**`, `vendor/settlemaker/**`, `vendor/settlemaker.snapshot.json`, canonical runtime tgz, `scripts/{setup,verify}-map-source.mjs`, lockfile pin and notices. Source revision
`e08ec2e09f9a15f9110a3048123a31a58d08c341`, 163-file snapshot, consumed artifact SHA256 `df41ca6e340f068f68600be702a74d3db74e165a4f61727916279ccfd3785f84`; do not regenerate maps or change provenance
to accommodate migration. Node `.nvmrc` is 22.23.3; npm 10.9.7 in CI. D23 distribution gate persists.

Canonical file SHA256: catalog `959664bbafad8ae0d40e69681e8f0a013e12b5ce5632780ed24226e5d70c989b`; rectangle as above; wooded-hills `ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed`;
river-valley `bf704cc07170dcf9b7587c11bee7db54139220ef9b8a69384c01f4de68b7aba2`. Preserve `.prettierignore` `data/maps/*.json`, `assets/maps` notices and `.local/generated-maps` contents; development
copying must preserve bytes and production must omit copied defaults.

## Asynchronous ownership and recovery contract

1. Local route owner provides session services per mounted session, never `providedIn:'root'`. It owns route generation, startup AbortController, active session handle and setup handle. Register
   DestroyRef cleanup synchronously before any await; `ngOnDestroy`, page departure and replacement share idempotent teardown.
2. Every async boundary checks captured generation/session identity, aborted signal and destroyed state **before and after** await: default fetch, catalog list/read/save, certification/export/hash,
   repository open, render initialization, callback and error/finally paths. Late rejection cannot set error/status/focus on a stopped route. Register cleanup for any handle that resolves late and
   dispose it immediately if ownership expired.
3. Host tracks canvas identity with `afterRenderEffect` over a signal query, registers cleanup before allocation, and reads service state untracked. Angular template HMR can recreate a view while retaining its component/service; fully retire the old canvas mount before allocating the replacement, reject old callbacks by mount token, and clear historical readiness until the replacement renders. Check destroyed/session identity before allocation, catch partial construction and dispose owned resources. Effects/listeners/ResizeObserver/pointer
   capture/RAF/timers/worker subscriptions belong to that host/session and are removed exactly once. Angular signals hold plain snapshots, never proxy or mutable Three.js ownership.
4. Setup is a full-size modal over the existing board. Its preview/runtime has separate ownership, not shared GPU resources. Board mount and personal state stay alive; its input/shortcuts are gated.
   Cancel/Escape abort setup operations, terminate workers, dispose preview, close dialog and restore focus to its original trigger if still connected. During committed Start, repeat Start and Cancel
   are disabled; route departure still cancels.
5. Selection uses MapRef key, not list index. Each load/generate/save has operation token. Recipe edits invalidate current eligibility; old retained display is not authorization. Late initial list
   merges with current saved summaries, keeps newer metadata on duplicates, and rebinds the selected ref. InitialRef applies only before user work. Port both accepted delayed-list regressions plus
   cloneability; all success/error/finally callbacks obey tokens.
6. Start requires current certification, exact draft recipe and non-null saved ref; failed save retains certified result for Retry save with Start disabled. The owner validates/clones the current
   board, invalidates setup callbacks, destroys old session completely, removes keyed host, and waits for Angular render/destruction acknowledgement before allocating the next scope/host. Use keyed
   `@for (...; track session.key)` or equivalent explicit component lifecycle; replacing an input alone is insufficient.
7. Before replacement commit, failure leaves old board intact. After commit, old session is disposed permanently; failed initialization offers Retry same certified board or Return to default board.
   Both allocate a fresh key/scope and rerun binding checks/render acknowledgement. Cancelling preparation invalidates immediately, while operation settlement follows deferred retirement; retain and await the cancelled operation promise before successor allocation/teardown acknowledgement. No rollback/staging second board, resume pointer or production repository. Late success/error from replaced host
   cannot affect new one.
8. Navigation away destroys route/startup/setup/session; back creates the canonical default. Reload likewise creates default. For bfcache, pagehide disposes local work and pageshow-persisted starts a
   fresh default; no hidden live reconnect. Listener registration and restart tokens are idempotent.
9. Angular owns bootstrap/HMR. Do not transplant Vite `import.meta.hot` or old Svelte `startShell` teardown. Template/style HMR may retain the current host; keep one owner. If Angular
   destroys/recreates it, old resources stop and the new route defaults. Exercise actual development HMR and destruction before/after pending startup completion; use Angular lifecycle tests for
   deterministic timing. General arbitrary JavaScript HMR is not assumed supported.

Observed live seams: Shell checks `stopped` after fetchMe but not after awaited guestEnabled, and prepare catch can publish after stop; GameComponent's fetch catch also lacks its success-path
destroyed guard. These motivate local tests, not authorization to refactor live lifecycle. Dedicated route avoids those boot paths. Preserve live code and record independent pre-existing failures
separately; coordinator may narrowly repair an integration regression only when caused by this series and reviewed.

## Focused packets, dependencies and exclusive paths

Serial default; at most one reviewed-prerequisite stacked draft, never merge against an unaccepted feature branch. All rows include focused tests/docs with the behavior, not a final tests-later
packet. Labels A0–A5 (including A3a/A3b) are plan packets, not issue numbers. No new issue changes or invented closing keywords.

| Packet / focused PR | Dependencies and deliverable | Exclusive writer paths | Model / acceptance gate |
| --- | --- | --- | --- |
| C0 execution checkpoint (no separate PR) | Refresh actual Angular main, preserve old checkout checkpoint/evidence, source survival manifest; freeze DTO and local contract specifications, implemented within A0/A2 | Coordinator: Git/workspace/log/contracts/config only | Coordinator Sol/medium with Sol/high contract review; no file released until its dependencies resolve |
| A0 Development catalog sidecar | Accepted P1 logic from pinned pre-cutover main; standalone list/read/save survives Vite removal | `tools/local-map-catalog/{types,handler,serve}.ts`, `*.test.ts`; coordinator owns its tsconfig/Vitest config, root scripts and Dockerfile build-stage input | Sol/high (transport/adapters); real socket/temp-dir tests, canonical bytes, failures, abort/exclusive writes; retain #285's **targeted 30000 ms** expensive save/readback/certification test bound, no global timeout change |
| A1 Restore Angular saved-map inspection | C0; P0 loader/page/raster plus surviving authoring/P2 graph; no A0 dependency | `client/src/shared/map-table/{loader,raster}.ts`, matching `.test.ts`; `client/src/app/map-table/map-table.component.{ts,html,css,spec.ts}` and `map-table.service.{ts,spec.ts}` | Sol/high (host/worker lifecycle); actual file load/certification, retained display on invalid replacement/cancel, top/oblique/focus controls and teardown; restored imports/coverage must run |
| A2 Restore certified setup services in Angular | C0 + A0; A1 raster is not required for preparation but is required before board UI | `client/src/shared/game-setup/{catalog,preparation}.ts`, matching `.test.ts`; coordinator delivers `contracts.ts`, `client/src/app/local-board/{contracts,default-board}.ts` and worker/config seams in this same PR | Sol/high; exact contracts/recipe/hash, worker cancellation and delayed hash; defaults certify in real Angular workers; transport integration through Angular origin |
| A3a Isolated certified board rendering | Accepted A1/A2 including delivered minimal contracts | `client/src/app/local-board/{board-binding,board-surface}.ts`, matching `.spec.ts`; `board-host.component.{ts,html,css,spec.ts}` | Sol/high binding/host; accepts validated render-only marks through frozen inputs, with no A3b imports; identity/bounds/raster/frame acknowledgement and exactly-once disposal |
| A3b Personal marks and notebook | Accepted A2/A3a contracts and board host | `client/src/app/local-board/{personal-repository,personal-store}.ts`, matching `.spec.ts`; `marks.component.{ts,html,css,spec.ts}`, `notebook.component.{ts,html,css,spec.ts}` | Sol/high storage/editing; Sol/medium ordinary templates by separate file release; fresh scoped notes/marks, editing/navigation, corrupt/version/scope rejection and visible storage errors |
| A4 Angular selection/generation setup | Accepted A2 + frozen Start/cancel contracts; independent of A3a/A3b after A2 contract delivery/acceptance | `client/src/app/local-board/setup/{setup-state.ts,setup-state.spec.ts,setup.component.ts,setup.component.html,setup.component.css,setup.component.spec.ts}` | Sol/high state/lifecycle, Sol/medium template/styles; retain 11 P4 behavioral cases and extend late operation, save/edit/Start, deferred-list and cloneability coverage |
| A5 Development route and session replacement | Accepted A3a/A3b/A4 and preservation checkpoints | Coordinator: `client/src/app/local-board/{local-board.component.ts,local-board.component.html,local-board.component.css,local-board.component.spec.ts,session-owner.ts,session-owner.spec.ts}`, route/config/entrypoint integration | Sol/high lifecycle implementation/review; whole-flow fresh evidence including production absence, retry/default, live preservation and post-integration CI |

Coordinator alone edits shared `client/src/app/{app.routes.ts,app.routes.spec.ts,app.config.ts,app.config.spec.ts,development.routes.ts,development.routes.dev.ts}`,
`client/{angular.json,proxy*.cjs,tsconfig*.json,vitest.config.ts,package.json}`, root package/lock/config, Dockerfile build-stage inputs, existing shared TS/worker entries, `server/src/api/{spaFallback.ts,app.test.ts}`, contracts
and docs. Do not give a worker broad `app/**` or `legacy/**` ownership. `client/src/main.ts` changes only if an actual owned bootstrap defect requires them, not by default.

A1 coordinator wiring adds lazy `/map-table`, Angular `/map-table.html` → `/map-table`, server OLD_PAGES mapping to `/map-table` and `/map-table` SPA fallback. Preserve query handling and API 404
boundaries. This file-only inspection route retains prior built behavior; it does not expose catalog/local setup in production. Reimplement page behavior with Angular template bindings/signals and a component-scoped resource service; do not ship `mountMapTable` or document-wide DOM queries,
not old module auto-start. Keep the protected dirty scale-marker additions out.

A2 coordinator wiring installs dev proxy, worker compile coverage and development-only default asset. A5 adds compile-time route replacement and Settings composition. Relevant docs travel with each
PR: A0 `docs/dev-map-catalog.md`; A1 `docs/map-table-guide.md`; A2/A3a/A3b `docs/game-initialization-angular-guide.md`; A5 same guide plus README, decisions, architecture and migration corrections. Reserve
actual decision number from refreshed main; do not reuse D27/D28/D29 blindly. Historical logs remain historical.

Critical path: C0 → A0/A1 → A2 → A3a → A3b → A5, with A4 independently available after A2. Default execute serially A0, A1, A2, A3a, A3b, A4, A5. A0 and A1 are independently ready on current Angular main after C0; A4 may precede A3a/A3b with delivered, accepted A2 contracts. Cutover is now merged, so there is no external #279 wait; missing restoration/contract acceptance is the real dependency. No claim that cutover CI or P4 history clears it.

## Verification, review and delivery gates

Every future PR freezes head/base/merge-base/tree and changed-path inventory. Independent Sol/high review covers every changed path and incoming integration, with bounded repairs/re-review. Source
hashes and logs must identify the actual tested Angular source. Current main moves require fresh compatibility inspection; successful Git merge alone is insufficient.

- Ordinary checks: pinned map-source bootstrap/setup and dependency installation when required; `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Preserve root `verify:map-source`,
  Angular `*.spec.ts`, plain `src/**/*.test.ts`, explicit A0 tools tests/typecheck and worker typecheck. Root build includes production Angular output plus sidecar compile, without starting it.
- Verify discovered suite paths/counts against the survival manifest. Keep P0 loader/raster/page regressions, P1 catalog/preparation and exact 30-second socket test, P2 detached predecessor/reentrant
  disposal cases. Retain semantics when porting tests; list any intentional test replacement with its successor. No passing zero-suite/mocked-worker result substitutes for those gates.
- Contract/lifecycle tests: wrong full identity despite same geometry; canonical/dimension/binding mismatch; rectangular bounds/UV/picking; raster reuse; fresh same-map scope; no inherited
  notes/marks/window state; storage error; before/after-await cancellation including catch/finally; destroy before afterNextRender; late handle cleanup; Start double click; disposal before
  replacement; actual-frame success/failure; Retry/default and stale callback rejection.
- Setup tests: saved load without generation, generation exact recipe/overrides, field edits during generation/save, successful-save Start gate, retry after save failure, cancel/late save, delayed
  list with/without stale duplicate metadata/initialRef, detached structuredClone at worker/preparation/catalog/Start boundaries. Use scene doubles in TestBed and deferred promises/fake clocks for
  timing.
- Targeted test-effectiveness checks for identity, stale async publication, saved-list race and reentrant resource release, isolated with restored hashes; no broad new mutation project. Keep existing
  CI mutation manifest/runner moved by cutover. General CI may not exercise new local Angular cases: require explicit focused evidence too.
- Actual browser at managed Angular origin: real default load, real saved certification and generation workers, save/readback exact canonical bytes/full hash, failure/retry and cancellation. Prove
  worker chunk loading and termination, WebGL raster/personal marks, zero pieces/stopped time, repeated replacement and notes/marks isolation. Capture desktop and 390×844 with
  scroll-width/focus/keyboard/high-contrast/reduced-motion checks.
- Lifecycle browser evidence: delayed startup then navigate away/back, delayed save/list release, HMR before/after startup resolution, session replacement, bfcache/reload-to-default, API unavailable
  default startup; observe no game creation/auth/WebSocket requests from local route. Keep workers/canvases/listeners bounded; errors are visible without stale mounts.
- Record task-owned DOM/GPU canvases and active certification workers at stable observation points: initialized board has one WebGL host and zero workers; setup retains that one host plus at most one separate preview canvas, and at most one active preparation runtime (up to two workers); settled setup returns to zero workers. After Cancel there is exactly one original board host, no setup preview/workers; after successful replacement exactly one new host and zero workers; after route departure there are zero local hosts/previews/workers. Record intermediate disposal-before-allocation separately. Observe actual worker lifecycle with browser instrumentation and corroborate counts with deterministic factory/disposal tests. Listener/RAF/observer cleanup is established by explicit registration/removal and exactly-once tests, not inferred from DOM counts alone.
- P0 browser regression: `/map-table.html` reaches usable `/map-table` through Angular dev and actual built server, selected file runs real certification, invalid replacement/cancel retains previous
  display, rectangular/square and oblique/narrow controls work. Test native input handler; disclose any picker automation limit.
- Production evidence on locally served build (no deployment): `/` unchanged; direct `/dev/local-board` cannot mount feature, query variants cannot enable it; feature action/chunk/default JSON absent;
  GET/POST `/__local/maps` do not succeed via API or SPA HTML fallback. Common authoring workers/scene code may remain for existing authoring/inspection; absence claim targets local feature/storage,
  not all map code.
- Live preservation: retain app route/shell/guest/scenario/game/table/marks tests and fresh real-server smoke for signed-out/sign-in or guest, menu, scenario creation, invite/lobby/join, live
  table/desk/orders/marks, game-over/menu. Local mode adds no server marks or scenario. Record pre-existing unrelated failures without silently fixing scope or claiming live acceptance from fixtures.
- Before ready/merge: current-head GitHub `check` and `test-effectiveness` pass, independent source/integration acceptance, required browser/artifact evidence and current base. Cutover run
  `38185038783`, old P4 screenshots and historical 11 tests never satisfy these packets. Source merge does not authorize deploy8090, hosted build publication or D23 distribution.

Execution log (`docs/game-initialization-landing-log.md`, coordinator only) records source/manifest, actual agent model/cwd/paths, check commands/results, evidence paths, findings/repairs, accepted
commit, pending gates and next packet. New Angular evidence goes under `docs/game-initialization-angular-evidence/`; raw/disposable evidence stays in `.local/game-initialization-landing-evidence/`. Do
not overwrite old P4 screenshots or reference raw evidence.

## Orchestration, first packet and cleanup

Use verified native GPT-6.1 Sol/high for lifecycle, adapters and independent review; Sol/medium for ordinary UI. Coordinator owns all shared contracts/entrypoints/config/Git/integration/previews. If
the coordinator implements a high-risk lifecycle packet, verify effective Sol/high or delegate that bounded path set to a verified high agent. Astra/high is for this cross-boundary plan or a bounded
unresolved architectural escalation, not routine UI work. Revisit approach before escalation; usage/cost not measured.

At most four task agents including coordinator; prefer coordinator + one writer + reviewer. Reuse settled `w3:pG` for independent review only after preserving its earlier handoff; verify footer
immediately before dispatch. Same-tab, existing cwd, no focus change. Planner `w3:pH` does not self-close. Every dispatch contains exact accepted source/dependencies, exclusive files, reserved files,
contracts/exclusions, checks and required evidence. Writers/reviewers do not operate Git, PRs or servers.

**First executable packet on later execution authorization:** coordinator C0 refresh at Angular main, preserve historical P4 branch/evidence, settle source owners before preparing a fresh feature
branch in the canonical landing checkout; then A0 sidecar extraction from pinned accepted P1, with explicit tools tests/typecheck/root-script integration. A1 is independent ready work after the same
checkpoint. Do not switch the shared checkout while any reader relies on its live bytes; provide a frozen source pin/export first. This plan dispatches none of it.

Failure policy: keep the affected PR unmerged, make a bounded owning-packet repair, rerun affected checks and obtain review. Never restore HQ/Svelte or relax certification/timeouts to get green. If a
merged exposure needs rollback, disable A5 dev route first while preserving independent P0/P1/P2 support and all personal/generated data; coordinator assesses dependent reverts separately.

Final cleanup packet, coordinator-owned: preserve each handoff/source/evidence and unresolved findings, verify task agents idle/done and no remaining packet needs them, then close only task-owned
writer/reviewer/planner panes from another controlling pane. Retain coordinator `w3:pF`, protected original `w3:p1`, unrelated panes and all original previews. Stop task-only
Angular/sidecar/harness/built-smoke servers when feedback completes unless owner requests retention; retain requested preview41930 until coordinator explicitly reconciles its feedback purpose. No
reset/clean/delete of dirty files, ignored maps/evidence or source branches. Planning performs no cleanup.

## Review handoff

Independent `init-landing-review`, verified GPT-6.1 Sol/high, reviewed the complete revised artifact against main `b6710565…`, cutover `f55395b…`, pre-cutover `51d4d36…`, frozen POC `da9dd0b…` and P4 `279dbb1…`. Initial review found two blockers: Docker lacked sidecar build inputs, and A0 depended on contracts delivered later. Both are resolved. The final re-review accepted dependency feasibility, ownership, preservation/test discovery, dev transport/build exclusion, and async/render/session contracts with no remaining findings. Review hashes and handoffs are preserved in the landing log and `.local/game-initialization-landing-evidence/angular-plan-{initial,final}-review.txt`.

This is engineering-plan acceptance only. No implementation, product, current feature CI, merge readiness or deployment acceptance is claimed. The status and this review record were updated after the frozen substantive plan received acceptance; packet architecture and gates are unchanged.
