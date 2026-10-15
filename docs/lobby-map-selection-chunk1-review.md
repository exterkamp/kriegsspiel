# R2 independent integrated chunk 1 review

**Verdict: Changes needed.** One blocking lifecycle finding, B1, in the frozen candidate. Native-browser/visual acceptance is also pending. This is a chunk 1 review, not acceptance of alternative playable maps, scenario assembly, durable map libraries, later chunks or the whole product.

**Historical freeze / repair handoff:** the coordinator accepted B1 and announced bounded B1/N3 repairs after this review. The execution snapshot is now a mutable repair workspace and must no longer be treated as equal to H. All snapshot comparisons, test results and probes below describe the pre-repair checks only. Findings remain bound to immutable H Git objects; no repair source was inspected or accepted in this report. A new exact candidate and browser record require a separate delta-review entry. The reviewer has finished this frozen R2 record without editing source or R1.

## Exact source and execution agreement

- Candidate H: `347e7c5645f1d476916cc711de7e0eeb03184e5d`.
- Candidate tree: `7f5bbc5de568cd91d7a2782d18e8f326911108a6`.
- B and verified merge-base M: `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`.
- Accepted metadata prerequisite: `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4` (R1).
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD remained at R1. H was inspected explicitly with Git object reads, never checked out.
- Execution snapshot: `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.
- Historical manifest: `/private/tmp/lobby-map-chunk1-candidate.json`. At review, its H/tree matched Git. All 14 R1-to-H changed paths were represented, and every manifest SHA-256 matched its H blob. This path may be reused for subsequent candidates; the H/tree recorded here remain authoritative for R2.
- Before repair, independently compared all **1316 regular tracked H files** with snapshot bytes using an in-memory Git archive. The only differences/missing files were `docs/lobby-map-selection-contract-review.md` and `docs/lobby-map-selection-execution-log.md`; those were reviewed from H. All product/config/test files agreed with H at that check. No extra files were found under client/server/engine/protocol/maps source directories.
- The complete B-to-H inventory contains **28 paths**. At the pre-repair check, all 26 changed paths other than those two documentation files matched the snapshot. Canonical product working files remained equal to R1. Its pre-existing execution-log modification was preserved. The checked R1 report SHA-256 was `cb9f94b884f209a97804627387ee3a80d6b297f796e942ab21f2f192ff33b6f1`, equal to H and the manifest; R1 was not edited.

Independent reviewer: assigned R2 reviewer in the existing read-only role. The packet identifies pane w3:pN and High effort; this session could not independently verify native settings through Herdr. No source/test/config edits, Git mutations, dependency installations, preview controls, pane/focus changes, new agents or external publication were performed. Only this exclusive report was written.

## Blocking finding

### B1 — P2: map entry is still live while game creation is pending

**Locations at H:** `client/src/app/shell/new-game.component.ts:65` (child inputs), `:386` (creation enters pending); `client/src/app/lobby/battlefield-map/battlefield-map.component.ts:213` (open guard), `:207` and `:342` (destruction/retirement).

After Start game calls `create`, `busy` and `starting()` become true. Parent form handlers block duplicate starts, state edits and Back, but that pending state never reaches the map component. Its three entry buttons remain enabled, and `open()` has no creation-pending guard. A user can open Choose/Add/View while the already-submitted game is being created. This contradicts the approved **Start/Create pending** rule to lock parent settings and map entry.

It also permits a concrete history overlap: Start → unresolved creation → Choose map pushes an overlay entry → creation succeeds → shell `go()` pushes the game route and destroys NewGame. At that point the current history state belongs to the game, so the destroyed map component does not unwind its earlier overlay entry. Back reaches an additional same-URL New game entry whose original dialog owner is gone. An independent in-memory source-logic probe confirmed both opening during pending creation and the retained overlay entry behind the game route. Angular/native primitives were stubbed in that probe; this is not a claim of native-browser reproduction.

**Required repair:** have the coordinator propagate/gate creation pending at the map-entry boundary, including a synchronous handler guard, and lock the relevant controls while that request is unsettled. Add a meaningful test with an unresolved create promise: all three map entries must remain closed, must not add history entries, and must resume correctly after a definite failure. Preserve exactly one existing scenario-only create request and the existing success route. Do not solve this by canceling an already-issued game request or changing its server semantics.

**Test gap:** the parent integration suite replaces the real map child with `MapFixture`; its open event emits regardless of parent creation state. Its tests exercise picker-open → blocked Start, but not the reverse ordering, pending Start → map entry. The real child's tests use a separate form host without the parent's `starting` state. The passing suites therefore do not cover B1.

## Complete changed-path coverage

All rows refer to H/tree above. R1 carry-forward below was checked by an empty R1-to-H diff for the affected contracts and approved design; this is not an assumption based on author conclusions.

| Changed paths | Actual inspection / disposition |
| --- | --- |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.ts`, `.html`, `.css` | Entire source/template/styles: validation, outputs, native dialog, history ownership, focus, input replacement and retirement. B1 applies. |
| `client/src/app/lobby/battlefield-map/battlefield-preview.component.ts`, `.html`, `.css` | Entire source/template/styles: shapes, layers, metre viewBox, zoom/pan, pointer and keyboard paths, descriptions and responsive controls. |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.spec.ts` | Entire suite, including repaired focus/history cases, invalid inputs and native primitive stubs; independently rerun. |
| `client/src/app/shell/new-game.component.ts`, `client/src/app/shell/new-game.component.spec.ts` | Complete delta and surrounding parent form/submission. Child-fixture limitations identified above. Independently rerun. |
| `client/src/app/shell/shell.component.spec.ts` | All changed assertions plus surrounding shell/history/auth/guest/live tests; independently rerun. Production shell source is unchanged. |
| `client/src/legacy/shell/newGame.ts`, `client/src/legacy/shell/newGameApi.test.ts` | Entire delta/new test and existing form/transport functions. Independently rerun. |
| `packages/protocol/src/battlefield.ts`, `packages/protocol/src/index.ts` | Unchanged from accepted R1; public DTO/barrel carried forward after object comparison. |
| `server/src/game/battlefield.ts`, `server/src/game/battlefield.test.ts`, `server/src/game/registry.ts`, `server/src/api/battlefield.test.ts` | Unchanged from accepted R1; original projection/identity/registry/API review and independent R1 probes remain applicable. No new server runtime input was introduced. |
| `docs/decisions.md` | Unchanged from R1; D41/D43 re-read at H with approved scope. |
| `docs/lobby-map-selection-contract-review.md` | Original R1 report, checked unchanged against its SHA-256; its conclusions are limited to the accepted metadata prerequisite. |
| `docs/lobby-map-selection-execution-log.md` | H record read; author check results separated from reviewer evidence. Snapshot copy differs and is not the authority. |
| `docs/lobby-map-selection-ux-design.md`, `docs/lobby-map-selection-ux-design/inspection.md` | Approved design/acceptance and historical inspection record read; unchanged since R1. |
| `docs/lobby-map-selection-ux-design/desktop.png`, `desktop.svg`, `narrow.png`, `narrow.svg`, `render_wireframes.py` | Historical approved-design assets inventoried, byte-checked against H/snapshot and confirmed unchanged from R1. Not newly rendered or treated as implemented-browser evidence. |

Surrounding unchanged paths inspected: canonical `AGENTS.md`; `client/src/app/shell/shell.component.ts`, `shell-api.ts`, `client/src/legacy/shell/screens.ts`, `newGameApi.ts`, `client/src/app/lobby/game-list.component.ts`, `client/src/app/ui/modal.component.ts`, `page-frame.component.ts`; client package scripts/Angular test configuration. R1's scenario/load/create/replay inspection is carried forward for unchanged engine/server paths, with current registry/API call sites rechecked.

## Assessment beyond B1

**Geography and privacy:** the UI consumes the public descriptor only, with no engine/master-state import or local-board/catalog dependency. SVG shape coordinates, full polyline widths and point radii remain metres. Features draw in ascending layer order; equal-layer IDs draw in reverse lexical order so the engine's smaller-ID precedence is on top. The bridge/river/road and asymmetric woods match the accepted 4 × 3 km descriptor. Base fill represents open ground. Decorative outlines do not constitute terrain conversion. Public descriptions enumerate geography, not armies, HQs, observations or objectives. Full terrain/initial-scenario hashes still come from the R1 server projection, not a client-derived approval.

**Modal and history:** native `showModal()` provides the intended browser top-layer/background interaction boundary, while `activeChange(true)` is emitted synchronously before native opening. All map/preview buttons are explicit `type="button"`. The parent separately guards synthetic form submit, pick, patch and Back while the dialog is active. Explicit Tab handling includes the initially focused heading, and preview shortcuts stop propagation only when handled. Enter on non-button/non-disclosure targets cannot implicitly submit the parent. Cancel/Escape/Use retain the parent gate/native modal until owned history traversal is acknowledged. Nested Add unwinds before the chooser; replacement input closes the old visit; destruction avoids focusing destroyed views and retains its pop listener only to settle in-flight cleanup. Existing tests meaningfully cover these local paths, including replacement/destruction during Back, but native focus/inertness and whole-shell history require the pending browser evidence.

**Readiness and current capability:** Use is a no-op confirmation of the single server-described default. Add truthfully explains its unavailable capability and contains no generation/save/library operation, even if a caller advertises `addMaps: true`. No new map/pairing field is sent to CreateGame. Older servers without metadata get an explicit default-map fallback. There is no newly accepted pairing, adapter, owned storage, historical identity resolver or alternative terrain renderer in this candidate.

**Keyboard, touch and narrow layouts:** source provides keyboard fit/zoom/pan, touch-sized buttons, pointer capture with aspect-ratio-aware panning, bounded zoom, and a text geography disclosure. The dialog switches to full-height/single-column below 700 px; header/footer remain outside the internal scroller, controls wrap, safe-area space is reserved and styles use existing tokens. These are source findings only. No claim of 390/320 fit, actual native focus behavior, contrast or touch-device acceptance is made without final evidence. Escape resets a zoomed map when the SVG owns focus; otherwise the dialog handles cancellation.

**Compatibility:** transport retains metadata additively; `toRequest` remains unchanged. Scenario/side/rate/mode/turn/dial/persona logic continues to be the existing form rules. Auth/guest, quick-create, invite/room, live-service and replay paths remain unchanged. The primary label now correctly says Start game for this immediate-create caller. There is no invented waiting-room request. The parent gates duplicate creation with its existing `busy` flag.

## Nonblocking findings and scope gaps

- **N1 — Display validation does not bind against the parent scenario ID.** `checked()` verifies a descriptor's internal map/pairing IDs, identities and revisions, but receives only a scenario display name. A coherent descriptor for another scenario can therefore be labeled Ready for the passed name. The test called “mismatched scenario binding” changes only the pairing ID while retaining the original map ID, so it tests internal inconsistency, not this coherent mismatch. The current registry exposes one fixed correct default and the parent directly supplies its associated descriptor, so this is nonblocking for the frozen current producer. Before multiple scenarios/approved pairings or reusable callers are introduced, bind/check the actual parent scenario ID and add that distinct negative test. Do not infer client authorization from these shape checks.
- **N2 — Invalid-metadata copy and final action are independent.** An invalid descriptor displays “It cannot be used for a game,” but the parent receives only dialog activity, not descriptor validity, and can still submit the original scenario. Server-side scenario loading remains the authority and no invalid map bytes reach it. Clarify fallback copy or the intended final-action behavior before expanding metadata failure/revocation semantics; do not claim the current client blocks invalid pairing creation.
- **Scope gap:** the broader approved design asks for a New game draft to survive a trip to Main menu within one shell visit. The unchanged shell destroys/recreates this component, so this candidate does not establish that behavior. It is separate from chunk 1's specific Cancel-retains-form acceptance and is not a new blocker here. Room map summaries, source/library tabs and generated/curated selection remain later work.
- R1's nonblocking general work/DTO limits and initial-world provenance cautions remain open. The new client shape checks do not close those server/catalog/assembly requirements.

## Verification actually performed by R2

All executed tests used snapshot product source whose agreement with H was independently checked. Node was `/private/tmp/game-init-landing-node/node_modules/node/bin/node` (v22.23.3). No ordinary full suite was duplicated.

| Check | Actual result / practical limit |
| --- | --- |
| Git H/tree/M and full B-to-H inventory; manifest SHA-256 comparison; in-memory archive comparison of 1316 tracked files; extra source-file inventory | Passed for product/test/config source. Two documentation snapshot discrepancies explicitly recorded above. |
| Snapshot `client`: `PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2 node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' --include='src/app/shell/new-game.component.spec.ts' --include='src/app/shell/shell.component.spec.ts'` | **81 tests / 3 files passed.** Actual Angular compilation ran. Child tests stub native dialog primitives in jsdom; parent tests substitute the child. No native-browser inference. |
| Snapshot `client`: pinned PATH + `node ../node_modules/vitest/vitest.mjs run src/legacy/shell/newGame.test.ts src/legacy/shell/newGameApi.test.ts src/styles/design-system.test.ts --no-cache --configLoader runner` | **23 tests / 3 files passed**, including exact immediate-create transport and five token checks. |
| Independent inline Node source-logic probe: transpile exact snapshot parent/map classes in memory; stub Angular signals/outputs/native references/history primitives; hold creation unresolved, open picker, resolve creation through the inspected shell push/destroy order | **B1 confirmed.** Starting remained true while native-modal stub opened; overlay history entry remained behind game URL after destruction. This isolates code logic; it is not Angular/native-browser acceptance. No fixture source was written. |
| Canonical product comparison against R1 and R1 report SHA-256 | Unchanged. Canonical HEAD remains R1; pre-existing modified execution log preserved. |

