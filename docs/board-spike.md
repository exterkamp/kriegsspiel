# Board spike: readability and unit control (#443)

A small separate prototype to find out how the board should look and be controlled so the game is readable, easy to command and fun. It answers the owner's seven problems (2026-10-13) one by one, compares each answer with the current board, and says what to bring into the real client, in what order.

- Prototype: `/spike/board` (Developer tools → Board spike). It runs from a fixture and a small local simulation in the browser; no server. Run it with `devrun up --name web --port-env PORT -- npm run dev -w client` and open `$(devrun url web)/spike/board`.
- Code: `client/src/app/spike-board/` (`sim.ts` the local battle, `fixture.ts` the scenario, `report.ts` the chief of staff, `layout.ts` counter declutter, the component draws the board in SVG).
- Battle length: `tools/board-spike/battle-length.mjs` runs the **real engine** over many seeds; raw output in `docs/board-spike/battle-length.txt`.
- Nothing in the real game changed except the new route and its menu link.

## How to use the prototype

The scenario is 3 km by 2 km, north up: a river (the Aa) with one bridge, a wood on the far bank and a post road. Blue (you) has two battalions, a hussar squadron and a battery on the south bank; red has two battalions, uhlans and a horse battery to the north. A turn is ten game minutes. Red follows a script; blue units follow the fixture's first-turn orders unless you give them others.

- Click a unit to see it and give it an order; click the map to set where, shift-click to add a waypoint, click an enemy to set an attack's target. **Give order**, then **End turn**.
- ◀ ▶ step back and forward through the turns; the board shows that turn's end and that turn's trails.
- Wheel or + / − to zoom, drag to pan.
- Every variant is a query parameter, so any screenshot can be reproduced: `?turn=3` plays three turns; `pieces=labels|counters`, `trails=off|on`, `contact=overlap|line`, `enemy=ghost|strong`; `select=b1`; `zoom=x,y,width` (metres); `report=0` folds the report. The "(now)" option of each imitates the current board.

## Summary of the recommendation

