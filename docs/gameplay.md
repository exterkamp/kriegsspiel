# Gameplay

## How Kriegsspiel is traditionally played

(Historical details to be checked against the rulebooks, see [research.md](research.md).)

1. **Setup.** An umpire picks a scenario. Both sides get a *general situation* (shared) and a *special situation* (their own orders and knowledge). The umpire holds the master map. Each side has its own map in a separate room. Space is continuous: units stand at any position and facing and may be drawn up in any shape the umpire judges realistic, with no squares or tiles (D15).
2. **Teams.** A side is several officers, not one player. A commander-in-chief gives orders to subordinates, usually in writing.
3. **Turns.** Rigid: fixed time slices tied to march rates. Free: the umpire sets the length of each slice, shorter in contact and longer on quiet marches.
4. **Orders.** Written. The umpire moves the blocks as competent subordinates would, including delays and misunderstandings.
5. **Information.** The umpire shows you enemy blocks only when they would be seen.
6. **Resolution.** Dice and tables (rigid) or the umpire's judgment (free).
7. **Critique.** The umpire ends the game and runs a discussion of what happened and why. This is where much of the learning happened.

### Rigid to free, and the umpire's manner

Two settings are chosen on the new-game screen and fixed for the game (D14, story 3.11):

- **How strictly the umpire follows the rules** (the dial). *Rigid*: the tables decide; the umpire never adjusts a result. *Standard*: where the rules are silent the umpire may nudge a result by up to a quarter either way. *Free*: the umpire has wider room, up to two fifths. In every setting each ruling is bounded by the engine, recorded and followed in like cases (the game's case law). The dial changes only that bound.
- **The umpire's manner** (the persona): a dry staff officer (the default), a pedantic umpire, or a dramatic correspondent. It changes only the voice and strictness of the umpire's prose, never what happens: the same orders and dice give the same outcome under any persona.

Both are recorded with the game, so the umpire's window and a replay agree with how it was played.

## Our model

### A continuous game clock

There are no turns. The game clock runs continuously, tied to wall-clock time at a ratio chosen per game: **1:1** (real time), **4:1**, **12:1**, or any other value. You issue orders whenever you like, couriers take game time to deliver them, and reports arrive on your desk as they happen. See [architecture.md](architecture.md) for the clock and scheduler.

Quiet marches cost nothing, because the simulation jumps between events. Fights resolve in short ticks of a few game minutes.

A turn-based game is just a clock that only advances when stepped. That mode exists for testing and for anyone who wants it, but it is not the main design.

The turn-based umpire game is a separate mode chosen when the game is made; see [Turn-based play](#turn-based-play) below and D39. Nothing in this section changes for real-time games.

### What a session feels like

1. Check in, read the new dispatches in the in-tray, and update the map.
2. Draft or revise orders, alone or with your staff, and sign the ones that are ready.
3. Leave. Couriers ride, columns march, and the umpire adjudicates. A notification tells you when something important arrives.
4. Repeat until the objective is taken, the time limit passes, or a battle is decided.

### How a battle ends

Fighting is lethal enough to break a force. When a side has lost a unit (broken or destroyed) and what is left of it, counting men by their morale, is under a quarter of the men it started with, the umpire declares the battle: a dispatch to both sides, in the same words and with no figures, says whose attack or defence was broken and who holds the field. The game then plays on for 20 game minutes so the pursuit can finish: broken units flee, cavalry that is free rides them down, and a unit run down is destroyed and reported. Before the ruling, the units in the fight send field reports to their own side: engaged, heavy losses, broken and falling back (and lost, if destroyed), each about that side's own unit only. The ruling itself arrives in the Staff pile as a dispatch from the field in the umpire's words, and the table rings the fighting. If the loser had nobody left, the game ends at once and the game-over paper says it was wiped out. After that the game ends with the reason stated on the game-over paper, for example "The attack on the objective was broken". Once the umpire has ruled, that ruling decides the game: the time limit cannot hand it to the other side (if it comes during the pursuit, the game ends then, with the ruling's result), nor can a later rout of the winner's last unit. Only a game in which no battle was decided goes to the defender at the time limit. In "Hold the Bridge" a decided battle ends the game roughly 30 to 50 game minutes in; a battle nobody breaks ends at the 50-minute hold. See D13 in [decisions.md](decisions.md).

The staff conference keeps your questions and the answers for the game: they are still there after a reload or a reconnect, and each answer also arrives in the Staff pile as a dispatch from the officer. Each role has one officer for the whole game, named the same in the conference, on the answer and on the dispatch. An officer writes the answer when it is due, from what their post knew at that moment, and it never changes afterwards. If the umpire's model is off or gives nothing usable, the officer still answers from the same facts, in their own manner: a terse officer keeps it short, a long-winded one says it all and signs it.

### Orders are standing instructions

Subordinates keep acting while you are away, so a good order covers contingencies:
- *Conditional:* "If the enemy appears at the bridge, fall back to the heights."
- *Timed:* "At 10:00, advance."
- *Discretion:* "Use your judgment if the situation changes. I intend to hold the ford."

This is the main skill the game tests, and it is what the umpire grades. Commander's intent in an order gives a subordinate better behaviour when plans meet reality.

### What paper reaches the in-tray

Everything is filtered through the visibility filter, so only your own side's knowledge and what your units have seen ever arrives.

| Paper | Pile | When |
|-------|------|------|
| Opening situation report from the chief of staff (own formations, no enemy information) | staff | At once, at game start |
| Courier acknowledgement that an order reached its unit | subordinates | About 2 game minutes after the unit receives the order |
| Enemy contact (scouts and pickets) | scouts | About 10 game minutes after the sighting |
| Unit lost, low ammunition, exhausted | subordinates | About 10 game minutes after the event |

A report on an objective changing hands is not yet produced.

### After the game

The umpire's window reveals true positions, dice and rulings. The umpire then writes a critique: what each side knew and when, decisions that mattered, and misreadings. This is built properly, not left as an afterthought.

The critique is a section of the window (`GET /games/:id/critique`, D38). The umpire writes it from the log: every point is dated and cites the logged events it rests on (orders and their delivery times, reports as they reached headquarters, rulings, losses, pauses and votes), and the server refuses any point that cites an event that does not exist. If no umpire is available the same facts are quoted plainly. It is written once and kept in the input log.

The window is the same map table with a scrubber over the whole game. It shows every unit's true position at the scrubbed time, can overlay what either side believed (live sightings and aged ghosts), and shows the dice, modifiers and umpire rulings for a unit under the pointer. It is rebuilt from the input log with no model call, and the server refuses it (`403 game_not_over`) until the game has ended (`GET /games/:id/window`, `/window/at`).

## Turn-based play

A second way to play, chosen on the new-game screen next to the dial and the umpire's manner and fixed for the game (D39, Epic #393). It plays like the original Kriegsspiel: both sides write their orders for a slice of time, hand them in together, and the umpire tells each side what happened. Everything else is the same game: the scenario, lobby, seats and roles, the desk, the in-tray, the map table, the umpire's window and replay.

**A turn** is a fixed slice of game time, 20 game minutes unless the game says otherwise. Nothing moves between turns: the clock only advances when a turn is resolved, so you can take as long as you like over your orders, or set a deadline ("orders due by Thursday") for a game played over days.

1. **Write orders for the turn.** At the orders desk, as in real-time play: each order is addressed to a unit, in your own words, with a fast or a safe courier. Write as you would to a subordinate who knows the ground: "Push the light company along the stream until they see the enemy, then report and hold", or "if the bridge is lost, fall back to the mill". The umpire reads the text as written; there is no "staff could not understand" in this mode. Orders still go by courier: a far unit may not get its order this turn, and a courier may be lost, read by the enemy or garbled on the way, as in real-time play. (11.3, #399; desk and lobby in 11.10, #406.)
2. **Send.** When your orders are ready you send them for the turn. Your staff can write and revise the side's orders for the turn with you; the commander (or a subordinate, for their own formations) sends them, once, for the whole side. You can revise or withdraw them until you send; after that they are with the couriers. The other side learns only that you have sent, never what. A side that sends nothing keeps its units on their last orders. There is no pause or ratio vote in this mode: nothing moves until the turn is resolved. (11.3, #399.)
3. **Wait for the umpire.** When every side has sent, or the deadline has passed, the umpire adjudicates the turn. It sees both sides' orders and the whole field and decides what each unit did, how commanders read their orders (a cautious colonel may stop short, an eager one may go too far, D36), where they stood at the end, what they saw, and what each fight cost. Where the outcome is genuinely uncertain it asks for a die roll with stated odds, and the server rolls it. The engine then checks the result against hard limits (no unit marches farther than it could over that ground, loses more men than it has, or sees what it could not have seen) and clamps anything that breaks them. If the umpire cannot answer, the turn is resolved by the tables instead and your in-tray says so: a turn always resolves. (Adjudication 11.6, #402; the engine's resolution 11.4, #400; the checks 11.5, #401; dice 11.7, #403; the umpire's memory across turns 11.8, #404.)
4. **Read the turn's reports.** Each side gets its own papers in the in-tray: what its units did and why, in their officers' voices, and what they saw of the enemy, never more than they could have seen. Everything written in the turn is in that turn's papers, even from units you gave no orders: a paper still on the road at the turn's end is handed in then (#438). The map table moves your units to where they stand and updates your contacts. Then you write the next turn's orders. (11.9, #405.)

**The dial** picks who adjudicates. *Rigid*: the tables alone, no umpire (real-time rules played in fixed steps: the same orders and seed give the same battle as a real-time game, the scripted opponent included, which acts on its own clock inside each turn as it does in real time; D39, #430). *Standard*: the umpire decides, starting from what the tables would give and departing only for a stated reason. *Free*: the umpire decides as a free-Kriegsspiel umpire would, with the tables as advice. In every setting the engine's hard limits apply. If the umpire cannot answer (no reply, a reply that breaks the rules twice, a spent budget, or more than 15 minutes), the turn is decided by the tables instead, as at *Rigid*, and the record says so (11.6, #402). The umpire needs a capable model (by default Claude Sonnet); a server without one, such as the keyless demo, plays turn mode with the tables at every dial, since no local model it can run is good enough (the benchmark, 11.2, #398).

When the umpire rules the battle (an attack broken, a defence broken; D13), the game closes 20 game minutes later, after the pursuit, or at the time limit if that comes first, as in real time. A turn that opens after the ruling says so on the desk: the battle is decided, the turn is the pursuit, the game closes by a given time (never later than the time limit), and you may send it with no orders (#438).

The game ends as a real-time game does (an objective held, a broken force, or the time limit); the last turn ends at the time limit, so it falls at the same minute in every mode. The turn that decides the game is the last: no further turn is opened, a victory inside a turn ends it at that time, and the hold on the objective is counted to the minute, as the clock shows it (#429). The umpire's ruling on the outcome is the turn's last paper in each in-tray. After it, the umpire's window replays it turn by turn with each turn's orders, rolls and rulings, and needs no model to do so (11.11, #407). The first full game in this mode is the playtest of 11.12 (#408).

## Pace: the clock ratio

The ratio is the pace setting. It is chosen per game on the New game screen (1:1, 4:1, 12:1 or a custom ratio; 12:1 by default) and can be changed mid-game by agreement.

| Ratio | A 12-hour battle takes | Feel |
|---|---|---|
| 1:1 | 12 real hours | Realistic. Couriers take real hours, nights are quiet. A long correspondence. |
| 4:1 | 3 real hours | An evening or a day |
| 12:1 | 1 real hour | A live session |
| Any other | Whatever you choose | Custom |
| Stepped (manual) | Whatever you step | Testing and turn-based play |

The default is decided after the first scenario is written and its pacing is measured. Scenarios declare a suggested ratio.

**At 1:1** the game clock can be offset so game night falls at local night, which gives natural lulls while players sleep.

### When you are away

- **Standing orders keep working.** Units follow their orders and contingencies. If none apply, they hold and wait. Subordinates never invent a plan for you.
- **Notifications.** You choose what reaches you: all dispatches, urgent only, or contact only.
- **Subordinate players** can act for a formation when you are away.
- **Deputy mode** (optional): an LLM staff officer acts within your standing orders and stated intent, writes orders under your authority, and reports what it did. You set how much discretion it has: **hold** (stand fast or fall back toward HQ), **adjust** (reposition a unit up to about a mile and a half at the ordinary pace) or **act** (anything you could sign yourself). The engine checks every order against the setting; one beyond it is never sent, and appears in the account as an act the deputy tried and was refused. It acts only while you have nothing open at the table, never signs for a formation you could not sign for, and on your return the in-tray holds one paper for each of its turns: what it ordered in your name, what it was refused, and its own report.
- **Contact alerts.** When a fight begins, you can be alerted at once.

### Pausing

Real life happens. The game can be **paused by a vote of all human players** across all sides.

- Any player can propose a pause, with an optional reason. A single "no" or a timeout cancels the proposal. The host can instead allow a majority.
- While paused, game time stops. Players can still read, draft and sign orders, but a signed order's courier only leaves when the clock resumes, so nothing can be gained from a pause.
- Resuming needs everyone to mark themselves ready, or a host-set maximum pause length.
- An **emergency hold** lets any one player stop the clock at once for five minutes by default, twice per player and six times per game by default (the host can change these), unless the other players ratify it with a vote, which makes it an ordinary pause (D5).
- If the server was ever down, the game comes back paused and asks everyone to confirm. We never skip game time silently.
- Pauses are recorded in the journal.

### Changing the ratio

The ratio can be changed mid-game by vote, for example to slow down a decisive battle or speed up a long march. The clock re-anchors so game time never jumps. Any voter proposes a ratio and the others vote under the same rules as a pause (unanimous by default, or a majority; a vote that times out is cancelled). One ratio vote is open at a time, and it works while the game is paused.

## Multiplayer collaborative mode

Real play was already a team game. Each side is a group of **roles**:

| Role | Sees | Does |
|---|---|---|
| Commander-in-chief | Reports forwarded to HQ, plus their own scouts | Signs and sends final orders |
| Chief of staff | The whole HQ picture | Polishes wording, spots gaps, coordinates |
| Intelligence officer | All incoming enemy information | Plots contacts, judges reliability |
| Quartermaster | Supply, fatigue, road capacity | Warns about shortages and march limits |
| Wing/division commanders | Their sector plus what HQ sends | Issue their own orders to subordinates |

In the lobby the commander's table fills as players join the side with a role; a subordinate picks the formations they command. A side nobody joins in a role is shared HQ. Unfilled roles are played by the LLM (a staff officer with personality traits), so a game with two humans per side still has a full staff.

### Drafting orders together

- Each order is a **shared draft**. Anyone with access can propose text, comment, or suggest a change. Edits are tracked.
- Only the holder of command authority for that formation can **sign and stamp** an order to send it. This is the stamp moment from the Papers Please-style desk. Staff and other players can propose on the draft but a stamp from them is refused; a subordinate stamps only for their own formations. A stamped draft is closed to edits (fork it for another plan).
- An **LLM staff check** reads a draft before it goes and reports how a subordinate will likely read it: "the bridge is not mentioned", "this contradicts the timing in Order 3". It costs a little in-game time (staff work: the chief of staff is busy for ten game minutes, the same at every clock rate), so it is a tool and not a free preview. It sees only what your side knows (your own units, the named places, the orders you have sent), and it is advice, not a promise: the order is read afresh when it is signed (D6d).
- Drafts can be **forked**, so the staff can write alternative plans and the commander chooses. A fork is also how a staff officer makes a suggestion: they write it in a fork, and merging it brings their edits into the draft under their name (D6g).

### Dissent

A teammate who disagrees with a signed order says so on the record: the dissent is kept with the order, shown to the side and read in the post-game critique. It does not stop or change the order.

### Information sharing is gameplay

A wing commander's scout report reaches HQ only if they send it, and it takes time to arrive. Withholding, delaying or mis-summarising information is possible and has consequences. Each player's desk shows only what reached them.

### Hierarchy styles

Both supported, set in the lobby:
- **Shared HQ.** Everyone on the side sees the same desk and map. Simpler, and good for friends planning together.
- **Chain of command.** Each human has their own desk and sector. Messages between players take in-game time. Human subordinates can misread or improvise. A subordinate's reports reach HQ only when the subordinate forwards them, and they ride there (distance at courier pace); in shared HQ forwarding takes no time (#79).

### Joining mid-game

A player may take a role nobody holds, also after the game has begun (a teammate left, or a staff officer was being played by the LLM). They are briefed from the journal of the seat they take over, and vote on pauses from then on.

### Session shapes

- **Team vs team**, each side a group of humans.
- **Co-op vs an AI commander**, with the opposing side played by an LLM using only fog-filtered information.
- **Human umpire** with the LLM as assistant.
- **Hot-seat**, for testing and one-evening play.

## Assumptions to confirm

- **Command level:** players command brigades and battalions, with a few dozen pieces per side, and a game clock where marches take hours of game time.
- **Default hierarchy:** shared HQ, with chain of command as an option.
- **Default session shape:** team vs team and co-op vs AI both supported from the start of multiplayer.

## Open questions

- ~~How are disputes between teammates settled?~~ Settled (D6e): the commander decides. A teammate files a **dissent** against a signed order; it is kept in the side's journal and handed to the critique, and changes nothing in the game.
- Should players be able to refuse or modify an order from a superior? (Suggestion: yes, with consequences the umpire records.)
- ~~How does a new player join mid-game?~~ Settled (D6e): they take over a free role and receive a briefing built from the journal of that seat (orders signed, dissents, drafts, staff questions). The commander seat is not yet handed over.
