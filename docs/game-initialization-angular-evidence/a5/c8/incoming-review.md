# Bounded incoming-main compatibility: demo polish, guest adoption, engine properties

2026-10-12. Root supplied freshly verified native GPT-6.1-Sol/high dispatch provenance. This audit performs no independent pane/model verification.

**Qualified A5 compatibility: no attributable A5 blocker or necessary local code/configuration adaptation identified.** All35 incoming paths and88 changed hunks were reviewed within compatibility scope. The only changed module in the pinned local/inspection dependency closure is the compatible optional `OwnUnit.trait` protocol field. The incoming FlatBoardComponent is a separate live renderer, not an A5 local/native dependency. Two documentation overlaps require root composition, detailed below.

This is not general upstream demo/CSRF/engine/property/narration correctness acceptance, A5 self-acceptance, browser/native-media acceptance or ready/merge approval. H remains the immutable source review authority specified by root. Previously authored A5 owner/effectiveness bytes receive no self-acceptance; prior independent feature qualifications remain separate. No provisional/moving checkout was substituted for H/B/I. The externally required native media gate remains **unwaived**.

## Pins, immutable packet and complete inventory

| Pin | Commit | Tree |
| --- | --- | --- |
| B | `36406f70c485e7f23befb9f9b9e27fdfbd4c32e0` | `46006d6f67ed45d313b2b9c2125e33f0b78ecd78` |
| I, full resolution of c8e3ec6 | `c8e3ec61efe56846f462f105414a615401ef3e4a` | `2086063d001884e841a827bdbbc623e591caa3e3` |
| H, requested A5 checkpoint | `3d787b66cffb475f543c09a72cbb682c2e231038` | `ed8994d2ca153fcb8be2606869122e56c4dbb2f5` |

Both B/I and H/I merge-bases are exactly B. Pinned history includes merge PR365 demo polish (`8137d610598e7c51956db788c128c8aa38b65c57`), PR367 guest adoption (`6af44f4763a0e7063c5167d912e3a438151cca30`) and PR368 properties (I). This records already-merged incoming work; no other-owner merge was performed here. A read-only HEAD observation during this audit still returned H; moving checkout state was not used as evidence.

Exact B→I `git diff --binary --full-index --no-ext-diff`: **108,088 bytes,2,136 lines,88 hunks,1,164 insertions/151 deletions**; SHA-256 `f697d36cda16a88a3c9281cce018816df5e9d3a6bedd78c2e72d93d193c77e3b`. Exactly **35 paths:32 modified,3 added,0 deleted,0 renamed**,925,149 incoming file bytes. Every incoming tracked mode is100644; existing base modes are100644, three added base modes000000. No mode/executable/symlink/submodule transition appears.

Full base/incoming path/status/mode/blob/byte count/SHA-256 inventory is preserved in [the frozen manifest](angular-a5-incoming-polish-adoption-property-manifest.json), SHA-256 `60247994f04627bcfbdc3241b2083729780f106c12983cb244019941eadf2c38`. Independently reconstructed all32 existing base and all35 incoming Git blob SHA-1 IDs using blob headers and exact bytes; computed SHA-256 for all67 existing versions. All35 full incoming copies were then independently rechecked against pinned Git bytes, hashes and exact inventory, and the frozen diff rechecked against Git. Copies are read-only444 and directories555; these evidence permissions are distinct from the source100644 modes recorded in the manifest.

Evidence locations: [complete diff](angular-a5-incoming-polish-adoption-property.diff), `angular-a5-incoming-polish-adoption-property-source/` complete35-path copies and the manifest. No deletion exception/omission is needed in this packet.

### All35 paths: exact changed-hunk coverage and incoming bytes

Every row's entire changed hunk was read, including tests/docs; all three added invariant files were read in full. Base/incoming blobs and base hashes are enumerated in the linked manifest; this table supplies the complete path coverage plus incoming hashes directly.