| # | Problem | Tried | Verdict | Where the fix belongs | Follow-up |
|---|---|---|---|---|---|
| 1 | No sign of where units went since last turn | Own trail per unit (solid, side colour, arrowhead); turn scrubber | **Keep**: the single biggest gain in reading a turn | Client, plus the server sending the last turn's positions | #449 |
| 2 | Units get too close and overlap | Engine rule: stop at a 140 m contact line. Rendering: counters pushed apart on screen with leader lines | **Both**: the rule fixes the cause, the declutter fixes zoomed-out crowding | Engine (#446) and client (#450) | #446, #450 |
| 3 | Labels ugly and too big | Compact NATO-style counters, names on hover / selection / close zoom, three levels of detail | **Keep** | Client | #450 |
| 4 | Chief of staff should summarise the turn | Template report: headline, fights, quiet units, enemy list; unit names link to the board | **Keep the template**; a model version was not tried (see below) | Client (from the side's own view) | #453 |
| 5 | Battles too short | Real-engine measurement over 200 seeds; parameter variants | **Rules problem, and a narration problem**; proposed numbers put every case in 20-40 min | Engine | #447, #448, bug #445 |
| 6 | Seeing and setting orders by clicking a unit | Unit panel on click; verbs; click destination, shift-click waypoints, click target; structured intent plus optional note | **Keep** | Client, plus a structured intent on orders | #452 |
| 7 | Enemy unclear once spotted, no enemy movement | Seen / last known / unknown drawn distinctly; staff letters; size band; dashed trails of seen movement | **Keep** | Client, plus a stable designation from the server | #451, #449 |

Order to bring them in (each is independently useful; the earlier ones change the most for the least work):

1. **#447 battle length** (after the crash fix **#445**) and **#448 fight stages**: small engine changes, and they make every later board change show a fight worth watching.
2. **#446 contact line**: removes the overlaps at their cause; the board work then never has to draw an attacker standing inside a defender.
3. **#450 counters and declutter** and **#451 enemy states**: the look; can go together.
4. **#449 trails and scrubber**: needs a small server/protocol addition (last turn's positions through the visibility filter).
5. **#452 click to order**: the largest; needs a structured intent on orders.
6. **#453 chief of staff report**: best after #448 so it can name stages.

## Before and after

All screenshots are of the prototype: the "now" side imitates the current board's look in the same 2D renderer, so the comparison is of the idea, not of WebGL against SVG.

![All four changes, now and proposed](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-all.png?raw=true)

## 1. Trails since the last turn

**Tried.** For each own unit, its position every game minute of the last turn as a solid line in the side colour with an arrowhead at the end; for each enemy unit, only the minutes it was seen, dashed in the enemy colour. Both sit on a pale casing so they read across the road and the wood. Selecting a unit dims the other trails. A turn scrubber (◀ ▶) shows an earlier turn's end with that turn's trails.

![Trails off and on](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-trails.png?raw=true)

**Worked.** At a glance you see that enemy A left the wood for the river bank, and that the uhlans (B) rode off north-east and were lost; without trails both are just diamonds in new places. The casing was needed: the first version's red dashes vanished on the brown road.

**Did not.** Arrowheads under a counter are hidden by it; the trail running into the counter is enough. Two turns of trails at once was too busy, so only the last turn is shown; the scrubber covers older ones.

**Recommendation.** Keep. The server must send the side its units' minute-by-minute positions for the last turn and the enemy's **seen** positions only (#449).

## 2. Spacing and contact

**Tried.** (a) An engine rule in the local sim: a unit that is not withdrawing or screening stops when its next step would bring it closer than 140 m (centre to centre) to an enemy ahead of it, turns to face it, and is in contact. A thick bar across the line between the two marks the contact. (b) Rendering: counters are a fixed size on screen, so at a distant zoom they would cover each other; a small layout pass pushes the drawn counters apart and draws a leader line to the true place (`layout.ts`).

![March through vs contact line](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-contact.png?raw=true)

**Worked.** With the rule, the fight at the bridge always reads as two units facing each other across a line. Without it (the engine's behaviour today: a move order marches to its destination, and opposing footprints may overlap, `placement.ts`, `turn.ts`), the red battalion ended **behind** 1st Battalion: no drawing can make that readable. The declutter keeps counters apart on a phone where they are relatively larger.

**Did not.** The contact bar alone, at the fixed counter size, can look like a stray stick when zoomed in (counters far apart on screen); it reads well at the whole-map view where it matters most. A zigzag "front line" bar was tried first and read as a scribble.

**Recommendation.** Both: an engine rule (#446), because overlapping is a rules outcome, not a drawing one; and the declutter in the client (#450).

## 3. Compact counters

**Tried.** An upright box of fixed screen size (3% of the view, never under 26 px): side colour, NATO arm symbol (infantry a cross, cavalry a diagonal, artillery a dot), a small wedge on the side it faces, a strength bar under it, and a pip on the corner for the fight stage (engaged, losses, wavering, broken). Enemy units are NATO hostile diamonds. Names show on hover, selection, or close zoom; a short designation (1/12, H/3) at middle zoom; symbols only when zoomed far out.

![Labels vs counters](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-pieces.png?raw=true)

![Far and near level of detail](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-lod.png?raw=true)

**Worked.** The board is clean and the state of each unit is on the counter: the strength bar and the stage pip told the fight's story without opening anything. Labels on the far side from a fight stop them landing on the contact bar.

**Did not.** At the first try the short designations were too small (8 px) to read; raised to about 11 px. The facing wedge is small; useful mostly at close zoom.

**Recommendation.** Keep (#450). On a phone the minimum size matters more than the 3% rule (see the mobile shot below).

## 4. Chief of staff report

**Tried.** A template (`report.ts`) that compares the side's view before and after a turn and writes: a one-line headline (what matters most: a unit broke, a unit is wavering, who is in action), one paragraph per fight (who met whom, where, when, losses, stage), one for the units not fighting, and a list of known enemy bodies, newest first, each with when it was last seen. Every unit named is a link that selects it and brings it into view. Enemy bodies are named by staff letter and size band ("enemy infantry C (350–650)"), never by their real name.

**Worked.** The headline is the best part ("1st Battalion is wavering; support or withdraw it."). Giving contacts letters was needed: the first version had two "enemy infantry (400–700)" lines that could not be told apart. Splitting the enemy into a list made it scannable.

**Not tried: a model version.** The prototype has no server, and the owner's benchmarks (#389, #398) show the models that fit this host cannot adjudicate or parse reliably; a summary is easier than adjudication, but the template already reads well and cannot leak hidden state or invent events. Recommendation: ship the template (#453); a model rewrite of the same structured facts can be tried later behind the same shape, and only if a capable model is configured.

## 5. Battle length

The issue asked whether this is a rules problem or a narration problem. It is both.

**Rules.** `tools/board-spike/battle-length.mjs` runs the real engine (a copy of `packages/engine/dist`, with variant numbers written into the copy) over 200 seeds. Minutes from a unit's first exchange of fire, p10 / p50 / p90:

| case | stage | now | proposed |
|---|---|---|---|
| Two 600-man line battalions, firefight at 150 m, morale 80 | wavering | 58 / 86 / 118 | 14 / 16 / 22 |
| | broken | 148 / 168 / 178 | **28 / 36 / 42** |
| Red attacks from 400 m | wavering | 136 / 156 / 172 | 16 / 20 / 28 |
| | broken | never within 3 h | **38 / 46 / 50** |
| Hold the Bridge, every red unit attacks its opposite number | wavering | 0 / 6 / 66 | 10 / 14 / 18 |
| | broken | **2 / 6 / 22** | **18 / 22 / 30** |

Fights are **bimodal** today. When several shooters or a flank shot hit a unit (the usual case in a real game), it can lose 30 or more morale in one 2-minute tick: morale loss is 2 per percent lost, ×1.25 from a flank, and then a morale check against the already-reduced morale fails and takes 4 more. One trace (seed 3): a red cavalry squadron under two battalions' flank fire went from morale 62 to 48 to 4 in two ticks and broke 4 minutes after its first exchange. That is the owner's "battles are too short". A head-on firefight at range, meanwhile, never ends, because long-range fire keeps only 25% of its effect.

**Proposed numbers** (the PROPOSAL row in `battle-length.txt`):
- `morale.maxLossPerTick = 6`: a new rule. A unit loses at most 6 morale to fire and shock in one tick; a failed check's extra still applies. Breaking from 80 to 25 therefore takes at least about 10 ticks (20 min), and the stages become visible.
- `morale.underFireLoss = 1`: also new. Each tick a unit takes casualties costs it 1 morale (counted inside the cap): the strain of standing under fire, which ends fights at range.
- `fire.longRangeFactor`: 0.25 → 0.5.

The other variants are in `battle-length.txt`: a cap of 8 alone fixes the short fights but not the endless ones; "under fire 2" or a cap of 5 makes every fight last almost exactly 25 minutes, which loses the spread that makes dice matter. The proposed set puts every case's median inside 20-40 minutes, keeps a spread, and changes three numbers. The tuning needs a separate engine PR with tests (#447). That PR is blocked on a crash this tool found (#445: a shot whose casualties round to 0 throws in `combat.tick`; it hit 1 run in 200 under the new numbers).

**Narration.** Between "engaged" and "broke" the commander hears nothing today, apart from one "heavy losses" report at half strength, so even a long fight reads as two lines. In the prototype each own counter carries the fight stage (engaged, taking losses, wavering, broken), and the report names it every turn. Across turns 2 to 4 of the fixture the bridge fight read as engaged, then taking losses, then wavering, then broken, and the owner can act at "wavering". The engine should report each stage and put it in the view (#448).

## 6. Click a unit to act

**Tried.** Clicking an own unit selects it: a gold outline, its name, its route drawn on the table, and a panel with arm, state, strength, morale, current order and its last report. The verbs are **move, hold, attack, withdraw, screen**: a map click sets the destination, shift-click adds waypoints, clicking an enemy sets the target of an attack. An optional note goes to the umpire. **Give order** holds it for the next turn, and the End turn button counts the new orders. The order becomes a structured intent, shown to the player:

```json
{"verb":"move","waypoints":[[1698,1339],[1557,1291]],"note":"Support 1st Battalion at the bridge; do not cross."}
```

Clicking an enemy shows what is known of it: arm, size band, when it was seen, where, and its state.

![Turn 1, writing an order for 2nd Battalion](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/series-2-order.png?raw=true)

**Worked.** Orders take three clicks instead of a paragraph, and the structured intent needs no parsing, which is what the local models cannot do. The note keeps the umpire's role for anything the verbs cannot say.

**Did not / open.** The verbs are the simplest set that covered the fixture. "Attack" with a place but no target, and formations, are not tried. The route preview is a straight line between waypoints; the real client should show the routed path (#337/#348's routes).

**Recommendation.** Keep (#452), with the intent added beside the text order so free text still works.

## 7. Spotted enemy

**Tried.** Three states:
- **Seen now:** a solid diamond in the enemy colour with a strong outline.
- **Last known:** a dashed hollow diamond, an age label ("8′ ago"), and a faint uncertainty ring growing 8 m a minute up to 200 m.
- **Unknown:** not drawn.

Each body has a staff letter (A, B, C by first sighting, stable) and a size band (e.g. "450–750") under it. The movement seen during the last turn is drawn as a dashed trail (point 1).

![Grey ghost vs seen / last known](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/cmp-enemy.png?raw=true)

**Worked.** You can tell at once which enemy is there now and which is a memory. Letters let the report, the panel and the board refer to the same body.

**Did not.** The first uncertainty ring (25 m a minute, like the engine's growing radius but slower) covered a third of the board after 17 minutes; it is now 30 m plus 8 m a minute, at most 200 m. The engine's own radius grows 100 m a minute (`visibility.ts`); that number is right for where a unit could be, but too big to draw at full strength. Drawing it faint and capped is a display decision.

**Recommendation.** Keep (#451). The server should assign the letters so they survive reloads.

## Mobile

At 390 px the board is a third of the desktop size, so counters at 3% of the view would be about 10 px. The 26 px minimum and the declutter keep them readable and tappable, at the cost of spreading them from their true places (the leader lines show where they really are). On a phone, zooming to the fight is still the better view.

![Mobile, whole map](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/mobile-t3.png?raw=true)

## Capture series

Three consecutive turns with trails, contact, spotted enemies and a unit-click order, taken with one headless Chromium under `nice`, closed after:

1. [Turn 1](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/series-1-turn1.png?raw=true): both sides close on the river; four enemy bodies spotted; A lost in the wood.
2. [Turn 1, order](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/series-2-order.png?raw=true): 2nd Battalion is clicked; a move order with a waypoint and a note to the umpire.
3. [Turn 2](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/series-3-turn2.png?raw=true): enemy C crosses the bridge and halts at the contact line with 1st Battalion; 2nd Battalion has moved up.
4. [Turn 3](https://github.com/exterkamp/kriegsspiel/blob/61b6cfb91ddf378e99d91567c32258d99944cc8d/pr-443/series-4-turn3.png?raw=true): 1st Battalion and C are both wavering; A has come out of the wood; B was last seen 8 minutes ago.

## Choices made where the brief was open

- **2D SVG**, not the Three.js table: it is faster to try ideas in, and every idea here carries over to the table and the flat board.
- **A local simulation, not the engine**, for the board: it lets the contact rule be switched on and off and keeps the page instant. Its combat uses the proposed numbers, roughly, so fights in the prototype last about as long as they would after #447. The battle-length numbers come from the real engine.
- **A ten-minute turn**, one of the turn lengths the real turn mode offers.
- **The current board's look is imitated** in the same renderer ("(now)" options), so screenshots compare ideas, not renderers.
- **Blue only:** the prototype plays blue; red is scripted.
- **The prototype is not linked from the game**, only from Developer tools.
