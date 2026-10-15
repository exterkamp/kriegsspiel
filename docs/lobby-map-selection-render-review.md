# R9: independent pure public render-adapter review

**Verdict: Accepted at H for the six-file pure adapter/paint-helper packet. No blocking or nonblocking source finding.** This accepts transport-to-render conversion, ordering and canvas-call behavior at the exact revision below. It does not accept live map composition, flat-component wiring, alternative availability or physical raster/browser fidelity.

## Exact revision and complete inspected inventory

- Actual manifest/Git H: `89eaab162ca15f7a218e709a5b0176d4c10f28c1`.
- Tree: `182f97df919d81c00ce9b4201895ce98d1e07aed`.
- Verified parent P: `c4a3bf221e28b42b2bb8a92cbf069c3966e412ba` (accepted R7 native prerequisite).
- Ref: `refs/heads/feat/lobby-map-render-adapter`.
- Manifest `/private/tmp/lobby-map-render-candidate.json` and handoff `/private/tmp/lobby-map-w2-render-handoff.md` identify the same six frozen client paths/hashes. Independently verified H/tree/parent, every manifest SHA-256 against its H blob, all six snapshot files against H, and the complete six-path P..H inventory. No other head was reviewed.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Accepted protocol97 and native R7 source are carried unchanged: P..H has no `packages` or `server` delta. Contract SHA-256 rechecked as `e0e950d00e53c7ed88d290f62023fb496483f0eae5c1fd317ee9c3cc6ed989e6`.

All six paths and their full tests/diffs were inspected from explicit Git objects:

| H path | H blob |
| --- | --- |
| `client/src/legacy/table/types.ts` | `c0c1e03e6f69b3d53a1ac7986818dd918376e557` |
| `client/src/legacy/table/mapTexture.ts` | `df2c638d95d26cd62e0674bf1298d566a40aeeab` |
| `client/src/legacy/table/paintOrder.ts` | `3d053e341fdd9a50b2a1de8b01e84e9559f85f39` |
| `client/src/legacy/table/paintOrder.test.ts` | `dcecba2c94867306c7fddaf885b464906993ff5e` |
| `client/src/legacy/table/battlefieldMap.ts` | `c0db8446076e842fb755b704a2ba1361953804dc` |
| `client/src/legacy/table/battlefieldMap.test.ts` | `5d16b0c306350092edfa105c32f1c60c58c3cda8` |

Surrounding inspected source includes the accepted protocol decoder/budget boundary, engine terrain coverage and layer/ID precedence, table fixture, existing scene/flat-board tests, `flatBoard.ts`, `TableScene.ts`, scene-state construction and `flat-board.component.ts`. The snapshot's tracked engine/protocol source and those named client dependencies/configs were compared with H. Four native product dependencies used by the independent descriptor probe—pin implementation, registry and both retained authored definitions—also match H; mutable native test files were excluded.

No complete snapshot identity is claimed. `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` also contains disjoint coordinator auth/intent work and W3-owned native tests, outside this H. R7/R8 report hashes were independently rechecked unchanged. Native High verification is supplied by the packet; no pane operation was performed.

## Implementation assessment

**Runtime boundary and privacy.** `battlefieldMap(value: unknown, parentScenarioId: string)` invokes `decodeApprovedBattlefield`, including its resource preflight and independently supplied public-parent binding. It does not call only a raw Zod schema, derive the parent from the payload or accept a private world as transport. Invalid descriptors throw; no fixture substitution or fallback approval is introduced. The module imports public protocol and local render types/helper only. Its returned map enumerates rendering fields and carries no units, HQs, objectives, gameplay attributes, assembly snapshot or private metadata. Schema/digest syntax remains distinct from authoritative registry approval.

**Exact geometry and detachment.** Conversion preserves NW-origin metre extents, axes, IDs/kinds, explicit layer zero/negative values, point radii and full polyline widths. It creates fresh feature/geometry objects, point arrays and coordinate objects; changes in either direction do not affect the other representation. `paintOrder` itself returns a fresh array of the same feature references, as documented; detachment belongs to the adapter. `battlefieldPoints` serializes validated numeric coordinates directly, preserving millimetre values such as `0.001` and `2050.123`; it is a serializer for validated render geometry, not a separate untrusted-input decoder. It does not change the existing rounded label/legacy serializer.

