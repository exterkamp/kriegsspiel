# R30 independent native-create parent review

**Verdict: Changes needed at H.** Three blocking recovery paths remain: losing the retained request after a retry storage error, treating empty retained storage as absent, and hiding recovery when its scenario disappears from the latest catalog. No browser/game request was made by this review.

## Exact binding and inspected paths

- H `5e89956c0aeafff60723e12a3938de011a78f17b`; tree `f621bdfa970f57e9f0257811b5b300ddc9e61048`; P `527c06c7bd8d37ec0e877229ed6836b1ec282c9d`.
- Manifest `/private/tmp/lobby-map-native-parent-candidate.json`, SHA-256 `1f355dd99a1ca5d5424839bbed84bca224a3a07b74f6af981cd655fa47222d30`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; combined execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified explicit H/tree/P, complete six-path inventory, manifest SHA-256 agreement with Git blobs and all six snapshot files. Read every complete changed file and the P..H delta:

| Changed path | H blob |
| --- | --- |
| `client/src/app/shell/new-game.component.ts` | `02af46ac4746a220b56753a3f688758ca3445535` |
| `client/src/app/shell/new-game.component.spec.ts` | `2692dd51431ef84611eaf8900c91c9e3ee1ac3b4` |
| `client/src/app/shell/shell.component.ts` | `0078140db1e7a0713760930aec20e27b06811a7d` |
| `client/src/legacy/shell/pendingCreation.ts` | `b11ae9db65db9bd8106681ee7ee05d2dd0f6766d` |
| `client/src/legacy/shell/pendingCreation.test.ts` | `ccf6412b2fed3828600fb8d78b7755c1ccf9ea74` |
| `client/proxy.conf.cjs` | `06890bec70cab84b238afa1d3ba2ebd3a2d9f251` |

Context inspected: AGENTS/design/accepted pairing contract and execution log, accepted W5/W9 child entry/output/active gates, pure newGame rules/request construction, accepted W7 create/receipt ambiguity semantics and actual shell owner binding. W10 transport/capability/disclosure and W11 focus work are disjoint and do not change this verdict. At the later final recheck, snapshot new-game.component.spec.ts and pendingCreation.test.ts differ from H, after the independently executed checks below. Those subsequent regression bytes are unreviewed here; findings and recorded passes remain bound to original H. No whole-snapshot identity or acceptance by compilation is claimed. The proxy adds only game-creations/map-library forwarding; it establishes no server capability.

## Blocking findings

**B1 — Retry storage failure discards an already ambiguous request.** In `NewGameComponent.start`, the sessionStorage.setItem catch always clears `pendingRequest` and `busy`, even when `wasPending` is true. `creationPending` remains true. On a later retry, `request` is now undefined, so the component rebuilds it and mints another UUID. A pending game can therefore become a second allocation after a transient storage failure. Synthetic edit guards also consult busy, which has been cleared despite pending state.

Independently reproduced against the actual transpiled class methods with signal/input/storage/output test doubles and real public decoders/rules: first create throws CreationPendingError; next retry throws from storage before calling create; restoring storage and retrying calls create with a **different UUID**. No network/create was performed. Retain the exact pending request/lock on a retry storage error; a failure before any initial send can remain editable. Add a permanent real-Angular regression spanning ambiguous result, failed storage write, recovery and UUID/body equality.

**B2 — An explicitly empty retained record authorizes a fresh allocation.** Restore uses `if (saved)` rather than distinguishing `null` from present malformed content. A key containing the empty string skips `decodePendingCreation`, leaves recovery unblocked and permits a new request. An existing undecodable retained record cannot establish that no earlier game committed. Independently reproduced with the same source-method harness: a present empty owner key leads to create with a new request and recoveryBlocked=false. Treat every present record, including empty text, as a decoder input; malformed content must preserve the fail-closed recovery path. Add empty/whitespace/truncated-record regressions without deleting or replacing ambiguous evidence.

