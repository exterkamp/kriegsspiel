# Kriegsspiel

A slow, long-running wargame played against a continuous game clock (1:1, 4:1, 12:1 or any ratio), based on the classic Prussian *Kriegsspiel* (von Reisswitz, 1824), with an **LLM umpire** on the server.

You never move pieces. You write orders. Subordinates interpret them, couriers carry them (or don't), and the umpire tells each side only what its commander would plausibly know.

## Idea in one paragraph

A deterministic engine owns the world: terrain, movement, line of sight, combat, dice. An LLM owns language: it turns free-text orders into structured intents, makes bounded judgment calls where the rules are silent (the umpire's discretion in "free Kriegsspiel"), and narrates fog-filtered reports for each player. The model never changes state directly, and everything it does is logged and replayable.

## Docs

- [docs/decisions.md](docs/decisions.md): decision log and open questions (start here)
- [docs/research.md](docs/research.md): history of Kriegsspiel, rigid vs free rules, related LLM wargaming work, sources
- [docs/design.md](docs/design.md): pillars, feature ideas, hybrid adjudication model, trust risks
- [docs/gameplay.md](docs/gameplay.md): how Kriegsspiel is played, the continuous game clock, pacing, pausing, and collaborative roles
- [docs/hq-interface.md](docs/hq-interface.md): the general's-HQ desk: historical map table, in-tray of dispatches, orders desk, staff
- [docs/hq-getting-started.md](docs/hq-getting-started.md): current HQ features, user instructions and hands-on validation checklist
- [docs/architecture.md](docs/architecture.md): server/engine/umpire design, tech choices, testing
- [docs/roadmap.md](docs/roadmap.md): milestones and what is done

## Current state

Epic 1 (the playable vertical slice) is done: you can start a game, write orders, wait for couriers and reports, and play "Hold the Bridge" to a win or loss in a browser, and the same game replays identically from its log. Since then the project has gained an Angular 22 client over a Three.js map table (with the desk: in-tray, orders, order of battle, journal, staff conference), accounts, guest play and a lobby, pause and ratio voting, notifications, an LLM umpire that runs on Anthropic, OpenAI-compatible or local Ollama providers (the rule-based parser remains the fallback), an LLM or scripted opposing commander, a post-game umpire's window, and a visual design system. See [docs/roadmap.md](docs/roadmap.md) for what is done and what is next.

### Play it

1. Start the API and the client (see Dev servers below), or `docker compose up` (see [docs/deployment.md](docs/deployment.md)).
2. Open the client. Choose **Play as guest** (turned on with `GUEST_PLAY=1` on the server) or sign in with an emailed magic link. With no `MAIL_WEBHOOK_URL` the link is printed in the server log.
3. Open `/?new=1&side=blue&rate=12` to create a game and take Blue, or `/?lobby=1` for the lobby, or `/?game=<id>` to join a game. With none of these the page shows the main menu.
4. Read the opening report in the in-tray (I), write orders at the orders desk (O), for example "1st Battalion march to the bridge and hold", choose a courier and sign. Hold the bridge for 50 game minutes; Red wins by taking it.

How long it takes: with orders a game ends at about game minute 40 (measured: 3.4 real minutes at 12:1, 10 at 4:1, same outcome), and a game nobody breaks runs the full 50 minute hold (4.2 real minutes at 12:1, 12.5 at 4:1). See D35 in [docs/decisions.md](docs/decisions.md).

Replay a finished game from its log with no model calls: `npm run replay -w server -- <log>` (see `server/src/game/replayCli.ts`).

## Development

Node version is in `.nvmrc` (`nvm use`); use npm 10.9.7 for the pinned map source build. This is an npm workspaces monorepo:

- `packages/engine`: pure, deterministic game engine
- `packages/protocol`: shared types between server and client
- `packages/maps`: standalone battlefield generation and validated export
- `server`: Node.js server
- `client`: Angular 22 + TypeScript client (standalone components, signals, zoneless) over a Three.js table

```bash
npm run setup:map-source # verify pinned engine source and build its local tarball
npm ci
npm test          # Vitest in every package (`ng test` plus the framework-free suites in client)
npm run test:stress # whole suite repeatedly under CPU load; fails on any flake
npm run lint      # ESLint + Prettier check
npm run typecheck # tsc --noEmit in every package
npm run build
npm run format    # Prettier write
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on pull requests.

### Flaky tests

A test that passes alone but fails on a busy machine depends on timing. Run `npm run test:stress` to
run the full suite several times while one busy-loop process per core occupies the CPUs; it exits
non-zero if any run fails and prints the failing tests. Tune it with `STRESS_RUNS` (default 5) and
`STRESS_BURNERS` (default: one per core; `0` for no extra load), for example
`STRESS_RUNS=20 STRESS_BURNERS=12 npm run test:stress`. Fix a flake by injecting the clock or timers
(`FakeTime` in `server/src/game/testing.ts`, vitest fake timers) or by waiting on the event the test
needs, not by raising a timeout.

### Server settings

The server reads `PORT` (default 3000), `HOST` (default 127.0.0.1) and `SCRIPTED_OPPONENTS`. Sides the scenario marks `scripted` (Red in "hold the bridge") are played by the built-in opponent unless `SCRIPTED_OPPONENTS` is `0`, `false` or `off`.

### Dev servers

Start dev servers with `devrun`, not a bare `npm run dev`:

```bash
devrun up --name api --port-env PORT -- env GUEST_PLAY=1 npm run dev -w server
devrun up --name web --port-env PORT -- sh -c 'API_URL=$(devrun url api) npm run dev -w client'
devrun url web
devrun logs web -n 50
devrun stop web
```
