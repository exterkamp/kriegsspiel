# Rules tables

The numeric rules live in `src/data/*.json`, one file per table, validated by `npm test` (`test/rules-data.test.js`). This doc explains where the numbers come from and how far to trust them.

## Sources

Defined in `src/data/sources.json`.

| Id | What it is | How we cite it |
|----|------------|----------------|
| `reisswitz-1824-scan` | The 1824 rulebook by G. H. R. von Reisswitz, as OCR text from [archive.org](https://archive.org/stream/reisswitz-1824/Reisswitz1824_djvu.txt). **Primary.** | Line number in the djvu.txt file. The OCR has no reliable page numbers. |
| `rulespal-reisswitz` | A modern English edition of the 1824 rules with the 1828 supplement as Appendix Two, on [RulesPal](https://rulespal.com/the-von-reisswitz-kriegsspiel/rulebook). Secondary. | The edition's own section numbers. |

Every table file has a table-level `source` (`{source, locator}`), and individual rows add their own where they come from somewhere else. The test fails if any number has no citation or if a citation names an unknown source.

## Which numbers are 1824 and which are later

- **1824 rigid rules:** everything in `scale`, `march` (ruler bands, special rates, infantry terrain row), `frontage`, `fire`, `casualties` and `morale`, except where marked below.
- **1828 supplement:** the incline-based infantry march table (`supplement_1828_infantry_by_incline` in `march.json`) and the six-die odds scheme (not encoded yet). These replace the 1824 versions in the 1828 game. We keep both so the engine can pick an edition later.
- **Later revisions (c. 1846-48) and free Kriegsspiel (1870s):** not used here. Free Kriegsspiel has no tables, which is what the LLM umpire does (see `research.md` section 3).

## Verifying three values

Line numbers (`djvu.txt line N`) are counted in the raw `Reisswitz1824_djvu.txt` file as downloaded from archive.org, with its HTML wrapper included. If you strip the wrapper you will land on the wrong line.

1. Ruler band 800 paces (gallop): `march.json` cites `djvu.txt` line 3952, "800 Schritt: Galopp der geschlossenen Cavallerie…".
2. Scale 400 paces per decimal Zoll: `scale.json`, `djvu.txt` line 3798.
3. Infantry fire at 100-200 paces, `[20,20,10,25,50,6]`: `fire.json`, edition section 3.1.1 Infantry Fire Table.

The 1824 scan confirms the march ruler and the scale. The fire and close-combat tables are cited to the English edition only, because the OCR of the scan's tables is not readable. A reviewer should check those against the edition, and ideally against page images of the scan.

## Simplifications and known problems

- The edition is inconsistent about the half-battalion block: one passage says 75 deep and 125 long (we use `frontage` 125, `depth` 75), another says width 75 and length 125. The engine depends on this, so decide it before using the footprint.
- The 1:8000 map ratio is confirmed only by the edition. The scan OCR has the 400 Schritt part but not the ratio.

- We record only what was legible. Nothing was filled in from memory.
- `casualties.json`, white T face of Die 1: the edition prints 30/18 in its table and 30/12 in its dice picture. We use 30/12 to match the other T faces. Unresolved.
- `march.json`: the 3rd ruler band note mentions a foot battery in few cases; the calibre is illegible in the OCR.
- Units are paces and 2-minute moves, as in the source. The engine can convert to game time (see `architecture.md`), but the data files stay in source units.

## Unit types and formations in the engine

The engine reads its unit stats from `packages/engine/src/unitTypes.ts` (decision "Unit types, formations and data-driven stats"). Types: `line_infantry`, `skirmishers`, `cavalry`, `artillery`. Formations: `line`, `column`, `square`, `skirmish`, `loose`, each with multipliers relative to `line` for ground per man and shape, march pace, outgoing fire, and casualties taken from fire and melee. Only these are traced to the tables above: infantry march (200 paces per 2-minute move, `march.json`), cavalry trot (600 paces), and line infantry ground per man (450 men in 125 x 75 paces, `frontage.json`). Everything else (fire rates, ranges, formation multipliers, change times, skirmisher and artillery pace) is a placeholder, not from the rulebook. Column moves faster than line (route march against deployed), which is a simplification of the 1824 pace bands.

## Supply, fatigue and ammunition in the engine

None of the numbers for fatigue, forced marching, ammunition use or wagon reach come from the rulebook; they are placeholders in `packages/engine/src/fatigue.ts` and `supply.ts`, listed in the decision "Supply, fatigue and ammunition" in `decisions.md`.

## Sight and cover

None of the sight numbers come from the 1824 rulebook, which leaves sight to the umpire. Placeholders in `packages/engine/src/visibility.ts`: sight range per unit type (`unitTypes.ts`), 200 m in or out of a wood or building, and partial concealment (`PARTIAL_PENALTY` = 4: a metre of ground at concealment c counts as 1 + 4c metres; a unit standing in it counts as 1/(1-c) times as far). Height tags (`low`, `flat`, `rise`, `high`) decide whether a ridge blocks the line. Cover is the per-feature `cover` attribute (0..1) read at the target in combat. The weather hook is `GameState.sightFactor`.

## Gaps

- Full 1824 movement table (cavalry, horse artillery, other terrain and slopes). It is an image in the edition.
- Close-combat Die 4 (3:1) row.
- Artillery fire tables other than 12-pdr 1500-2000 paces (12-pdr nearer ranges, 6-pdr, 7-pdr howitzer, 10-pdr howitzer).
- Cavalry squadron, battery and column frontages and depths.
- The 1828 six-die odds, small-arms dice and artillery dice.