**B3 — A retained scenario missing from current options hides Retry creation indefinitely.** Restore correctly retains the old request/form, but the template's setup branch requires `scenario()` before rendering the form/action area. If the latest options omit the retained request's scenario, `scenario()` is undefined and the page only says Loading scenarios…; with no scenarios, loadError similarly hides recovery. There is no pending-recovery action outside those branches. The server's accepted-key recovery deliberately precedes current availability/default decisions, so a client recovery must not require a still-listed scenario to reach that same key. This finding follows directly from restore, the scenario computed value and template control flow; no native-browser reproduction is claimed. Render a bounded independent recovery action for a valid retained intent even if the current scenario/catalog is absent. Add remount tests for removed scenario and empty latest list, proving exact old key/body and no fresh allocation.

## Nonblocking finding

**N1 — The pending decoder does not bind the visible turn deadline to the request.** It compares clock rate and turn minutes but never compares `form.deadlineHours` with `request.turnDeadlineHours`; it also permits turn-only request fields in realtime mode. Independently confirmed that a valid turns record displaying1 hour while requesting2 hours decodes successfully. The exact request itself remains retained, so this is not another demonstrated duplicate-allocation path, but it weakens the promised corruption/visible-intent check. Validate mode-dependent presence and deadline agreement using the existing pure helper, with lower/upper-bound and absent-deadline tests. Do not recalculate the request from latest opponent/default settings.

## Other source assessment

Modern selection uses the independently parent-bound catalog decoder and committed ID/revision. The child output is decoded and matched to the current catalog before retention; malformed modern metadata prevents legacy fallback on Start. Valid modern requests carry exactly the selected pairing, battlefieldVersion1 and a generated UUID. Existing legacy callers preserve the scenario-only request shape and do not acquire modern fields. Pending retry ordinarily uses its captured request rather than current defaults, opponent or revised catalog. Definite failures unlock while CreationPendingError keeps the request and inputs locked; a previously ambiguous request remains conservatively pending even after a later error. B1/B2/B3 are exceptions to the intended recovery guarantee.

Shell supplies the authenticated owner ID. Owner replacement clears old visible state and starts a new epoch/load; current-owner/epoch/destruction checks suppress late load/create completion and prevent old started output or removal of old-owner evidence. Destroying a page retains its ambiguous owner-scoped key. The load/create functions themselves are stable shell bindings; no transport abort is introduced by this component, so late allocation can still finish and must be recoverable by its retained key.

Parent active state synchronously blocks Start, edits and navigation behind the picker. The stable canOpen callback observes starting/pending before rendering disabled controls. Selection/Start guards cover synthetic activation; pending fieldsets lock displayed choices. The actual-child unresolved-create regression is retained. This establishes source/unit behavior, not top-layer/native-browser focus, exact live map alignment or create-to-live acceptance. The parent does not attach library ports in this packet.

## Independent checks actually run

Pinned Node22.23.3; snapshot client; Angular environment `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/shell/new-game.component.spec.ts' --include='src/app/shell/shell.component.spec.ts' --include='src/app/game/game.service.spec.ts'
node ../node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/legacy/shell/pendingCreation.test.ts
npm run typecheck
```

**74 Angular tests /3 files and10 decoder tests /1 file passed; client app/spec/worker typechecks passed.** `git diff --check P H` passed. Logs `/private/tmp/lobby-map-r30-review-{tests,pending,typecheck}.log`. No independent production build/full-root/CI/browser run or mutation/red test was performed. Existing Angular SQLite notices remain.

The source-method probes in `/private/tmp/lobby-map-r30-review-probes.log` use TypeScript's in-memory transpilation and a VM with simple Angular signal/input/output/storage doubles, plus actual rules/public decoders and a valid checked modern catalog. They demonstrate B1/B2/N1 control flow; they do not claim Angular DOM/browser proof or create an HTTP game. Ordinary Angular cases meaningfully cover current selection, modal/synthetic gates, legacy request shape, changed-default remount and late owner completion, but omit the identified storage/availability edges. Passing broader service/shell compilation does not accept disjoint combined workspace changes.

## Gate

Repair B1–B3 with permanent regressions and review exact repair bytes before accepting this native parent integration. N1 is a routine decoder correction. R29 library API remains independently changes-needed; no library attachment or full readiness follows from this packet. Actual browser Start approval remains pending, with no workaround.

Only this exclusive R30 report was written for this packet. Older reviews remain unchanged. No source/test/config/Git mutation, managed process/server/browser/game/pane control, new agent, external message/action, merge or deploy occurred. R31 follows as a separate bounded source review.
