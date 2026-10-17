# R39 independent opt-in preparation offload review

**Verdict: Accepted at `d5b87b9531383f9f4ba37a3be89e92ce1ef85f05` as the bounded opt-in preparation verification dependency and lobby factory binding. No blocking or nonblocking source finding.** This does not accept the disjoint W16 consumer changes or whole-UI/browser/heap performance.

## Exact binding and complete coverage

- H `d5b87b9531383f9f4ba37a3be89e92ce1ef85f05`; tree `db8d6facf792970527860521b083087c5ffdb1cf`.
- P accepted R37 `f1f1b20701d6ba26e9fc056a1fa86fe40052d376`.
- Manifest `/private/tmp/lobby-map-preparation-offload-candidate.json`, SHA-256 `d6dcd7c89c156ea082ad09f396db827156d61e29947cb381c797b5952715a5b6`.

Verified actual Git H/tree/P/ref, complete five-path inventory, every manifest hash against Git and the scoped snapshot, and `git diff --check`. Read the complete delta, facade/helper/tests, post-await runtime/export/owner guards, existing preparation callers/contracts, accepted R37 candidate agreement/lifecycle and parent capability/factory binding. The five files are source-bound; the concurrent combined workspace is not identified as H.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/shared/game-setup/preparation.ts` | `43ba74fc8633c2a19f6a6b4790778e36774ba3af` | `fadeba1a20eab520135184f0049fbaeb938f7167e82c2f09b52235a18a008105` |
| `client/src/shared/game-setup/preparation.test.ts` | `ce919d94ddc30f3b6c6b3272ff9288320cd22049` | `d07587ac40f423e29d48e2b7283f4f31f667f4e4e48c5830e056aa73257b451d` |
| `client/src/shared/lobby-map-library/preparation-verifier.ts` | `c65bc038d32ff6b267c3f2ed346c89a08f4d256f` | `baefba253c20ba6786258a5d61ced1d8edb7f8dc8a5ccb79d92e63107d36dd67` |
| `client/src/shared/lobby-map-library/preparation-verifier.test.ts` | `a8edbbf4097864cd0acc4922773caec591a06782` | `4606ba967f0b8240812d7fad8226ef8f1ef44cfa78f6ce0fbd4d77a1a28e9438` |
| `client/src/app/shell/new-game.component.ts` | `ab8874165cc4c10059df692401a62dbcc7663148` | `978df91f4de80fdb2e021f51b2aa031299f426fbbbf0ba7e59b7521df88a3f78` |

## Boundary and implementation assessment

`createBoardPreparation` captures the optional trusted `verifyAsset(candidate, canonicalJson, signal)` function at construction. The ordinary local/dev path still requires the same canonical export equality and current full `assetIdentity(snapshot, 'asset')`; no default caller acquires worker verification implicitly. The opt-in path receives a detached runtime candidate and exact export text, awaits the trusted verifier, rechecks ownership, clones the returned asset and requires a full64-lower-hex identity. A verifier failure does not fall back to main-thread acceptance. This is a trusted embedding seam, not a validator for arbitrary injected verifier code.

The unchanged facade still owns current complete runtime certification and export/request association. After either asynchronous identity branch it requires the same active owner, live facade, ready runtime, matching runtime request ID, original exportAsset reference and original exportFiles reference. NW-zero/dimensions and saved-summary binding remain checked before publishing. The final board contains detached checked asset/reference/bounds and the original export JSON. Abort/replacement/disposal settle the facade operation, and retirement detaches resources before cleanup/reentrant successor allocation; a late verifier result or rejection cannot publish or retire its successor. No generation is introduced on saved loads.

The lobby parent changes only its preparation-factory dependency: `createBoardPreparation({verifyAsset: verifyPreparedLibraryAsset})`. Existing fresh-instance, owner/capability, pending-create, stale-render and selection boundaries remain. This does not change native create requests, permit saved geography to become playable or enable another availability policy.

The new helper preflights nonempty text, valid Unicode and actual UTF-8 under the64MiB ceiling, then computes SHA-256 directly over `TextEncoder` bytes of that exact text. It does not parse or reserialize the asset to obtain identity. Abort is checked before work, after digest and after verification. It passes the digest, text, candidate dimensions and optional candidate to the accepted R37 helper; that worker independently requires candidate canonical equality to the same text, exact canonical JSON/full hash, NW-zero/dimensions and current complete certification. The candidate is not silently replaced if inconsistent. The map schema/placement/certification policy itself is unchanged.

WebCrypto digest cannot be canceled here. A departed digest may finish, but its signal check prevents worker allocation; a late verifier result cannot publish. The facade's own abort/retirement provides operation cancellation while helper work completes. The helper alone does not promise prompt settlement if a deliberately noncooperating digest/verifier never resolves, and this packet does not establish a whole-preparation30s budget. Accepted R37's worker lifetime deadline begins when that verifier is invoked. Main still encodes/hashes exact bytes, clones the runtime candidate and the verified asset, and performs the accepted helper's bounded structural work; none is claimed constant-time, free or memory-neutral.

## Test effectiveness

The original preparation tests remain, including full-identity versus geometry, current certification/export agreement, saved reference/dimension/ordered override detachment, default-path stale identity resolve/reject, request replacement, reentrant factory/subscription/cleanup retirement and disposal. Three new facade cases exercise captured verifier invocation with detached actual controller export, failure without fallback and late result after abort/replacement without disturbing its successor.

The new helper cases exercise real WebCrypto full SHA equality and geometry inequality, exact five-field delegation to a trusted checker, changed candidate rejection, pre-abort, delayed noncancelable digest after owner departure with no verifier allocation, late noncooperating verification result, malformed Unicode/empty text and over-ceiling text. Their reference-asset checker validates import/canonical/full-hash/candidate agreement; it does **not** represent complete current certification or a real browser worker. R37's actual complete worker-handler cases establish that separate boundary. These tests are meaningful unit/lifetime checks, not browser integration/performance evidence.

The corrected new test expects `importAsset(json)` and asserts non-aliasing against the actual runtime export. Canonicalization can order the fixture differently from the unsorted source object, so that correction fixes the premise rather than weakening the production check. Existing expectations are unchanged in the inspected delta. The author correction is not counted as a red product-regression run.

## Independent checks actually run

Pinned Node v22.23.3 PATH, existing dependencies, no installs:

| Check | Actual result | Reviewer log |
| --- | --- | --- |
| Snapshot client `vitest run --configLoader runner --no-cache src/shared/game-setup/preparation.test.ts src/shared/lobby-map-library/preparation-verifier.test.ts` |38 tests /2 files passed | `/private/tmp/lobby-map-r39-review-tests.log` |
| Focused ESLint on all5 owned TS/test files (batched with R38 specs) | Passed | `/private/tmp/lobby-map-r38-r39-review-lint.log` |
| Combined-snapshot client `npm run typecheck` | Failed with2 disjoint W16 TS2322 diagnostics; not represented as green | `/private/tmp/lobby-map-r38-r39-review-typecheck.log` |
| Read-only Git-backed TypeScript app/spec/worker programs at exact H, no emit |0 diagnostics in all3 graphs; roots1/118/3,378 Git-backed files read | `/private/tmp/lobby-map-r39-review-git-typecheck.log` |
| Manifest/Git/scoped snapshot and diff whitespace | Passed | Tool output |

The failed ordinary command reports readonly prepared assets assigned to mutable MapAsset in `app/lobby/map-library/library-browser.component.ts:353` and `map-library-state.ts:296`. Independent comparisons prove both mutable files differ from H; neither is part of this packet. `shared/game-setup/contracts.ts` remains identical to H. No W16 repair or acceptance was performed.

To obtain source-bound type evidence without checkout or file edits, the separate Node/TypeScript check used an in-memory compiler host reading tracked client/packages/config source from H's Git blobs, filtered test roots to tracked H files and used the existing installed compiler/dependencies. It ran the same app/spec/worker TypeScript configuration graphs with no emit and zero diagnostics. This is a frozen-source compiler check, not a repaired or rerun-to-green mutable-snapshot command, Angular production build or browser worker boot. Author prior typecheck/build/root-suite claims remain separately attributed. No independent production build, format, full/root suite, remote CI, actual HTTP/browser/game or performance test was run.

## Release boundary and preservation

Accepted for bounded preparation dependency delivery. The disjoint nine-path W16 UI consumer work remains unreviewed, including the observed in-progress type errors. This source does not remove all duplicate browser/state verification, main-thread encoding/digest/clone cost or heap pressure. Actual Angular module-worker loading, owner cancellation, representative/near-limit long tasks, transfer cost and peak memory remain gates. Browser Start/create-to-live is still unverified under its existing approval boundary; no workaround was attempted.

Only the reserved R38/R39 reports were written. Historical reports remain unchanged. No source/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, branch publication/restack, merge or deployment occurred. Canonical HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`. Stop after this bounded packet.
