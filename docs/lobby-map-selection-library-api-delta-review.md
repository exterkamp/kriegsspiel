# R32 independent library boundary/API repair review

**Verdict: Accepted at H for the bounded seven-path repair union. R29-B1/B2 and R28-N1/N2 are resolved in source. No remaining blocking or new nonblocking finding in this delta.** Independent socket execution was restricted:34 tests passed and3 listener-dependent tests failed with listen EPERM. Separate actual-route injection probes verified the repaired cancellation/shutdown behavior. This is source/dependency acceptance, not managed-preview attachment, browser/performance or whole-product acceptance.

## Exact binding and complete coverage

- H `c0daa57efa97ac52f380840b90ee0e2cc15283a3`; tree `cbbb6dab39627e0990523a4ed48896301174383a`.
- Immediate parent/intermediate `fa814f16686db230ba83815191a22d8d6846771c`, tree `ed20f3ef31a0ec8bc089d0d86cabcb26b512d355`.
- Complete review baseline R29 H `d659fe2492c8cb744c02dc48f8d62f93ad35a493`.
- `/private/tmp/lobby-map-library-boundaries-candidate.json`: SHA-256 `88e3ad5ee883c1f57dd7398d4b92811bccdaad33911f2d7b4c5a0b4df2613892`.
- `/private/tmp/lobby-map-library-api-repair-candidate.json`: SHA-256 `878c853431feba82479b5dc7f42ed682c73fb55faecb30d3dd901fba9fbcda76`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified both manifest H/tree/P/inventories, their exact seven-path baseline..H union and every scoped SHA-256 against explicit Git blobs and the snapshot. Read the complete union delta, all new tests and surrounding route/parser/worker/admission/store/service lifecycle:

| Union path | H blob |
| --- | --- |
| `server/src/map-library/store.ts` | `1dc80091c580d913acb45ed50e3b83e897584a99` |
| `server/src/map-library/store.test.ts` | `5196261108afbbece7ecf469a319a11572ce93b8` |
| `server/src/map-library/validation.test.ts` | `0ededfb56d2d187948df546ac29f15a4a209ec30` |
| `server/src/map-library/wire.test.ts` | `d81c08193ffc4199bcd213adc594b0c58a14c69f` |
| `server/src/map-library/routes.ts` | `e31f7275480ec8fd60b4aa087af3aac9845a646f` |
| `server/src/map-library/service.ts` | `26f43e077b330cd4d7c3feaa2f72d1458a321f45` |
| `server/src/map-library/api-boundaries.test.ts` | `55d30cabbdffb05304d71a6520f090bef2dfc8d2` |

Context: AGENTS, D43–D45/approved design, accepted library contract SHA-256 `9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`, execution log, historical R28/R29 findings and raw regression logs. The R29 report remains unchanged. R30 parent repair, W11 focus and W12's new client helper are disjoint and are not accepted by this server compilation. No whole-snapshot equality is claimed.

## Finding disposition and lifecycle assessment

**R29-B1 resolved.** Both upload and included-file readers now decode fatal UTF-8 with ignoreBOM:true. This preserves the actual U+FEFF character rather than removing it; existing JSON import/canonical verification rejects the representation. The new raw BOM upload regression uses a real valid shipped canonical asset/full identity and requires400, no operation and no owned rows. It reached those assertions successfully in the independent run. Existing valid canonical save/read/retry cases still pass. A separate independent probe supplied a BOM-prefixed canonical included file through actual MapLibraryService.open with disposable durable SQLite: startup rejected map_validation_failed and returned no initialized library. No canonical normalization or accepted-key substitution is introduced.

**R29-B2 resolved.** Request abort and premature response close now invoke the same retirement path. Response close checks writableFinished, so ordinary completed responses retain the normal onResponse path. The retirement promise is installed before abort dispatch can reenter and remains discoverable in the operations map until lease release settles. Error/normal/close/shutdown callers receive that same in-flight promise; they cannot remove its discoverability or double release while worker exit is pending. Cleanup removes both owned raw listeners. The existing worker exit promise remains tracked by the lease; cancellation terminates the worker, and lease release waits actual exit rather than acknowledgement or requested termination.

