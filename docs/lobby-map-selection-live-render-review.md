# R20 independent live-render consumer review

**Verdict: Changes needed at `7886d4b65513875dd81b4b3e6ed7c9844c8b0c12`. One blocking lifecycle finding, B1; one nonblocking test-effectiveness finding, N1.** The renderer consumers correctly use checked public terrain rather than fixture fallback. The loading gate still needs failure cleanup before this packet is accepted. Physical rendering/browser/create-to-live acceptance is not established.

## Exact source and complete coverage

- H `7886d4b65513875dd81b4b3e6ed7c9844c8b0c12`; tree `14434e28ec51dc40788ecbb4640f38e180307428`.
- P `11e1b631a77307c7d08d23de4e33e3b5d66eb6ba`.
- Manifest `/private/tmp/lobby-map-live-render-candidate.json`; handoff `/private/tmp/lobby-map-w6-consumers-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; scoped execution source `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Independently verified actual Git H/tree/parent, complete13-path delta, and all13 Git-blob SHA-256 values against manifest and snapshot. Read the complete product changes and changed tests; handoff conclusions were not treated as proof. Complete inventory:

| Path | SHA-256 |
| --- | --- |
| `client/src/app/game/flat-board.component.ts` | `68ad85247f53fdef68d1ec4cef44308c3ab6213eec0c916ad91e5e8d3a6594a1` |
| `client/src/app/game/flat-board.component.spec.ts` | `93b54e0b2bbe44a6cca904e471357b1efab3a132ea172b70f5525431ccdaaa30` |
| `client/src/app/game/table-host.component.ts` | `5ddea8bf0d22a91b69a91644a9e985315d4892350f0d793afa4b2951b50e9c84` |
| `client/src/app/game/table-host.component.spec.ts` | `8201c390900fa007a6db37cfae6c595094ef6c3bc069d2edc9a646f20aa4b24d` |
| `client/src/app/game/marks.service.ts` | `1545c32ca816de16817a4baae1fd3390062067b7c324c1b83ecd9492e74a4f0b` |
| `client/src/app/game/marks.service.spec.ts` | `891947afd1116800627a0631a3a50bb0975abf9dadbcb73e07d298ca1d28bc13` |
| `client/src/app/game/table.service.ts` | `3145024f2703070764b4a4955198bb4822d815b3cdcdec25ceaa029f72d0f930` |
| `client/src/app/game/table.service.spec.ts` | `abcfe3e6f508b38a4f178bae7570cbd4f88b1c5e9d2292518683a95eb2d4b5e0` |
| `client/src/app/game/game.service.ts` | `0a05606779609f5d876248109b006d7124d02166e5779df04dc3bdeb26726401` |
| `client/src/app/game/game.service.spec.ts` | `b19d78cee5bbecc40aaeb3d1d727432fed2547043caa9db16323834dbc67e5a7` |
| `client/src/app/game/game.component.ts` | `9ba63e284b72249e73ce0fdbbd1abe71e3c0fb288702b773ae1859799300891f` |
| `client/src/app/desk/fake-game.ts` | `7a973aa82c703cd14fdcb1d30364cbfa15f2db5e10884d6c929db02fea057729` |
| `client/src/legacy/lobby/api.ts` | `c41f945f20fe3fb8582700fada89d61492e424c05e74a93b0d9691ed37b898a6` |

Also inspected surrounding GameComponent hot-seat/lifecycle, unchanged game/HUD specs, fetch helper/decoder, public adapter/order, TableScene apply/start/dispose, scene/window builders, flat-board geometry/picking and GameConnection. Fourteen named runtime/test/config dependencies, including these core paths and Angular/TypeScript config, matched H in the snapshot. The mutable parent/API/library work is outside H; no whole-snapshot identity is claimed. Native High is packet-supplied; no pane/settings operation was performed.

## Blocking finding

### B1 — Failed parallel loading leaves its sibling request alive without a deadline

`client/src/app/game/game.service.ts:88` starts terrain and game-info loads under one AbortController with a30s timer. If either rejects, the catch at line120 clears the visible map and stops the connection, but does not abort the controller. The finally at line132 immediately clears the timer even if the sibling request is still pending. Promise.all does not cancel that sibling.

Independent in-memory source probe supplied an immediately rejecting terrain loader and an abort-aware, otherwise pending info loader. After the error state settled: map was undefined, loading false, error nonempty, **the sibling signal was not aborted and there were zero remaining timers**. It stayed pending until explicit disconnect, which then aborted it. No network, WebSocket or browser was used. The symmetric first-failing-info case has the same catch/finally structure.

**Required repair:** abort/retire the current loading operation on failure before removing its deadline, without allowing stale completion to affect a successor. Preserve the established successful socket lifetime: its callbacks currently share the request signal, so blindly aborting every successful load would disable messages. Add permanent regressions for both first-failure directions with a still-pending sibling, plus deadline/disconnect cleanup and a successful stream remaining live. Keep readable error/Retry and no-map/no-socket behavior. This is a loading-resource defect; the probe did not find terrain published after failure.

## Nonblocking finding

### N1 — One inherited start-failure test now passes before invoking start

