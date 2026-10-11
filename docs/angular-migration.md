# Angular migration plan (issue #269)

Status: **stage 1 (the spike) done; stage 2 step 0 (tooling, #271) and step 1 (services and stores, #272) done; step 2 in progress, with the roster, journal, conference and pause panel (#273), the in-tray, orders desk and umpire window (#274), and the desk shell, game over screen, HUD and marks (#275) done; step 4 (shell and entry, #276) done, and step 5 (admin, map authoring and benchmarks, #277) done, see below.** The Angular app lives in `client-ng/`, beside the Svelte client in `client/`, which is untouched and still what the server and Docker image serve. Stage 2 ports everything, then deletes `client/` and renames `client-ng/` to `client/`. Nothing here changes the protocol, the visibility filter or the server.

## What the spike proves

`client-ng/` is an Angular app that builds, serves, tests and runs in this repo's tooling and, in one page, shows a real desk view and the live Three.js table talking to the real server:

- `GameService` (`src/app/game/game.service.ts`) holds the existing `ClientState` in a signal. It reuses `net/connection.ts` (`GameConnection`, WebSocket with reconnect), `net/state.ts` (reducers) and `session.ts` unchanged, imported through the `@legacy/*` path alias to `client/src/*`.
- `ClockComponent` is a port of `desk/DeskClock.svelte` (template, styles, a signal ticking every 250 ms) over the unchanged pure `desk/clock.ts`.
- `TableHostComponent` hosts the unchanged `table/TableScene.ts` on one canvas.
- Open `/?game=<id>` to join a game; with no game it shows the fixture board offline.
- Verified in a browser against `npm run dev -w server`: a guest session, a created game, the clock reading the server's `Day 1 00:00 · 12:1 · Running`, and the table with the side's own formations. See the PR for screenshots.

Not in the spike: sign-in, menus, orders, marks, any other view, the admin, map-authoring and benchmark pages (routes exist as placeholders), serving `client-ng` from the server, and the Docker image serving it (it only builds it).

## Step 0: tooling (#271)

- **Vitest 4.1.11** root-wide (`vitest` `^4.0.0` in the root `package.json`). `@angular/build` now shares the single hoisted copy; the nested Vitest 3 under `client-ng` is gone. Plain `npm install` still crashes on this tree with the arborist error from risk 3, so the lockfile was regenerated from the committed one with `npm install --legacy-peer-deps`; `npm ci` then installs it cleanly with no nested `@vitest/*`.
- **Review harness.** Vitest 4 removed the `onFinished` reporter hook, so `scripts/review/capture-reporter.mjs` records only `onTestRunEnd` and `results.mjs` no longer cross-checks the two channels (the JSON reporter is still cross-checked against it). The runner's version guard now accepts any 4.x. The negative control that corrupted `onFinished` now removes `onTestRunEnd`.
- **SPA fallback.** `server/src/api/spaFallback.ts`, enabled by `SPA_FALLBACK=1` (option `spaFallback`, needs `STATIC_DIR`). Off by default, because the Svelte build has real `admin/index.html` and `*.html` files.
- **Docker.** `--build-arg CLIENT=ng` copies `client-ng/dist/browser` instead of `client/dist`. Default unchanged. See `docs/deployment.md`.

## Step 1: services and stores (#272)

- **`GameService`** (`game/game.service.ts`) now also holds `gameId`, sends commands (`sendOrder` records the pending order as `liveClient.ts` did; `askStaff`, `proposePause`, `proposeResume`, `vote` return false with no link), marks dispatches read (`markRead`, `mergeRead`), and owns the `pagehide` (stop) / `pageshow` with `persisted` (start) listeners, added on `connect` and removed on `disconnect`.
- **`DeskStore`** (`desk/desk.store.ts`) holds the signals of `desk/store.ts`: `activeView`, `trayFiled`, `trayDiscarded`, `trayMarks` (computed from the game's read set), `viewedDispatch`, `showOnTable`, the window signals, `orderDraft`, conference client and log, and `journal`. `persistTray`, `persistDraft` and `persistJournal(key)` load from localStorage through the unchanged `@legacy/desk/*` helpers and then save from an `effect`; each returns a stop function. `addNote` is a method.
- **Injection tokens** (`game/ports.ts`): `ORDER_SENDER`, `CONFERENCE_SENDER`, `PAUSE_ACTIONS`. They default to `GameService` (root factories), so the Svelte "set once connected" stores are not needed; tests and fixture mode provide their own.
- **Plan change:** the `gameState` store is not duplicated in `DeskStore`; it is `GameService.state`. `gameId` lives on `GameService`, not the desk store. Marks, hot-seat switching and canvas pointer handling stay for step 3 (`MarksService`, `GameComponent`).
- **Behaviour difference.** A Svelte `subscribe` saw every state; an Angular `effect` runs once per tick, so game states applied within one tick are folded into one. `persistJournal` compares only the previous *seen* state, so a pause then resume (or an order added then refused) inside a single tick leaves no diary entry. Each WebSocket message is its own task, so this should be rare.
- Tests: `game.service.spec.ts`, `ports.spec.ts`, `desk/desk.store.spec.ts` (no timers; `TestBed.tick()` flushes effects). No Svelte tests were dropped: the Svelte store has no tests of its own.

## Step 2.2: roster, journal, conference and pause panel (#273)

- Ported to `client-ng/src/app/desk/{roster,journal,conference,pause-panel}/` as standalone `OnPush` components (`RosterComponent`, `JournalComponent`, `ConferenceComponent`, `PausePanelComponent`) over the unchanged pure `@legacy/desk/*` logic, `GameService.state` and `DeskStore`. Templates and styles are copied from the Svelte versions, so markup, labels, roles and test ids match.
- Re-reads of game time (roster, journal, conference) and the pause countdown use a `setInterval` that writes a `wall` signal, cleared in `DestroyRef.onDestroy`, as `ClockComponent` does. The pause panel marks `document.title` from an `effect` and restores it on destroy.
- **Conference sender.** Svelte left `conferenceSender` unset offline so the fixture charged the cost. `CONFERENCE_SENDER` always exists now, so the component skips it when `GameService.state().link === 'offline'`.
- No `@angular/forms`: inputs use `[value]` and `(input)` bound to signals.
- The components are not mounted yet; `DeskComponent` (step 3) lays them out. `desk/testing.ts` has a `stubGame()` helper that provides a `GameService` whose state a test sets directly.
- Tests: one spec per component, covering the mount assertions of `roster.test.ts`, `journal.test.ts`, `conference.test.ts` and `pause.test.ts`, with the `PausePanel` cases of `pause.test.ts` ported and a countdown test on fake timers. The pure-logic halves of those Svelte test files stay where they are until the cutover. No test was dropped; the Svelte `Desk`-mounted cases (for example the clock vote shown beside the pause panel) belong to `DeskComponent`.

## Step 2 (part): in-tray, orders desk, umpire window (#274)

Components in `client-ng/src/app/desk/`, each standalone, `OnPush`, signals, with its Svelte CSS carried over unchanged. None is mounted in a route yet: the desk shell (step 3) will place them.

- **`InTrayComponent`** (`in-tray.component.*`, port of `InTray.svelte`). Sorting and marks stay in `@legacy/desk/tray`. The viewer shown is published to `DeskStore.viewedDispatch` by an `effect`. After File or Discard moves the viewer on, focus returns to the viewer with `afterNextRender` (Svelte used `tick()`). **#267 included:** its engine, server and docs changes (the opening `situation` report from the chief of staff, and the order acknowledgement filed after `ACK_DELAY_MS` instead of the 10-minute sighting delay) are applied here, so the in-tray is no longer empty before contact. `ACK_DELAY_MS` is now exported from the engine. Five existing engine and server test files asserted the old behaviour and were updated (`orders.test.ts`, `visibility.test.ts` x3, `app.test.ts`). #267 is superseded by this change.
- **`OrdersDeskComponent`** (`orders-desk.component.*`, port of `OrdersDesk.svelte`). The draft is `DeskStore.orderDraft`; sending goes through the `ORDER_SENDER` token, so a spec (or fixture mode) provides its own sender. The staff estimates are computed once per courier. The SENT stamp uses a 1.4 s `setTimeout`, cleared on destroy. Error text sits in an always-present `role="alert"` region per field, as before.
- **`UmpireWindowComponent`** (`umpire-window.component.*`, port of `UmpireWindow.svelte`). Reads `GameService.gameId`, fetches the timeline and frames through the unchanged `@legacy/window/api`, writes `DeskStore.windowFrame`, and clears frame and hover on destroy. A ticket counter drops a frame that lands after a newer request.
- **Plan change:** none. Specs use a small `fake-game.ts` (a `GameService` stand-in whose state is a plain signal) instead of a fake socket.
- **Tests:** `in-tray`, `orders-desk` and `umpire-window` `.component.spec.ts`, no wall-clock timing (the one timer test uses fake timers and `TestBed.tick()`, because the zoneless scheduler itself runs on timers). The Svelte `tray.test.ts` and `orders.test.ts` mount-and-query cases are ported one for one; their pure-logic cases (`sortTray`, persistence, estimates, annex, draft autosave, delivery status, refusals) stay where they are and still run. Not ported, because they test other parts: the journal case that lists a sent order (belongs to `JournalComponent`), the `MarksBar` toggle, and the `index.html` icon check. Added: empty-pile text, the #267 situation report and acknowledgement in the right piles, focus after a paper goes, Ctrl+Enter, the stamp expiring, a game-over form, a vanished annex arrow, and every umpire-window case (the Svelte one had no component test).

## Step 3: desk shell, game over, HUD and marks (#275)

The game route (`game/game.component.ts`) now lays out the whole live game screen over the persistent table canvas, as the Svelte `liveClient.ts` did. Open `/?game=<id>` (or no query for the offline fixture board).

- **`DeskComponent`** (`desk/desk.component.*`, port of `Desk.svelte`): dock with the pause panel, clock and one button per view (with the unread badge and the post-game "Umpire's window" button), hotkeys T/I/O/R/J/C and Escape (not while typing, except Escape), focus into the opened view with `afterNextRender` (Svelte used `queueMicrotask`), the fade and the papers.
- **`GameOverComponent`** (`desk/game-over/`, behaviour and tests of held PR #266): result headline, reason, losses read from the umpire's window frames, and the ways out (umpire's window, journal, Play again, New game, Main menu). The game ending sets the table view whatever view was open. Its pure logic (`game-over.ts`) is copied from #266's `client/src/desk/gameOver.ts` into `client-ng`, because #266 is still open against the Svelte client; at the cutover the copy in `client/` goes. #266 is superseded when this lands.
- **`TableHostComponent`** stays in the game route, never in a desk view. All scene calls are effects on signals: apply the player's view or the umpire's window frame, dolly to the desk on `activeView` (0 ms with reduced motion), overlays, mark drawing, camera buttons given to the drawing tools, pan to `showOnTable`. Canvas `pointerdown/move/up/cancel` and the Delete key call `MarksService`. The scene is made through the `TABLE_SCENE_FACTORY` token so specs can use a fake (jsdom has no WebGL; mocking `three` with `vi.mock` is not reliable here because the builder shares chunks between spec files).
- **`MarksService`** (`game/marks.service.ts`): tool, selection, draft, note, overlays, the gesture handling and Plot report, over the unchanged `table/markTools` `Gesture`. `GameService` gained `putMark` / `deleteMark` (state updates at once, then sent). `TableService` holds the scene and the HUD's status line.
- **`HudComponent`, `MarksBarComponent`, `SideSwitchComponent`** (`hud/`). The side switch shows for a hot-seat game (read with `fetchGame`).
- **Plan changes and assumptions.** (1) The plain orders panel of `hud/hud.ts` (unit select, textarea, pending list, notices) is not ported: the Svelte build hid it with `#orders { display: none }` behind the orders desk, so nothing visible is lost; clicking an own unit therefore no longer selects it in that hidden box. (2) The `#gameover` status line is kept for screen readers but visually hidden, since the game over paper now says the same. (3) Marks redraw every 2 s from an interval that writes a `tick` signal, as the Svelte `setInterval(redrawMarks)` did. (4) Sign-in, `?new=1`, `?lobby`, taking a seat and the room are step 4, so this route still only joins `?game=` and does not take a seat.
- **Tests:** `desk.component.spec.ts` (the Svelte `desk.test.ts` Desk-shell cases plus every `gameOver.test.ts` case of #266, including losses, Play again and its error), `game-over.spec.ts` (pure logic), `marks.service.spec.ts`, `hud/hud.spec.ts` (HUD, marks bar, side switch), `game.component.spec.ts` (one persistent canvas across views, dispose on leaving, pan, mark drawing, hot-seat switch). No wall-clock timing. Not ported because they test pure code that still runs in `client/`: the view-key and camera-transition maths and the `TableScene` desk dolly cases of `desk.test.ts`.

## Step 4: shell and entry (#276)

The route `/` is now `ShellComponent` (`client-ng/src/app/shell/shell.component.ts`), which does what `shell/boot.ts`, `liveClient.ts` (entry half) and `main.ts` did, over the unchanged pure rules in `@legacy/shell/screens` (`initialShell`, `reduce`, `urlFor`, `needsReload`) and `@legacy/session` (`parseSession`). Existing URLs keep their meaning: `?game=<id>[&side=]`, `?new=1[&side=][&rate=]`, `?lobby=1`, `?mode=fixture`, and none for the menu.

- **Screens** (standalone `OnPush`, signals, no `@angular/forms`): `SignInComponent` (guest start and emailed link), `MenuComponent` (continue list, account, about; `MenuScreen.svelte`'s loading is folded in), `NewGameComponent` (behaviour of #264 over `@legacy/shell/newGame`), `GameMenuComponent` (Esc at the table, focus trap, capture-phase key listener), `AccountBarComponent` (top right, with Games, Sign out and Delete account), `GameListComponent` and `RoomComponent` (`lobby/`, polling every 2 s while the game has not started).
- **Moves.** Between the shell's own screens it is `history.pushState`; into or out of the game it is a fresh page load (`needsReload`), because the game screen owns the canvas and the page listeners. Back from a loaded game disconnects and reloads.
- **Getting a seat.** `ShellComponent.prepare` does what `liveClient.ts` did before the table opened: `?new=1` makes a game (`createQuickGame`) and rewrites the URL to `?game=`, `?game=` joins a free side (or the one in `&side=`), and a game still in the lobby shows the room until it starts.
- **Injection tokens** (`shell/shell-api.ts`): `SHELL_API` (every server call), `SHELL_WINDOW` (location and history), `SHELL_NOW`. Specs supply fakes; there is no wall-clock timing.
- **Reconnect** was ported in step 1 (`GameService`: socket reconnect, `pagehide`/`pageshow`), and the shell calls `GameService.disconnect()` before every page load it starts.
- **Assumptions and plan changes.** (1) The Svelte shell sends `?lobby=1` to the new-game form, so `liveClient.ts`'s own game list and create form were unreachable. The list is kept: `GameListComponent` shows "Your games" under the new-game form (that is where the account bar's Games link goes); the second create form (session type, pause rule) is not ported. (2) There is no browser notification or web push client in `client/` (the preferences API is server-only), so none was ported; in-game notices are the HUD's, from step 3. (3) The index page title is now "Kriegsspiel".
- **Tests.** `shell/shell.component.spec.ts` ports the cases of `shell.test.ts` and `guest.test.ts` (menu, sign-in, guest, new-game form, routing, in-game menu) and adds the room, seat-taking and account bar. Not ported: the axe-core checks (axe is not a `client-ng` dependency; the labels and roles are copied from the Svelte templates) and the pure-logic tests of `screens.ts`, `continueList.ts` and `newGame.ts`, which still run in `client/`.
- **Walkthrough** (headless Chromium with software WebGL against `ng serve` and the real server): guest start, the game, Esc menu, leave to the main menu, New game with a custom 120:1 rate, an order in plain text, the in-tray's chief of staff report, game over (Defeat), Main menu. Screenshots are in the PR.

## Step 5: admin, map authoring and benchmarks (#277)

Lazy routes in `client-ng/src/app/app.routes.ts`, each a standalone `OnPush` component that creates the existing imperative app after the first render and tears it down in `ngOnDestroy`:

- `/admin` (`admin/admin.component.ts`): creates the unchanged `AdminPage` in `#app`, calls `start()`, and `stop()` on destroy. Its page CSS moved out of `admin/index.html` into `admin.component.css`, nested under `ks-admin` so it does not restyle other routes. A rewrite stays later work.
- `/map-authoring` (`map-authoring/`): the markup of `map-authoring.html` as the template, `mountAuthoringApp` with the same presets and replay-support check as `map-authoring/main.ts`, `dispose()` on destroy. `style.css` is copied and nested under `ks-map-authoring`. The generate and validate workers are referenced from `client/src/map-authoring` (`webWorkerTsConfig`: `tsconfig.worker.json`).
- `/map-benchmark`: `mountBenchmark`. The template deliberately has no `#benchmark` id, since the legacy module mounts itself on that id when imported.
- `/table-benchmark`: imports `table/benchmark.ts`, which is a script that starts on import and reads `#table`/`#result`; it runs once per page load, so reopening the route needs a reload. `hq-preview.svg` was copied to `client-ng/public`.
- `/admin` and `/admin/` both resolve: `TrailingSlashUrlSerializer` drops a trailing slash before parsing (Angular otherwise finds no route for `/admin/`). The old `/map-authoring.html`, `/map-benchmark.html` and `/table-benchmark.html` redirect to the new routes. `proxy.conf.cjs` now proxies `/admin/api`.
- `@kriegsspiel/maps` resolves to `packages/maps/src` through `tsconfig.json` paths.
- Tests: `admin/admin.component.spec.ts` (both URLs mount the page, leaving stops it), `app.routes.spec.ts` (redirects, serializer). The Svelte-side admin and map-authoring tests are framework-free and unchanged. Not covered: mounting map authoring and the benchmarks in jsdom (workers and canvas are unavailable), so those were not exercised in a browser here.
- Not done: `map-table.html` (dev map catalog page, not named by the issue) and the server fallback for the cutover.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Angular | **22.2.2**, current stable. Standalone components only, signals, `OnPush`, **zoneless** (`provideZonelessChangeDetection`, no `zone.js`). | Zoneless works: state is signals, and the Three.js loop must not trigger change detection anyway. |
| Build | `@angular/build:application` (esbuild/Vite based), `ng build` / `ng serve`. | The default; no webpack. It replaces the Vite config in `client/vite.config.ts`. |
| Dev server | `ng serve` with `proxy.conf.cjs` proxying `/games` (REST and WebSocket), `/scenarios`, `/auth` to `$API_URL`, same as the Vite proxy today. `/admin/api` is added in stage 2. | Keeps the session cookie on the page's origin. |
| Unit tests | **Keep Vitest** (4.x since step 0). `@angular/build:unit-test` with `runner: vitest`, jsdom, `TestBed`. | Angular supports it natively, so the 41 framework-free test files keep their runner. |
| TypeScript | **6.0**, root-wide. | Angular 22 requires `>=6.0 <6.1`. TS 6 no longer auto-includes `@types/*`, so `tsconfig.base.json` now sets `"types": ["node"]`. |
| Node | **22.23.3** (`.nvmrc`, `Dockerfile`). | Angular 22's CLI needs at least 22.22.3. Older pins in `docs/` are historical logs. |
| Layout | A new npm workspace `client-ng` during the spike and the port. Renamed over `client/` at the end of stage 2. | Keeps `main` green and the demo build untouched. |

### Risks that showed up in the spike

1. **Vitest version split (resolved in step 0).** `@angular/build` peers on Vitest 4 but the root pins Vitest 3. Vitest 4 breaks the review-mutation harness (`scripts/review`, `test/review-workflow.test.js`, which parse Vitest 3 reporter output). The spike runs Angular's runner on Vitest 3.2.7 and it works (2 tests pass), with a peer warning. Stage 2 must move the repo to Vitest 4 and update that harness in its own PR, ahead of the bulk port.
2. **Lockfile hoisting.** Do not regenerate `package-lock.json` from scratch with a Vitest 4 in the tree: npm then nests `@vitest/*` under `vitest` and the same harness fails. Regenerate from the committed lock.
3. **Mixed `npm install` peers.** With Vitest 4 declared in `client-ng` and Vitest 3 at the root, npm 10.9.7 crashes (`Cannot read properties of null (reading 'edgesOut')`). Do not declare a second Vitest.
4. **Imperative DOM is also UI.** The issue counts Svelte components, but `liveClient.ts`, `hud/`, `lobby/lobby.ts`, `auth.ts` (login form and account bar), `shell/boot.ts` and the whole of `admin/` and `map-authoring/` build DOM by hand. Parity means porting these too (see the inventory and order below).
5. **Two desk UIs.** `client/src/hq/` is the HQ fixture UI (reachable only at `/?mode=fixture`; see `docs/hq-interface.md`) and `client/src/desk/` is the live desk. They duplicate roster, journal, in-tray, orders and clock. The plan ports `desk/` (live) first and decides in stage 2 whether the fixture UI is ported or retired, since "every behavior" lists only live behavior.
6. **Bundle size.** The game chunk is about 1 MB raw (194 kB transfer), almost all Three.js. Admin and map authoring must stay lazy routes.
7. **Hosting the table.** See below; the risk is a second `TableScene` after route changes or leaked WebGL contexts.
8. **Held PRs.** #266 (game over) and #267 (empty in-tray) change Svelte files (`desk/Desk.svelte`, `InTray.svelte`). Port them with the view they touch, using their code and tests as the spec, then close them.

## Hosting the persistent Three.js canvas

The scene classes stay framework-agnostic. Angular only owns the element and calls into them:

- `TableHostComponent` renders a `<canvas>`, builds `TableScene` once in `afterNextRender`, calls `start()`, and calls `dispose()` in `ngOnDestroy`.
- State flows in through one `effect` that calls `scene.apply(buildSceneState(view, map))` when the `view` signal changes. Nothing Three.js is ever put in a template or a signal graph.
- The host lives in the **game route component**, not in the desk views. Desk views are siblings layered over it and switched by the `activeView` signal (as the Svelte `Desk` does today: the canvas keeps rendering and the camera dollies away), so switching views never destroys the canvas. Only leaving the game route disposes it.
- Camera, picking, marks drawing and the render loop run outside change detection. Zoneless means no `runOutsideAngular` is needed; pointer handlers write to signals only when the UI must change.
- `window:resize` and `visibilitychange` go through host bindings. The `pagehide` / `pageshow` (bfcache) reconnect logic in `liveClient.ts` moves into `GameService`.

## Routing for the four pages

One workspace, one `index.html`. Routes in `app.routes.ts`:

| Route | Today | Angular |
| --- | --- | --- |
| `/` | `index.html`, `src/main.ts` (menu, lobby, game via query: `?game`, `?new`, `?lobby`, `?mode=fixture`) | `GameComponent` and a shell; the query parameters keep working (`parseSession`), so existing invite links stay valid |
| `/admin` | `admin/index.html`, served at `/admin/` | lazy route; `/admin/` and `/admin` both resolve (replaces the Vite `adminRedirect` plugin); `/admin/api` stays proxied |
| `/map-authoring` | `map-authoring.html` | lazy route |
| `/map-benchmark` | `map-benchmark.html` (and `table-benchmark.html`, a fifth entry in `vite.config.ts`) | lazy routes |

The server must serve `index.html` for these paths (SPA fallback, keeping `/games`, `/scenarios`, `/auth`, `/admin/api` as API). That is a small server change for the cutover only, which the issue allows ("except what the build and hosting need").

Note: the old paths `/map-authoring.html`, `/map-benchmark.html` and `/table-benchmark.html` are linked from docs and maybe bookmarks; keep redirects for them.

## Inventory of Svelte components and their Angular targets

32 `.svelte` files (about 6,200 lines): 26 shipped components and 6 test harnesses. Each target is a standalone `OnPush` component. Svelte stores become signals in an injectable service (`GameService`/`DeskStore` below). Svelte `$props` become `input()`/`output()`; `{#if}`/`{#each}` become `@if`/`@for`.

### `client/src/desk/` (live desk, 9 components)

| Svelte | Lines | Angular target | Notes |
| --- | --- | --- | --- |
| `DeskClock.svelte` | 96 | `ClockComponent` | **Done in the spike.** |
| `Roster.svelte` | 106 | `RosterComponent` | pure logic in `roster.ts` |
| `Journal.svelte` | 148 | `JournalComponent` | search, filters, export; `persistJournal` |
| `InTray.svelte` | 273 | `InTrayComponent` | #267 touches this; `persistTray` |
| `Conference.svelte` | 191 | `ConferenceComponent` | `conference.ts` |
| `PausePanel.svelte` | 159 | `PausePanelComponent` | `pause.ts`; vote countdown uses a timer signal |
| `OrdersDesk.svelte` | 373 | `OrdersDeskComponent` | annexes, courier choice, signing; largest |
| `UmpireWindow.svelte` | 181 | `UmpireWindowComponent` | post-game scrubber; drives `windowFrame` |
| `Desk.svelte` | 198 | `DeskComponent` | view buttons, hotkeys T/I/O/R/J/C, focus handling; #266 touches this |

### `client/src/shell/` (menu, sign-in, new game; 5 components)

| Svelte | Lines | Angular target | Notes |
| --- | --- | --- | --- |
| `MenuScreen.svelte` | 25 | `MenuScreenComponent` | layout wrapper |
| `SignIn.svelte` | 110 | `SignInComponent` | emailed link and guest start |
| `Menu.svelte` | 152 | `MenuComponent` | continue list, new game |
| `GameMenu.svelte` | 133 | `GameMenuComponent` | in-game menu |
| `NewGame.svelte` | 224 | `NewGameComponent` | scenario, side, opponent; #264 behavior |

### `client/src/hq/` (HQ fixture UI, 18 files: 12 components and 6 harnesses)

| Svelte | Lines | Angular target | Notes |
| --- | --- | --- | --- |
| `App.svelte` | 368 | `HqAppComponent` | composes the below; fixture only |
| `shell/Shell.svelte` | 891 | `HqShellComponent` | largest file; navigation in `shell/navigation.ts` |
| `PlacementBridge.svelte` | 25 | `PlacementBridgeComponent` | |
| `ui/Table.svelte` | 74 | `HqTableComponent` | wraps `FixtureTableScene`; same hosting rule as the live table |
| `views/clock/Clock.svelte` | 128 | `HqClockComponent` | |
| `views/roster/Roster.svelte` | 344 | `HqRosterComponent` | |
| `views/intray/InTray.svelte` | 329 | `HqInTrayComponent` | |
| `views/journal/Journal.svelte` | 289 | `HqJournalComponent` | |
| `views/orders/Orders.svelte` | 237 | `HqOrdersComponent` | |
| `interactions/marks/Marks.svelte` | 613 | `MarksComponent` | |
| `interactions/plotting/Plotting.svelte` | 332 | `PlottingComponent` | |
| `interactions/plotting/ReportPlotHandle.svelte` | 85 | `ReportPlotHandleComponent` | |
| Harnesses (6): `ui/TableHarness`, `views/{orders,intray}/Harness`, `views/{journal,clock}/TestHarness`, `testing/MarksShellHarness` | 14–27 each | none: replaced by `TestBed` host components inside the spec files | not shipped |

(Totals: 9 desk + 5 shell + 12 hq = 26 shipped components, plus the 6 harness files. The issue's "about 27 components" and "18 in `hq`" match.)

### Not Svelte, but hand-built DOM that must also be ported

| Source | Lines | Angular target |
| --- | --- | --- |
| `liveClient.ts` (boot, wiring, canvas pointer handlers, marks gestures, hot-seat side switch) | 413 | `GameComponent`, `GameService`, `MarksService`, `SideSwitchComponent` |
| `hud/hud.ts`, `hud/marksBar.ts` | | `HudComponent`, `MarksBarComponent` |
| `lobby/lobby.ts` (game list, room) | | `GameListComponent`, `RoomComponent` |
| `auth.ts` (`showLogin`, `showAccountBar`) | | folded into `SignInComponent`, `AccountBarComponent` |
| `shell/boot.ts` | | route guards and `AppComponent` bootstrap |
| `admin/` (`AdminPage`, panels, replay, llm) | about 14 files | `AdminComponent` (lazy). Wrap first (create the existing `AdminPage` in `ngAfterViewInit`) and rewrite later, since admin is an internal tool |
| `map-authoring/`, benchmarks | | lazy components that host the existing imperative apps the same way |

Pure TypeScript that carries over unchanged (no Svelte, no DOM): `net/`, `table/` (scene, picking, marks), `window/`, `session.ts`, `hq/contracts`, `hq/data`, `hq/interactions/*/controller.ts`, `desk/{clock,roster,journal,tray,orders,pause,conference,views}.ts`, `lobby/api.ts`, `shell/*Api.ts`.

## Order of porting (stage 2)

Each step is one PR (or a few) leaving `main` green. The old client keeps serving until the last step.

0. **Tooling PR:** Vitest 4 and updating the review-mutation harness (Risk 1); SPA fallback in the server behind the existing static dir; a `client-ng` deploy path in the Dockerfile (still not the default).
1. **Services and stores:** `GameService` (signal state, connection, reconnect, bfcache), `DeskStore` (the stores in `desk/store.ts`: `activeView`, tray, draft, journal, conference, window) with the `persist*` localStorage helpers; `OrderSender` etc. as injection tokens.
2. **Table and leaf views** (smallest, pure-logic-backed first): clock (done), roster, journal, conference, in-tray (with #267), pause panel, orders desk, umpire window.
3. **Desk shell:** `DeskComponent` with hotkeys and focus handling, game-over (#266), the HUD and marks bar, marks gestures and the table pointer handlers, hot-seat switch.
4. **Shell and entry:** sign-in/guest, menu, new game, game menu, lobby and room, account bar, query-parameter routing, reconnect and notifications. At the end of this step the walkthrough (sign in or guest, start, order, read in-tray, game over, back to menu) runs against `client-ng`.
5. **Admin, map authoring and benchmarks** as lazy routes (wrapper components first).
6. **HQ fixture UI:** port or retire (decision in that PR; it is only reachable at `/?mode=fixture`).
7. **Cutover:** delete `client/` and all `.svelte`, `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check`, `eslint-plugin-svelte`, `prettier-plugin-svelte`, `svelte.config.js`; rename `client-ng` to `client`; update Dockerfile, compose, `docs/deployment.md`, README, AGENTS.md; add the decision superseding D3 and D16 and update `docs/hq-interface.md` and `docs/architecture.md`; rebuild the hosted demo after the walkthrough passes; close #266 and #267 as superseded.

## How the existing tests map over

63 test files in `client/src`. 21 import a `.svelte` file and `main.test.ts` mocks `svelte`; the other 41 are framework-free and run as they are (they are imported from the Angular workspace through `@legacy/*` until the rename, then simply stay).

| Existing tests | Count | Plan |
| --- | --- | --- |
| Pure logic and net: `net`, `table/*`, `window`, `lobby`, `shell/*` models, `admin/*`, `map-authoring/*`, `desk/*` logic tests, `hq/data`, `hq/*/controller` | 41 | Unchanged. |
| `desk/*.test.ts` that mount `Desk.svelte` (clock, desk, journal, conference, pause, roster, tray, orders) | 8 | Keep the logic assertions; the mount-and-query assertions are rewritten with `TestBed` and `nativeElement` queries. |
| `hq/` component tests (`App`, `Shell`, `Table`, `Marks`, `Plotting`, `components`, five view tests, `accessibility`, `marksQueue`) | 13 | Rewritten one for one with `TestBed` against the same props and the same assertions (roles, labels, focus, keyboard). `accessibility.test.ts` keeps `axe-core`. |
| `main.test.ts` | 1 | Replaced by a routing test for the `/` boot (it mocks `svelte.mount`). |

Rules: no wall-clock timing (use fake timers or injected `now`, as today), and any dropped test is listed in the PR that drops it with the reason. The spike's `clock.component.spec.ts` shows the shape: zoneless `TestBed`, `fixture.whenStable()`, text and role assertions.

## Commands

```bash
npm ci
npm run dev -w client-ng              # ng serve; set API_URL to the API
devrun up --name api --port-env PORT -- npm run dev -w server
devrun up --name ng --port-env PORT -- sh -c 'API_URL=$(devrun url api) npm run dev -w client-ng'
npm run build -w client-ng            # client-ng/dist
npm test -w client-ng
```