| Path | Status | Exact hunk ranges B→I | Incoming bytes / SHA-256 |
| --- | --- | --- | --- |
| `client/src/app/desk/roster/roster.component.html` | M | `-24,7 +24,7`; `-37,9 +37,8` | 1480 / `ac61f75204b001f7eb92489b0a102c44291acde611f408300fab99a8101cc55d` |
| `client/src/app/desk/roster/roster.component.ts` | M | `-7,7 +7,7`; `-29,7 +29,7` | 1477 / `ad1dd4bb1d3884b85cf44feee19a40045b572f99107ce9c49a42a32c6eaceef7` |
| `client/src/app/game/flat-board.component.spec.ts` | M | `-47,6 +47,7`; `-55,6 +56,7` | 4047 / `f11eee27884cc9aa69a1f39086424542201203c1851144a65b4e1e90ecacf254` |
| `client/src/app/game/flat-board.component.ts` | M | `-89,8 +89,14`; `-246,6 +252,11`; `-376,6 +387,6` | 12198 / `edb17e6e281e337be6f669524d09b73edebf55cd167f50d5377d51d58048ead3` |
| `client/src/legacy/desk/roster.test.ts` | M | `-1,7 +1,15`; `-37,10 +45,32` | 2786 / `4859aef2b6d5f8f4d51b315ddf35f6e1d49dbf00762711689ad025249302c049` |
| `client/src/legacy/desk/roster.ts` | M | `-11,6 +11,7`; `-41,6 +42,12`; `-51,12 +58,14` | 3041 / `7ce4040a25464eb596e829eee15b3b2f3d0d49cf93d48162de58460dc5a8834a` |
| `docs/architecture.md` | M | `-257,6 +257,7` | 35938 / `0b9d84d28337c4a08071e1b8c62847a76fdec82f6733ddf1ec01c118677479a7` |
| `docs/decisions.md` | M | `-133,7 +133,7`; `-422,7 +422,7`; `-543,5 +543,9` | 147533 / `7d729e20cf112bc791729f6e238d923517e27a606f8726e4505e51ec9554c8b6` |
| `package-lock.json` | M | `-6765,6 +6765,29`; `-8770,6 +8793,23`; `-10532,7 +10572,8` | 361017 / `e14e5e616d19023c993f1f313759e4e1ea9699943f3d9d13b46ee5f740196188` |
| `packages/engine/package.json` | M | `-11,6 +11,7` | 362 / `c546d6a194ab158bec547f4db5b5cbff3a4e8785c10a9ca476044a51849e7781` |
| `packages/engine/src/invariants.corpus.json` | A | `-0,0 +1,58` | 1702 / `624564803a284eb3f0cdc5a385915ef850fe1ae2a5be936de4b75f2d6309f138` |
| `packages/engine/src/invariants.test.ts` | A | `-0,0 +1,188` | 6614 / `c3f65d7f42ec6c077a08790143ff78448fafeafe4fc90fd1eeab7aa1539244ac` |
| `packages/engine/src/invariants.testkit.ts` | A | `-0,0 +1,223` | 7217 / `97aba1dc67c5cf6460e6aa263f5e515473325acc04154aba8a0282325e1471b8` |
| `packages/engine/src/scenario.test.ts` | M | `-189,10 +189,22` | 14227 / `0bb35f49d49714a0ac9dc06b9140df20d9c9ab9021d5996d4ef3bc7c798447b9` |
| `packages/engine/src/scenario.ts` | M | `-266,6 +266,7` | 13254 / `89a0586279639d300782a09467a52ab83e03a5b0bd5e857bf26ec156e6d696cd` |
| `packages/engine/src/scenarios/holdTheBridge.ts` | M | `-64,6 +64,8`; `-75,6 +77,8`; `-86,6 +90,8`; `-97,6 +103,8`; `-108,6 +116,8`; `-119,6 +129,8` | 3658 / `25a29c4a95881ee13f92885a50f327476a66a7731c881fb32ae8d955796c12e0` |
| `packages/engine/src/standing.ts` | M | `-56,6 +56,7` | 6133 / `2e09a653661841f17582fa2e02b99210044efc2771fc7a28bf88cff7db7ad5c7` |
| `packages/engine/src/types.ts` | M | `-177,6 +177,8` | 15002 / `1123b0f95820b9be595c6f34c2ae6523946d635d11f536adc96766d756bec389` |
| `packages/engine/src/visibility.ts` | M | `-188,6 +188,7`; `-461,6 +462,7` | 27206 / `9f60c3b616939632d2333ea871ae970d63a1397c8d4d96892b9a1b01b4139ad3` |
| `packages/protocol/src/view.ts` | M | `-66,6 +66,8` | 6468 / `75343e3e629f0c97118e6bcdc7b8b81f7a2736a4c837ff2cad39cd56556f7eac` |
| `server/src/api/sideView.test.ts` | M | `-153,11 +153,16` | 5703 / `b0b1ac803a1462080f6b206bed7f2d790c259a476e5345fdadfb958164bb7e14` |
| `server/src/api/sideView.ts` | M | `-157,6 +157,7` | 8025 / `d31a212288a2e834d71c8a780dc8d92ac463f0bffa1fd39173a9c3eb58efb3ae` |
| `server/src/auth/auth.test.ts` | M | `-321,8 +321,10`; `-418,3 +420,23` | 17321 / `6a18c096c2036291a5e59a9db7c33f778eba453dec8edc87aee1c257c5bfe3dc` |
| `server/src/auth/guest.test.ts` | M | `-56,6 +56,7`; `-246,6 +247,57` | 13619 / `51a54b80fcd45b969aee4180fb998863e1bb769289feb2b17ffa0e3456560641` |
| `server/src/auth/routes.ts` | M | `-156,7 +156,14`; `-172,17 +179,18` | 10036 / `ef310bb1d994eca11bc44c6c6a8b7bc34d0bc142cb246077fe2a3cb2a98cd7d8` |
| `server/src/auth/store.ts` | M | `-32,9 +32,10`; `-58,7 +59,7`; `-116,14 +117,14`; `-193,7 +194,8`; `-226,6 +228,10`; `-301,20 +307,26` | 14732 / `aaa1f9fafd7837929c3617ca1b9d8420e223af6b7dfe3fcd194ffaf3bfef6c1d` |
| `server/src/game/actor.ts` | M | `-40,6 +40,7`; `-52,7 +53,6`; `-165,11 +165,11`; `-444,15 +444,19`; `-486,7 +490,8`; `-494,6 +499,20` | 50676 / `6feb0ec06f74b91e27f4e3c4633da592736f0c8fe433426a76bb031089be2de2` |
| `server/src/game/narrate.test.ts` | M | `-49,7 +49,7`; `-225,7 +225,7`; `-256,7 +256,7`; `-286,7 +286,7`; `-387,7 +387,6` | 17332 / `93ee7511f27dcf610834b860711fe9140f18c44a380bbfdefec1c87a18f53661` |
| `server/src/umpire/gameLimits.test.ts` | M | `-271,6 +271,7` | 12479 / `83cf68daff3f2b1cec87222586f2f00c985ae96e861b44c0fc3201faf42024ca` |
| `server/src/umpire/leak.test.ts` | M | `-32,6 +32,7`; `-114,7 +115,9` | 13322 / `0cb0bb796830dc6ed885af25760b87dbe7510cb1463a602b7166dc4bb2eba6a2` |
| `server/src/umpire/narrate.test.ts` | M | `-15,6 +15,7`; `-145,15 +146,104`; `-163,9 +253,12`; `-178,45 +271,34` | 14249 / `03f16c555f63b2691d7ee36c56818a36e28314c0b8277bc15f3374c6809de954` |
| `server/src/umpire/narrate.ts` | M | `-5,8 +5,8`; `-14,7 +14,7`; `-24,7 +24,7`; `-59,12 +59,14`; `-425,18 +427,55`; `-446,53 +485,105` | 20754 / `634aa86bb0a3f2be88df72eb84698b70303bea6f4297306341a3d288b8c2552d` |
| `server/src/umpire/staff.test.ts` | M | `-282,9 +282,43`; `-295,7 +329,10`; `-307,7 +344,7`; `-317,7 +354,7`; `-329,7 +366,7`; `-359,12 +396,42` | 18032 / `cb57182dcac07cd02803108e8e92d810533882b9ff7bc7df559d5c430ea74422` |
| `server/src/umpire/staff.ts` | M | `-257,7 +257,7`; `-270,6 +270,57`; `-366,11 +417,11`; `-412,6 +463,7`; `-441,7 +493,7` | 20411 / `d2235647647146d16b0d564417e6c300b83cec5b1e92786630984fbe71164bd2` |
| `server/src/umpire/testProvider.test.ts` | M | `-276,7 +276,7` | 17098 / `6f1f78f09fc5dab5109c2b1b7aea697cfc4bf95edbe6f2b777e4f31a52468e36` |

