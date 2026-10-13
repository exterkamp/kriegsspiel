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

## Our model

### A continuous game clock

There are no turns. The game clock runs continuously, tied to wall-clock time at a ratio chosen per game: **1:1** (real time), **4:1**, **12:1**, or any other value. You issue orders whenever you like, couriers take game time to deliver them, and reports arrive on your desk as they happen. See [architecture.md](architecture.md) for the clock and scheduler.

Quiet marches cost nothing, because the simulation jumps between events. Fights resolve in short ticks of a few game minutes.

A turn-based game is just a clock that only advances when stepped. That mode exists for testing and for anyone who wants it, but it is not the main design.

### What a session feels like

1. Check in, read the new dispatches in the in-tray, and update the map.
2. Draft or revise orders, alone or with your staff, and sign the ones that are ready.
3. Leave. Couriers ride, columns march, and the umpire adjudicates. A notification tells you when something important arrives.
4. Repeat until the objective is taken, the time limit passes, or a battle is decided.

### How a battle ends

Fighting is lethal enough to break a force. When a side has lost a unit (broken or destroyed) and what is left of it, counting men by their morale, is under a quarter of the men it started with, the umpire declares the battle: a dispatch to both sides, in the same words and with no figures, says whose attack or defence was broken and who holds the field. The game then plays on for 20 game minutes so the pursuit can finish: broken units flee, cavalry that is free rides them down, and a unit run down is destroyed and reported. Before the ruling, the units in the fight send field reports to their own side: engaged, heavy losses, broken and falling back (and lost, if destroyed), each about that side's own unit only. The ruling itself arrives in the Staff pile as a dispatch from the field in the umpire's words, and the table rings the fighting. If the loser had nobody left, the game ends at once and the game-over paper says it was wiped out. After that the game ends with the reason stated on the game-over paper, for example "The attack on the objective was broken". In "Hold the Bridge" a decided battle ends the game roughly 30 to 60 game minutes in; a battle nobody breaks ends at the 50-minute hold. See D13 in [decisions.md](decisions.md).

The staff conference keeps your questions and the answers for the game: they are still there after a reload or a reconnect, and each answer also arrives in the Staff pile as a dispatch from the officer.

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

The window is the same map table with a scrubber over the whole game. It shows every unit's true position at the scrubbed time, can overlay what either side believed (live sightings and aged ghosts), and shows the dice, modifiers and umpire rulings for a unit under the pointer. It is rebuilt from the input log with no model call, and the server refuses it (`403 game_not_over`) until the game has ended (`GET /games/:id/window`, `/window/at`).

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
- **Deputy mode** (optional): an LLM staff officer acts within your standing orders and stated intent, writes orders under your authority, and reports what it did. You set how much discretion it has.
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
- Only the holder of command authority for that formation can **sign and stamp** an order to send it. This is the stamp moment from the Papers Please-style desk.
- An **LLM staff check** reads a draft before it goes and reports how a subordinate will likely read it: "the bridge is not mentioned", "this contradicts the timing in Order 3". It costs a little in-game time (staff work), so it is a tool and not a free preview.
- Drafts can be **forked**, so the staff can write alternative plans and the commander chooses.

### Information sharing is gameplay

A wing commander's scout report reaches HQ only if they send it, and it takes time to arrive. Withholding, delaying or mis-summarising information is possible and has consequences. Each player's desk shows only what reached them.

### Hierarchy styles

Both supported, set in the lobby:
- **Shared HQ.** Everyone on the side sees the same desk and map. Simpler, and good for friends planning together.
- **Chain of command.** Each human has their own desk and sector. Messages between players take in-game time. Human subordinates can misread or improvise.

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

- How are disputes between teammates settled? (Suggestion: the commander decides, and dissent is recorded in the journal and appears in the critique.)
- Should players be able to refuse or modify an order from a superior? (Suggestion: yes, with consequences the umpire records.)
- How does a new player join mid-game? (Suggestion: they take over a role and receive a briefing from the previous holder's journal.)
