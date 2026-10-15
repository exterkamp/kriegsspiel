# R8: independent shared SQLite prerequisite review

**Verdict: Accepted at H for the bounded borrowed-connection prerequisite. No blocking or nonblocking source finding.** Both stores can use one caller-owned `DatabaseSync` for synchronous seat/lobby writes, and neither closes a borrowed handle. Existing path constructors retain their ownership and connection policy. This does not establish API wiring, atomic adoption, creation receipts or idempotency.

## Exact source and complete coverage

- H: `941d07df9fe308cdd24f3b74cf55d65da1ae68fd`.
- Tree: `e623f9ee5cce4d227934bfb08fb273d9748a75f3`.
- Verified parent/base: `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`.
- Ref supplied by packet: `refs/heads/feat/lobby-map-shared-db`.
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD verified still `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Manifest: `/private/tmp/lobby-map-shared-db-candidate.json`. Independently verified H/tree/parent, the complete three-path delta, all three SHA-256 values against H blobs, and all three snapshot files against those same bytes. Both original store files at base independently match canonical `1d6fcb4` bytes.

All candidate paths were inspected in full from explicit Git objects:

| Path | H blob | Manifest SHA-256 |
| --- | --- | --- |
| `server/src/auth/store.ts` | `a63c01e73386083e96127c707238ec8858e99873` | `4009b7bdceb2fcb56392a9a871afa2b98df45fca91d6ac52ee8fb4bb76ee6cae` |
| `server/src/lobby/store.ts` | `4a5fab159c526e926631e02ebebb091dfe9e2254` | `b571d6e0ad91158653249a820ad498f78b264b2f3d9f4eaca831d3690fbccf40` |
| `server/src/lobby/shared-database.test.ts` | `bb1c593086f3ead809db98a578154f6cac57506a` | `f3a2bf7358a5664bcd0c6afa23ab91bbc5dc0e7922de8323b44195ed5f5663a2` |

Surrounding inspection covered existing auth/guest tests, lobby store tests, auth adoption/deletion callers and `main.ts` construction/shutdown. These paths plus server Vitest/TypeScript config were compared with H and match the execution snapshot. AGENTS, decisions and the execution/accepted-contract context were read; the accepted contract's shared-handle choice remains SHA-256 `e0e950d00e53c7ed88d290f62023fb496483f0eae5c1fd317ee9c3cc6ed989e6`.

The execution snapshot is `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`. It also contains disjoint map work and mutable writer tests. No whole-snapshot or whole-compilation-tree identity is claimed. R7's native source and W3's native pin/replay test ownership are outside this packet and were not edited or re-reviewed. Native High verification is supplied by the packet; no pane operation was used to verify it.

## Ownership, bootstrap and transaction assessment

The source change in each store is limited to accepting `string | DatabaseSync`, recording whether it created the handle, applying the existing WAL/busy-timeout setup only to owned handles, and guarding `close()` with that ownership flag. A path still opens its own connection, initializes the same schema, sets `journal_mode=WAL` and `busy_timeout=5000`, and closes that connection. No legacy method, memory store, SQL statement, account/guest policy or lobby record shape changed.

A borrowed constructor uses the exact supplied connection. It still initializes its own namespaced tables/indexes and the existing auth column migrations, but leaves journal mode, timeout and other connection policy to the owner. Avoiding a borrowed-handle WAL change is appropriate: composition may already have configured the connection or begun a transaction. Neither store commits, rolls back or closes the owner's transaction during bootstrap. Independent probes confirmed schema initialization itself participates in an existing transaction and can be rolled back. Composition should normally bootstrap stores before starting a business unit of work; rolling back newly created schema invalidates the assumptions of those store instances.

`claimSeat` and lobby `put` perform their existing synchronous SQL on the shared handle. An outer `BEGIN IMMEDIATE` therefore encompasses both; commit persists both, and rollback removes both. They introduce no await, alternate connection or hidden commit. Cached JavaScript state does not mask database rollback: subsequent reads query SQLite. The new disk test closes/reopens through the legacy constructors and verifies both records, supplying real file-persistence evidence for the committed transaction.

Borrowed `close()` is a no-op for the connection, including while an owner transaction is active. It does not retire the wrapper or prevent later method calls; the composition owner remains responsible for stopping callers and closing its shared handle exactly when all borrowers are finished. A constructor error does not close a borrowed connection. The existing path-owned failure-cleanup behavior was not changed by this delta.

`main.ts` still constructs separate path-owned auth and lobby connections and closes them separately. There is no shared owner, receipt table, API/main wiring or changed shutdown path in H. Passing the same filename to two legacy constructors is not the new shared-transaction capability; later composition must pass the same actual handle and explicitly retain its connection policy and final close responsibility.

## Findings and coverage limits

**Blocking findings: none. Nonblocking source findings: none.**

The three new tests have concrete premises and outcomes: seat and lobby writes exist before manual rollback and disappear afterward while the earlier user survives; a committed file-backed transaction survives reopening; borrowed wrapper closes leave the handle usable; path-owned closes make further store operations fail. They exercise the ownership distinction rather than merely constructing the classes. The first test's title mentions allocation failure, but its body requests rollback directly; it does not inject a failing allocation. The independent SQL-fault probe below covers that additional case at H. No independent mutation/red run was performed.

An important unchanged integration limit is explicit: `SqliteAuthStore.adoptGuest` and `deleteUser` own their own `BEGIN`/`COMMIT` transactions, and adoption deletes the guest after its seat-move transaction. They are not yet composable inside a caller's outer transaction. An independent probe reproduced `cannot start a transaction within a transaction` for adoption under `BEGIN IMMEDIATE`, with the guest preserved after owner rollback. The current auth route's subsequent lobby reassignment also remains unchanged. This is not a regression or blocker for the narrowly scoped constructor prerequisite, which makes no adoption-atomicity claim. C5 integration must address these methods/callers before claiming one transaction across adoption, lobby reassignment and future receipts.

No contention, multi-process concurrency, crash/restart recovery during an uncommitted transaction, receipt behavior, UUID collision handling or modern game creation was validated. The committed close/reopen test is not evidence for those later guarantees.

## Independent checks actually run

Checks used pinned Node **v22.23.3**. From the snapshot's `server/` directory:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/auth/auth.test.ts src/auth/guest.test.ts src/lobby/store.test.ts src/lobby/shared-database.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**Test result: 53 passed, 1 infrastructure failure / 54 tests across 4 files.** The three new shared-database tests passed, as did the unchanged auth and lobby-store files. The unchanged guest test `keeps a guest out of another account's game (REST and WebSocket)` failed at `server.listen({ port: 0, host: '127.0.0.1' })` with **`listen EPERM: operation not permitted 127.0.0.1`**. Its earlier injected REST assertions ran, but the real WebSocket assertions were not reached. This reviewer did not escalate, change policy, alter the test or retry via a workaround. The coordinator's permitted 54/54 rerun remains author-supplied evidence, not an independent reviewer pass.