Independently exercised the actual Fastify route plugin through injection with a controlled byte-bearing read and tracked exit: destroy the response; signal abort occurs immediately; abort callback synchronously reemits request-aborted; then an error and server.close join retirement. Abort and lease.release are each invoked once. Admission remains1 and server.close remains unresolved until the exit promise resolves, then both settle and admission becomes0. This closes the response-close gap and separately verifies shutdown discoverability. The read port/exit are controlled test seams, not a claim of physical socket or real-worker timing. The unchanged worker tests exercise actual worker success/current validation plus controlled exit/error/abort/timeout cases.

**R28-N1 resolved.** Store.list now distinguishes absence from an explicitly supplied empty cursor using cursor !== undefined. The permanent regression rejects empty text with restart_map_list rather than returning page one. The existing strict HTTP query boundary remains unchanged.

**R28-N2 resolved.** Permanent worker tests now submit character-length and multibyte UTF-8 overflow and assert no worker factory allocation, compare actual result to the independently computed full asset hash and against geometry identity, and submit topology-importable canonical geography with obsolete provenance that current complete validation rejects. These assertions pass independently; no coverage is inferred merely from a64hex shape or the old test title.

The new partial chunked-upload wire test meaningfully sends an unfinished real request, observes its lease, requires same-owner429 before acceptance, disconnects and requires0 slots/no operation. The GET/complete-PUT departure tests separately hold tracked exit while the handler is parked, require immediate abort and continued occupied capacity, then require release when exit resolves. Cleanup is outside the behavioral assertions. They introduce no HTTP game allocation, managed-server restart or alternative playable map.

Raw author red evidence was read rather than adopted as this reviewer's run: cursor1failed/9passed; clean API3failed/3. The clean API log shows BOM200 versus400; the GET fails its post-exit slot-zero assertion, while PUT fails immediate-abort. It does not show both methods failing the same signal assertion. The earlier masked cleanup run is not counted as meaningful product failure evidence. No old assertions were weakened by the inspected delta.

## Independent executed checks and infrastructure limit

Pinned Node22.23.3, snapshot server:

```sh
node ../node_modules/vitest/vitest.mjs run src/map-library/store.test.ts src/map-library/validation.test.ts src/map-library/wire.test.ts src/map-library/service.test.ts src/map-library/routes.test.ts src/map-library/api-boundaries.test.ts --no-cache
npm run typecheck
```

**34 passed /3 failed across37 tests in6 files.** All three failures are `listen EPERM: operation not permitted 127.0.0.1`: partial-upload wire and GET/PUT completed-request socket tests. They fail at listener allocation, not product assertions. The raw BOM case and all ordinary foundation/service/routes tests pass. This is not an all-green independent37-test result. No escalation, permission change or retry-to-green was attempted. The coordinator's37-pass permitted run remains author evidence only.

Server typecheck and focused ESLint on all seven union TypeScript/test paths passed; `git diff --check baseline H` passed. Logs `/private/tmp/lobby-map-r32-review-{tests,typecheck,lint}.log`. Independent stdin-only injection/shutdown/BOM-startup probes passed in `/private/tmp/lobby-map-r32-review-lifetime-probes.log`; source imports used the existing pinned maps build, with no source edits. Experimental SQLite/Transform Types notices remain. No independent red mutation, production build/full-root/CI/Docker/browser or live game test was performed.

## Bounded release and remaining gates

Accept the repaired server packet at H and close the named R28/R29 findings for this source. The independently unavailable physical socket cases remain an evidence limit, explicitly supplemented by source inspection, actual-route injection/reentry/shutdown probes and the retained author wire runs. Existing R29 identity/privacy/adoption/transaction/capability assessment otherwise carries through the inspected bounded delta.

No library is attached to a managed preview by this review. R30 parent recovery, W11 focus and W12 worker-helper changes require separate verdicts. Durable generation/save/list/readback, representative/near-limit browser responsiveness/memory and desktop/390/320/native-modal evidence remain separate gates. Actual browser Start/create-to-live approval remains pending; no workaround occurred.

Only this reserved R32 report was written. R29/R28 and all earlier reports remain unchanged. No source/test/config/Git mutation, managed process/server/browser/game/pane/focus control, new agent, external message/action, merge or deploy occurred. Disposable workers/databases and injection/test listeners attempted by tests are limited to this review's checks.
