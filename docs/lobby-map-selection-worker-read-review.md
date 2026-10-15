# R37 independent integrated worker-read review

**Verdict: Accepted at `f1f1b20701d6ba26e9fc056a1fa86fe40052d376` for the bounded worker-backed HTTP read dependency. No blocking or nonblocking source finding.** Actual Angular/browser worker loading and performance remain gates. Independent real-HTTP execution was prevented by listener EPERM; it is not recorded as passing.

## Exact binding and complete coverage

- H `f1f1b20701d6ba26e9fc056a1fa86fe40052d376`; tree `72400d359d393c9ca89e71bf2ed82c331b9d9f9c`.
- P `c700e0d292bdf43ef958df24c6e67ccc8b17e720` (seven source-identical library deliveries; separate rebind report).
- Manifest `/private/tmp/lobby-map-worker-read-candidate.json`, SHA-256 `dbe15528d33c41d290830756cd55af7625a603f6dfbd4d7b47c577ff0d1d3085`.
- W14 handoff `/private/tmp/lobby-map-w14-http-worker-handoff.md` and raw logs supplied context; they were not substituted for independent source inspection or reviewer executions.

Verified actual H/tree/parent/ref, the complete seven-path delta, every manifest hash against explicit Git and the scoped snapshot, and `git diff --check`. Read the complete production delta and tests, the three-file helper delta against accepted R35 `52e00f32087132d3d1759648e518d8d1a0128c7c`, current helper/worker/HTTP phase boundaries, new real-transport test, worker configuration and relevant inspection/preparation/server composition callers. AGENTS, relevant decisions, accepted contracts/reports and execution log retain their existing scope.

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `client/src/shared/lobby-map-library/asset-check.ts` | `02127b9ca02df9ce6058228d7f473293c4b6ec97` | `7d28e73841fd0183eb8fbec10d913b8db07a42df77faf5d9f1f10db0de1a3958` |
| `client/src/shared/lobby-map-library/asset-check.worker.ts` | `dc60d693e5b0a6596422ef0ea068109074eddb65` | `9ee4230a5ca1ae19675511a444004becab9a308a43d9b6c1cad023500053aef6` |
| `client/src/shared/lobby-map-library/asset-check.test.ts` | `943dff6f6926d2b6bf251284a2aa263223d7b5b1` | `1c12c2fe8dbabeb9c1f28ebde556a7f1a820c5375b2cb4e4c53b6c90ecd562c8` |
| `client/src/shared/lobby-map-library/http.ts` | `6246beb19ac2d017cd58fd7e4fed05aaa843b1e3` | `e0c2752e8f7b4c294d49c3ca85ce26cf1d75863fbd81361c6abb8b43bf69716d` |
| `client/src/shared/lobby-map-library/http.test.ts` | `afd2a7cf0ca9bb8e0595cdd332f67f739ece3c7b` | `184da0fdb2746d76efa830bc0b610247ad603017fb2385ff009175d821c0261d` |
| `client/tsconfig.worker.json` | `54cd8f853fd709cf8e5a37ca322fb70d683fe6d9` | `53ca629be00ee2014d129f0016dea9e33ec60c0899a8f43deda94dbf3f55f39d` |
| `server/src/map-library/client-transport.test.ts` | `360c18650d5ca26bc0ec12b5c04e4243b5925239` | `7ea1e45977918523ac0dd4a6552c4766b2ab814785c73772ff1a4cdd5d3c4d5a` |

Independently reproduced the supplied tracked-file binding:1153 blobs excluding `docs/`, root `AGENTS.md` and root `README.md`, zero differences against the snapshot. A broader check including those two root documentation files also found zero differences across1155 blobs. This explicitly states the counting filter; it does not cover ignored build products, untracked files, runtime state or all documentation. Binding manifest `/private/tmp/lobby-map-worker-read-tree-binding.json` SHA-256 `95d6e75d11e3c10f4f0a18e33bff377c2bbb7e6309abb5b1539fd21fae423dbc`.

## Implementation assessment

The helper retains its four required fields and now permits one optional own-data `candidate`. Main preflight uses the existing bounded JSON/structural/aggregate checks and schema clone to detach that candidate before dispatch. A present invalid/accessor candidate fails before worker allocation. In the worker, the candidate is parsed and canonicalized and must equal the same exact input JSON. The worker still independently imports the JSON, checks exact canonical bytes/NW-zero/dimensions, computes full asset identity and runs current complete certification. Candidate agreement cannot replace any of those checks. A renamed candidate with the same geometry but different full content is rejected. This reviews the exact later bytes previously identified as unreviewed drift in R35; R35 itself remains unchanged.

The helper's strict envelope, opaque current UUID, byte-count/digest/dimension binding, detached result, fixed diagnostic-free failure, one-shot worker entry and per-call cleanup remain intact. Abort, factory reentrancy, partial acquisition, deadline, late callbacks and final-handoff abort retain the reviewed behavior. The trust boundary remains a trusted same-origin worker/factory, not attestation of an arbitrary injected worker. Main still scans/traverses/clones bounded data, including an optional candidate; that is not free or preemptible work.

