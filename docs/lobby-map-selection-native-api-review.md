# R23 independent native API/composition review

**Verdict: Changes needed at `df194df13b1c5a85f622412bc5e1d0419192d0d3`. Two blocking ownership/lifecycle findings, B1/B2; one nonblocking body-limit finding, N1.** Default-only production composition and the normal native allocation/recovery paths are coherent, but the new asynchronous record boundary and activation completion do not safely handle account deletion. Do not enable the alternative based on this packet. No library implementation or browser/create-to-live acceptance is implied.

## Exact source and complete inventory

- H `df194df13b1c5a85f622412bc5e1d0419192d0d3`, tree `efd1701cd2fee60a426fe8b588e6f3d4ce9a5568`.
- P accepted receipt core `9aee88ee3c7a7fc50311ab8d2a4dd55efe180253`.
- Manifest `/private/tmp/lobby-map-api-candidate.json`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped execution source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified actual Git H/tree/parent, complete five-path delta, and all manifest/Git-blob/scoped-snapshot SHA-256 values. Read the complete diff, new pinned-game module and all12 new API tests, surrounding auth/seat/role/ready/start/WS/postgame/list/close paths, main composition and D44 amendment. Inspected accepted receipt/pin/header/snapshot contracts and earlier review limits; author conclusions were not treated as proof.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `server/src/api/app.ts` | `93ae8f73b8e62daa00ae4f5052a018ec3f8b7bef` | `491ea350efbd444ad5a0890d1dd7e366a88562b9446dce9ffa5b8bfe1b3d25bc` |
| `server/src/api/battlefield-selection.test.ts` | `4541b4f58ae31580c7cde9a997a6468eddf60ed3` | `38d4668b48e8f60a911b180eca6d4555ff48fbee9eb7c97514257ac071032815` |
| `server/src/lobby/pinned-game.ts` | `a8a445074bf2c14fbbb8d708f7f7edf07b3a214a` | `474a57a52708235d0a072d8557880de98840bb9c187f19641a1722f9b9c6f07c` |
| `server/src/main.ts` | `7a134b0d5f348d2f59902e684323e909c98fd77d` | `6b08d170d6f8e04642aed2f8c41eb931192ae800131fb214b6432d5384924de4` |
| `docs/decisions.md` | `778662aed7f6023bdff2b02c3423d5bd92fc06e7` | `506776d1c5a76c491bd99a7dbc57a950a6148ab6ae39d5315cad11d08aa0dfbb` |

Seventeen surrounding runtime/test paths independently match H: creation-intent/store, auth/store/routes, lobby/store, Host/actor, pinned-header/snapshot-binding, game Memory/SQLite stores, native registry/pin, unchanged lobby/removal/guest tests and FakeTime. Snapshot `server/vitest.config.ts` and `server/tsconfig.json` have an additional disjoint `@kriegsspiel/maps` alias/path absent from H; engine/protocol mappings are unchanged. This configuration/context difference is explicitly outside the candidate, not a whole-snapshot identity claim or library acceptance. Native High verification is packet-supplied; no pane operation occurred.

## Blocking findings

### B1 — Awaited record lookup can authorize a deleted private allocation

`server/src/api/app.ts:434` captures lobby and receipt before awaiting the header, validates those detached old copies and returns the old lobby record. The GET/join routes subsequently evaluate privacy or mutate seats using that stale record. Deletion can remove the lobby and tombstone its receipt during the await; the captured receipt still passes `assertLobbyAllocation`. `isPrivateTo` then looks up the deleted guest, sees no guest flag and treats the old private record as shareable.

Independently reproduced twice with a native guest-owned **unstarted lobby**, an unrelated signed-in account, and a controlled pending `store.logHeader`:

1. Begin unrelated account's GET `/games/:id?battlefieldVersion=1`; while lookup waits, execute the owner's actual DELETE `/auth/account` (204). Confirm lobby absent, then release lookup. **GET returns200 with `battlefield` despite a tombstoned receipt and absent lobby.**
2. Repeat with unrelated account's POST `/games/:id/join?battlefieldVersion=1`, requesting Red. After the same deletion/release, **join returns200 and writes an orphan Red seat** while the lobby remains absent and receipt tombstoned.

These are in-process Fastify injection operations on disposable stores, not managed-server requests. No private master-world fields were exposed; the defect is disclosure of an owner-private guest map and unauthorized effects on a removed allocation.

**Required correction:** re-read/reconcile current receipt and lobby after asynchronous reads and before returning an authoritative record; missing/tombstoned/replaced allocation must not return a captured record. Recheck live principal/ownership/privacy immediately before mutation or admission after awaits. Keep that final check and seat/role/lobby effects synchronous or otherwise serialize against ownership lifecycle changes. Cover deletion/expiry while GET/join is waiting, requiring no public map, no seat/record resurrection and no new allocation; also protect adoption/current-owner changes and other routes sharing the async boundary. Do not “fix” it by treating a missing user as public ownership.

### B2 — Deletion during startup leaves a registered actor for a tombstoned allocation

At `app.ts:903`, native startup may finish after account deletion has removed its unstarted lobby and tombstoned its receipt. `activationResult(...,true)` then correctly rejects. The catch at line920 attempts to record failure, logs the tombstone rejection and returns `start_failed`, but never retires the actor just registered by Host.

Independent probe blocked the initial snapshot save during native POST `/games`, executed the same actual DELETE `/auth/account` (204), then released startup. **POST returned503; receipt was `tombstone`, lobby absent, but `host.get(id)` still returned the activated actor.** Application close subsequently cleaned the disposable actor; no managed game was created.

