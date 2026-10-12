# Staff conference

The staff conference is a desk view (hotkey C) where the player puts questions to the chief of staff, intelligence officer, quartermaster and engineer. See [hq-interface.md](hq-interface.md), "Views".

## Behaviour (client, built)

- Each officer shows a name and personality traits. Traits colour the advice.
- A question costs the officer game time (fixture: chief of staff 10 min, intelligence 15, quartermaster 10, engineer 20). The answer is held back until game time reaches `askedAtGame + cost`, the same at every clock rate. While it is pending the officer is busy and cannot take another question.
- Answers use only the asking side's `SideView`. The fixture client (`client/src/desk/conference.ts`, `fixtureAnswer`) names only units and contacts in the view and says so when the view is silent; it works with no LLM.
- The client talks to a `ConferenceClient` held in the `conferenceClient` store. The fixture is the default; the server-backed client replaces it when the endpoint exists.

## Cost enforced by the server (#242)

Over the game WebSocket the client sends `askStaff { questionId, role, question }`. The server charges the officer's cost in game time (see D6b in [decisions.md](decisions.md)) and replies `staffQueued { questionId, role, askedAtGame, answerAtGame, costMs }`; a question to a busy officer gets an `error` with code `staff_busy`. The client takes `answerAtGame` from the reply and does not compute it.

The server then writes the answer on the `staff` stage (D6b, "Conference answers") and sends `staffAnswer { questionId, role, text?, basedOnGame, officer { name, traits } }`, built from `viewForRole` at the time of the question. The client keeps it until game time reaches `answerAtGame`. With no `text` (no umpire configured, or the stage failed) the client answers from its fixture over the view it holds when the answer is shown. The server also keeps every question and answer per side and sends them in `SideView.staffHistory` (D6b, #323), so the log survives a reload, a reconnect and a server restart; the client merges them by `questionId`. When an answer is due it is also filed once as a Staff-pile dispatch from the officer (id `staff-<questionId>`), so it is in the in-tray and the journal. The admin LLM panel lists the calls as `staff`.

## Server endpoint contract (not yet implemented; Epic #3)

`POST /games/:id/conference`, authenticated by the session cookie and seat like the game WebSocket (D16, D17).

Request:

```json
{ "role": "chiefOfStaff | intelligence | quartermaster | engineer", "question": "string, 1-400 chars", "askedAtGame": 0 }
```

Response `200`:

```json
{ "text": "string", "basedOnGame": 0, "officer": { "name": "string", "traits": ["string"] } }
```

Rules the server must keep:

- The model sees `viewForRole` for the seat and nothing else (never master state). It must not cite an id outside that view.
- The question and the answer are logged as inputs and outputs so a game replays with no model calls.
- The game-time cost comes from the officer and is applied by the engine; the LLM never mutates state. The client shows the answer once game time passes `askedAtGame + cost`.
- Errors: `400` bad role or question, `403` no seat, `409` officer busy, `503` model unavailable (the client shows "could not be reached" and lets the player ask again).
- The `officer` block lets the client show the real staff (same officer as `staffOfficer` in `server/src/umpire/staff.ts`) in place of the fixture names and traits.
