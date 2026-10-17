# R27 independent picker/library attachment review

**Verdict: Accepted at H for the bounded eight-file presentation packet, with one nonblocking focus finding.** No blocking source defect was identified. This does not enable production Add, accept the disjoint library implementation, or establish native-browser/visual/durable-save acceptance.

## Exact binding and coverage

- H `527c06c7bd8d37ec0e877229ed6836b1ec282c9d`; tree `93a58d59ace554727d82dcd9280a3081de8c5f2f`; P `578d2146f6777ff9b6a454152b425430bd9d991a`.
- Manifest `/private/tmp/lobby-map-picker-library-candidate.json`; handoff `/private/tmp/lobby-map-w9-picker-library-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; protected HEAD independently remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Read the complete P..H delta and all eight complete scoped files. Explicit Git H/tree/parent/inventory, Git blob SHA-256, manifest hashes and the eight snapshot hashes agree, including a recheck after execution:

| Scoped path beneath `client/src/app/lobby/` | H blob | SHA-256 |
| --- | --- | --- |
| `battlefield-map/battlefield-map.component.ts` | `d725fa219920e0ab83c3430a0f948e104e9ea368` | `c8e8801dd7c726e648605c4749830e683e86d880f3d4c56b369523ccbec250e8` |
| `battlefield-map/battlefield-map.component.html` | `1719c87f2e9cca2e867d76a782b503336ad03bde` | `93fe7d5003aa6f3a44dcda9adc59efdce4005b9fa78455d3d3119308986bcba2` |
| `battlefield-map/battlefield-map.component.css` | `5f2ffbf9236676def14f0b0d992b784f669a0582` | `e2d16ef46236003c061410432196e05d83e89b54f54dece366cc8a18427f32e0` |
| `battlefield-map/battlefield-map.component.spec.ts` | `0725fd47362d18fca2a09cd6f34b70286bdb2153` | `c3bdda4f9a89a90951d837201d2d2532f78dcb41e40dca57e21ac9febd64c082` |
| `map-library/library-browser.component.ts` | `57d74ef7a8d94bc73451f343d2255666e1160f87` | `eedd9f11824122fede0c8b29b1d93e95edad897023396538f965c8c30d3cb064` |
| `map-library/library-browser.component.html` | `2b63753f295fd0f326f72394d5a86df0833798c5` | `6f4c3da1edec80600455aea93c9514cdb49e46031b9fe08aec1381488be29ce0` |
| `map-library/library-browser.component.css` | `bea8090b93eb48e13cc1c53f917cb8c29d030d29` | `900f959b4e71de2b74d22b35053673640df455e7443fba39c3c88d08fe28fc2c` |
| `map-library/library-browser.component.spec.ts` | `84a3cec7c31006b89bc6017d92e5215226b7fe6b` | `6fb7daf04c74aefc0a86392c6013181cbd7d85b5a4e7387ed64d65f6b4c50507` |

Context inspected: `AGENTS.md`, D41/D43 in `docs/decisions.md`, approved `docs/lobby-map-selection-ux-design.md`, execution log, accepted library contract/R18 report, historical R14/R26 reviews, actual W8 component/state and their tests, shared library/preparation contracts, legacy map preview/generation protocol, and surrounding NewGame/shell callers/tests. The accepted port at H remains SHA-256 `bc0c8873aef2633897ba810d019a33e9e61e29e1b1f5d738208b12a764d8a215`. BoardPreparation contracts at H are blob `21e5123cb98570c38930ed482d00935661f96fd1`; preview is blob `ecc580ef3d1f78e864fc3adf75765da124b45885`.

W8 state/component TypeScript, state tests, both contracts, preview and generation protocol match H in the execution snapshot. W10's separately owned W8 HTML/CSS/spec already differ on the later dependency check; they are not reviewed or accepted here. Snapshot NewGame source/spec and shell source also differ from H. Their passing compilation/tests are combined-workspace observations, not acceptance of those changes or a whole-snapshot identity assertion. H's original W8 template was read directly from Git; R26-N1 remains historical and its future repair is separate.

## Source assessment

**Playable state remains separate.** Both optional ports are required before exposing library controls or real Add content. Missing/partial capability retains truthful unavailable copy. This is an injected presentation capability, not proof of durable initialized storage; the composition owner must supply it only after that gate. Summary/View continue to show committed native geography. Browsing owned/included maps preserves the native candidate, never emits `selectionChange`, and synchronously rejects Use while a library source is active. All library rows/inspection remain Needs a scenario. No master-state, development catalog/session, transport endpoint or engine approval path is imported.

**Real child and history ownership.** The existing outer native dialog remains the sole modal/history owner. Add receives a fresh preparation; dirty Cancel/Escape/native cancel/unexpected native close/Back-to-maps request the real W8 confirmation. Keep editing preserves that exact child and draft. A same-URL browser Back is acknowledged before an owned Add entry is reinserted; repeated Back while confirmation is pending does not accumulate an extra retained depth. Confirmed discard either traverses to the retained chooser or unwinds to the original parent. A foreign URL does not get an Add entry or old focus restored into it. Parent active gating remains through history acknowledgement. Destruction and input replacement explicitly retire work rather than presenting an invalidated owner as editable.

Saved output is accepted only from the currently mounted child/preparation and active visit. W8 has already checked save/readback identity before emitting. The parent detaches that summary, asks the now-clean child to close, returns to My maps and inspects it even if the first list page omits it. Inspection uses a different preparation. Direct Add replaces its own history entry with Choose; nested Add traverses back to its chooser. Neither changes the native map or starts a game. The factory-return-after-destruction guard releases the orphan without reopening or focusing the destroyed owner.

**Library boundary and retirement.** Only one explicit page of at most20 rows/32KiB is retained; previous/next re-fetch cursor pages without aggregating assets. Source/library replacement clears cursor history. Foreign/duplicate/private-field/ready summaries and invalid or looping cursors reject visibly. An expired later page has explicit retry/restart. A read must agree on reference, summary, canonical bytes, full asset identity and NW-zero dimensions; a fresh BoardPreparation then performs current certification, followed by independent returned-board consistency checks. Included/owned references adapt only in memory to premade/generated preparation references. No certification alone becomes scenario approval.

Owner generation, operation identity, abort signals and explicit synchronous `retire()` prevent late list/read/certification publication and stale rendered row/paging allocation after retirement. Preparation and preview handles are released on replacement, page/source departure, close and destruction. Error text does not reveal thrown private details. Preview load receives a detached asset. These presentation checks assume the library port itself enforces streamed byte/metadata bounds before returning objects: post-return clone/JSON-size checks do not establish bounded transport allocation. Repeated full-asset import/canonicalization/hash/copy work likewise has no measured large-map responsiveness guarantee.

**Keyboard/style boundaries.** Actions remain type=button, with disabled plus synchronous handler guards for native selection/entry. The existing native-close visit queue, deferred opener restoration and Tab containment remain intact. Source controls expose pressed state; status/error copy, canvas pan/zoom/fit instructions,44px targets, wrapping/min-width constraints, narrow single-column layout and flex-growing scroller are present. Actual top-layer focus, native Back timing, touch/scroll and390/320 geometry need source-bound browser evidence.

## Nonblocking finding

**N1 — Save-to-inspection does not focus the saved map.** `battlefield-map.component.ts:511–548` returns through `returnToMaps()`/the normal pop handler, which focus the generic Choose battlefield map heading. `library-browser.component.ts` inspects `initialItem` but has no saved-item/inspection focus handoff; its selected-name heading is not a focus target. The approved design explicitly asks to focus the new saved entry. This is most visible when the saved item is absent from the current page: keyboard users are returned above the source/list rather than to the item they just saved. The new Save regressions check inspection/canonical identity and selection preservation but do not assert the focus destination. Add a current-owner, render-deferred focus target for the saved row or inspection heading, including the off-page case, before final integrated UX acceptance. This does not block the bounded nonplayable presentation dependency. No browser failure is invented from this static finding.

## Independent checks actually run

Pinned Node22.23.3; snapshot `client/`; Angular environment `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' --include='src/app/lobby/map-library/*.spec.ts' --include='src/app/shell/new-game.component.spec.ts' --include='src/app/shell/shell.component.spec.ts'
npm run typecheck
node ../node_modules/vitest/vitest.mjs run src/styles/design-system.test.ts --no-cache --configLoader runner
```

**225 Angular tests /6 files passed; app/spec/worker noEmit typechecks passed;5 design-token tests /1 file passed.** Focused ESLint on the four scoped TypeScript/spec files passed from snapshot root. `git diff --check P H` passed. Raw independent logs: `/private/tmp/lobby-map-r27-review-{tests,typecheck,style,lint}.log`. Existing Angular deprecated-splitting/experimental SQLite notices remain. No independent red/mutation run, production build, full-root suite, CI or browser run was performed.

The new tests retain the prior77 picker cases and meaningfully exercise actual W8 state/component outputs, dirty confirmation, repeated same-document history, candidate/parent-draft preservation, direct/nested save-to-inspection, pending-create/stale input guards and resource disposal. Browser cases check malformed pages, complete-versus-geometry identities, exact canonical/readback disagreement, source/owner replacement and late completion suppression. Dialog primitives are stubbed for jsdom; preparation/library/preview ports are doubles using real reference-asset canonical bytes and WebCrypto hashes. The Save fixture deliberately uses W8's recorded-recipe seam with the150m reference asset. It proves attachment behavior, not real5/10/15km generation, transport/storage, auth lifecycle or native raster/browser performance. Combined parent/shell passes do not approve their disjoint source.

## Release limits

Accept these eight H files as the bounded W9 dependency. Production attachment still requires reviewed durable library implementation/transport, current capability and owner binding, parent synthetic-submit/selection checks, real generation/save/list/readback integration and desktop/390/320 native-browser evidence. Prior R5 browser evidence is historical. Actual browser Start/create-to-live approval remains pending; no workaround was attempted.

Only this exclusive R27 report was written. All earlier reports are preserved. No product/test/config/Git mutation, managed server/browser/game/process/pane/focus control, new agent, external message/action, merge or deployment occurred. R28 foundation review is a separate following packet.