The new tests are substantially behavior-based: they assert actual SVG attributes/layer order, event containment, deferred history acknowledgement, focus targets, native-close staleness and exact creation bodies. Invalid/replacement fixtures are synthetic, and geometry fixtures use placeholder hashes; they do not certify new scenarios. Touch capture, browser Forward through retired overlay entries, native open failures, and pending-create reverse ordering are not established by their coverage. No mutation testing was requested or performed.

Author evidence was not promoted to reviewer-run evidence. The retained server logs were inspected directly: `/private/tmp/kriegsspiel-lobby-map-server-tests.log` records one emergency-hold `pauseResult` timeout, 1384 passes and 3 skips; `...-rerun.log` records 1385 passes and 3 skips across 86 files. H changes no server paths beyond already-accepted R1, but the logs alone do not establish the cause of that transient failure. Other author-reported full-suite/typecheck/build totals remain coordinator evidence, not R2 reruns. R2 did not rerun full ordinary checks, build, typecheck or accessibility suites.

## Browser evidence and handoff

At the initial evidence check, `/private/tmp/lobby-map-chunk1-browser.md` did **not exist** and the evidence directory contained only `desktop-chooser.jpg`. At the supplemental check below, the final browser report was still absent. **Complete visual/native-browser acceptance remains pending.** R2 did not operate the task previews or change any user browser inputs.