## Actual integration contracts and dependency intersections

Read H AGENTS/relevant decisions, approved Angular landing plan and pinned ledger. Relevant retained plan contracts: lazy development route bypasses Shell bootstrap/GameService/DeskStore/live MarksService/TableService; certified static default has full identity/NW registration; local presentation has stopped0 time and empty pieces/roster/papers; personal scope is fresh and private; certified FixtureTableScene stays distinct from live rendering; production compile-time exclusion/default assets/catalog proxy and native retirement/modal/input requirements remain. The ledger's c387/browser/history evidence is historical source context, not current-head/native-media acceptance.

Fresh lexical static traversal at H from development route, local-board component and map-table inspection component reaches **122 TypeScript modules**, zero unresolved inspected relative/alias imports or relative URL references. It follows `@legacy`, maps and protocol aliases. **116 modules are shared with B/I:115 object-identical, one changed: `packages/protocol/src/view.ts`.** No engine module, FlatBoardComponent or live `legacy/table/TableScene.ts` is in this closure. The six H-only feature modules are excluded from self-acceptance. This is lexical source dependency evidence, not a compiler/AST/emitted/browser equivalence claim.

Independently compared tracked inventories B/I: local-board29, map-table6, shared game-setup5, shared map-table4, legacy map-authoring39, maps105, local catalog tools7, data/maps4 and whole vendor166 are identical (**365 local prerequisite entries**). Legacy table33, shared UI4, shared styles3 and shell9 are also unchanged. Public protocol has12 entries, with only view.ts changed. Independently compared22 existing route/bootstrap/build/proxy/worker/default/renderer/manual-mark boundary inputs: Angular config, app routes/component/config/main, both proxies, client package/Vitest/app/spec/worker configs, root package, Dockerfile, three map-source/default scripts, FixtureTableScene/fixtureMarks and protocol common/marks/index; all unchanged. Lock changes are treated separately below.