**Order and transitivity.** The helper's effective order is a lexicographic tuple: effective layer ascending; implicit before explicit at equal layer; reverse code-unit lexical ID for explicit ties; original index for remaining ties. These keys are consistent across comparisons. In particular, interleaving an implicit marsh with explicit `a`/`z` at layer1 cannot produce the comparator cycle that mixing pairwise native-ID and insertion-order rules would cause. Validated native descriptors have finite bounded layers and unique IDs. Engine precedence is highest layer first and lower lexical ID first; painting ascending layers and reverse IDs puts that same winning feature last/on top. No locale-dependent comparison is used. Fully implicit legacy fixtures preserve the original kind table and insertion ties. The mapTexture re-export preserves the prior import surface.

**Canvas behavior.** `drawMap` consumes the shared helper without a subsequent kind sort. Explicit-layer polylines use `width * scale`, points use `radius * scale`, and layer zero does not select legacy behavior. Native round line caps and the existing round joins match the engine's distance-to-segment/full-width coverage convention. Implicit legacy lines retain butt caps and the two-pixel visibility clamp; legacy points retain the two-pixel radius clamp. Colours, backgrounds, decorative outlines, texture sizing and other existing drawing behavior remain unchanged. Canvas API calls establish geometry and style arguments, not antialiasing, physical pixel coverage or subpixel visibility.

**Compatibility and current callers.** `BaseFeature` changes only by adding optional `layer`; existing implicit fixture producers remain valid. The existing Three.js texture path reaches `mapCanvas(map)`, so it can respect explicit layers when later given adapted geometry. The new adapter and SVG serializer are not yet connected to GameService or a flat component. The inspected flat component still owns `fixtureMap`, rounds terrain points through `pointsAttr` and styles feature caps as `butt`. Those unchanged paths must be deliberately integrated for native terrain; this packet does not claim they already satisfy the modern rendering contract.

## Test effectiveness and independent checks

The new tests have meaningful premises: coherent foreign-parent rejection, strict field/identity/mm rejection, accessor rejection without invocation, every geometry variant detached in both directions, explicit layer zero/negative/custom ordering, reverse ID ties and mixed legacy/native ties. Drawing tests invoke the actual `drawMap` implementation with a recording context and inspect stroke-time widths/caps, arc radii/positions and fill order. They detect width/radius halving, native two-pixel inflation, axis changes, kind re-sorting and layer-zero truthiness mistakes. Legacy clamp/outline assertions remain concrete. Existing scene and flat-board tests are unchanged by Git content.

The descriptor fixture explicitly uses syntactically valid synthetic digests; passing it does not prove a server-approved assembly. The separate real-registry probe below addresses source-level native geometry agreement. No reviewer source mutation or independent red run was performed, and author build/lint/format reports are not counted as independent runs.

Pinned Node **v22.23.3** was used. From snapshot `client/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/legacy/table/battlefieldMap.test.ts src/legacy/table/paintOrder.test.ts src/legacy/table/scene.test.ts src/legacy/table/flatBoard.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.app.json
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.spec.json
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.worker.json
```

**54 tests / 4 files passed. All three non-emitting client typechecks passed.** The existing scene suite emitted jsdom's optional-canvas `getContext()` not-implemented messages and passed. No canvas dependency was installed or test/config changed. Those scene cases do not provide a raster oracle; the new recording-context tests supply the drawing-call assertions. Typechecks cover the current snapshot compilation units, not a claim of whole-tree identity or review.

Manifest/source/dependency comparisons and `git diff --check P H` passed. One initial read-only dependency inventory used the nonexistent name `fixtureMap.ts`; it was corrected to the actual `fixture.ts` and the comparison passed. No product failure or source repair resulted. No independent build, lint, format, full-root suite, CI, browser or physical raster check was run.

Additional inline Node/assert probes imported matched source using in-memory TypeScript transpilation and wrote no fixtures/source files:

- **504 ordered mixed triples passed** against an independently expressed tuple ordering, with repeat-sort idempotence and frozen inputs. Cases include explicit negative/zero/layer1 values, implicit field/wood/marsh and lexical/numeric-looking IDs.
- **40,320 permutations passed** for eight equal-layer explicit features: every permutation produced the same reverse lexical order. This probes input-order independence, including case and punctuation comparisons; it is not an assertion that every helper-only synthetic ID is accepted transport.
- **Five parent/current legacy draw comparisons passed**, at scales `0.0001`, `0.01`, `0.512`, `1` and `2`. The parent implementation was read from P and transpiled in memory; recorded fill/stroke geometry, colours, widths, caps and joins for the unchanged fixture were identical. This is call-level legacy appearance evidence, not a screenshot comparison.
- **Both registered native definitions passed source-level world/adapter comparisons.** A trusted in-memory test registry enabled the default and Open bridge solely for the probe, without changing availability anywhere else. For each resolved pin, every adapted feature matched the loaded engine geometry converted from mm to metres, including extent, kind, layer, full width and radius; SVG point serialization matched the numeric geometry. Bridge-centre top feature agreed with engine terrain precedence, and a foreign public parent rejected. No API, actor, game, model or browser was opened.

## Bounded release and remaining gates

Accept H as the pure public render-adapter/shared paint-order dependency. No repair is required for this packet and no new ownership release is issued by this report.

Later integration must provide an independently known public parent ID, keep returned terrain order through both painters, use the exact terrain SVG serializer, match native cap semantics, and load the verified pinned map before interaction. GameService, flat-component, WebSocket/capability, fixture replacement, room/window/picking/marks and replay/create alignment remain separate coordinator gates. Canonical geography remains unpaired; the alternative remains unavailable by default. No live renderer or physical raster acceptance follows from these pure tests.

Only this exclusive report was written. Source/tests/config/Git, servers, browser, panes, permissions and prior review reports were not changed; no agents, external actions, merge or deployment occurred. R5's owner-pending real-browser Start-to-live gate was not retried or worked around and remains outside this acceptance.

## R10 append: exact renderer restack rebind

**Disposition: prior bounded R9 acceptance carries unchanged to `e0644f57194e5610b0efe5da3e7029d0f8dcea98`. No new renderer finding.** Restacked tree is `db37052f5bd0e340c028551608aa4c74523dc245`; verified parent is native-regression H `2a71d553c92560c3b596ecc7ccb1df3a34aaa23d`, tree `7ffa96fc5343ccd71e9acfc657af0230030f9090`. Manifest: `/private/tmp/lobby-map-render-restacked-candidate.json`. The original R9 source/check record above remains bound to old H `89eaab162ca15f7a218e709a5b0176d4c10f28c1`; its retained ref `refs/lobby-map/reviews/render-89eaab1` was verified to resolve there.

Independently verified the restack's H/tree/parent and complete seven-path delta from its native parent: exactly the original six client paths plus this completed R9 report. All seven manifest SHA-256 values match their H blobs. The completed pre-append report in H has SHA-256 `79f5899a240e3cac1b32ffbc2e6610645926c16ba2cecac90380bbd34f9b7ecb` and matched canonical bytes before this authorized append. The appended record itself is a new review output, not falsely attributed to that frozen H blob.

All six renderer file hashes/blobs listed above are unchanged. More broadly, old and restacked heads have identical complete `client` tree `2b3d81cf9949c7f4af82168657e6df37cebe1052` and `packages` tree `7d8b3d9b8ff95ba988599abdf5d7d98999637523`. The complete old-H..restacked-H inventory contains only `native-scenario-pin.test.ts`, new `native-scenario-replay.test.ts`, execution log, completed R7 report and completed R9 report. Production native dependencies and root/client configuration are unchanged. Six scoped snapshot renderer hashes also match; no full-snapshot claim is made.

The new native-test ancestry was independently reviewed and run: **33 tests /4 files and server noEmit typecheck passed** at its exact native H; see [R10 native regression review](lobby-map-selection-native-tests-review.md). R7-N1/N2 are addressed by those permanent tests. The original R7/R8 reports remain unchanged. `git diff --check` passed for both native and renderer bounded deltas.

R9's54 focused tests, three client typechecks and ordering/legacy-draw/native-world probes carry only by verified source/dependency identity; no new client test/build/browser run is claimed for this append. All earlier limits remain: no actual service/flat-component/WS/fixture wiring, availability, physical raster or live-browser acceptance. In particular the owner-pending browser Start gate was not retried or worked around. No source/Git/config/server/browser/pane mutation, new agent, external action, merge or deployment occurred. Only the authorized R10 report and this append were written.
