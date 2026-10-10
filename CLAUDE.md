# CLAUDE.md

Kriegsspiel: an asynchronous, long-running wargame with an LLM umpire on a server. Read `docs/decisions.md` first, then the doc that matches your task.

## Docs
- `docs/decisions.md`: decision log and open questions
- `docs/architecture.md`: clock, scheduler, LLM barrier, pause voting, components
- `docs/gameplay.md`: how the game plays, pacing, roles, collaboration
- `docs/hq-interface.md`: the desk and map table, rendering decision
- `docs/design.md`: pillars, features, trust risks
- `docs/research.md`: history and sources
- `docs/llm-providers.md`: configuring, adding and locally running LLM providers
- `docs/roadmap.md`: milestones

## Rules of the design
- The engine is pure and deterministic. It never reads the wall clock. It only advances to a given game time.
- The LLM never mutates state. It returns structured proposals, and the engine validates and applies them. Dice come from the seeded server RNG.
- The only path from master state to a client is the visibility filter. Never send hidden state.
- Player inputs and LLM outputs are logged so any game can be replayed with no model calls.
- Game time must not advance past an unresolved LLM result (the LLM barrier).
- Any change to the clock must work at rates 1, 4, 12 and in manual and fast-forward modes.

## Current state
- Only the monorepo scaffold exists (`packages/engine`, `packages/protocol`, `server`, `client`; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`). An earlier Phaser prototype was abandoned and removed. Do not revive it. Build the engine and client fresh from the docs.
- Node version is in `.nvmrc`. Start dev servers with `devrun` (see `~/CLAUDE.md`), not bare `npm run dev`.

## Keep docs current
When a design decision changes, update `docs/decisions.md` and the affected doc in the same change.
