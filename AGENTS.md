# AGENTS.md

Kriegsspiel: an asynchronous, long-running wargame with an LLM umpire on a server. Read `docs/decisions.md` first, then the doc that matches your task.

## Docs
- `docs/decisions.md`: decision log and open questions
- `docs/architecture.md`: clock, scheduler, LLM barrier, pause voting, components
- `docs/gameplay.md`: how the game plays, pacing, roles, collaboration
- `docs/hq-interface.md`: the desk and map table, rendering decision
- `docs/staff-conference.md`: staff conference screen and its endpoint contract
- `docs/design.md`: pillars, features, trust risks
- `docs/research.md`: history and sources
- `docs/llm-providers.md`: configuring, adding and locally running LLM providers
- `docs/roadmap.md`: milestones
- `docs/map-implementation-plan.md`: M3c implementation sequence, Herdr agent ownership, validation and recovery
- `docs/map-architecture.md`: pinned planner assessment, coordinate adapter and fork constraints
- `docs/map-execution-log.md`: active assignments, accepted checkpoints and recovery state
- `packages/maps/README.md`: frozen map contract, numerical policies and validation boundaries
- `docs/order-eval.md`: golden order corpus and parser evaluation harness
- `docs/umpire-fixtures.md`: mock umpire and how to add fixtures
- `docs/deployment.md`: container, compose, backups and restore

## Rules of the design
- The engine is pure and deterministic. It never reads the wall clock. It only advances to a given game time.
- The LLM never mutates state. It returns structured proposals, and the engine validates and applies them. Dice come from the seeded server RNG.
- The only path from master state to a client is the visibility filter. Never send hidden state.
- Player inputs and LLM outputs are logged so any game can be replayed with no model calls.
- Game time must not advance past an unresolved LLM result (the LLM barrier).
- Any change to the clock must work at rates 1, 4, 12 and in manual and fast-forward modes.

