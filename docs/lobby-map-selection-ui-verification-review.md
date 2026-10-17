# R42 independent library UI worker-verification review

**Verdict: Accepted at `6e65771fe2f163aa1b5f58237affd3611237688f` for the bounded Add/browser verification integration. No blocking or nonblocking source finding.** Actual15km browser artifacts supplement the source evidence within their recorded scope; they do not establish a heap/long-task/performance guarantee or browser gameplay acceptance.

## Exact binding and complete inventory

- H `6e65771fe2f163aa1b5f58237affd3611237688f`; tree `28e101df665e4e8d991ae251f713d7572c435ef9`.
- P `5e3b4ca5092b905506783d915d29096410e0b460`.
- Manifest `/private/tmp/lobby-map-ui-verification-candidate.json`, SHA-256 `df1869fbacc8a0fa7d95087a8a84d0607ab1fea4ff2ccc2625cea3300a50d55b`.
- Handoff `/private/tmp/lobby-map-w16-ui-verification-handoff.md` was inspected, including intermediate failures and final logs; its conclusions were not used as independent proof.

Verified actual H/tree/P, complete nine-path delta, all manifest hashes against explicit Git/scoped snapshot and diff whitespace. The ref initially matched H and was subsequently rewritten by the coordinator; R43 covers that rebind. Read all changed paths/diffs, whole production state/browser lifetimes, new test checker/default token, relevant recipe/metadata/preview/history/focus contracts and accepted R37/R39 helper/facade boundaries. AGENTS, current decisions/log and approved design were read. No HTML/CSS, shared worker/HTTP/preparation, native registration or port change is part of this packet.

| Path under `client/src/app/lobby/` | H blob | SHA-256 |
| --- | --- | --- |
| `map-library/asset-verifier.ts` | `07e58d447e32414931f36fb1e0fa98c2f13ca2db` | `69b5223ce800a3448ddf4a8bf33413d9bb6d581e5645fd17d93b57cdc18827cd` |
| `map-library/asset-verifier.testing.ts` | `28d1f0e449f2d6d21e056f44185e8e433dd8e950` | `10048df5aab7ec1a94037a80d48f01f295557ab7b5d76259634672ec84e3ef95` |
| `map-library/map-library-state.ts` | `96f59baeb203bde91a27d47c85256005f4007cdb` | `652e345cd842594a884c34ad773ce5160b432f714e296a93926051eee51f4ce9` |
| `map-library/map-library-state.spec.ts` | `1c3a909fce84d9156ed5c0e682abbbb1d743b9b2` | `06fa5e3bbb0b915a12eada507e7e129482abaf60f9ca3d2daea41e3ee49531b4` |
| `map-library/map-library.component.ts` | `61b0bb5ce372cd0239223b330b7d25542b1e5732` | `3d7082b87fda198d3a59494177c068ee19c2d0bebb53a0683f769fa1e439285b` |
| `map-library/map-library.component.spec.ts` | `95dde9387a50c8cbb477f614858ca5dcd7e371bb` | `0a8dfa7e22b9451f5d4e64dcbe138adf195493c17df1942e8daa901062ef6728` |
| `map-library/library-browser.component.ts` | `0beb9f666bf7edbdfb39e0fe677502cc40a034e0` | `7af1c3effe7ef7cf20198b9f19375763be9f788719371e50b9b819f39ac40497` |
| `map-library/library-browser.component.spec.ts` | `eb414c5dacd9d0d07da5e2eebd085be856a11aa1` | `166c95d4658000afdd2c1c67ffedac3891b69f93db9ebf3bc37d8f8ee0c0733d` |
| `battlefield-map/battlefield-map.component.spec.ts` | `58d6df1e7aff27ee47d17336e932bac7778e46c1` | `3b6a22b3a886d0f12cc87a3cbc09eac1c73b10ac823d76ee142c9e11d2d98bfc` |

## Production boundary and lifetimes

The Angular root token defaults to the actual accepted `verifyLibraryAsset`; component/browser inject it. Portable state defaults to the same helper without requiring DI. Overrides are trusted embedding/test code, not port data or a public bypass. Production imports do not reach `asset-verifier.testing.ts`.

Generation detaches the prepared board, checks unsaved reference/NW/extents metadata, then awaits worker verification of exact canonical JSON, full identity/dimensions and the detached candidate. It cannot publish a board or allocate a generated preview before that await succeeds. Independent exact replay recipe, seed/settings/ordered overrides and result bounds remain checked afterward. The worker retains real candidate-canonical agreement and current complete certification; a type-only MapAsset assertion of an already-cloned readonly port value does not grant validity.

Save retains the immutable UUID/name/JSON/full-hash intent, accepted reference/summary/dimensions and exact readback agreement. Four-field readback verification is now awaited before completed/saved publication. Failure remains ambiguous and keeps the same intent/key; it cannot turn into a new save or allow edits that replace it. The same operation AbortSignal reaches preparation, port and verification. Every new await is followed by owner/token/active/signal checks. Final dirty callbacks can reenter replacement; saved output still requires current ownership.

Browser inspection verifies raw read bytes only after bounded text and exact selected source/ref/summary/full-identity agreement, and before allocating preparation. The unchanged in-memory ref adapter supplies premade/generated semantics only to the preparation port. After load, board bytes/identity/bounds/ref/summary still must agree, followed by candidate verification against those same read bytes. Only a current load can publish preview data. Source/owner/page/selection replacement, explicit retirement and destruction abort/release the same load; old results cannot create preparation, overwrite the same-row successor, dispose its resources or steal focus. Native modal/history and saved-heading focus ownership are unchanged.