**Non-emitting server typecheck passed.** It sees the current combined snapshot compilation unit; this is not a claim that every compiled path belongs to H or was reviewed here. Manifest/source/base comparisons and `git diff --check B H` passed. No independent build, lint, full-root suite or CI inspection was performed.

An additional inline `node --experimental-strip-types --input-type=module` probe imported only the two scoped store sources and Node built-ins. **Six in-memory cases passed**, with no fixture/source file writes:

1. Auth-first bootstrap of historical auth tables, preserving owner `journal_mode`, `busy_timeout=137`, `foreign_keys=OFF` and `synchronous=OFF`; old user and guest-token-column migration round trip; repeated initialization; borrowed closes during a transaction followed by successful owner commit/readback.
2. The same checks with lobby-first bootstrap.
3. A temporary SQLite trigger aborting lobby insertion after a newly created guest and seat were written. Caller catch/rollback removed all three transaction effects and preserved a user created before it.
4. Both constructors inside an existing transaction, followed by rollback, proving newly created auth/lobby tables were not implicitly committed.
5. Auth initialization failing against an incompatible pre-existing sessions table, while the borrowed connection remained queryable by its owner.
6. The unchanged nested-adoption limitation described above, followed by a successful owner rollback and intact guest readback.

SQLite's experimental-feature warning was emitted by pinned Node. No product exception occurred in the successful database cases; the asserted SQL errors were deliberate probe inputs.

## Bounded acceptance

Accept H as a constructor/ownership dependency for later C5 implementation. Before integrating a shared owner, configure its connection policy, finish schema bootstrap, retain one final-close owner and compose only transaction-compatible synchronous operations. Adoption/expiry/receipt changes require their own frozen implementation and tests. H establishes neither production shared-handle use nor atomic adoption/idempotent creation.

No source/test/config/Git/server/browser/pane mutation, permission change, new agent, external message, publication, merge or deployment was performed. Focused tests used isolated test instances and temporary databases, not managed task previews or their data. The sole durable output is this exclusive report; all earlier review reports remain unchanged. R5's owner-pending real-browser Start-to-live gate is still outside this acceptance and was not retried.
