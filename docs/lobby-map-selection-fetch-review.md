# R13: independent public battlefield fetch-helper review

**Verdict: Accepted at H for the two-file fetch-helper packet. No blocking or nonblocking source finding.** This accepts the unused bounded client transport helper, not endpoint privacy, GameService/lifetime integration, WebSocket capability wiring or playable alternative availability.

## Exact source and coverage

- H `dc6105c0e8de0e8a6a22f7e1f68357832b38cd5f`, tree `4a2ca77346e253235f844cc1aa272883289cb025`.
- Verified parent P `e0644f57194e5610b0efe5da3e7029d0f8dcea98`.
- Manifest `/private/tmp/lobby-map-fetch-candidate.json`; handoff `/private/tmp/lobby-map-w4-fetch-handoff.md`; ref `refs/heads/feat/lobby-map-fetch`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

The complete delta is two new files, inspected in full. H/tree/parent/inventory, all manifest SHA-256 values, Git blobs and the two execution-snapshot files agree:

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/legacy/lobby/battlefield.ts` | `7edfa6041f848ba73c58c2335471fa917311c799` | `d765de7f540c0c148c53d36ef468578ff93d9cf6c807f718f742d440b2e7d49e` |
| `client/src/legacy/lobby/battlefield.test.ts` | `d4ae9cfe2bc52b5dd8523d7a1806ff04c2e9e769` | `7c41293da3a794496a1bb0d27e8e82893715333cc3a75d443b15e59e6b232c0d` |

Accepted protocol source, renderer adapter/order/types, surrounding lobby/model/new-game API tests and client Vitest configuration used by the focused run were compared with H. No whole-snapshot claim: `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` also contains separately frozen picker and disjoint coordinator Host/creation/auth/lobby work. Those are outside this fetch verdict. Native High verification is packet-supplied; no pane control was performed.

## Source assessment

The helper performs one encoded-game-ID GET with `battlefieldVersion=1`, same-origin credentials and the caller's exact signal. It neither retries nor creates/seats a game. Returned envelope ID must equal the requested ID. An independently supplied `scenario` is required to be a bounded nonempty identifier and is passed to the accepted decoder and render adapter; the resolved assembly ID is not substituted for this public parent.

The response is read through a stream reader into a fixed262144-byte buffer. Actual chunk byte lengths are checked before copying, including aggregate/chunk overflow and dishonest/missing Content-Length. The inclusive limit, fatal UTF-8 decode and JSON parsing precede strict descriptor validation. It does not call Response.json/text or return a fixture fallback. The bound applies to bytes accumulated by this helper; network chunk production, overall timeout and connection lifetime remain caller/transport responsibilities.

Only game ID, public scenario ID, decoded approved descriptor and detached render map are returned. Other GameInfo envelope fields are omitted. Private/unknown descriptor/map fields reject through the shared schema. Metadata and render geometries do not alias each other. This allowlist cannot certify that an actual server endpoint never sends private fields; server projection remains its own gate. Syntactically valid digest/shape checks do not authenticate a private assembly or registry membership.

Cancellation has one request-lifetime rejection race, rather than a retained abort reaction per chunk. Pre-aborted calls avoid fetch. An abort rejects promptly, cancels an outstanding reader without waiting indefinitely for source acknowledgement, and disposes of a response that arrives after abort. Checks after read/adaptation and after race settlement prevent EOF-to-return stale publication. Finally removes the abort listener, cancels unfinished reads and releases the reader lock. Cancellation rejection handlers prevent secondary unhandled rejections from masking the original result. A permanently non-cooperating source cannot be forced to release its own underlying resource, but this helper does not wait for that acknowledgement.

401/426/404 produce the specified sign-in/reload/missing categories; other HTTP, network, body and validation errors produce fixed unavailable copy. Raw server/error content is not exposed through these errors. Abort remains a distinct AbortError. UI messages, retry policy, connection-token ownership and scene gating are deliberately absent.

## Tests and checks actually run

Pinned Node **v22.23.3**, snapshot `client/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/legacy/lobby/battlefield.test.ts src/legacy/lobby/model.test.ts src/legacy/shell/newGameApi.test.ts src/legacy/table/battlefieldMap.test.ts src/legacy/table/paintOrder.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.app.json
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.spec.json
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.worker.json
```

**70 tests /5 files passed, including42 helper tests; all three client noEmit typechecks passed.** Typechecks cover the current combined snapshot compilation units, not complete equality to this H or acceptance of separately owned modules. Manifest/dependency comparisons and `git diff --check P H` passed. No independent build/lint/format/full-root/CI/real endpoint/browser run was performed.

The tests use fake fetches with ordinary Response/ReadableStream objects. They assert exact URL/auth/signal, inclusive byte limits across chunks and Unicode, false length headers, split UTF-8, malformed payload rejection, parent/game binding, exact asymmetric/mm geometry and widths, allowlisting/detachment, HTTP categories and single-request behavior. Cancellation cases exercise late fetch resolution, outstanding reads with resolving/rejecting/never-settling cancellation, listener/lock cleanup and a timer-free EOF-to-settlement abort race. These are meaningful stream/lifetime assertions, not a real network/browser oracle. No source mutation or independent red run was performed; handoff claims of an earlier failing cancellation regression are author evidence only.

## Acceptance boundary

Accept this helper as an isolated dependency. Actual consumers must supply their own abort/timeout and connection identity, reject stale results, obtain a verified map before interaction, retain readable error/retry behavior and never replace missing modern metadata with fixture terrain. The server must expose only the approved public descriptor with an independent public scenario ID and enforce the remaining capability/privacy rules. No endpoint, live GameService, WS, renderer or availability acceptance follows from this packet.

Only this exclusive report was written for R13. No source/test/config/Git/server/browser/pane/permission mutation, new agent, external action, merge or deployment occurred. Earlier reviews remain unchanged. Browser Start approval remains pending; no workaround was attempted.
