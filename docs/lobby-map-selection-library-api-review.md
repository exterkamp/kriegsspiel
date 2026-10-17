# R29 independent library API/composition review

**Verdict: Changes needed at H. Two blocking boundary findings: raw UTF-8 BOM normalization and incomplete response-close cancellation.** R28 foundation remains accepted at its exact revision. Do not enable production Add on this packet. No browser save/generation or whole-product acceptance is established.

## Exact binding and complete inventory

- H `d659fe2492c8cb744c02dc48f8d62f93ad35a493`; tree `ce0e3ce2a318a513e6537ad114a5f5b856f36957`; P `d915115160619ab6a3c4884e07d9005ebda0b93a`.
- Manifest `/private/tmp/lobby-map-library-api-candidate.json`, SHA-256 `868338026799ab0e6a820cbda0237c50db8d38eeee127606d7c779680680db20`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.
- Accepted library contract SHA-256 `9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`.

Verified explicit Git H/tree/P, the complete nine-path delta, all manifest hashes against Git blobs and the scoped snapshot files. Read every new source/test file and the complete changes in the other paths:

| Changed path | H blob |
| --- | --- |
| `server/src/map-library/service.ts` | `874da29991ba17653fcbe867b74ccb879db89ca6` |
| `server/src/map-library/service.test.ts` | `e8648143d7685ed0a6cc6b0303e9014bff90d7c3` |
| `server/src/map-library/routes.ts` | `94afa6441dc32dbeaaafeb4d666bac5ca1ff1f17` |
| `server/src/map-library/routes.test.ts` | `c5174d99654429c41d9e14d1776e3f419313fa8d` |
| `server/src/lobby/creation-store.ts` | `26e328442da4e135fe6ea757b9b711f27ca3d693` |
| `server/src/api/app.ts` | `b0a20ad59d8dc4d8bd134fc1745f36679bb7cfbd` |
| `server/src/main.ts` | `65c9168f36391127e56233f49ef7148cb7ef574e` |
| `Dockerfile` | `17cea92f3af08bf7b27bfb5551329d3c900cf292` |
| `docs/decisions.md` | `b0813ec616ccd8a2b3d30372c1b930f882f4aefa` |

Inspected surrounding auth session lookup/expiry/adoption/delete, creation transaction callbacks, accepted foundation code, Fastify request/error/response/close hook implementation, actual shipped catalog/assets, maps certification/build dependency, main shutdown, `.dockerignore`, and D43–D45/design/contract/execution log. Existing native API coverage is carried only from the previously accepted exact parent ancestry; the new app delta was independently read. No alternative native registration is added. Docker copies the shipped maps into build/runtime; no image build/deployment was performed.

During review the coordinator began a separate foundation repair in store.ts/store.test.ts/validation.test.ts and added an untracked wire.test.ts. Those future bytes are outside H and unaccepted here. The nine R29 Git files remain the frozen review target. R28's source/dist dependency checks and the independently executed R29 suite precede that repair notice; no whole-snapshot equality or acceptance by compilation is claimed. Client/parent/W11 work is disjoint. At the later final snapshot recheck, service.ts and routes.ts also differ from H; this report's findings, tests and real-BOM reproduction bind the original Git candidate and the earlier verified bytes. No conclusion about those subsequent repairs is carried forward.

## Blocking findings

**B1 — The raw upload parser silently removes a UTF-8 BOM.** In `server/src/map-library/routes.ts`, the content parser uses `new TextDecoder('utf-8', { fatal: true }).decode(...)`. The default decoder strips an initial EF BB BF. As a result, BOM-prefixed canonical JSON is passed to certification and storage as the BOM-free string. This violates exact canonical bytes/no normalization and conflates two raw save intents.

Independently reproduced first through the actual Fastify parser with a recording save port: five uploaded bytes EF BB BF 7B 7D reached save as the two-byte string `{}` and returned200. Then reproduced with the actual route, MapLibraryService, real current-certification workers and a disposable file-backed SqliteCreationStore: prefixing the shipped canonical included asset with a BOM returned200, stored only the BOM-free bytes, and retrying the same key with the plain bytes returned the same accepted operation. This is a product-source failure, not a mock-only inference. No game or managed server was used.

Preserve the BOM in decoded text so parsing/canonical equality rejects it, or reject it explicitly before decoding. Add an actual raw-byte regression requiring rejection/no operation and verify valid canonical uploads retain exact bytes. Apply the same exactness rule to other raw UTF-8 readers where relevant; do not normalize uploaded text to make certification pass.

**B2 — Closing a response during a pending read does not cancel that operation promptly.** `onRequest` subscribes only to `req.raw`'s `aborted` event. There is no response-close cancellation hook. `onResponse`/`onError` retirement therefore does not observe an ordinary closed response while its async read is still pending. The slot and validation work remain live until that work finishes or its30s deadline expires. A completed GET request whose response socket closes is distinct from an incomplete upload's IncomingMessage aborted event.