State/browser no longer directly import or call `parseAsset`, `importAsset`, canonicalization or full asset hashing. They still clone/traverse metadata/recipe/candidate data, and browser still scans/encodes its bounded read. R39 retains exact UTF-8 WebCrypto digest and cloning in the facade/helper. Multiple independent helper lifetimes remain across HTTP, preparation and UI; this is not zero main-thread work or a concurrency/memory guarantee.

## Test effectiveness and independent checks

The new explicit test checker performs real import, exact canonical equality, full SHA/NW/settings/dimensions and candidate canonical agreement, with abort checks. It intentionally does not certify current generator support/complete topology. Returning the checked parsed candidate preserves the prior fixture ordering after exact byte equivalence; this is not unconditional acceptance. Actual current complete certification remains exercised by R37's handler tests and the real default helper, not by this reference-fixture seam.

Independent TypeScript AST comparison retained all660 original assertion expression statements across the four changed specs: state29, Add134, browser89, picker408. Added assertions total96; no old assertion changed. The26 new cases cover actual root default identity, controlled verification before board/preview/preparation/saved output, exact jobs/signals, rejecting checker faults, immutable ambiguous retry, and late output after owner/source/cancel/dispose/retirement plus same-row successor ownership. The picker spec changes only its explicit test provider/import. Raw meaningful red log shows the new Add test at old source receiving zero verifier calls (1 failed,42 filtered); this is inspected author red evidence, not a reviewer source mutation.

Pinned Node v22.23.3 PATH, SQLite Angular cache/2 workers, existing dependencies:

- Combined focused Angular run on room/shell and the four UI specs: **258 tests /6 files passed**, including the207 UI cases. `/private/tmp/lobby-map-r40-r42-review-angular.log`.
- Actual helper plus token/style tests: **63 tests /2 files passed** (58 helper,5 style). `/private/tmp/lobby-map-r42-review-helper-style.log`.
- Client/server typechecks both passed. `/private/tmp/lobby-map-r40-r42-review-typecheck.log`.
- Focused ESLint on all nine owned files and separate main/room paths passed. `/private/tmp/lobby-map-r40-r42-review-lint.log`.
- Read-only AST preservation comparison passed. `/private/tmp/lobby-map-r42-review-assertions.log`.
- Git/inventory/hash/diff checks passed; production test-helper import search found none.

The earlier W16 in-progress readonly/type errors honestly recorded by R38/R39 remain historical. This final typecheck passed; it does not rewrite those reports. Author's ordering-checker correction and intermediate8 failures remain in its handoff, not counted as reviewer executions. No independent full/root suite, production build, format, remote CI, actual browser/HTTP/game or profiler was run.

## Supplied bounded browser supplement

Read [final browser checkpoint](lobby-map-selection-implementation-evidence/final/README.md), source-binding/readback JSON and all three actual320/390 PNGs. README SHA-256 `188f9465d87fef61434d1d40eb7ee24fc4e5d6ed6c526a030fa6ccd9fbfd98e1`; source-binding `b81b1aaf29c880520fdf562d783552d5312ac7a4c4af0eedd87c747bbb555dbb`; readback `2bf51184a6bbe562e55d6b16e979fa78dd6bc785fa90de8be58dcd403a92a218`.

Coordinator reports actual isolated-origin Chrome15km Countryside seed17 generation/save through Angular module workers, real HTTP/server certification/durable SQLite, saved-heading focus and canvas inspection, preserving the original native parent selection. Readback records8678100 UTF-8 bytes/full identity `24dd102e722d5755303faaf257a033aa48c5413a1fe032c5e89dfe422b6da89b`, exact independent generated-byte comparison true; the earlier5km asset remains, with2 assets/2 operations/0 games/0 creation receipts. Source binding names post-fixture `0af4feaaa5d20c203546ed4a1bb86a292ea9e947` and a single concurrent shell-spec difference at that capture. R43 proves its product identity to H apart from the two accepted fixture specs. The API in that evidence used the task bootstrap, not the newly reviewed real-main process.

The reviewer visually inspected `320-large-unsaved.png`, `320-large-saved.png`, `390-large-saved.png`, respectively SHA-256 `1bc26cc175ec744a05d12206ebc5b20758f32dfd1ae2179eaf43cdb9cc3c480d`, `d4114d2e5be43ac04d3cd6b02ea86bdd37905730dbc0a31f4ee307fd4abb182a`, `d0631c801ef0962428f78f1a43263e2f872e00912fa6d8c8593931ff5ce0a172`. They show the15km draft/saved names, Needs a scenario, disabled Use and visible narrow footer controls. Static frames are scroll-position samples; they do not prove the full scroll/focus interaction, absence of every occlusion, peak memory or latency. The reviewer did not operate Chrome, query its database or independently recompute stored bytes. Runtime/focus/readback statements above are attributed coordinator evidence, not reviewer executions or cryptographic runtime attestation.

## Remaining gates and preservation

This is accepted source integration with a bounded real-browser supplement. No heap/long-task/frame-rate/near64MiB guarantee follows. Main-thread encoding, copies/shape checks and repeated full worker certifications still need representative measurement; default deadlines and cancellation have separate unit evidence. Room/live browser Start remains pending its existing approval, without workaround.

During review, a1158-blob comparison excluding `docs/`, root AGENTS/README matched post-fixture0af at that checkpoint. Later parent/shell bytes changed outside these nine paths; they are unreviewed W17 work, and the checkpoint is not a current whole-workspace identity claim. All nine scoped paths remained frozen at the last check. Historical reports are preserved. Only reserved R40–R43 reports were written; no source/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment occurred.
