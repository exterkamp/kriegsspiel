# R34 independent native-parent recovery repair review

**Verdict: Accepted at H for the bounded four-path recovery repair. R30-B1/B2/B3 and N1 are resolved. No remaining blocking or new nonblocking finding in this delta.** No browser/create-to-live, library attachment, W12 helper or whole-snapshot acceptance is inferred.

## Exact binding and complete coverage

- H `190fac0c59a0e858435322b9eb0c51628bced3a4`; tree `d7b866fac0b5b1dc4b566db238f4a68efea86219`.
- P/baseline `5e89956c0aeafff60723e12a3938de011a78f17b`.
- Manifest `/private/tmp/lobby-map-parent-recovery-candidate.json`, SHA-256 `c62e70e0a006c4f1b98480e373b80802018517f588c75b3f07816f4a210e94aa`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified explicit H/tree/P, the complete four-path inventory and each manifest SHA-256 against Git blobs and scoped snapshot bytes, including final recheck. Read the entire delta and current parent setup/template/recovery/start/owner/destruction flow, complete decoder and pure deadline helper, all added tests and relevant retained parent/shell/service tests:

| Changed path | H blob |
| --- | --- |
| `client/src/app/shell/new-game.component.ts` | `f9832379afc69067c587829010883d0357642c0e` |
| `client/src/app/shell/new-game.component.spec.ts` | `42ac5d13ae8b7e8f42083569d7791090ab085971` |
| `client/src/legacy/shell/pendingCreation.ts` | `9c4e4833b3a88473677caf8232e1ebda5d274ff1` |
| `client/src/legacy/shell/pendingCreation.test.ts` | `0ea9843121c03c6a540c46d15a39fc59b4540076` |

Context: AGENTS/approved design/accepted pairing and recovery direction, execution log, historical R30 findings and raw parent/decoder red logs. R30 report remains unchanged (SHA-256 `bc4f01df2390994614b5217f03dfae33d0362ee88b05c99d11392eac93f6b6e9`). W11 focus/R32 server repair have separate reports/ancestries; this candidate does not include or implicitly merge them. W12's new helper is disjoint. Canonical protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`; no whole-snapshot identity is claimed.

## Findings disposition and source assessment

**B1 resolved — retry storage failure preserves intent and lock.** The setItem failure path now retains pendingRequest and busy when wasPending is true, while clearing only the starting spinner. The exact earlier request remains available for a later retry, background edits remain guarded and malformed/ambiguous evidence is not removed. Initial storage failure before any send can still return to an editable form without retaining an unsent request. The permanent Angular case first captures an ambiguous request, injects storage failure, checks no additional create/unchanged retained text/disabled input, then verifies complete original request equality after storage recovers. UUID equality follows from that whole-body assertion.

**B2 resolved — every present record is decoded.** Restore distinguishes null absence from every present string. Empty, whitespace and truncated records now enter the decoder/fail-closed recovery branch. The UI presents the recovery error without a new Start path, and start's own recoveryBlocked guard prevents synthetic allocation. The original text remains unchanged; the repair does not clear evidence or invent an alternative key. With no valid pending request, unavailable session storage likewise cannot silently authorize a fresh allocation.

**B3 resolved — recovery is independent of latest catalog availability.** Owner-scoped restore now occurs before invoking the latest catalog request. A valid retained form/request is kept when current options arrive; defaults cannot replace it. An explicit recovery section exists when its scenario is absent or catalog loading fails, including before a catalog response. Start requires current options only for a new request, while a decoded retained request can be retried with the exact key/body without a listed scenario. Separate tests cover empty list, removed scenario and rejected catalog; all verify the original request rather than reconstructing it from current defaults. The old normal setup/legacy behavior remains for new requests.

**N1 resolved — deadline and mode agreement.** The decoder uses the same deadlineHoursOf helper as request construction. In turns mode, visible deadline must be valid and equal the retained request, treating a genuinely absent deadline as null; turn minutes remain bound. Realtime requests reject turn-only request fields. Stale turn draft fields may remain in the realtime form, consistent with existing mode switching, but cannot appear in its sent realtime request. Existing strict metadata/private-field/version/UUID/rate/selection checks and protocol deadline bounds remain. Tests reject mismatched deadlines and realtime fields, and preserve a valid absent-deadline record before rejecting a changed visible deadline.