**Required correction:** coordinate terminal account removal with pending activations and recheck current allocation after Host activation. If allocation is removed/tombstoned, close/retire the actor and its providers/timers rather than leaving an inaccessible active game. Distinguish this terminal case from a recoverable activation/status-write fault on a still-owned receipt, retaining the same game ID for legitimate retries. Cover deletion/expiry during initial persistence and assert no actor/resources remain after the operation settles; include allocations without seats, such as hot-seat, rather than relying only on auth seat lists. The Host's accepted pending-close mechanism is available, but API lifecycle wiring must actually use an appropriate retirement path.

## Nonblocking finding

### N1 — The documented16KiB create limit is not an HTTP byte limit

POST `/games` uses the ordinary Fastify body limit and then the16KiB decoded-object preflight. Whitespace is already gone at preflight. An independent raw JSON request of **17,447 bytes** (17KiB whitespace plus a small valid no-key hot-seat lobby object) returned201 and allocated the lobby. Installed Fastify's unchanged default is1,048,576 bytes. Thus parsing is bounded, but not by the accepted16KiB create-wire budget. Add a route-level16KiB limit and a raw/whitespace byte-boundary regression while retaining the object depth/value/schema preflight. This is separate from, and lower priority than, B1/B2.

## Positive coverage and inspected behavior

- Main composes one shared SQLite receipt/auth/lobby owner; its borrowed children do not close the shared handle. Without DB_PATH it explicitly uses Memory SQLite, retaining per-process idempotency without restart durability. The game store remains separate. Main does not pass an alternative-enabled registry, so production stays default-only; only trusted test composition enables the authored alternative. Shutdown closes the host before the owned stores. No task server was restarted onto these sources.
- Strict modern request decoding occurs before reservation effects; pairing revision/parent/native availability are resolved before writes. Legacy no-key main requests get fresh internal UUIDs and enter the same reservation path, preserving separate submissions. Accepted-key retry uses its stored defaults/pin before latest registry or limits. Conflicting intent/key ambiguity is explicit; unknown commit/activation errors remain5xx, not definite no-allocation rejection. Tracing begins after reservation acceptance rather than minting phantom IDs for rejected requests.
- The normal pipeline pins one receipt/lobby/header assembly, coalesces same-ID activation, resumes header-only matching allocations and reopens stored native games without current alternative availability. `pinned-game.ts` checks markers, allocation identity, immutable intent/settings and native header receipt/pin binding. Malformed/missing modern evidence does not synthesize legacy terrain. Historical synthesis requires actual compatible header/world evidence. Host performs its accepted full snapshot-header/static-world checks when opening; this packet does not replace them with public-map trust.
- GameInfo builds its existing summary/seat projection and adds only the public approved descriptor. No private pin/raw/initial world is spread into responses. Owner-only receipt GET returns bounded status/game identity, with foreign-owner404 and owned collision409. The normal guest invite test denies public access. B1 is the missed concurrent deletion case, not an assertion that the normal allowlist leaks master state.
- REST game/join and WS preValidation check alternative capability before seat effects or upgrade, including an existing seat. Default/legacy clients remain accepted for the default. Human sides and subordinate-unit validation use the retained native world, and room/start uses the retained assembly. Existing role/ready/pause/postgame logic was inspected around those changes.

The12 checked-in native tests meaningfully use real disposable stores/Host, fault injection, concurrent pending saves, durable close/reopen, public decoder/privacy assertions, lost acknowledgement, missing markers and injected WS upgrades. They do not cover B1/B2. Most unchanged lobby/removal tests compose without `creations`; their author passes alone would not prove the new main-style no-key branch. Additional reviewer injection checks below exercise that branch directly.

## Independent checks actually run

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/api/battlefield-selection.test.ts src/api/lobby.test.ts src/api/lobbyRemoval.test.ts src/auth/guest.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**27 passed /27 failed across4 files. All12 native API tests passed.** The27 failures are all `listen EPERM: operation not permitted 127.0.0.1`:20 lobby,6 removal and1 guest case require a loopback listener. The remaining15 guest cases passed. No escalation/policy change or assertion suppression was attempted. The author's permitted54-pass and later12-pass runs are read evidence, not independent passes. **Server noEmit typecheck passed**, with the disjoint compilation/configuration context noted above. Node emitted its existing experimental SQLite notice. Manifest/blob/scoped comparisons and read-only `git diff --check P H` passed. No independent lint/build/full-root/CI run was performed.

Additional inline Node/assert probes imported matched source through in-memory TypeScript transpilation and used Fastify injection, MemoryGameStore, isolated Memory SQLite and FakeTime:

- The two controlled header-read deletion races and blocked-snapshot startup deletion reproduced B1/B2 exactly as recorded. All apps/stores were closed afterward.
- Main-style default-only catalog exposed one default. No-key team lobby creation, Red seating, subordinate selection from the pinned Blue unit IDs, not-ready rejection, ready/start and three pause voters passed. Co-op rejected a Red human seat without effects. Malformed modern selection rejected, and a lobby rate contradicting its receipt returned503 with no battlefield. Cleanup left zero FakeTime timers.
- The raw whitespace request reproduced N1. These are isolated test allocations/actors, not actual HTTP/browser/managed-server games. No checked-in test/source/config was changed.

## Handoff and limits

Repair B1/B2 and provide permanent race regressions before accepting this API dependency. N1 should be corrected with the bounded request-limit work. Source verdict is tied only to H; it does not approve later mutable repairs, alternative public enablement, parent/transport integration, owned-library implementation, distribution or whole-product completion. Physical rendering and actual browser Start/create-to-live approval remain pending; no workaround was attempted.

Only this exclusive R23 report was written. All prior reviews are preserved. No product source/test/config/Git mutation, managed server/browser/game/pane control, new agent, external action, merge or deployment occurred. Review stops after this packet as requested.
