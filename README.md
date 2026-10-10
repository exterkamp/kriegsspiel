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

Design phase. There is no code yet. The planned client is a Three.js map table (flat historical map, 3D pieces) plus a Papers Please-style Svelte desk, backed by a TypeScript server with a continuous-time engine and an LLM umpire. An earlier Phaser prototype was abandoned.
