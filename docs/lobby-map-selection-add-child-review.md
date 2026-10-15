# R26 independent portable Add geography child review

**Verdict: Accepted at `578d2146f6777ff9b6a454152b425430bd9d991a` for the bounded portable child/state dependency, with nonblocking N1 below. No blocking source finding.** This accepts neither W9 picker attachment nor durable library implementation/capability, real generation/save transport, physical preview/layout or playable-map readiness.

## Exact binding and complete inventory

- H `578d2146f6777ff9b6a454152b425430bd9d991a`, tree `39592c5836c2c899687395693263c8770ef44267`.
- P R25 transport `9e4d437ca2e296b917d7ca330a889504c16a73f9`.
- Manifest `/private/tmp/lobby-map-add-child-candidate.json`; handoff `/private/tmp/lobby-map-w8-add-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified actual Git H/tree/parent, complete seven-path delta and every manifest/Git-blob/scoped-snapshot SHA-256. Read all six new child/state source/template/style/test files and the port. Also inspected existing BoardPreparation contracts/implementation, replay-parameter parser, map preset/asset import/canonical/full-hash boundaries and preview ownership; these surrounding preparation/preview/config paths match H. Author handoff assertions were checked against source/tests, not accepted as evidence by themselves.

| Path | SHA-256 |
| --- | --- |
| `client/src/shared/lobby-map-library/contracts.ts` | `bc0c8873aef2633897ba810d019a33e9e61e29e1b1f5d738208b12a764d8a215` |
| `client/src/app/lobby/map-library/map-library.component.ts` | `a41c9c2b8071e6fdba9de97500eb3e529738c2d7d0157b68a3d74146d5b6aded` |
| `client/src/app/lobby/map-library/map-library.component.html` | `9ac983866fa182585439d93e34a9760fdde021db2b614ff9b1fb3f54db63bd88` |
| `client/src/app/lobby/map-library/map-library.component.css` | `6d40ede4042e3d159ce07621302ec684fda1b367011675db1dfc3939a0e0ddb6` |
| `client/src/app/lobby/map-library/map-library.component.spec.ts` | `fc7c9139bc083783f23511be78fc05077303453a8779cd1fc3e16adb4ae4c60e` |
| `client/src/app/lobby/map-library/map-library-state.ts` | `53c59a691d2ed26f7c1abd89356863757bb460889fd882aa0fed70b7ef354fae` |
| `client/src/app/lobby/map-library/map-library-state.spec.ts` | `80e6cbcf9cbd00ab2689946e91bbd4b83796701bc3ea621ed7bcd16d4258b724` |

### Port semantic rebind

Accepted R18 document remains SHA-256 `9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`. Its accepted port was SHA-256 `a092029d36ce1392d0df585393aa485704d40d3778a25d6cc68fcfc85a1f1c76`.

Independently reconstructed that exact old byte sequence in memory by replacing only the current formatted `list` declaration with its previous single-line spelling; the reconstructed SHA-256 equals the accepted R18 hash. Thus the new port hash above is accepted by verified whitespace-only identity, not a false claim that old and new hashes match. Pagination source/signal/cursor and `{items,nextCursor?}`, read/save fields and geography-only status are unchanged. No port or contract was edited by this review.

## Source and test assessment

- Inputs are explicit BoardPreparation/MapLibraryPort plus optional complete recorded recipe; generation occurs only on action. Defaults are Countryside5km. The custom recipe remains fully represented, including seed/settings/ordered overrides; size changes only dimensions, while a landscape change explicitly adopts that preset's settings. No local catalog, native dialog, history, game/session creation or selection channel is introduced.
- The returned preparation result is detached and checked against canonical bytes, full asset hash, exact recipe, dimensions/bounds and unsaved reference. Current complete certification remains the injected BoardPreparation's authority. The child does not infer playable approval from generation or implement another placement/certification engine. Display name is separate metadata; the certified asset bytes are preserved.
- First Save captures one UUID/name/bytes/full hash. Failure/abort ambiguity locks edits and retains that same intent. Successful metadata must be owned, bounded and allowlisted, with matching identity/name/dimensions/status; exact readback reference/metadata/bytes and recomputed full asset hash are required before a detached saved output. A known accepted reference cannot silently change on a readback retry. Duplicate save/output is guarded. No Use/Start action exists, and saved geography remains Needs a scenario.
- Current operation/owner/token checks invalidate late preparation/save/read/hash completion on cancel, discard, destruction and input replacement. Preparation disposal ownership is explicit and one-time; a disposed preparation is not silently reused. State tests cover synchronous dirty/abort callback replacement so an old close cannot retire a new owner. Preview instances have separate one-time ownership, retry and destruction handling, including a resource returned after synchronous destruction.
- requestCancel immediately aborts work and asks before discarding dirty state; ambiguous-save text correctly says discarding does not delete a possibly saved map. Keep editing preserves the candidate/key and returns focus. The parent must route every exit through this method and retain modal/history/final focus ownership until cancelled. Inline confirmation and parent-form Enter containment are tested. These are portable ownership boundaries, not native-dialog/browser proof.
- Styling uses tokens,44px controls, wrapping text, a narrow single-column layout, expanding scroller and separate footer with safe-area allowance. Preview has keyboard/pan/zoom/fit instructions. Actual parent dimensions, footer placement, touch capture and accessibility in a native modal are not established by source or jsdom.

## Nonblocking finding

**N1 — Repeat-this-map controls are not collapsed.** The approved design calls for Map number under a collapsed Repeat this map disclosure. The template currently uses an always-visible fieldset. Use an accessible initially collapsed disclosure when completing attachment; no new owner decision is needed. Current tests assert the labels/presence but do not check collapsed behavior. This does not block the portable state/port dependency, but should be resolved before final integrated UX acceptance.

## Independent checks actually run

Pinned Node v22.23.3, snapshot `client/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2 node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include=src/app/lobby/map-library/map-library.component.spec.ts --include=src/app/lobby/map-library/map-library-state.spec.ts
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/styles/design-system.test.ts --no-cache --configLoader runner
```

**46 Angular tests /2 files and5 token tests /1 file passed.** The independently executed client typecheck during R25 also passed app/spec/worker compilation with these exact R26 files present; it was one invocation, not an additional R26 run. Nine preparation/preview/config/style dependencies were compared with H. All seven scoped hashes were rechecked after tests and still matched. Angular's existing splitting/experimental SQLite notices remain. No independent lint/format/production build/full-root/CI/browser run was performed.

Tests use ordinary injected preparation/library/preview doubles and real reference-asset canonical bytes/full WebCrypto hash. They effectively check exact identity/readback, invalid candidate/metadata/name rejection, stable retries, no duplicate emission, cancellation/replacement/reentrant ownership, form containment, focus and cleanup. They **do not** establish actual complete-generator results, durable saves, authentication or transport. Reference150m fixtures are not evidence for real5/10/15km generation or large-asset responsiveness. Main-thread cloning/import/canonical/hash/preview work still needs representative measurement with real prepared assets before public capability attachment; no responsiveness or memory-performance pass is claimed.

## Handoff and limits

W9 picker attachment is disjoint and unreviewed here. It must supply a current preparation with exclusive disposal ownership and a reviewed library adapter, route cancellation/history/focus correctly and preserve the New game draft. Public Add/save remains gated on initialized durable reviewed storage, transport and exact-source integration/browser evidence. No arbitrary geography becomes playable; native pairing and game creation stay separate.

Only this exclusive R26 report was written. R24/R25 have separate verdicts and prior reviews remain unchanged. No source/test/config/contract/Git mutation, managed server/browser/game/pane control, new agent, external action, merge or deployment occurred. No whole-snapshot identity is claimed. Browser Start/create-to-live remains pending approval. Review stops after R24/R25/R26 as requested.