Reproduced using the actual route plugin and Fastify injection, with a controllable read port: enter GET `/map-library/maps/owned/:id`, destroy the raw response, observe LIGHT_ECONNRESET, then inspect its captured signal/reservation. The signal remains **not aborted** and admission remains **1 active** while the read is held. Only after explicitly allowing the read to settle does normal response retirement abort it and reduce admission to0. No permanent slot leak after settlement is claimed. The actual route logic is the defect; the controlled port makes the missing cancellation edge observable without timing a real worker.

Register an owned response-close path that distinguishes successful completion, aborts departed work immediately, and awaits tracked worker exit before releasing capacity. Cleanup must be idempotent across request abort, response close, error, normal response and shutdown; retirement already in flight must remain awaitable. Add regressions for response close during read/certification, after a complete upload but before save completion, and teardown without double release. The coordinator's separately reported partial chunked-upload disconnect test covers another path and does not close this finding. Shutdown currently has an onClose sweep; it does not substitute for response-close cancellation during normal operation.

## Other reviewed behavior

Authentication and PUT metadata/content-type/encoding/key/declared-length checks occur in onRequest before custom body buffering. PUT and byte-bearing GET acquire the shared no-queue owner/global lease before large SQL/certification. Actual chunk bytes and chunk count are bounded; UTF-8 decoding is fatal; ingress and worker have separate30s deadlines. Ordinary game-body limits are retained. The BOM exception above remains material despite these other checks.

Metadata is allowlisted, URI-decoded name validation is bounded, raw read response headers carry only public summary fields, and private responses are no-store. JSON list/receipt endpoints remain small. The strict query parser rejects explicit empty cursors, resolving R28-N1 at this HTTP boundary even though the old store remains permissive. No raw map body/original-owner identifier is added to application tracing/log output.

Save checks the current session before work and again after certification, then the store rechecks live user/key/quota in its final transaction. Exact accepted-key retry is resolved before current certification/quota decisions. Changed accepted intent conflicts. Lost COMMIT acknowledgement yields503 and the same durable receipt/key can recover without another asset. Async reads recheck principal and current owned record after certification, then route principal again after the caller await. This prevents the inspected deletion/logout/adoption windows from publishing old private bytes or committing under a departed session. Abort does not prove that a previous write never committed.

Ownership participants use the existing shared account transaction. The library registers before included startup; participant failure rolls back auth/seats/lobby/library changes. Registration rejects duplicate identity or transaction-time/poisoned state. Startup requires a genuinely file-backed owner, initializes schema and certifies every included canonical file before returning the service. Main omits the library in memory-only mode; buildApp requires the same durable creation owner before routes/capability are advertised. Unsupported/corrupt included startup rejects instead of returning a partial capability. A failed startup is not accepted as a usable service. These source properties do not establish live capability, full storage recovery under every fault, or browser performance.

## Independent checks and limits

Pinned Node22.23.3, snapshot server:

```sh
node ../node_modules/vitest/vitest.mjs run src/map-library/store.test.ts src/map-library/validation.test.ts src/map-library/service.test.ts src/map-library/routes.test.ts src/lobby/creation-store.test.ts --no-cache
npm run typecheck
```

**49 tests /5 files passed; server typecheck and focused ESLint on the seven scoped server TypeScript/test paths passed.** These are the actual selected tests/count, not the coordinator's different69-test integrated set. Logs `/private/tmp/lobby-map-r29-review-{tests,typecheck,lint}.log`. `git diff --check P H` passed. The ordinary tests use real included certification, Fastify injection, durable temporary SQLite and controlled transaction/session failures; they are meaningful evidence for those paths. They do not exercise a physical slow/chunked socket, raw BOM or response-close cancellation. No assertions/source were changed by this reviewer.

Independent stdin-only probes: `/private/tmp/lobby-map-r29-review-boundary-probes.log` records parser normalization and pending-read response close; `/private/tmp/lobby-map-r29-review-real-bom.log` records the real worker/store normalization and same-key equivalence. The latter ends with0 active leases/1 stored asset in its disposable database, then closes/removes it. Foundation's67-file in-memory dist/source equality was established in R28. No independent production build/Docker build/full-root suite/CI, managed server restart, browser or live game/create test was performed. Experimental notices remain unsuppressed.

## Gate

Repair B1/B2 and independently review exact repair bytes plus permanent regressions before accepting the API/composition packet or enabling library Add. Retain exact-source desktop/390/320, durable generation/save/list/readback, main-thread near-limit measurement and approved create-to-live browser gates separately. Main remains native-default-only in this delta; library geography never enables playable Use.

Only this exclusive R29 report was written for this packet; R27/R28 and all historical reviews are unchanged. No source/test/config/Git mutation, managed process/server/browser/game/pane/focus control, new agent, external message/action, merge or deploy occurred. Browser Start approval remains pending and no workaround was attempted. R30/R31 are separately queued reviews, with no implicit library implementation acceptance.