No incoming code path overlaps H's A5 delta. Root's20 implementation bytes therefore have no incoming path overwrite or dependency adapter requirement from this packet; this statement does not independently review or accept those bytes or an uninspected provisional composition.

### FlatBoard, planned routes and optional trait

`FlatBoardComponent` still injects GameService/DeskStore/MarksService and builds from the live side view or post-game window. It is not the native local certified renderer. The change doubles the planned route's stroke multiplier2.5→5, adjusts dash lengths and adds an endpoint circle for planned routes only, under the same orders/routes overlay filtering. It does not change picker geometry, manual marks, order arrows or routing/provision of services. The retained public `OrderRoute` schema (`view.ts:121–128`) requires at least two points; unchanged sceneState maps those points through, and the post-game window scene supplies no order routes. Thus indexing the last point for valid wire routes has an existing cardinality contract; no required A5 adaptation is identified. Tests add marker presence/overlay-removal assertions, not real contrast/layout/keyboard or every malformed-state coverage.

Trait is optional in engine Unit, parsed from scenario strings, copied into own ViewUnit and optional protocol OwnUnit, then added to toSideView's ownUnits and rosterRows/title. Enemy view schemas receive no trait/name/commander extension. Existing own-unit role condition/date handling is retained. The shipped scenario adds names/traits on both sides; far-start derives the shipped units. The optional field does not change local bindings, stopped presentation, render-only marks, notes or certification. The protocol/index export graph gains no runtime import of engine/property code. Client roster freshness clamps its report date to the displayed clock and separates “just now” from “old”; this is an intentional live UI semantic change, not local personal-state behavior.

### Dependencies and engine/property boundary

Deep-compared lock JSON package entries: exactly two additions (`node_modules/fast-check`4.10.2, `node_modules/pure-rand`8.4.2, both dev=true) and the engine workspace devDependency addition `fast-check:^4.10.2`. Other package entries/top-level metadata are unchanged. Engine package.json agrees with the lock. No client/map/catalog runtime dependency or existing locked version is replaced. Root must use the new lock for fresh installation/checks; the 3d787 CI lock hash is not current-I evidence.

All new corpus/test/testkit bytes were read. The corpus has two entries (one expressly hand-written, one stated post-game delivery counterexample); properties cover chunked advancement, serialization/restoration, bounded rule checks, repeated-input determinism and sampled orders on two shipped scenarios. The check bounds/stop sampling and fixture command generation are explicit. These are finite authored property tests, not a proof of all engine/gameplay behavior; no property was run or accepted. The helper is not exported by engine index or imported by the local closure. The sole new standing runtime guard is `if (world.outcome) return { world }` at standing.ts59 before applying delivered intents. It affects actual live post-game delivery, not a local simulation path (A5 has none); outcome/order/replay checks remain required in the owning workflow.

### Auth/guest adoption and ordinary live boundaries

