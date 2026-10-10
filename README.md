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
- [docs/architecture.md](docs/architecture.md): server/engine/umpire design, tech choices, testing
- [docs/roadmap.md](docs/roadmap.md): milestones and next steps

## Current state

Early scaffold. The monorepo is set up (engine, protocol, server and client packages with tests, lint and CI); there is no game logic yet. The planned client is a Three.js map table (flat historical map, 3D pieces) plus a Papers Please-style Svelte desk, backed by a TypeScript server with a continuous-time engine and an LLM umpire. An earlier Phaser prototype was abandoned.

## Development

Node version is in `.nvmrc` (`nvm use`). This is an npm workspaces monorepo:

- `packages/engine`: pure, deterministic game engine
- `packages/protocol`: shared types between server and client
- `server`: Node.js server
- `client`: Vite + TypeScript client

```bash
npm install
npm test          # Vitest in every package
npm run lint      # ESLint + Prettier check
npm run typecheck # tsc --noEmit in every package
npm run build
npm run format    # Prettier write
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on pull requests.

### Server settings

The server reads `PORT` (default 3000), `HOST` (default 127.0.0.1) and `SCRIPTED_OPPONENTS`. Sides the scenario marks `scripted` (Red in "hold the bridge") are played by the built-in opponent unless `SCRIPTED_OPPONENTS` is `0`, `false` or `off`.

### Dev servers

Start dev servers with `devrun`, not a bare `npm run dev`:

```bash
devrun up --name web --port-env PORT -- npm run dev -w client
devrun url web
devrun logs web -n 50
devrun stop web
```