## Current state
- Only the monorepo scaffold exists (`packages/engine`, `packages/protocol`, `server`, `client`; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`). An earlier Phaser prototype was abandoned and removed. Do not revive it. Build the engine and client fresh from the docs.
- AI commander: `AI_COMMANDER=llm` (with `AI_DIFFICULTY`, `AI_PERSONALITY`) swaps the scripted Red for an LLM one on the `command` umpire stage; see `docs/decisions.md`.
- Server API: `npm run dev -w server` builds and starts it on `$PORT` (default 3000), so under `devrun` use `devrun up --name api --port-env PORT -- npm run dev -w server`. `POST /games` makes a game; `/games/:id/ws` is a side's WebSocket, authenticated by the session cookie and the user's seat (D16, D17). Sign in with `POST /auth/login`; with no `MAIL_WEBHOOK_URL` the login link is in the server log.
- Lobby (D17a): open `/?lobby=1` for the new-game form and your games; `POST /games` with `lobby: true` waits for `/games/:id/start`. `/?game=<id>` is the invite link and shows the room until the game starts. Lobby code is in `server/src/lobby`, `client/src/lobby`.
- Notifications (`server/src/notify`, D17b): preferences and web push subscriptions under `/notifications/*`; set `VAPID_*` to enable web push.
- Client HUD (`client/src/hud`, `client/src/net`): sign in with the emailed link, then open `/?new=1&side=blue&rate=12` to create a game and take a side, or `/?game=<id>` to join one; with neither the page shows the main menu (`client/src/shell`, see `docs/hq-interface.md`); the Svelte HQ fixture (`client/src/hq`, see `docs/hq-contracts.md`) is only at `/?mode=fixture`. Live URLs use the accepted client composition in `client/src/liveClient.ts`; the HQ live adapter remains contract-gated. Vite proxies `/games` (REST and WebSocket), `/scenarios` and `/auth` to `$API_URL` (default `http://localhost:3000`). The server does not yet send pending orders or a delivery estimate, so the HUD lists orders it sent itself. The marks toolbar (`client/src/hud/marksBar.ts`) draws pins, pencil lines, arrows and range rings on the table (D16b); they are stored per side on the server and survive a reload.
- Desk shell (`client/src/desk`): a Svelte layer over the Three.js canvas with one button per view (map table, in-tray, orders, order of battle, journal, staff conference), hotkeys T/I/O/R/J/C and Escape for the table. `activeView` and `gameState` stores in `desk/store.ts` are shared by both layers. Leaving the table dollies the camera to the desk (`TableScene.setDesk`) and fades the canvas; the canvas keeps rendering and the table pose is restored on return. This accepted live desk remains separate from the fixture HQ renderer (`table/FixtureTableScene.ts`). The in-tray (`desk/InTray.svelte`, pure logic in `desk/tray.ts`) is real; its read, filed and discarded marks persist in localStorage per game via `persistTray`. The desk clock (`desk/DeskClock.svelte`, `desk/clock.ts`) shows game time, rate, paused/stopped, an open pause or resume vote and "staff at work", compact at the table. The pause panel (`desk/PausePanel.svelte`, pure logic in `desk/pause.ts`) proposes a pause or resume with an optional reason, prompts for a vote with a countdown, and marks the page title `(vote)` while one waits; results appear in the HUD notices. The live orders desk (`desk/OrdersDesk.svelte`, `desk/orders.ts`) supports per-game drafts, arrow annexes, fast/safe couriers and signing; its journal shows sent orders, received papers and estimated delivery progress (D16c). The HQ fixture keeps local drafts with sending unavailable. The order of battle roster (`desk/Roster.svelte`, pure logic in `desk/roster.ts`) lists the SideView formations with strength, supply and morale (unknown shows as "unknown"), dated by the view and aged in game time; clicking a formation focuses it on the table. The live journal / war diary (`desk/Journal.svelte`, pure logic in `desk/journal.ts`, store in `desk/store.ts`) records orders sent, dispatches received, pauses and resumes the player saw, and their own notes; it has search, kind filters and a plain-text export, and persists in localStorage per game via `persistJournal`. The staff conference (`desk/Conference.svelte`, pure logic and fixture answers in `desk/conference.ts`) lets the player question four officers, shows their traits, charges game time per question and answers from the SideView only; it runs on fixtures until the server endpoint in `docs/staff-conference.md` exists. Typecheck is `svelte-check`.
- Umpire's window (after the game): `server/src/api/umpireWindow.ts` serves `GET /games/:id/window` and `/window/at?at=` to a seated player only once the world has an outcome; `client/src/window` builds the table scene from a frame and `desk/UmpireWindow.svelte` is the scrubber. It is the only route that sends master state to a client.
- Angular migration (#269): `client-ng/` is the Angular 22 workspace (spike); `client/` stays the served Svelte client until stage 2 completes. Plan, inventory and port order are in `docs/angular-migration.md`; its `/` route is the shell (sign-in, guest, menu, new game, lobby room, game) in `client-ng/src/app/shell`. Run it with `devrun up --name ng --port-env PORT -- sh -c 'API_URL=$(devrun url api) npm run dev -w client-ng'`.
- Node version is in `.nvmrc`. Start dev servers with `devrun` (see `~/CLAUDE.md`), not bare `npm run dev`.

## Keep docs current
When a design decision changes, update `docs/decisions.md` and the affected doc in the same change.

## GitHub epics and stories

Work is tracked in [Kriegsspiel project 2](https://github.com/users/exterkamp/projects/2) and the `exterkamp/kriegsspiel` issues. These conventions are recovered from the existing issues, repository labels and project workflows. There are currently no repository issue templates in `.github/ISSUE_TEMPLATE`; this section is the authoring guide. Project automation is configured in GitHub, not in the repository's CI workflow.

### Hierarchy and numbering

- An epic describes an outcome spanning several implementation tasks. Title it `Epic <N>: <outcome>` and apply `epic` and `enhancement`.
- A story is a GitHub issue labelled `task`. Title it `<N>.<M> <specific deliverable>`, where N is the logical epic number and M is the story number within it. Existing follow-ups use suffixes such as `1.3b` and `3.1b`; preserve existing numbering and check siblings before choosing a new number.
- Logical numbering and GitHub issue numbers are different. For example, Epic 8 is issue #119, and story 8.1 is issue #120. `Part of Epic #119` and dependency references must use the real issue number.
- Link the story with GitHub's native parent/sub-issue relationship as well as naming the parent in its body. A text reference alone does not populate the project's sub-issue progress or trigger sub-issue enrollment.
- Epics belong in project 2; its enabled workflow adds their sub-issues automatically. Verify enrollment after linking. Search existing issues and PRs before creating duplicates.

### Epic contents

Use a goal, a scope checklist and a concrete completion condition. Larger epics also distinguish current behavior, desired behavior, owner decisions, assumptions, suggested approaches and exclusions, as in Epic #119. Keep an owner's decision separate from an agent's assumption or implementation suggestion.

```markdown
**Goal.** <The user-visible or verifiable outcome.>

## Scope

- [ ] <Capability, linked to its story once created.>
- [ ] <Another capability.>

## Done when

- <Observable outcome that proves the epic works end to end.>
- <Required validation, playtest or documentation.>
```

Add `## Owner decisions`, `## Assumptions`, `## Suggested approach` and `## Not in scope here` when useful. Keep the epic checklist consistent with its linked stories; an epic is complete only when its own completion criteria hold, not merely when a PR exists for each story.

### Story contents and labels

Implementation stories use the following body structure. Include the relevant doc sections and decision titles, concrete scope boundaries and testable acceptance criteria. Decision numbers in older issues can be stale; verify them in `docs/decisions.md` before citing or adding an entry.

```markdown
Part of Epic #<parent-issue-number>. Size: **M**. Area: `server`.

**Depends on:** #<prerequisite-issue>, #<other-prerequisite>

## Context

<Why this is needed; relevant docs, decisions and existing behavior.>

## Scope

- <Bounded deliverable.>
- <Required tests and documentation.>

## Acceptance criteria

- [ ] <Observable behavior and how to verify it.>
- [ ] <Relevant invariant, failure case or integration check.>

## For the implementing agent

- Read `AGENTS.md`, `docs/decisions.md` and the docs named above.
- Stay within this issue's scope; record additional work in linked follow-up issues.
- Add appropriate tests with implementation changes and preserve the design rules in `AGENTS.md`.
- Update `docs/decisions.md` and affected docs in the same PR when a design decision changes.
- Include `Closes #<this-issue-number>` in the PR description.
```

- Use `**Depends on:** none (can start now)` when there are no prerequisites. List actual issue numbers; verify the prerequisite implementation is available before starting dependent work.
- Apply `task`, one primary `area:<area>` label and one `size:<size>` label, matching the body. Existing areas are `engine`, `server`, `client`, `llm`, `protocol`, `infra` and `docs`; existing sizes are `S`, `M` and `L`. Sizes express relative scope, not a documented estimate in hours.
- Add `## Why (owner directive)` when needed to preserve the reason for a change. Use explicit exclusions or deferred follow-ups to keep a story independently reviewable.
- A small bug or implementation follow-up may use the existing shorter format: originating issue/PR, observed behavior, desired correction and validation. When promoting it to a planned story, add the parent, dependencies, area, size and acceptance criteria.
- The `later` label means **deferred by the owner: do not start until asked**, as in #128. State that deferral in the body; belonging to an epic does not authorize starting deferred work.
- Older issue instructions referring to the repository's `CLAUDE.md` mean `AGENTS.md`. Use the new filename in newly authored or updated instructions.

### Project status and completion

The project's six enabled workflows currently implement these transitions:

| Trigger | Action |
| --- | --- |
| An item in the project has sub-issues | Add its sub-issues to the project |
| An issue or PR is added | Set status to `Todo` |
| A PR is linked to an issue | Set status to `In Progress` |
| An issue or PR is closed | Set status to `Done` |
| A PR is merged | Set status to `Done` |
| An issue's status is set to `Done` | Close the issue |

Use `Todo` for queued work and `In Progress` for active work. Do not set `Done` merely to show a draft or submitted PR: it closes the issue. Close completed stories through the implementing PR's `Closes #...` reference after the acceptance criteria and appropriate checks are satisfied. Describe validation and any remaining limitations in the PR; keep partial work open and link its remaining tasks. Do not close an epic until its end-to-end completion condition is met.

When creating follow-ups, link the originating issue/PR and relevant parent epic, and distinguish current limitations from future enhancements. Changing issue bodies, labels, relationships or workflow configuration is separate from documenting these conventions; do it only within the user's requested scope.

## Work chunks and pull requests

These conventions draw on exterkamp's story PRs [#212](https://github.com/exterkamp/kriegsspiel/pull/212) (orders desk), [#217](https://github.com/exterkamp/kriegsspiel/pull/217) (role views), [#219](https://github.com/exterkamp/kriegsspiel/pull/219) (pause voting) and [#224](https://github.com/exterkamp/kriegsspiel/pull/224) (roster). The map implementation plan supplies the explicit accumulating-epic exception below. Their old decision numbers and historical verification limits are not current requirements; check the docs and actual source.

### Chunk work by deliverable

- Default to one bounded story or bug fix per PR. A chunk delivers an observable behavior or independently verifiable contract, with its relevant tests and docs. Keep the engine/protocol/server/client changes together when they implement that one behavior; do not split solely by directory or layer.
- Separate prerequisites and follow-ups when they have independent acceptance criteria. For example, #217 delivers engine role views and permissions while deferring lobby/wire integration to #216; #212 delivers the orders flow while naming server delivery tracking as future work. Do not quietly pull adjacent epic stories into the current PR.
- Order dependent chunks by accepted contracts and available implementation. Check prerequisites before starting; record what remains blocked and any independent work that can proceed. An open prerequisite PR alone does not establish an accepted dependency.
- For coordinated work, give each writer a bounded packet: prerequisite revisions, relevant docs, exclusive writable paths, reserved shared files, acceptance criteria, exclusions and required evidence. The coordinator owns shared contracts/configuration and integration unless the plan names another owner. Record accepted checkpoints and next dependencies in the execution log.
- Use story-sized commits on a feature branch. Default to separate story PRs; an explicit epic plan may instead choose one accumulating integration PR with a story-to-commit/evidence checklist, as in `docs/map-implementation-plan.md` and [#151](https://github.com/exterkamp/kriegsspiel/pull/151). Do not open overlapping PRs from that same integration branch. Keep milestone acceptance separate from component completion.

### Format PRs for the reviewer

- For a story, use `<N>.<M> <specific deliverable>` as the title, matching the issue. Bug fixes and integration PRs use a concrete behavior/outcome title; do not invent story numbering.
- Lead with the problem and resulting behavior. Explain the important implementation boundaries and any changed rule or invariant. Describe the final change, not the sequence of agent handoffs or abandoned approaches.
- Use `## What`, `## Verification` and `## Limits / follow-ups` when those sections help; omit empty sections. A small fix can use a short paragraph plus validation. Larger integration PRs may link a checkpoint table and detailed evidence instead of copying the execution log into the body.
- Include `Closes #<issue>` or `Fixes #<issue>` only for issues whose acceptance criteria the PR actually satisfies. Link partial/deferred work without a closing keyword, and name exclusions or remaining limitations with follow-up issue links where available. Do not claim an epic complete merely because all component changes are present.
- Report the checks actually run and their results: appropriate focused tests and root `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. State any failure, skip or unavailable check and its practical limit. Distinguish fixtures, mocks and injected states from real server/browser/model validation.
- For UI changes, exercise the affected flow in a browser using `devrun` servers, include desktop and narrow-screen evidence where applicable, and embed or link actual screenshots. If browser validation is unavailable, state that layout/interactions remain unverified. No screenshots are needed for changes without visual behavior.
- Tie evidence to the source tested. After integration or conflict resolution, review the changed boundaries and rerun affected checks before carrying forward prior evidence. Before declaring the PR ready, inspect GitHub checks on the current head; fix failures or report the concrete blocker. Local checks alone do not establish green CI.
- Keep agent/process history and raw measurements in the relevant execution log or evidence report. The PR should contain enough accessible evidence and limitations to assess the delivered behavior, with links to details.