### Supplemental 390 px visual assessment — same frozen H

**N3 — P3, nonblocking: the short Add state leaves its footer near the top of the full-height dialog.** Independently opened and visually inspected `/private/tmp/lobby-map-browser-evidence/390-add.jpg` (390 × 844). It shows readable capability copy and visible Cancel/Back to maps actions immediately below it, followed by a large blank paper area. The footer is not anchored to the viewport bottom as the approved narrow-dialog layout intends. This is a visual consistency defect, not an inaccessible/obscured action or a new blocking lifecycle issue.

The inspected historical screenshot's SHA-256 is `53061b25806de12ce826c9b2cfd1191788d22312dc3fe50a41e40db51bae5546`. The evidence path can change during repair; later bytes at that path are not this frozen screenshot.

The cause is visible in H's `battlefield-map.component.css`: the narrow dialog gets `height: 100dvh` and flex-column layout; header/footer use `flex: none`, but `.scroller` retains its default zero flex growth. Short content therefore does not consume the remaining height. The long chooser can shrink and scroll correctly while this short Add state still looks wrong. The appropriate bounded repair is to let the narrow dialog's content/scroller grow into remaining space while retaining `min-height: 0`, overflow scrolling and the nonshrinking footer. Avoid absolute-positioning the actions over content. Verify both short Add and overflowing chooser at 390 and 320 px, including footer visibility and safe-area spacing. No product CSS was edited by R2.