AuthStore's consumed token changes from an email string to `{email,guestId?}`; all production uses are in routes/store, with both Memory and SQLite implementations updated. The optional token guest id comes from server-resolved session user at POST login, never a client body field. Verify adopts only when the currently resolved guest id equals the token's guestId, then invokes the existing adoption callback and issues the account session as before. A same guest can still keep games when signing in; a link requested elsewhere does not adopt the receiving browser's guest games. A valid link still signs into the link owner account, so this is a bounded guest-transfer guard, not general login-CSRF/security acceptance.

SQLite adds nullable guest_id to schema and migrates existing token tables; old tokens with no guest id remain valid for account login but cannot adopt a guest. Single-use DELETE RETURNING and expiry refusal are retained. Read all auth/store/guest test hunks: both-store round-trip/single-use checks, old-schema migration and wrong/no-requesting-guest tests. Client auth/menu/guest endpoint payloads, redirect safety, guest creation/sliding sessions, lobby/invite routes and adoption callback contract are unchanged in this packet. Local route has no auth store/server dependency. No local API/client adapter is needed; root's actual same-browser guest-adoption/live preservation evidence must still match the composed source.

### Staff/narration changes and preservation limits

Staff v3 retains the requested officer role/view selection and adds optional fact quality checks (five-word repeats, filler and a name/id/bare count) with one retry. Count quality is deliberately loose; existing prose/hidden-term checks remain responsible for refusing invented facts. Test updates are scripted quality/fragment/retry/source-time assertions, not caller authorization or real-model evidence.

Narration v2 is materially rewritten: one report per short call, sorted by delivery time, at most the six newest by default; older reports keep templates. `NarrateResult.fellBack` now means any report fallback and required `fallbacks` lists per-report reasons. Actor now consumes partial successes/templates even when fellBack=true, adds trace fallback rows and uses a tracked timer/AbortSignal deadline so completed reports survive the deadline. The existing due-report visibility/window/barrier registration and abandoned-completion check are retained; calls are still recorded for the input log. The abort wrapper abandons the result, without passing the signal into UmpireRequest/provider transport, so underlying provider cancellation is not proven. The actor-close timer clearing/abandonment and late-provider settlement remain affected lifecycle checks; no local owner/session cancellation mechanism is shared with this server code.

Read changed narration, actor, limits, provider and leak tests. Mixed success, newest selection/delivery ordering, timeout partial results and templates have named scripted assertions. Actor timeout test removes its old assertion that narrationFor is undefined, consistent with now storing template/partial results. Existing maxCalls remains per report; call counts/budget behavior intentionally differ from the old single batch. No general narration/provider/timing acceptance is inferred from source tests.

## Root-owned documentation composition

Only `docs/architecture.md` and `docs/decisions.md` overlap H's delta. Architecture adds the property-testing paragraph; retain it alongside A5's local/native ownership, renderer and production-isolation text. Decisions changes D17c's requesting-guest adoption rule, staff prompt version v3, and adds staff-quality/narration-per-report paragraphs; retain all incoming content/history alongside H's active local **D36** and associated architecture/migration/guide references.

I has D35 for the incoming playtest/default-rate decision and **no D36**, so no new decision-number collision is present. Preserve D4's incoming D35 reference and historical references. Do not rename incoming D35 to satisfy local ownership. No Git merge/rebase/composition was attempted and no clean textual merge is claimed; root must review the actual composed docs and ensure its local references stay D36. The other33 incoming paths have no H path overlap.

## Earlier findings re-established at I

Changed source is not cleared or blanket-carried. Fresh bounded source evidence gives these dispositions, separate from A5 attribution:

