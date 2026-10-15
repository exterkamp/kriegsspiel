# R14: independent curated-picker child review

**Verdict: Accepted at H for the bounded four-file child-component packet. No blocking or nonblocking source finding within this delta.** New browser/native-modal/visual acceptance remains pending. A broader combined-snapshot run has fifteen shell failures caused by disjoint live-service changes; those failures are recorded below and are not a green integration result or a defect attributed to frozen H.

## Exact binding and complete coverage

- H `11e1b631a77307c7d08d23de4e33e3b5d66eb6ba`, tree `bd0cb8a55f9ab54d54f85172785f106a751592bc`.
- Verified parent P `dc6105c0e8de0e8a6a22f7e1f68357832b38cd5f` (separately reviewed R13 fetch packet).
- Manifest `/private/tmp/lobby-map-picker-candidate.json`; handoff `/private/tmp/lobby-map-w5-picker-handoff.md`; ref `refs/heads/feat/lobby-map-curated-picker`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

All four complete files and their P..H delta were inspected. Manifest H/tree/parent/inventory and SHA-256 values match explicit Git blobs and the four snapshot files:

| Path beneath `client/src/app/lobby/battlefield-map/` | H blob | SHA-256 |
| --- | --- | --- |
| `battlefield-map.component.ts` | `eddde618e84a51525da64cd229b42a23b87f08a9` | `86fc83f28fa807fa295dc6087e729c3c8103119fe108228f240492cb131f3f23` |
| `battlefield-map.component.html` | `7d95d84d231dbc582438843db1f466233a9a82bb` | `845a6647af2bffe5672b714a7be00f3447f098ff3058c3c549eca34f30b21803` |
| `battlefield-map.component.css` | `f0c973014a30a948b2f5123840ff28d2d312ab9f` | `1b9cccf205c73cc19f3bedd74f34ea7a4748f7f7714808da2e6459d8cf0a1351` |
| `battlefield-map.component.spec.ts` | `8fe3b81c51b514554e22be4bff52498ed8bc96bc` | `b1120006d55a02d2f74b28a37e8a87c9294d44d5440845ed0ab6fc030c81def5` |

Surrounding inspected dependencies include the unchanged three preview files, accepted protocol decoder, actual NewGame reactive starting callback/parent guards, parent/shell tests and shared choice styles. Those named files/configuration and protocol source match H in the execution snapshot. R13 fetch files also remain identical. Approved UX and prior focus/history findings remain the acceptance context.

Snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` contains disjoint coordinator Host/creation/auth/lobby work and, as independently observed during testing, newer live `MarksService`/`GameService` changes outside H. No whole-snapshot identity or acceptance is claimed. Native High verification is packet-supplied; no pane operation was performed.

## Source assessment

**Approval and compatibility.** Any supplied modern catalog/parent/selection input selects the modern validation path. Catalog decoding uses the accepted bounded wrapper and an independent bounded public scenario ID. Missing/invalid modern inputs do not fall back to the otherwise valid legacy descriptor. A missing selection resolves to the catalog's unique default; a present stale/foreign/legacy/null/malformed selection remains unavailable until explicit Use. Valid catalog choices remain accessible for recovery while View is disabled for an invalid committed choice. The legacy-only caller retains the earlier default-only/no-output flow. Corrected legacy preview-failure copy no longer falsely claims scenario-only creation is unusable.

The component imports only public protocol and its geography preview. Readiness follows checked supplied catalog entries, not successful generation or geography alone. This does not authenticate synthetic/public digests or expose the internal alternative: the production parent at H still supplies only the legacy inputs. It makes no request, master-state import, game mutation, library save or generated-map approval.

**Candidate and committed state.** Summary/View use the committed choice; chooser radios affect only the candidate and its actual preview. A changed map ID recreates the interactive preview and resets fitting. Cancel/Escape/Back preserve the committed map and parent draft; nested Add/Back retains the candidate. Use decodes a detached output, records local commitment and starts the close/history gate before emitting once. The parent can acknowledge the same immutable ID/revision without resetting history/focus/announcement ownership; other input/context replacements retire the active picker even when IDs are reused. Invalid feedback clears readiness/announcement while the existing unwind settles. Emitted-object mutation cannot change the checked catalog or local summary.

The child is not a complete controlled form/store: integration must receive/validate the output, retain the accepted parent selection and explicitly reflect rejection/replacement. Final Start must independently validate modern state. These responsibilities remain in the coordinator's future parent integration; the current parent is unchanged.

**History, lifecycle and input gates.** The earlier native close/history retirement machinery remains. Entry and Use/radio handlers consult the callback-derived gate; the actual parent callback reads its reactive `starting` signal, so pending-create changes are visible before DOM rendering. History unwind retains modal/parent gating until acknowledgement. The visited native-close queue and deferred after-render focus return reject stale/newer-lifetime interference. Teardown removes or settles its owned pop listener without touching destroyed views. New selection-only acknowledgement handling preserves that lifecycle instead of initiating a duplicate traversal.

**Keyboard and styling.** All map actions remain type=button. Native radio grouping uses one name; containment treats the checked radio as the group's Tab stop, permits native arrow defaults and prevents Enter from submitting the surrounding form. Preview Escape still fits a manipulated view before propagating later Escape to dialog close. The source retains heading focus, status/alert copy, exact opener fallback, token styling,44px action/choice targets, one-column narrow layout and flex-growing scroller/footer arrangement. New text wrapping/min-width constraints address long candidate names. Actual Chrome radio navigation, top-layer inertness, focus scheduling, touch and390/320 geometry are not established by source/jsdom and remain browser gates.

## Test effectiveness and executed checks

The37 new child cases supplement the earlier40 without weakening behavioral assertions. They cover checked modern catalog boundaries, candidate/commit separation, output/transport detachment, nested Add retention, preview replacement, stale selection recovery, parent feedback timing/repetition/invalid feedback, pending-create changes before render, radio Tab/Enter/arrow handling, input replacement and late native-close acknowledgement. Public fixtures are separately decoded and whole-catalog validated before mounting. Their syntactically valid synthetic IDs/digests are not private registry approval or real selectable-alternative evidence.

Dialog primitives are deliberately stubbed in jsdom, including a deferred-close harness that clears focus and later delivers close acknowledgement. Actual same-document history and Angular events run, and the tests assert history/parent gates synchronously and focus after settlement. This is useful regression evidence for the implementation; it cannot replace new source-bound native-browser checks. The source fixtures retain no request or live game creation. No source mutation or independent red run was performed; handoff fixture-typing/shared-reference failures are authoring history rather than claimed product detections.

All commands used pinned Node **v22.23.3**, snapshot `client/`, with `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2` for Angular:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' --include='src/app/shell/new-game.component.spec.ts' --include='src/app/shell/shell.component.spec.ts'
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' --include='src/app/shell/new-game.component.spec.ts'
```

**First broader run:113 passed /15 failed across128 tests in3 files.** All77 child tests and4 NewGame tests passed;15 shell cases failed with `TypeError: this.game.map is not a function` during `MarksService` initialization. This was not an infrastructure/permission failure. Compared the dependencies directly: snapshot `client/src/app/game/marks.service.ts` and `game.service.ts` differ from H. The disjoint MarksService now reads `this.game.map()` during initialization, whereas the unchanged shell test GameService stub lacks that method. The four picker files and parent/shell sources/tests match H. These failures therefore identify an unreviewed combined-snapshot integration gap, not a demonstrated R14-source regression. No stub/source was changed to suppress them, and the coordinator's earlier128-pass handoff was not treated as a current independent integration pass.

**Isolated picker + NewGame rerun:81 tests /2 files passed.** The rerun excludes the diagnosed disjoint shell dependency and provides the bounded child/actual-parent coverage requested here; it does not erase the broader failures. Angular test bundle generation passed. The existing deprecated-splitting and experimental SQLite notices remained unsuppressed.

The three client noEmit typechecks executed earlier in this review sequence passed (`tsconfig.app.json`, `tsconfig.spec.json`, `tsconfig.worker.json`). They covered the combined snapshot compilation units at execution time, not a fully frozen H tree. Manifest/dependency comparisons and `git diff --check P H` passed. No independent production build, lint/format, full-root suite, CI, live server/game or browser check was performed.

## Bounded release and open acceptance gates

Accept the four-file child packet at H as a presentation dependency. Record the disjoint15-failure shell integration gap for its owner; do not call current combined integration green. No source repair within R14 was identified or authorized by this review.

Coordinator integration must supply the independent public parent and checked catalog, acknowledge/validate selected ID/revision, retain active/pending-create guards and prevent invalid modern state from reaching Start. Actual catalog/create/capability/WS/service/render/receipt/availability wiring remains separate. Add remains unavailable and performs no storage/generation. New radio/long-name/narrow/footer/native-focus browser checks and create-to-live map alignment remain pending; prior R5 screenshots/focus evidence are historical and do not automatically transfer to W5.

Only this exclusive R14 report was written for this packet; R12/R13 have their own separate reports/verdicts. Older reviews remain unchanged. No source/test/config/Git/server/browser/pane/permission mutation, new agent, external action, merge or deployment occurred. Browser Start approval remains pending and no workaround was attempted. Review stops after these bounded packets as requested.
