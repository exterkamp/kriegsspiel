# Kriegsspiel: background research

Notes gathered to inform the design. Items marked **(verify)** come from secondary sources or my memory and should be checked against the primary rulebooks before we rely on them for mechanics.

## 1. Short history

| Date | Event |
|------|-------|
| c. 1812 | Georg Leopold von Reisswitz (a Prussian court official) builds a sand-table war game for the royal family. |
| 1824 | His son, Lt. Georg Heinrich Rudolf von Reisswitz, reworks it onto real topographic maps with scaled unit blocks. He presents it to the king and general staff. Müffling's "this is not a game, it is training for war" is the famous quote. The king orders a set for every regiment. |
| 1828 | First revision (supplement) by a group of young officers. Revised march rates and new dice odds. |
| c. 1846-48 | Further revision by the Magdeburg and Berlin wargaming societies. |
| 1870s | Backlash against "rigid" rules. Meckel (*Studies on Kriegsspiel*, 1873) and Verdy du Vernois (*Beitrag zum Kriegsspiel*, 1876) push the **free Kriegsspiel**: little or no dice and tables, the umpire decides on military judgment. |
| 1880s+ | Spreads to Britain (Hoffbauer, Baring translations), the US and elsewhere. Later it feeds Naval War College wargames, then modern professional wargaming. |

Caveat: popular histories credit the game with Prussia's 1866 and 1870 victories. Scholarly accounts treat that as overstated. The game was one training tool among several.

## 2. Core mechanics of the original (rigid) game

- **Two sides, one umpire.** Each side sits in a separate room with its own map, or is screened off. The umpire holds the master map showing everything.
- **Fog of war.** A player only sees enemy blocks the umpire places on their map, when line of sight exists. This is widely cited as the first systematic fog of war in a game.
- **Written orders.** Players do not move pieces directly. They write orders, in the style a commander would actually give. The umpire interprets them and moves the units as the subordinates would carry them out, including misunderstandings.
- **Turns are fixed slices of time** (about 2 minutes in the 1824 rules, **verify**), so movement and fire are tied to real clock time and march rates.
- **Units are blocks** with a footprint matching real frontage at map scale. Maps were real topographic sheets (scale around 1:8000 in some sources, **verify**).
- **Dice and tables.** The umpire rolls a die against tables for fire and melee results. Casualties are fractional, so units degrade rather than die outright (the original used hit-point-like losses; **verify**). Morale, formation, terrain and flank attacks modify results.
- **Umpire discretion.** Anything the tables did not cover was the umpire's call, and this was always the weak point: it needs an impartial, experienced officer.

## 3. Free Kriegsspiel (the one that suits an LLM)

Verdy du Vernois and Meckel argued that tables and dice slow the game and that a veteran officer's judgment produces more realistic outcomes. In free Kriegsspiel:

- The umpire decides outcomes from military judgment, sometimes rolling a single die only for genuine uncertainty (the umpire assigns the odds).
- Players have wide latitude in what they order.
- Known failure modes: the umpire's credibility depends on their experience, and a senior officer present could overrule them.

An LLM umpire is structurally a free-Kriegsspiel umpire. That is exactly the failure mode we need to engineer around (see `design.md` and `architecture.md`): consistency, impartiality, memory and auditability.

## 4. LLMs in wargaming: related work (2025-2026)

- **U.S. Army War College (AY2026)** seminars used LLMs to speed adjudication in a tabletop game and explicitly linked it to free Kriegsspiel. Finding: it reduced instructor burden and let students focus on planning. See the War Room pieces linked below.
- **Snow Globe** (open-ended wargames with LLMs): a Python "control agent" synthesizes player moves into outcomes, supports llama.cpp, Transformers and API backends.
- **GenWar Lab** (Defense News, Nov 2025): LLM agents paired with a physics-based simulation (AFSIM). The LLM handles natural language and the simulator adjudicates.
- **SCSP hackathon "Kriegsspiel" repo** (github.com/skookumer/SCSP): rules-based state engine plus an LLM Red Cell, logs every prompt and state transition. Self-reported claims, not independently reviewed.
- **Caution (Benjamin Jensen, CSIS):** AI helps wargames only if documented and evaluated. Foundation models are not well benchmarked for strategy, and the risk is analysis collapsing to "here is what an LLM said."

**Takeaway:** the strong pattern is a hybrid. A deterministic engine owns the state and the physics. The LLM owns language: parsing orders, narrating, and judging ambiguous cases. We should follow that.

## 5. Sources worth reading next

- [Wikipedia: Kriegsspiel](https://en.wikipedia.org/wiki/Kriegsspiel)
- [Wikipedia: Georg von Reisswitz](https://en.wikipedia.org/wiki/Georg_von_Reisswitz)
- [Military History Now: how a 19th century tabletop game changed history](https://militaryhistorynow.com/2019/04/19/kriegsspiel-how-a-19th-century-war-game-changed-history/)
- [kriegsspiel.org rules](https://kriegsspiel.org/rules/): modern community rules with full tables
- [RulesPal: von Reisswitz rulebook](https://rulespal.com/the-von-reisswitz-kriegsspiel/rulebook): has the march-rate and dice sections we still need
- [Tactical Notebook: free kriegsspiel](https://tacticalnotebook.substack.com/p/free-kriegsspiel)
- [NPS wargaming history](https://drift.nps.edu/wargaming/?p=339)
- [Divergent Options: Kriegsspiel 2.0 for leadership training](https://divergentoptions.org/2021/05/17/assessing-the-impact-of-a-kriegsspiel-2-0-in-modern-leadership-and-command-training/)
- [Army War College War Room: back to the basics](https://warroom.armywarcollege.edu/articles/back-to-the-basics/)
- [Defense News: GenWar Lab](https://www.defensenews.com/news/your-military/2025/11/24/new-lab-offers-generative-ai-for-defense-wargaming/)
- [SCSP Kriegsspiel repo](https://github.com/skookumer/SCSP)

## 6. Open research TODOs

- [ ] Pull actual march rates, frontage, fire-range and casualty tables from the 1824 rulebook / kriegsspiel.org and write them into `src/data/`.
- [ ] Find a public-domain topographic map style to emulate for the renderer.
- [ ] Look for arXiv work benchmarking LLM adjudication consistency.