- **Staff role-view P1:** hub.ts637 still calls answerStaff with side/requested role/question, not the requesting seat. Actor answerStaff section is B/I byte-identical (SHA-256 `4a07a0c6ce070e10fed000b26a45cb0a300fb5c49c03222c143919ed771670ca`). New staff.ts461–465 still chooses SEAT_FOR and viewForRole for that requested officer seat. Quality filtering narrows outputs, not input to the asker's authorization. No clearance.
- **Unusable staff call-record P2:** changed staff.ts still accumulates records at486 but returns undefined on UmpireError488/exhaustion503; actor.ts625 still logs `answer?.records ?? []`. The new quality rejection paths also use this same undefined return. Current changed-source boundary re-established; no durable-record clearance.
- **Narration retry privacy U1:** rewritten narrate.ts561 checks output with opts.hidden;568–569 keeps the diagnostic;531/539 sends it in the next request's rejected input. Unchanged leakGuard.ts43 returns the canonical world name, and actor.ts451 supplies world-derived hiddenTerms. A lowercase/Cf-separated guessed hidden name still results in a retry input containing canonical matched world spelling. This is confirmation/normalization to the model, not proof of an accepted hidden-name player dispatch. The new per-report flow does not clear it. Leak tests now pass hiddenTerms, but the adversarial retry exclusion remains; incoming narration tests inspect invented-id feedback/returned dispatches, not absence of canonical hidden terms in all retry inputs.
- **Combat P2:** combat.ts is wholly B/I-identical, SHA-256 `9acb7d21684e6817fa7f69cc0855a50dead9c50af31d73a5a20484269f631cdb`. Re-read evaluateVictory203–227, conclude324–333 and deadline532–539: before a declared pursuit closes, evaluateVictory can return null and the hold deadline substitutes defender objective-held; conclude only overrides withdrawn/eliminated reasons. The earlier constructed declared45/hold50/pursuit65 branch remains. New standing.ts59 operates only after outcome is already set and does not change that winner-selection branch. This is no clearance of that specific source finding, not an actual scenario-incidence/general combat verdict.
- **Trace P2 and lobby modal observation:** app/hub and lobby room/shared modal are object-identical B/I. Discarded tracing-wrapper upgrade rejection and absent room owner Escape/focus wiring remain the earlier bounded source observations, not new A5 regressions or runtime claims. Shared UI/styles/shell are unchanged, so this packet gives no new clearance for the older sticky-layout/browser qualification.

No repair or upstream follow-up mutation was performed. Passing prior CI, a hypothetical successful merge or old browser staging cannot clear these boundaries.

## Required affected checks and final handoff

Root may compose a provisional candidate using the immutable I packet. Required next steps are root-owned and were **not executed here**:

1. Review actual docs composition, retain D36/D35 boundaries, and bind new head/tree/base/merge-base/full inventory. Independently compare all20 implementation bytes against the accepted source checkpoint and retain G's independent source/effectiveness qualifications. New docs/media head needs the separate final review.
2. Fresh locked setup/install with the changed engine lock, root lint/typecheck/test/build and current-head ordinary/CI checkout/artifact inventory. Preserve map-source verification, local catalog and Angular/plain/worker coverage. Prior 3d787 green run is exact-H evidence only, not a composed-I result.
3. Target changed FlatBoard/roster tests, protocol/sideView visibility/type tests, scenario/standing/order/game-over/property corpus tests, auth/store/guest migration/adoption tests, umpire staff/narration/leak/limits/provider and actor narration/clock/replay tests. Verify actual discovered tests/skips; do not infer changed-source success from authored assertions. Property-test success would remain a bounded property result.
4. Actual composed-source ordinary auth/guest and live preservation: matching/requesting guest adoption to new/existing account, link from elsewhere/different guest, retained games/seats/lobby/redirect/session behavior, orders/manual marks/roster traits/planned route overlays, narration partial/deadline/templates/budget/close and staff fallback, clock/barrier at rates1/4/12/manual/fast-forward, replay and game-over/menu. These are owning preservation checks; no broad gameplay acceptance follows.
5. A5 native media/keyboard, actual desktop/narrow/modal/focus/typing/contrast/reduced-motion/resource/worker proofs and production local-route/default/catalog exclusion plus inspector gates remain separate and **unwaived**. This packet has no native setup/style/owner change, but source-only review never supplies that external media gate. Fresh remote head/base/main/mergeability and publication/ready/merge disposition remain root-owned; no network observation of moving main was performed here.

No A5 code adaptation is necessary from the inspected delta. Documentation composition and new-head affected validation remain necessary. No source/config/test/Git/PR mutation, check execution, network request, runtime/browser/pane operation or agent delegation occurred; sole writes are this report and the frozen copies/diff/manifest. Read-only Git/source/hash inspection was used as described above. Original reference dirty files and prior evidence were not touched.

Preserved earlier source-bound report SHA-256 values:

- `angular-a5-incoming-current-review.md`: `282898d01d645e52f0fc0bf1229b3f020b35ee1b7335a18564d47b7fcbe6d120`.
- `angular-a5-incoming-lobby-combat-review.md`: `a1b92ddfabf694a6733ba7e7a66409906815df335018b3adc458eadc379fb720`.
- `angular-a5-incoming-injection-review.md`: `107008bb357b8ded0d6c7d476a7705eeca98e0595b245778631bb9da7e8a90dc`.
- `angular-a5-3d787-ci-review.md`: `c75fa0eccb89fb689cc25e266fca36fcad0961a07d5d02e724c48129bd79d67e`.
