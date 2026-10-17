# R36 independent bounded library attachment review

**Verdict: Accepted at `929e6595975ae9ec220a0e4340ee3d98661bfe27` for the capability-gated lobby library attachment. No blocking or nonblocking source finding.** This accepts the bounded attachment and R34 rebind. Main-thread verification performance, actual worker-helper integration and browser Start/create-to-live remain separate gates; this is not final whole-product acceptance.

## Exact binding and complete inventory

- H `929e6595975ae9ec220a0e4340ee3d98661bfe27`; tree `d4802ea163f9b91a81278703448d30c5bd6e8d03`.
- P `52e00f32087132d3d1759648e518d8d1a0128c7c` (accepted unused R35 worker helper).
- Manifest `/private/tmp/lobby-map-library-attachment-candidate.json`, SHA-256 `bd0aa754408c80ffaeab390a0b95640ed0b4ea12e98c932699388ea75ad8bab6`.
- Accepted parent-recovery source used for independent delta comparison: `190fac0c59a0e858435322b9eb0c51628bced3a4` (R34).

Verified actual Git H/tree/parent/ref, the complete four-path P..H inventory, every manifest SHA against Git and the scoped snapshot, and `git diff --check`. Both decoder blobs are exactly R34; the parent contains the accepted R34 repairs plus the attachment-only diff independently inspected against R34. The new commit is not identified as the old R34 commit.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/app/shell/new-game.component.ts` | `07731c803a76cdc1dc6b1731d901e077c7427ece` | `44870338c4c37bccb282a800d8303895142fba9ae9654c98328698f08d704e1e` |
| `client/src/app/shell/new-game.component.spec.ts` | `36a567a62c1a98a7b25f5a19c6dea2f5097f5389` | `02484bc5389150e5f6fc71f2549d3913ba2fc1f595f8d570235152838462e0f2` |
| `client/src/legacy/shell/pendingCreation.ts` | `9c4e4833b3a88473677caf8232e1ebda5d274ff1` | `d85dbf1d8c4f6769031849ae3b4d26b5b5c9a58a09594bf82bd6ab3535a8e575` |
| `client/src/legacy/shell/pendingCreation.test.ts` | `0ea9843121c03c6a540c46d15a39fc59b4540076` | `c00429b8593a34f5325f7734a4bf9b4585118e34b4a8f1eb1cb42b36b4d98000` |

Read the complete P..H delta, the attachment-only R34..H four-path diff, current parent and decoder, added tests and relevant surrounding callers. Boundary reads included `battlefield-map.component.ts/.html`, `map-library.component.ts`, `map-library-state.ts`, `library-browser.component.ts`, `shared/lobby-map-library/http.ts` and `shared/game-setup/preparation.ts`; these seven snapshot files were also compared byte-for-byte with H. Accepted R18/R31/R32/R33/R34/R35 reports, AGENTS, decisions and execution-log context retain their original scopes. No whole-snapshot compilation/source identity is claimed.

## Source and test assessment

The parent passes a real HTTP library port only when a current nonempty authenticated owner ID exists and the decoded server option is exactly `mapLibrary === true`. Missing/false capability or missing owner supplies neither library nor preparation factory. The computed port is stable until its dependencies change and is replaced across owners; it performs no operation merely by construction. The server still authorizes each operation. This is capability use, not a client assertion of durability or authority.

The passed preparation function creates a fresh existing `BoardPreparation` each time. The child retains its established retirement/disposal and operation ownership responsibilities. There is no import of `verifyLibraryAsset` or `asset-check` by application code; R35 remains unused. Neither the default preparation algorithm nor HTTP verification policy changes in this packet.

`loadedOwner` synchronously distinguishes the owner whose form/catalog is loaded from a newly replaced input. Both the map-opening callback and Start reject the stale rendered owner's actions before `ngOnChanges` acknowledges replacement. Owner acknowledgement clears the former form/options/pairing/pending/error state and captures a new load epoch. Prior loads and create results still require matching epoch/owner and a live component before publishing. Replacing library/preparation inputs causes the existing child to retire its active library/Add lifetime, invalidate stale output and unwind its native modal/history through the established child logic. Pending creation, starting and corrupted recovery also close the map-entry gate.

The R34 changes remain intact: an ambiguous retained request survives retry-storage failure with its exact key/lock; every present storage record, including an empty string, is decoded or blocks recovery; valid pending intent is restored before catalog loading; Retry remains available without a current catalog/scenario; visible deadline/mode/request agreement is strictly decoded. No new native create semantics are introduced by the attachment-only diff. Native committed pairing remains the source of playable creation; owned geography remains inspection-only and cannot replace that pairing. Legacy request shaping remains unchanged.

Added parent tests verify capability absence/false and missing owner, different port identity after owner replacement, distinct preparation instances with disposal, and the before-change-detection stale-owner callback/Start guard. The latter actually replaces the input, invokes the old rendered callback and clicks Start before stabilization, asserting no create and no retained request under either owner. These are meaningful parent-binding tests, using an explicit map fixture. They do not themselves test browser modal/focus or actual HTTP durability. The focused six-file run also exercises the real child, library state/browser and shell through their existing tests; decoder tests exercise actual untrusted retained values.

## Independent checks actually run

Pinned Node v22.23.3 PATH; snapshot `client/` except root ESLint. Angular used `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`.

| Check | Actual result | Reviewer log |
| --- | --- | --- |
| `ng test --watch=false` including shell new-game/shell specs, battlefield-map spec and all three map-library specs |248 tests /6 files passed | `/private/tmp/lobby-map-r36-review-angular.log` |
| `vitest run --configLoader runner --no-cache src/legacy/shell/pendingCreation.test.ts` |14 tests /1 file passed | `/private/tmp/lobby-map-r36-review-decoder.log` |
| `npm run typecheck` | App/spec/existing-worker checks passed | `/private/tmp/lobby-map-r36-review-typecheck.log` |
| Focused ESLint on the four changed paths | Passed | `/private/tmp/lobby-map-r36-review-lint.log` |
| Git/manifest/scoped hashes, R34 blob comparison, boundary-file identity and diff whitespace | Passed | Tool output |

The248 count includes the new stale-owner regression beyond the coordinator's earlier247-test run. Typecheck sees combined snapshot context and does not accept disjoint server/client work. No independent format, production build, full-root suite, remote CI, managed-runtime request, real browser interaction or actual game creation was performed.

## Supplied visual/readback evidence and its limits

Read all eight canonical PNGs under `docs/lobby-map-selection-implementation-evidence/library/`. Desktop and390/320 captures show Add generation/name/unsaved states, geography preview and saved My maps inspection. Saved entries and inspection explicitly say “Needs a scenario”; Use map is visibly disabled. Narrow captures retain readable copy and visible footer actions, with tall content scrolling/clipped inside the modal viewport. No screenshot-visible attachment/style blocker was identified. Static captures do not independently establish keyboard focus, touch behavior, exact overflow geometry, history restoration, save requests or reload persistence.

Evidence hashes (SHA-256):

| PNG | SHA-256 |
| --- | --- |
| `desktop-unsaved.png` | `966a1c1f35c87d24a228b89f48fdd0b60a4ae0f8c57952b88bef3d3a5ead25d2` |
| `desktop-saved-inspection.png` | `28ea127f2b082ce8258aaba6557934e81d49bedc3a6751340878b45500a71a47` |
| `390-unsaved.png` | `bf382c85f7eba8e8dc707818f477029a820eaa599bffba0ddc136a1518526272` |
| `390-preview.png` | `c63c52591e11b674411848c6986e118d771bb8529becd717022a144fc8bb051b` |
| `390-saved-inspection.png` | `56c146510ff9fb64d290e41d85d451308fa9bec2c82d881b7bd50f5822da3254` |
| `320-preview.png` | `408bc8e927063270fa4de9f61e0e585612817358250ed5873f0d0bbb17d8cc64` |
| `320-unsaved-back.png` | `c2ac1f8d8fb6015e777c66ec6dcfa9b1727626bb7f8e06605eeb30a929cb2fcc` |
| `320-saved-inspection.png` | `1ecfbf4cbacf0650cf56a71e8115dd616880bed2850cc094b0cd1331ce410669` |

Read `/private/tmp/lobby-map-browser-library-readback.json`, SHA-256 `029eb7b98ea2e791059f59f37f1a58fcd224b2b39d30a83d5841b2bd3bd60c73`. It records owned asset `5b05b386-4f40-4321-9cc2-15e4e2f93a5d`, name `Lobby countryside review`,5000×5000m,1598509 bytes, full identity `6305b91faa19915eeea48e0bb473d900415ff00584fce318866d4e79e883926a`, `hashMatches` and `exactDeterministicGeneratedBytes` true; counts1 asset/1 operation/0 games/0 receipts. Coordinator reports actual isolated-origin Chrome generation at seed17, save, saved-heading focus at390/320, cancellation restoring the default/Add opener, full reload/list/read persistence and independent raw-byte comparison. Those are attributed coordinator observations, not reviewer browser/DB executions. The reviewer did not query the live database or independently recompute its bytes. These external artifacts are not part of H's four-path Git delta, and their historical runtime source attribution comes from the coordinator rather than a full-snapshot identity proof.

## Remaining gates and preservation

This attachment still uses the existing repeated main-thread import/canonical/full-hash verification paths. The5km capture/readback does not measure long tasks, near-limit allocation or10/15km responsiveness. R35's unused verifier does not resolve that gate until its consumers are separately integrated and actual bundled-worker/browser measurements pass. Saving geography does not create armies/objectives, authorize arbitrary placement or make it playable.

Browser Start/create-to-live remains unperformed and pending the existing approval gate. No workaround, managed server/browser/game/process/pane control, source/test/config/Git edit, agent, external message, merge or deployment occurred. Only the three authorized R35/rebind/R36 reports were written in this task sequence. Historical R33 and R34 report hashes remain respectively `509ec66a00a1afa0392bd8793f966b18a96c8123a3ce0cf74f6963c6a52587dd` and `0d05a41f647ffa8e4fe99adc982c6f8b0a28d8416bf24dc47ef9797eff879753`. Stop after this bounded packet.

Final preservation check: all four R36 scoped snapshot files still match the manifest. The three separate W12 verifier snapshot files have changed externally since R35 inspection/checks; their later bytes are unreviewed and do not change this attachment verdict. See the explicit drift notice in the R35 report. R36 checks use combined compilation context and do not accept that new helper source or any future wiring.