The coordinator additionally reports native desktop heading/Shift+Tab containment, nested Add Back, Cancel/focus/rate preservation and View Escape-fit-then-close passing. Reported 390 chooser measurements are page/dialog width 390, scroll width 388, footer bottom 843 in an 844 px viewport, and content/client heights 908/726. These are coordinator observations supplied in the follow-up, not interactions or measurements independently performed by R2. They support the repaired focus and long-content layout paths but do not resolve B1 or complete the missing 320 px/final evidence report.

The reported initial use of shared `127.0.0.1` cookies across ports may have replaced an existing local sign-in cookie. Subsequent evidence uses the task-specific `lobby-map-347e7c.localhost:41564` host. This is a verification-isolation incident, not a product-source defect; source acceptance must not imply that pre-existing browser authentication was preserved. The coordinator reports no server-data/process changes. Likewise, the ordinary snapshot's repository test requiring `.git` is an environment/evidence limitation, not by itself a candidate failure or a passing full-suite result; canonical repository and remaining catalog/bridge results remain pending coordinator evidence. The reported full lint/typecheck/build passes are still author evidence, not R2 reruns.

`HERDR_ENV=1` was verified. Under the previously read [Herdr skill](/Users/dominic/.agents/skills/herdr/SKILL.md) and [Herdr PR review skill](/Users/dominic/.codex/skills/herdr-pr-review/SKILL.md), ordinary `herdr agent list` returned `PermissionDenied: Operation not permitted`. No permission change, focus/pane action or coordinator prompt followed. This exclusive durable report and the final response are the handoff to `lobby-map-ux`.

Coordinator next action: repair B1 in a bounded owned packet, add pending-create coverage, then provide a new exact candidate and final browser evidence for delta review. This report does not authorize source changes by the reviewer, a merge, deployment or publication.
