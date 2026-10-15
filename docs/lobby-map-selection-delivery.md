# Lobby map implementation handoff

Implemented as independently reviewed **draft PRs**, not merged or deployed. Approved design chunks1–5 have product source and functional task-preview evidence. Browser game creation/live entry remains an explicit missing acceptance gate; generated-map scenario policy is the separate chunk6 follow-up.

## Try the task preview

Open [New game](http://lobby-map-347e7c.localhost:41564/?lobby=1). From a terminal in `~`:

```sh
open 'http://lobby-map-347e7c.localhost:41564/?lobby=1'
```

The original preview41930 is preserved. This task preview runs isolated snapshot source and a separate retained SQLite database. Both the original bridge battlefield and Open bridge approaches are selectable, with explicit candidate→Use confirmation. They retain authored armies/objectives and exact private native pins; generated library geography remains **Needs a scenario**, with Use disabled. Add generates, certifies, previews, names and durably saves maps; My maps reopens them. Nothing silently creates an empty sandbox or assigns arbitrary armies.

Back/menu/browser Back retain an owner-scoped ordinary setup draft within one Shell visit; full reload/auth changes reset that draft. Pending creation recovery remains separately authoritative. Rooms show retained public map/scenario identity before seating/invites and offer inspection without map changes. Existing guest/auth/invite/Ready/live/turn policy and accepted development-only local board remain preserved by the reviewed boundaries.

## Evidence and source

Final product **f8fb3e4bba04a384c593745fd95bf41dd51b39f1**, tree032539ae6158c945d2ec9b86ea30368573f8b13a, accepted by R45 on the accepted preceding packets. [All1160 product files match the task snapshot](lobby-map-selection-implementation-evidence/final/final-source-binding.json). [Complete154-path review attribution and final blob hashes](lobby-map-selection-implementation-evidence/final/review-coverage.json) identifies source review versus owner-approved design assets; it is not a new whole-product approval. Historical reports retain their exact heads; [R43](lobby-map-selection-fixture-delivery-rebind-review.md) independently verifies every rewritten delivery packet and its sole inherited fixture delta.

- [Real server, Back navigation and desktop/390/320 evidence](lobby-map-selection-implementation-evidence/final/real-main-and-back.md).
- [Actual15km generation/save/readback and responsive dialog](lobby-map-selection-implementation-evidence/final/README.md).
- [Earlier5km save, unsaved Back confirmation, keyboard preview and reopen](lobby-map-selection-implementation-evidence/library/README.md).
- [Curated candidate/confirmation captures](lobby-map-selection-implementation-evidence/curated/README.md).

The15km map is8678100 bytes, exact full SHA256 and byte-equal to independently generated canonical geography. Both saved maps survive switching the task API to actual compiled main and full browser reload. The task DB has2saved assets/2operations,0games/0creation receipts. Public terrain includes no units or private placement; a latest catalog is not a substitute for a retained game pin.

Final local lint/typecheck/build pass,944 Angular tests/53files and1247 framework-free client tests/66files pass. Earlier unchanged workspace checks pass engine528,protocol116,maps262,server1550(+3existing live-provider skips),repository52,catalog21,bridge23. These are scoped constituent runs; the earlier root npm-test run failed at legacy asynchronous fixtures before repair and is retained historically. Full repository CI executes the real Git-backed command. Existing CommonJS/jsdom canvas warnings remain. No assertion, seed, test skip or timeout was weakened to clear a gate.

[Current CI snapshot](lobby-map-selection-implementation-evidence/final/ci-status.json) and [remote head/base/tree audit](lobby-map-selection-implementation-evidence/final/pr-source-audit.json) bind the draft stack. Every base is an ancestor; potential merge trees equal head trees. Workflow checks explicitly checkout HQ_REVIEW_HEAD; final488 static job log confirms checkout of the exact reviewed head. Publication account is **dfezzie**, distinct from the independent reviewer.

## Focused draft stack in dependency order

| PR | Change | Head | CI at capture |
| --- | --- | --- | --- |
| [462](https://github.com/exterkamp/kriegsspiel/pull/462) | Describe the scenario battlefield for lobby map setup | `1d6fcb4b` | pass |
| [463](https://github.com/exterkamp/kriegsspiel/pull/463) | Show the battlefield map in New game | `5e8425de` | pass |
| [464](https://github.com/exterkamp/kriegsspiel/pull/464) | Define bounded native battlefield catalog transport | `97bed058` | pass |
| [466](https://github.com/exterkamp/kriegsspiel/pull/466) | Pin and resolve authored native battlefield assemblies | `2a71d553` | pass |
| [467](https://github.com/exterkamp/kriegsspiel/pull/467) | Preserve approved battlefield geometry and paint order | `e0644f57` | FAIL |
| [468](https://github.com/exterkamp/kriegsspiel/pull/468) | Retain native battlefield pins in game headers and replay | `6ddffa08` | FAIL |
| [469](https://github.com/exterkamp/kriegsspiel/pull/469) | Bind native actor recovery to the retained battlefield | `41b89ca0` | pass |
| [465](https://github.com/exterkamp/kriegsspiel/pull/465) | Allow account and lobby stores to share a SQLite transaction | `2cbfb79a` | pass |
| [470](https://github.com/exterkamp/kriegsspiel/pull/470) | Reserve pinned games with owner-scoped creation receipts | `9aee88ee` | pass |
| [471](https://github.com/exterkamp/kriegsspiel/pull/471) | Create and recover games with exact approved battlefield identity | `1fa53df6` | pass |
| [472](https://github.com/exterkamp/kriegsspiel/pull/472) | Preview and confirm approved native battlefield choices | `eb40829d` | pass |
| [473](https://github.com/exterkamp/kriegsspiel/pull/473) | Render verified game terrain across live map consumers | `6187fdcf` | pass |
| [474](https://github.com/exterkamp/kriegsspiel/pull/474) | Recover uncertain game creation through its original request key | `f49c6f53` | pass |
| [475](https://github.com/exterkamp/kriegsspiel/pull/475) | Store owned battlefield geography with bounded validation | `28011596` | pass |
| [476](https://github.com/exterkamp/kriegsspiel/pull/476) | Serve durable owned battlefield maps | `1cca1bd6` | pass |
| [477](https://github.com/exterkamp/kriegsspiel/pull/477) | Generate and save geography from the lobby | `d9751018` | pass |
| [478](https://github.com/exterkamp/kriegsspiel/pull/478) | Browse saved battlefield geography in Choose map | `0c37cc40` | pass |
| [479](https://github.com/exterkamp/kriegsspiel/pull/479) | Recover the same lobby creation across uncertain responses | `8eea8d64` | pass |
| [480](https://github.com/exterkamp/kriegsspiel/pull/480) | Preserve exact owned map identity over HTTP | `5c0f0e2a` | FAIL |
| [481](https://github.com/exterkamp/kriegsspiel/pull/481) | Connect the owned map library to New game | `555f1142` | pass |
| [482](https://github.com/exterkamp/kriegsspiel/pull/482) | Verify saved map reads in bounded browser workers | `59183765` | pass |
| [483](https://github.com/exterkamp/kriegsspiel/pull/483) | Verify lobby preparation through the asset worker | `62c03dda` | pass |
| [484](https://github.com/exterkamp/kriegsspiel/pull/484) | Offer the two reviewed native battlefields in New game | `5e91b6fb` | pass |
| [485](https://github.com/exterkamp/kriegsspiel/pull/485) | Show the retained battlefield in the waiting room | `be1b1a9e` | pass |
| [486](https://github.com/exterkamp/kriegsspiel/pull/486) | Await worker verification before library previews and saves | `0af4feaa` | pass |
| [487](https://github.com/exterkamp/kriegsspiel/pull/487) | Identify the lobby scenario and clarify preview keyboard help | `d6b1eafb` | pass |
| [488](https://github.com/exterkamp/kriegsspiel/pull/488) | Retain New game choices when returning from the menu | `f8fb3e4b` | pass |

All PRs remain draft. Final product #488 has all required CI checks passing on f8fb3e4. Required checks still fail on older drafts #467, #468 and #480 across the stack. No merge/deploy authorization is inferred from accepted source packets or later green descendants. CI snapshot timestamps/check links are retained in JSON; pending results remain pending at that capture.

## Boundaries and remaining decisions

**Browser Start approval.** Automatic approval review rejected creating the disposable task game before execution, treating the earlier design-only no-game restriction as still active. The specific isolated-game approval request is unanswered. No retry or API workaround was used. Consequently actual browser room/live create→start→reopen is not accepted; in-process API pin/replay/render tests and public runtime checks are separate evidence.

**Unchanged engine CI failure.** Draft480 fails application/check on a bridge attack counterexample (seed2065375889) with269mm movement in5ms. Draft468 has the earlier related589mm/11ms counterexample. The engine subtree e5c9063d791f451dfc120ec2de326ab2a557ccd6 is identical to main d82eec1 and final product. Exact counterexamples/reproduction artifacts are linked above; failures remain visible, with no rerun-to-green or unrelated engine change. Draft467 separately timed out waiting8seconds for the existing emergency-hold WebSocket pauseResult. Its test, API app, host and pause source are identical to main at that head; the focused current-integration test passes (1selected,81filtered), but the original CI failure is not reproduced or cleared. No timeout/assertion change or CI rerun was made.

**Performance limits.** Actual offered15km generation/save/reopen works, but available browser control does not expose heap/long-task profiling. No near64MiB responsiveness or peak-memory claim follows. Bounded workers, cancellation, identity and lifecycle rejection have separate automated evidence. Multiple worker checks and main-thread copies/encoding still have costs.

**Generated playability.** Curated native alternatives are implemented; canonical saved geography has no approved army/HQ/objective assembly. Chunk6 needs the material owner decision between an authored constrained scenario template and human approval of each pairing, followed by engine/content/playability evidence. It does not block inspecting/saving maps or choosing approved curated maps. Import is deliberately deferred, as allowed by the design.

**Resolved routine refinements.** Successful Save opens/focuses My maps directly; Add remains available to make another. Back from dirty Add uses the accepted explicit Keep editing/Discard confirmation rather than keeping a hidden generated-board cache across subviews; Keep editing retains the draft and selected playable map. No full terrain editor or automatic scenario switch is introduced. Library ownership is private with existing guest adoption/expiry; immutable game pins remain independent of library lifecycle.

Detailed ownership/process/check history: [execution log](lobby-map-selection-execution-log.md). The protected checkout and41930 preview retain their original source; all new product changes are retained as Git commits and draft branches, with task-only runtime source under /private/tmp. Do not restart protected previews or discard the preserved task database when continuing.
