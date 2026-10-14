# AGENTS.md

Kriegsspiel: an asynchronous, long-running wargame with an LLM umpire on a server. Read `docs/decisions.md` first, then the doc that matches your task.

## Docs
- `docs/decisions.md`: decision log and open questions
- `docs/architecture.md`: clock, scheduler, LLM barrier, pause voting, components
- `docs/system-overview.md`: diagrams of the system, how LLMs are integrated, and what each class is responsible for
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
- `docs/umpire-benchmark.md`: turn-umpire benchmark: cases, checks, rubric, Claude Code reference and blind grading
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
- Lobby (D17a): open `/?lobby=1` for the new-game form and your games; `POST /games` with `lobby: true` waits for `/games/:id/start`. `/?game=<id>` is the invite link and shows the room until the game starts. Lobby code is in `server/src/lobby`, `client/src/app/lobby`.
- Notifications (`server/src/notify`, D17b): preferences and web push subscriptions under `/notifications/*`; set `VAPID_*` to enable web push.
- Client (`client/`, Angular 22, standalone `OnPush` components, signals, zoneless; D29): sign in with the emailed link, then open `/?new=1&side=blue&rate=12` to create a game and take a side, or `/?game=<id>` to join one; with neither the page shows the main menu (`client/src/app/shell`, see `docs/hq-interface.md`). The HQ fixture UI was retired in D28. The Angular dev server proxies `/games` (REST and WebSocket), `/scenarios`, `/admin/api` and `/auth` to `$API_URL` (default `http://localhost:3000`, `client/proxy.conf.cjs`). Framework-free modules (net, table, window, pure desk logic, map authoring, admin) live in `client/src/legacy/` and are imported as `@legacy/*`; their `*.test.ts` run under plain Vitest (`client/vitest.config.ts`), components' `*.spec.ts` under `ng test`; `npm test -w client` runs both. The server sends a returning side the orders it sent (`sentOrders`, from the input log) but not yet a delivery estimate. The marks toolbar (`MarksBarComponent`) draws pins, pencil lines, arrows and range rings on the table (D16b); they are stored per side on the server and survive a reload.
- Desk shell (`client/src/app/desk`): an Angular layer over the persistent Three.js canvas (`app/game`) with one button per view (map table, in-tray, orders, order of battle, journal, staff conference), hotkeys T/I/O/R/J/C and Escape for the table. `GameService` and `DeskStore` (signals) hold the shared state. Leaving the table dollies the camera to the desk (`TableScene.setDesk`) and fades the canvas; the canvas keeps rendering and the table pose is restored on return. The in-tray, desk clock, pause panel, orders desk, roster, journal (war diary), staff conference and game-over paper are components in `app/desk` and `app/game` over the pure logic in `legacy/desk/*.ts` (tray, clock, pause, orders, roster, journal, conference); read/filed/discarded marks, order drafts and the diary persist in localStorage per game. The staff conference runs on fixtures until the server endpoint in `docs/staff-conference.md` exists. Typecheck is `tsc` over `tsconfig.app.json` and `tsconfig.spec.json`.
- Umpire's window (after the game): `server/src/api/umpireWindow.ts` serves `GET /games/:id/window` and `/window/at?at=` to a seated player only once the world has an outcome; `client/src/legacy/window` builds the table scene from a frame and `UmpireWindowComponent` is the scrubber. It is the only route that sends master state to a client, with the critique (`GET /games/:id/critique`, `server/src/api/critiqueService.ts`, `server/src/umpire/critique*.ts`, D38) under the same gate.
- Angular migration (#269) is complete (D29): the Svelte client is gone and `client/` is the Angular workspace. The history, inventory and what was dropped are in `docs/angular-migration.md`. Run it with `devrun up --name web --port-env PORT -- sh -c 'API_URL=$(devrun url api) npm run dev -w client'`.
- Visual design system (#327): tokens in `client/src/styles/tokens.css`, shared controls in `client/src/styles/ui.css` under `.ks-theme`, `ks-page-frame` and `ks-modal` in `client/src/app/ui`, the style guide at `/style-guide`; no hex colours or font families in component styles (a test enforces it). See `docs/hq-interface.md`.
- Turn mode (D39, Epic #393): `POST /games` with `mode: 'turns'` (and `turnMinutes`, `turnDeadlineHours`) makes a turn-based game on a manual clock; orders are held with `holdTurnOrder` and sent with `sendTurn`, and the turn resolves through the `TurnResolver` seam in `server/src/game/turns.ts`. `GameHost`'s default resolver is the engine adjudicator (11.4, `server/src/game/engineTurn.ts`): the turn's orders read by the rules parser, couriers rolled once by the courier pass, then the turn run under the ordinary handlers; `projectTurn` does the same on a copy for the umpire. At the `standard` and `free` dials, when a capable model serves the `adjudicate` stage (`turnUmpireEnabled`: an Anthropic key or another non-local provider; the keyless demo has none), the turn is the umpire's (11.6, `server/src/game/umpireTurn.ts`, stage in `server/src/umpire/adjudicate.ts`): it proposes, the engine checks, resends once, clamps, or falls back to the engine adjudicator; the logged proposal replays with no model. Scripted sides think at their interval inside an engine-resolved turn, as in real time, and the projection runs copies of them (`TurnResolveContext.agents`, #430). The client (11.10) offers the mode on the new-game form, shows the turn on the desk clock, a turn panel in place of the pause panel, held orders and **Send orders for this turn** on the orders desk (`TurnOrdersComponent`, `legacy/desk/turn.ts`), and glides pieces to their new places after a turn; see `docs/hq-interface.md`.
- Claude Code bridge (D42, #457): `UMPIRE_PROVIDER=claude-bridge` (or `UMPIRE_KEYLESS_PROVIDER=claude-bridge` with `docker-compose.claude-bridge.yml`) runs the umpire on the host's `claude` CLI through `tools/claude-bridge` (`npm run claude-bridge`); see `docs/llm-providers.md`.
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
