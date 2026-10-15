# R31 independent library HTTP/capability/disclosure review

**Verdict: Accepted at H as the bounded transport/capability-projection/disclosure dependency. No blocking or new nonblocking source finding. R26-N1 is resolved.** This does not accept production library attachment: R29 API and R30 parent remain changes-needed, R27's focus follow-up is separate, and real browser/performance gates remain open.

## Exact source and complete inventory

- H `81ae2e9facd6dc8d1e5b2c6b80abb83659bb3225`; tree `a975c703d0a4a1e3f9faa7dca19f033e3c8c50e6`; P `5e89956c0aeafff60723e12a3938de011a78f17b`.
- Manifest `/private/tmp/lobby-map-library-http-candidate.json`, SHA-256 `51c1d35c767ebfbf890bef7a68c0c52424da876a88f4d097f6261fca26fe269d`.
- Handoff `/private/tmp/lobby-map-w10-http-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Read the complete eleven-path P..H delta, complete HTTP implementation/tests and all changed surrounding code/tests. Explicit Git H/tree/P/inventory and all manifest SHA-256 values match Git blobs and scoped snapshot files, including final recheck:

| Changed path | H blob |
| --- | --- |
| `client/src/shared/lobby-map-library/http.ts` | `1dc417f6da1300a5ead813b8e6238dcddc4e076c` |
| `client/src/shared/lobby-map-library/http.test.ts` | `cfaecf6855f6aed19a5d41722df0998a547ece6f` |
| `client/src/app/lobby/map-library/map-library.component.html` | `991d46446af95807d171c82d51e20e10f83947be` |
| `client/src/app/lobby/map-library/map-library.component.css` | `7941354966b0388f87bdf58a3e3c79bb3deea24a` |
| `client/src/app/lobby/map-library/map-library.component.spec.ts` | `45e1ed8ca4a3a344d690324429346a956065fa0a` |
| `client/src/legacy/shell/newGame.ts` | `c4916c2c751fae26c028be8bee4c9d916cb41b48` |
| `client/src/legacy/shell/newGameApi.ts` | `b2eea8e2eef58f3bf8ec319946f6072a3213b193` |
| `client/src/legacy/shell/newGameApi.test.ts` | `b2ae793a28a2c5d4b582bc09809b5d498140adff` |
| `packages/protocol/src/map-library.ts` | `ef188ac17ccb7e09b4859e31edb320f6d960788a` |
| `packages/protocol/src/map-library.test.ts` | `55f99d439a0da07f191ab79c1d402c2139e6b0b3` |
| `packages/protocol/src/index.ts` | `493aef0be384e1c47f63f5fde842641f38873109` |

The three protocol blobs were byte-compared with accepted R28 `d915115160619ab6a3c4884e07d9005ebda0b93a` and are identical. Rebind that bounded protocol acceptance and the independently executed116-test protocol evidence by verified identity. This is not a rebind of any server foundation repairs. The accepted port remains SHA-256 `bc0c8873aef2633897ba810d019a33e9e61e29e1b1f5d738208b12a764d8a215`; accepted contract remains `9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`.

Context inspected: AGENTS/approved design/contract/R18, W8 state/save/readback and preparation/preview boundaries, R25 transport, R26-N1, R27 picker/library callers and R28 protocol decoders. R30's native parent is the declared parent, but its three blockers are not cured or accepted by this packet. W11's mutable focus repair and coordinator server/foundation changes are outside H. No whole-snapshot identity/acceptance is claimed.

## Source assessment

**Exact bounded transport.** The factory creates only a MapLibraryPort. Requests use relative paths with same-origin mode/credentials and redirect:error. It creates no session/guest/game/request UUID and never automatically retries PUT. Source/cursor/reference/save metadata are preflighted; four input strings are snapshotted through own data descriptors. Upload UTF-8 accounting rejects broken surrogates and excess bytes without allocating a second asset buffer. It sends the caller's unchanged canonical string and separate URI-encoded name/full hash under the exact caller key. It does not certify arbitrary upload input; the reviewed child/current server remain that authority.

List responses are streamed to32KiB and decoded through the exact accepted schema/source/duplicate/page decoder. Save/receipt/error JSON is bounded to4KiB. Asset reads stream actual bytes to64MiB independently of Content-Length, require exact type and bounded allowlisted X-Map headers/reference, and verify canonical equality, NW-zero extent/dimensions and full asset identity. UTF-8 is fatal and `ignoreBOM:true` preserves a BOM character so canonical comparison rejects it; it does not normalize the R29-B1 representation. Public summaries/results are detached and no private payload/provider error text is surfaced.

The contiguous reader grows only to its declared budget; old/new buffers can overlap transiently during growth. It bounds empty/total chunks and checks wall time inside the read loop, so an always-ready stream cannot indefinitely starve a timeout timer. One phase owns fetch/body/validation and an abort race, removes timers/listeners, cancels unread/late bodies, releases reader locks and rejects stale EOF/hash/receipt results. It observes cancellation rejection without waiting on a noncooperating source. Synchronous import/canonical/hash preparation cannot be preempted by a timer; that limit is accurately retained as a measurement gate, not described as a frame/RSS guarantee.

**Save ambiguity.** A successful response must be strict owned metadata with the exact name/full hash. A valid conflicting intent is never reconciled into success. A network/5xx/unreadable or unresolved success may perform one GET of the same receipt key; never another PUT or a replacement key. Known4xx, including409 whose body is malformed/oversize/times out, cannot trigger reconciliation into an unrelated result. Unresolved receipt/auth/404/conflict/private/timeout data remains pending. Caller abort returns AbortError and does not prove cancellation of a committed write. W8 retains its exact intent on every such error and independently reads back exact bytes/identity before emitting saved; the transport's metadata response alone is not save-to-play approval.

**Capability and compatibility.** ScenarioOptions adds only an optional boolean. Only a root object with exactly schemaVersion1/available=true promotes it; false/unknown/malformed/extra/per-scenario advertisements omit the capability while preserving ordinary scenario setup. No wire object or extra private fields are retained. Previous bounded create/receipt transport and request semantics are unchanged. The flag is an advertisement projection, not authority to infer durability from a mounted component or accept the disjoint R29 implementation.

**R26-N1 resolved.** Repeat this map is an initially closed native details/summary disclosure. Its labelled Map number retains recipe/seed across collapse and expansion; Enter/Space defaults remain unsuppressed. Summary gains44px minimum target and token spacing. No generation/state handler, recipe replacement or implicit save was introduced. Actual native accessibility/390/320 rendering remains a browser gate.

## Independent checks actually run

Pinned Node22.23.3, snapshot client:

```sh
node ../node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/shared/lobby-map-library/http.test.ts src/legacy/shell/newGameApi.test.ts src/legacy/shell/newGame.test.ts src/styles/design-system.test.ts
NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2 node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/map-library/map-library.component.spec.ts' --include='src/app/lobby/map-library/map-library-state.spec.ts'
```

**193 framework tests /4 files passed (82 HTTP,91 scenario/create transport,15 form,5 design-token cases);47 real Add/state Angular tests /2 files passed.** Focused ESLint on the six changed client TypeScript/spec paths passed. The client app/spec/worker typecheck independently run in R30 passed with these same eleven scoped files present; that is one shared invocation, not an additional R31 typecheck. `git diff --check P H` passed. Logs `/private/tmp/lobby-map-r31-review-{tests,angular,lint}.log` and `/private/tmp/lobby-map-r30-review-typecheck.log`.

Tests meaningfully use actual Response/ReadableStream readers, split multibyte text, literal32KiB/4KiB/64MiB boundaries, malformed/private/ref/header data, BOM/noncanonical/full-versus-geometry identity, stable intent under caller mutation, actual cancellation callbacks/locks, nonacknowledging sources, timed-out fetch/body/two-phase receipt, late hash/fetch/EOF/receipt races and no extra PUT. Canonical/reference bytes and Node WebCrypto hashes are real. Fetch/auth/server/storage and generator are doubles: an exact64MiB invalid asset rejected after byte admission is not evidence that a near-limit valid map is usable, and64MiB upload whitespace accepted by a fake server is transport admission evidence only. No independent mutation/red run was performed.

The focused Angular run deliberately excludes W11's changing picker subtree; it checks the exact W10 child delta. The coordinator's226-test full attachment result is retained as author evidence, not claimed as this reviewer's run. No independent production build/full-root/CI/actual HTTP/durable save/browser/generation run was performed. Existing Angular splitting/SQLite notices remain.

## Release limits and handoff

Accept the eleven H files as a bounded dependency; retain R28 protocol acceptance by exact blob identity. R29 API B1/B2 and R30 parent B1–B3 require separate repairs/reviews. R27-N1's saved-item focus repair is outside this packet. Main-thread import/canonical/full-hash/clone throughput, long tasks/input latency and peak memory need representative and near-limit actual-browser measurement through the subsequent preparation/preview path before live capability; move work behind an accepted worker boundary if those measurements require it. No performance pass or complete library readiness is inferred from unit timing.

Production attachment still needs initialized reviewed durable capability, actual current-owner generation/save/list/readback integration and source-bound desktop/390/320 native-modal/focus/touch evidence. Geography remains Needs a scenario; it never becomes an alternative playable native pairing. Browser Start/create-to-live approval remains pending and no workaround was attempted.

Only this exclusive R31 report was written for this packet. Earlier reports remain unchanged. No source/test/config/Git mutation, managed process/server/browser/game/pane control, new agent, external message/action, merge or deploy occurred. Review stops after R31 as requested.