Unchanged `game.component.spec.ts` case “disposes a half-built scene when start() throws” supplies only `start` and `dispose`. The new host calls `setGlide`/`apply` before start, so this fake now throws at missing `setGlide`; its disposal/fallback assertions pass without exercising the named start failure. Complete the fake and require start to have been called. This is nonblocking because the new dedicated TableHost suite uses a complete fake, throws from its start and explicitly verifies that call and disposal. No assertion or fake was changed by this review.

## Positive source/test findings and boundaries

- GameService synchronously clears prior map/view on live entry, fetches checked parent-bound terrain before socket creation, cross-checks game/scenario settings, advertises capability1 and uses visit identity plus AbortController for same-game reconnection and stale callbacks. Fixture terrain is explicitly offline only. Loading/error/Retry presentation exists. Disconnect stops listeners/socket and invalidates the old visit; B1 concerns the failed-load branch, not that explicit cleanup.
- Flat board derives extent, styling scale, scene/window positions, summary and picking from the checked map. Native millimetre points, widths and radii remain exact, including explicit layer0; round native caps and inherited legacy appearance are distinguished. The accepted adapter supplies final paint order. Keying SVG lifetime by map object and checking rendered identity rejects old-SVG events before replacement rendering; glides do not cross map lifetimes.
- TableHost constructs only after canvas render and checked map availability, applies the map before starting, preserves one scene across ordinary view/desk updates, and owns disposal on replacement/destruction. Missing views clear pieces. Empty-map pointers/resize cannot act on the prior scene. The map-linked TableService handle synchronously revokes direct HUD camera access before effects dispose resources. That bounded service exception is necessary for direct consumers, not an unrelated renderer rewrite.
- Marks use current dimensions for tolerance/minimum stroke distance. Map replacement resets drafts/selection and event-entry checks cancel stale gestures, capture, pending click and old report context. No-map mutation and live mark completion in the read-only window are blocked. Cancellation retains unfinished note text; cleanup and current window picking are covered.
- The13-path packet includes the explicit shared test-fake update, so the earlier disjoint fake incompatibility is not hidden here. W6 tests use asymmetric8000×3000 maps, exact0.001m geometry, real pure picking and supplied render-state assertions. Recording scene fakes establish calls/ownership, not real GPU projection or pixels. Service tests inject transport results; their success fixtures intentionally bypass real decoding. The separate fetch/adapter tests below exercise those boundaries. No current test covered B1.
- `fetchGame`/join advertise capability1; optional signal/credentials are forwarded for game metadata. The existing component hot-seat metadata fetch is separate from the service gate. Ordinary GameInfo remains a cast rather than a new strict complete metadata schema, and multiple metadata GETs remain; this packet is not a claim of a consolidated response validator or HTTP performance measurements.

## Independent checks actually run

Pinned Node v22.23.3, snapshot `client/`, Angular cache `NG_BUILD_CACHE_STORE=sqlite`, workers2:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2 node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include=src/app/game/flat-board.component.spec.ts --include=src/app/game/table-host.component.spec.ts --include=src/app/game/marks.service.spec.ts --include=src/app/game/table.service.spec.ts --include=src/app/game/game.service.spec.ts --include=src/app/game/game.component.spec.ts --include=src/app/hud/hud.spec.ts
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/legacy/lobby/api.test.ts src/legacy/lobby/battlefield.test.ts src/legacy/table/battlefieldMap.test.ts --no-cache --configLoader runner
```

**81 Angular tests /7 files passed;59 framework-free tests /2 files passed.** There is no `legacy/lobby/api.test.ts`; that filter selected no file, and no third suite is claimed. From snapshot root, pinned `npm run typecheck -w client` passed app/spec/worker checks. Angular emitted the existing deprecated splitting notice and experimental SQLite warning. Manifest/blob/snapshot/dependency comparisons and `git diff --check P H` passed.

Additional inline Node/assert checks used in-memory TypeScript transpilation: Angular injection with controlled promises/timers confirmed B1 and explicit-disconnect cancellation; an injected-fetch-only API probe passed encoded game URLs, capability query, exact credential/signal forwarding and join method/body compatibility. No probe edited product/tests or made a network request. The author's181 integrated result is separate evidence, not counted as this reviewer's execution. No independent production build/lint/full-root/CI or browser run was performed.

## Handoff and limits

Repair B1 before accepting the live-render packet; N1 should be corrected with the next relevant test edit. Prior pure schema/native/adapter/fetch/picker coverage carries only at its recorded revisions/verified unchanged dependencies. This report does not accept disjoint parent integration, API receipt activation, public alternative availability, storage/Add, or whole-product completion.

Physical canvas/SVG alignment, real pointer capture/camera behavior, desktop/narrow layout and WebGL fallback still need exact-source browser evidence. Actual browser Start/create-to-live approval remains pending; neither previous chunk1 captures nor these jsdom tests establish it. No workaround or managed game was created.

Only this exclusive R20 report was written. R18/R19 have separate verdicts; historical reports remain unchanged. No source/test/config/Git mutation, managed server/browser/game/pane control, new agent, external action, merge or deployment occurred. Stop after R18/R19/R20 as requested.
