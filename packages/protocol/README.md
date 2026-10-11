# @kriegsspiel/protocol

Single source of truth for what crosses the wire between server and client. Zod schemas with inferred TypeScript types. Hidden master state is deliberately absent: it lives only in `packages/engine`, and clients only ever receive a `SideView` produced by the visibility filter.

Every message carries `v` (`PROTOCOL_VERSION`, currently `1`). Schemas are strict: unknown fields are rejected, so hidden state cannot ride along unnoticed.

Helpers: `parseCommand` / `parseServerMessage` (JSON string to `{ ok, value | error }`) and `serializeCommand` / `serializeServerMessage` (validate, then stringify; throw on malformed input).

## Commands (player to server), discriminated on `kind`

| kind           | fields                      | notes                           |
| -------------- | --------------------------- | ------------------------------- |
| `issueOrder`   | `orderId`, `draft` or `text` | signs a draft, or sends the order wording directly (until drafts exist); exactly one of the two |
| `setReady`     | `ready`                     | resume-from-pause readiness     |
| `proposePause` | `reason?`                   | starts a pause vote             |
| `vote`         | `proposal`, `yes`           | vote on a proposal              |
| `draftEdit`    | `draft`, `ops: unknown[]`   | stub; op shape not yet designed |

## Server messages (server to player)

| kind         | fields             | notes                           |
| ------------ | ------------------ | ------------------------------- |
| `viewUpdate` | `view: SideView`   | fog-filtered state for one side |
| `dispatch`   | `dispatch`         | a newly arrived paper           |
| `clockState` | `clock`            | re-anchored clock               |
| `error`      | `code`, `message`  |                                 |

## Shared types

`Coord` (metres on a continuous plane, no grid), `Formation`, `Footprint`, `ClockState`, `Intent` (move, hold, attack, withdraw, report, when, at), `Trigger`, `Dispatch` (structured fields plus prose `text`), `SideView` (own units and visible enemies with free positions, facings and footprints, last-known contacts with `ageMs` and an `uncertaintyRadius` that grows with age, dispatches, clock). Positions and lengths are metres; facing is a compass bearing in radians (0 north, clockwise).
