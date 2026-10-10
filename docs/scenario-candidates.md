# First historical scenario: candidates

Research for issue #83. The maintainer decides. Items marked **(verify)** come from search summaries and secondary sources and must be checked against the primary sources before any data goes into `src/data/`. Nothing here has been checked against a map scan yet.

## What the first scenario must do

- Be small: roughly brigade or division scale, so the assumed command level (battalions and brigades, see D6) works with a handful of roles per side.
- Fit the Kriegsspiel era (1824 to the 1880s) and the Kriegsspiel tradition of staff-ride style engagements.
- Run in one game day or less, so it can be played at 1:1 over a long weekend and at 12:1 in one live session (see [gameplay.md](gameplay.md)).
- Have a period map that is free to reuse, and an order of battle good enough to name units, commanders and strengths.
- Offer decisions where couriers, stale information and fog of war matter, which is the point of D2 and D4.

## Candidate A: Ball's Bluff, 21 October 1861 (American Civil War)

- **Forces.** A Union division detachment under Stone (Baker, Lander, Gorman and others) crosses the Potomac against a Confederate brigade-level force under Evans. Each side is on the order of 1,700 to 2,000 men engaged **(verify)**.
- **Maps.** US Library of Congress holds period maps, including an A. Hoen & Co. lithograph of the seat of war and battle plans ([Crossroads of War map list](https://crossroadsofwar.org/?p=1114)). US federal and pre-1900 works are normally public domain, but each LoC item's rights statement must be read. Done for #84: the Corbett map (LoC 99439216) is free to use, see `assets/maps/sources.json`.
- **Order of battle.** Good. Separate Union and Confederate pages exist ([Union](https://en.wikipedia.org/wiki/Battle_of_Ball%27s_Bluff_order_of_battle:_Union), [Confederate](https://en.wikipedia.org/wiki/Battle_of_Ball%27s_Bluff_order_of_battle:_Confederate)). Note that the Official Records and most secondary works list Lander's and Gorman's brigades in the reverse order and place the 15th Massachusetts and 42nd New York under Gorman, while the Union page follows National Archives Record Group 393. This source conflict needs a decision before data entry. The Official Records are public domain.
- **Pacing.** One day. At 1:1 the fight is a long afternoon and evening, with the real tension in the slow river crossing by a few boats. At 12:1 it is a short live session.
- **Hooks.** A single bottleneck (the crossing) makes courier delay and reinforcement lag decisive. The Union side starts with poor knowledge of the Confederate strength. The Confederate side must guess where the main effort lies. Both generals can be left to the LLM if roles are empty.
- **Risks.** A heavily wooded bluff and a river, so the flat-map, terrain-grid plan (D3) must represent a steep bank and wood cover. Little cavalry or artillery to exercise those rules.

## Candidate B: Podol, 26 to 27 June 1866 (Austro-Prussian War)

- **Forces.** A Prussian First Army brigade (15th Brigade, von Bose) against elements of Clam-Gallas's Austrian I Corps, about 1,300+ Prussians against about 4,000 Austrians **(verify)** ([Wikipedia](https://en.wikipedia.org/wiki/Battle_of_Podol), [History of War](https://www.historyofwar.org/articles/action_podol.html)). Sources disagree on the date and numbers.
- **Maps.** Not found. The Prussian General Staff history of 1866 has period maps, and Austrian and Prussian sheets are old enough to be public domain, but the digitised copy and its rights must be located **(verify)**.
- **Order of battle.** Brigade level is findable in the General Staff history. Not confirmed.
- **Pacing.** A night-time action over about a day. Fits both ratios.
- **Hooks.** A small Prussian force against a larger Austrian one, a bridge crossing at night, and an Austrian side that held a strong position and was surprised. Close to the German-staff tradition the game comes from.
- **Risks.** Weakest sourcing of the three. German-language material and a map we have not found.

## Candidate C: Wissembourg, 4 August 1870 (Franco-Prussian War)

- **Forces.** A French division (Douay) of about 6,000 against about 25,000 German troops with 144 guns **(verify)** ([Wikipedia](https://en.wikipedia.org/wiki/Battle_of_Wissembourg_(1870)), [War History](https://warhistory.org/article/the-battle-of-wissembourg-4-august-1870-part-i?amp=1)). Sources give widely different numbers.
- **Maps.** Not found. French and German staff maps of 1870 exist, and rights need checking **(verify)**.
- **Order of battle.** Well documented from both sides, but the German side spans three corps, which is too much command structure for a first scenario.
- **Pacing.** One morning and afternoon. Fits both ratios.
- **Hooks.** Strong defensive position on the Geisberg, a stubborn defence, and a lopsided force ratio.
- **Risks.** Large, and the outcome is nearly fixed by the force ratio, so there is less for the players to decide. Better as a later scenario.

## Comparison

| | Ball's Bluff | Podol | Wissembourg |
|---|---|---|---|
| Size | Small | Small | Medium to large |
| Map found | Yes (LoC, check rights) | No | No |
| Order of battle found | Yes, with a known conflict | Partly | Yes, large |
| One-day fit | Good | Good | Good |
| Courier/fog hooks | Strong (river crossing) | Good | Moderate |
| Sourcing effort | Low | High | Medium |

## Recommendation

**Ball's Bluff.** It is the smallest, it is the only one with a map and order of battle that we have already located, its sources are in English and public domain, and its river crossing is a natural test of couriers, delay and fog of war. Podol is the best second scenario if we want a Prussian setting closer to the game's roots.

## Next steps once chosen

1. ~~Read the rights statement on the chosen map and record it.~~ Done (#84), see `assets/maps/README.md`.
2. Resolve the Lander/Gorman order-of-battle conflict against the Official Records.
3. Pull march rates and tables per [research.md](research.md) section 6.
4. Hand-annotate the map for the terrain grid (roadmap, milestone with the first historical scenario).

## Sources

- [Battle of Ball's Bluff order of battle: Union](https://en.wikipedia.org/wiki/Battle_of_Ball%27s_Bluff_order_of_battle:_Union)
- [Battle of Ball's Bluff order of battle: Confederate](https://en.wikipedia.org/wiki/Battle_of_Ball%27s_Bluff_order_of_battle:_Confederate)
- [Ball's Bluff Maps, Crossroads of War](https://crossroadsofwar.org/?p=1114)
- [Battle of Podol, Wikipedia](https://en.wikipedia.org/wiki/Battle_of_Podol)
- [Action of Podol, History of War](https://www.historyofwar.org/articles/action_podol.html)
- [Battle of Wissembourg (1870), Wikipedia](https://en.wikipedia.org/wiki/Battle_of_Wissembourg_(1870))
- [The Battle of Wissembourg Part I, War History](https://warhistory.org/article/the-battle-of-wissembourg-4-august-1870-part-i?amp=1)
