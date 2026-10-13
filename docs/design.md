# Game design and unique features

## Vision

A non-real-time, asynchronous, multiplayer wargame where you command by **writing orders**, never by moving pieces. A server-side **LLM umpire** reads both sides' orders, consults a deterministic simulation, and returns what each commander actually sees, hears and is told. Fog of war, friction and imperfect communication are the game.

Pillars:

1. **You command, you don't control.** Orders go through subordinates who can misunderstand, be late, or lose the message.
2. **You only know what you've been told.** Your map is your picture of the war, built from reports that may be stale or wrong.
3. **The umpire is a character, not a calculator.** Narrative adjudication with auditable mechanics underneath.
4. **Time is real and adjustable.** A continuous game clock runs at 1:1, 4:1, 12:1 or any ratio. You check in, read, and write. Pausable by vote when life intrudes.

## Hybrid adjudication (the key design decision)

Free Kriegsspiel with a pure LLM is inconsistent and unauditable. Pure rigid Kriegsspiel is slow and robotic. We split the job:

| Layer | Owner | Examples |
|-------|-------|----------|
| State and physics | Deterministic engine | positions in continuous space (no grid), pathfinding, march rates, line of sight, supply, ammo, fatigue, combat odds, dice |
| Interpretation | LLM | parse free-text orders into structured intents, resolve ambiguity, flag impossible orders |
| Judgment | LLM, bounded | assign modifiers and odds for situations the engine has no rule for (the "umpire's call"), within caps |
| Narration | LLM | field reports, courier dispatches, after-action text, per-side fog-filtered |

The LLM may propose any arrangement of units it judges realistic, subject only to the engine's physical-plausibility checks (D15). It never edits state directly. It returns structured proposals (intents, modifiers, event requests) that the engine validates and applies. Dice are rolled by the server with a seeded RNG, never by the model.

## Feature ideas

### Core (v1)

- **Free-text orders.** "Colonel Mueller: take the 2nd battalion up the Albrecht road, screen the bridge at Hohenau, don't engage unless pressed." Parsed into structured intents plus preserved original text.
- **Order delay and friction.** Delivery time depends on courier distance and terrain. Orders can be late, garbled, or lost. Subordinates execute what they *understood*.
- **Fog of war per side.** Each player gets their own fog-filtered map and narrative. Enemy markers carry confidence and age ("cavalry, c. 2 sqn, seen 3 h ago").
- **Umpire log and reveals.** After a game, the full unfiltered log is released: what the umpire knew, what dice were rolled, what modifiers were applied.
- **Deterministic replay.** Every turn is reproducible from state + orders + seed + recorded LLM outputs.

### Differentiators

- **Subordinate personalities.** Each commander has traits (aggressive, cautious, literal, initiative-taking) which colour how orders are interpreted. A cautious general may halt short; an aggressive one may exceed his orders. Trait reputations are learned by the player over a campaign. Implemented as hidden traits that bound how a move is read, softened when the order states its intent (D36).
- **Commander's intent matters.** Orders that explain *why* are executed more sensibly when circumstances change (Auftragstaktik vs literal obedience). The umpire grades this.
- **Written reports as the only sensor.** Player maps are reconstructed from reports, with the player free to annotate. No omniscient minimap.
- **Courier and signal layer.** Couriers can be intercepted by enemy cavalry, and captured dispatches can be read by the other side (the umpire hands them over in-fiction). Implemented as courier model v2 (see "Courier model v2" in [decisions.md](decisions.md)).
- **Rigid / Free dial.** Lobby setting from "rigid" (engine-heavy, tables visible) to "free" (wider bounded judgment). Same server, different caps (D14, 3.11).
- **Umpire personas.** Tone and temperament: dry Prussian staff officer, a pedantic one, a dramatic war-correspondent mode.
- **Umpire consultation.** Players may submit questions ("Can I see the ford from the ridge?"). The umpire answers in character, and the question costs game time.
- **Hot-seat and solo vs AI commander.** A second LLM plays the opposing commander using only fog-filtered information.
- **Historical scenarios and procedural ones.** Scenario files include map, OOB, objectives, weather, historical notes. The existing noise-based generators cover procedural terrain.
- **Campaign persistence.** Casualties, ammunition and morale carry over between scenarios.

### Stretch

- Spectator and "war correspondent" view with delayed omniscient commentary.
- Training mode where the umpire explains, afterward, why something happened.
- Voice orders.
- Larger scale: corps commanders with player-controlled division commanders under them (multi-player per side, each with a partial view).

## The trust problem (design constraints on the LLM)

| Risk | Mitigation |
|------|-----------|
| Inconsistent rulings | Engine owns physics; rulings recorded in a per-game "case law" file the model sees on every call |
| Information leaks across sides | Separate prompts per side for narration; the model that sees the master state never writes player-visible text without a filter pass; leak tests in CI |
| Favouring one player / being talked into things | Orders are inputs, never instructions to the umpire; prompt-injection tests; modifiers capped by engine |
| Hallucinated units or terrain | Narration is generated from validated event lists, and checked against entity IDs |
| Cost and latency | Turn-based so batch calls; cache; cheap model for parsing, stronger for judgment and narration |
| Unfairness feeling | Post-game reveal of all rulings and dice |