HTTP read now calls the real helper by default after strict requested-reference/header checks, bounded streamed UTF-8 read and fatal decoding with BOM preservation. It passes exactly the four required fields and the **derived phase signal**, not the caller signal or optional candidate. Fetch, body and verification share the original30s HTTP phase; verification does not gain a second HTTP budget. Timeout/caller abort propagates to worker retirement, and deadline/signal checks after verification reject late success. Errors are sanitized without fallback or a second read. The return remains only the checked summary and original exact JSON. List/save do not invoke the verifier and retain their existing UUID/conflict/reconciliation semantics.

The optional `LibraryAssetVerifier` argument is an explicit trusted embedding seam. HTTP does not revalidate the seam's returned asset. Production defaults to the trusted helper; supplying arbitrary successful code is outside the seam contract. Worker tsconfig adds the new worker glob and keeps the legacy authoring workers, with no broad DOM ambient addition to the server.

The new Node/server test runtime-imports the actual client HTTP implementation and actual worker handler through file URLs, while importing only the pure port type statically. The Node callback invokes the actual handler and honors abort before/after it; it is not a browser Worker and does not move that client-side validation to a Node thread. Server service validation uses actual Node workers. This preserves distinct browser/server type contexts and resolves the earlier transitive browser-type failure without adding global DOM types.

## Test effectiveness

All82 prior transport cases remain, now using a documented trusted reference-fixture checker reproducing their former import/canonical/NW/dimension/full-hash assertions. Inspection of their diff found no removed assertion; the96 prior `expect` calls are retained before the added worker suite. That checker is not complete certification and is not represented as such. Fourteen new HTTP cases exercise the default helper with worker doubles: actual allocation/job shape, reverse-order concurrent completion, no publication before verification, no heavy main verification calls, foreign response binding, admission before allocation, list/save exclusion, exact derived signal, sanitization, abort/stale output, uncooperative seam and remaining phase deadline. Raw red evidence shows the new allocation test failing at old HTTP source (expected2 workers, observed0;95 filtered cases); it is author evidence, not a reviewer red mutation.

The58 helper cases exercise the actual current worker handler on supported and canonical-but-current-invalid assets, plus lifecycle doubles. Four new cases establish bounded candidate detachment, actual matching candidate success, changed-full-content rejection despite equal geometry identity and accessor rejection without getter/factory execution.

The six actual-HTTP test cases have substantive premises and assertions: unmodified5km Countryside seed17 with current complete certification, nonempty buildings/roads and over1MB canonical JSON; full raw SHA equality and geometry inequality; actual ephemeral TCP/cookies/server workers/durable SQLite; exact included/read/save bytes; one immutable operation; lost acknowledgement reconciled with GET and no second PUT; conflict without reconciliation; invalid identity/current provenance rejection before acceptance; foreign404 without metadata/receipt; ownership adoption, independent file connection reopen and deletion tombstone. Cleanup asserts zero game receipts/lobby games. These are real library tests, not actual gameplay/browser tests.

## Independent checks actually run

Pinned Node v22.23.3 PATH, existing dependencies, no installs:

| Check | Actual result | Reviewer log |
| --- | --- | --- |
| Snapshot client: `vitest run --configLoader runner --no-cache src/shared/lobby-map-library/http.test.ts src/shared/lobby-map-library/asset-check.test.ts` |154 tests /2 files passed (96 HTTP,58 helper) | `/private/tmp/lobby-map-r37-review-client-tests.log` |
| Snapshot server: same focused Vitest command for `src/map-library/client-transport.test.ts` | Suite setup failed at `listen EPERM: operation not permitted 127.0.0.1`; all6 cases skipped, none independently passed | `/private/tmp/lobby-map-r37-review-server-tests.log` |
| Root: `npm run typecheck -w client -w server` | Both passed; client includes the new worker graph | `/private/tmp/lobby-map-r37-review-typecheck.log` |
| Root: ESLint on all6 changed TypeScript/test files | Passed | `/private/tmp/lobby-map-r37-review-lint.log` |
| Explicit object/hash/inventory comparisons, tracked-file binding and diff whitespace | Passed with the counting filter above | Tool output |

The socket suite reached real generation/service startup before listener allocation failed. No escalation, policy change or retry-to-green was attempted. Coordinator log `/private/tmp/lobby-map-w13-worker-permitted-tests.log` records6 passed in its permitted environment; that remains separate author execution evidence. W14's earlier server typecheck failure is preserved in its handoff; this review's final client/server typechecks passed. No production build, format, full suite, remote CI, managed HTTP request, browser or game creation was performed by this reviewer.

## Remaining gates

This packet moves the **HTTP read verification stage** into its default worker. `library-browser.component.ts` still imports/canonicalizes/full-hashes readback and checks prepared assets; `shared/game-setup/preparation.ts` still clones/canonicalizes/full-hashes its exported candidate. Neither file changes here. The optional candidate is a reviewed dependency for later preparation wiring, not evidence that wiring already exists.

Angular worker configuration/typechecking is not an observed compiled-worker boot. Coordinator's in-progress browser check and any later performance evidence are not presumed passed. Browser worker loading, owner cancellation, representative/near-limit transfer/main-thread latency and memory remain gates;64MiB does not guarantee responsive or bounded-RSS behavior. No whole-flow removal of main-thread work is claimed. Browser Start/create-to-live remains pending its existing approval gate, with no workaround. No alternate availability, arbitrary generated-map playability or final product acceptance follows.

Only the reserved R37 and library-delivery-rebind reports were written. Historical reports remain unchanged. No product/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment occurred.