**Owner and asynchronous lifetime remain current.** Owner replacement clears old visible/pending state and creates a new epoch while preserving the previous owner's durable evidence. Catalog resolution/rejection and create resolution/rejection still check owner/epoch/destruction before publishing, navigating or removing storage. Immediate captured load invocation is retained with explicit synchronous-throw handling; there is no extra Promise scheduling step. A late catalog cannot overwrite a restored pending form or a newer owner. Destruction does not claim to cancel a server allocation; its key remains recoverable and late started output is suppressed.

New requests still pass the checked current native catalog/committed pairing and synthetic modal/starting guards before generating a UUID. The repair does not change toRequest or the legacy body shape. Pending retry bypasses latest availability checks intentionally, preserving the server's accepted-key-before-current-defaults semantics. Known initial refusal can unlock; an already ambiguous request remains conservatively pending after later errors. No library port/capability or automatic game creation is added.

## Test effectiveness and independent execution

Read the raw author red logs: `/private/tmp/lobby-map-parent-recovery-red.log` has4 failed/10 passed, detecting changed UUID, empty-record allocation and both missing-catalog UI cases; `/private/tmp/lobby-map-pending-deadline-red.log` has4 failed/10 passed, detecting all new mode/deadline premises. Those are author red runs, not this reviewer's mutations. The later outage case and original assertions remain. The reported temporary extra-defer setup failures are not counted as useful regression detection; final source contains no such defer or sleeps.

Pinned Node22.23.3, snapshot client; Angular environment `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/shell/new-game.component.spec.ts' --include='src/app/shell/shell.component.spec.ts' --include='src/app/game/game.service.spec.ts'
node ../node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/legacy/shell/pendingCreation.test.ts
```

**81 Angular tests /3 files and14 decoder tests /1 file passed independently.** Focused ESLint on all four changed paths and `git diff --check P H` passed. Logs `/private/tmp/lobby-map-r34-review-{tests,pending,lint}.log`.

A read-only TypeScript API check with existing spec compiler options, the three named Angular spec roots plus decoder test and their transitive dependencies produced **0 diagnostics**, with no filesystem emit/configuration changes (`/private/tmp/lobby-map-r34-review-targeted-typecheck.log`). This is targeted checking. The full client typecheck attempted during R33 failed in disjoint W12 asset-check.test.ts; that failure is retained in R33's report/log and no new full-client green is claimed here. The coordinator's full backend suite is separate evidence, not parent acceptance.

Additional stdin-only probes ran the actual in-memory-transpiled parent methods with simple Angular signal/input/output/storage doubles and real rules/public decoder: an old catalog completion cannot replace a newer owner's state; retained recovery sends the exact original body before any catalog completion; destruction suppresses late create output/storage removal; and a synchronous catalog throw still permits exact retained recovery. All passed (`/private/tmp/lobby-map-r34-review-lifetime-probes.log`). No HTTP/game request was sent. These source-method probes supplement the actual Angular DOM tests rather than claiming browser evidence.

The tests meaningfully exercise actual retained sessionStorage, rendered recovery actions, complete request equality and current owner guards. Create/catalog/service seams remain doubles. No independent red/source mutation, production build/full-root/CI, native-browser, managed server/game or real creation test was performed. Angular SQLite/splitting and Node Transform Types notices remain unsuppressed.

## Release boundary

Accept these four H files and close the historical R30 findings for this source. R32 server and R33 saved-focus verdicts stay separately bound to their exact candidates. Combining those packets still requires explicit source binding and affected integration checks. Durable owned-library attachment, actual generation/save/readback, main-thread/worker performance evidence and desktop/390/320 native-modal/browser acceptance remain separate. Actual browser Start/create-to-live approval remains pending; no workaround occurred.

Only this reserved R34 report was written for this packet. R30 and all earlier reports remain unchanged. No source/test/config/Git mutation, managed process/server/browser/game/pane/focus control, new agent, external message/action, merge or deploy occurred. Review stops after R34 as requested.
