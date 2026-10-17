# R7: independent native content, pin and registry review

**Verdict: Accepted at H for this bounded internal prerequisite. No blocking finding.** The retained authored definitions, strict private codec, identities and cached default-only resolver meet the accepted contract at the revision below. Two nonblocking regression-coverage findings remain. This verdict does not release alternative-map availability or establish complete chunk2/chunk3 acceptance.

## Exact binding and inspected inventory

- H: `c4a3bf221e28b42b2bb8a92cbf069c3966e412ba`.
- Tree: `247ce1e6249d24880fa6aa660af813d7c77ce541`.
- Verified parent P: `97bed058c3214d103539f80859b91dcc84dc02b5` (accepted public schema).
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.
- Manifest: `/private/tmp/lobby-map-native-candidate.json`. Independently verified H/tree/P, the complete ten-path P..H inventory and every listed SHA-256 against the corresponding Git blob. All seven native server files and `docs/decisions.md` match their frozen snapshot bytes at the checks.
- Accepted contract SHA-256 independently rechecked: `e0e950d00e53c7ed88d290f62023fb496483f0eae5c1fd317ee9c3cc6ed989e6`, with the recorded depth-32 / 65,536-value clarifications. Approved UX design, canonical AGENTS, D41/D43 and candidate D44 were inspected alongside the execution log and prior schema review.

Complete delta, inspected from explicit Git objects:

| Path | H blob |
| --- | --- |
| `server/src/game/native-scenario-pin.ts` | `ad9ae1b36de598759bd6260b3eb1c442c9377cd6` |
| `server/src/game/native-scenario-pin.test.ts` | `f5873081944e1c7a2b3ff80a04e6a9f05919364d` |
| `server/src/game/native-battlefield-registry.ts` | `8f835eb199fcf3ad51937ea487cab0510ecd0016` |
| `server/src/game/native-battlefield-registry.test.ts` | `095c739f5cece471840c5c84407bafd9b6727d60` |
| `server/src/game/native-scenarios/default-bridge-v1.ts` | `e9cb18943fb782f4e3461d3ce977675c0a6d917f` |
| `server/src/game/native-scenarios/open-bridge-v1.ts` | `2611fa9656e8d023898529069c14d1be88940999` |
| `server/src/game/native-scenarios/open-bridge-v1.test.ts` | `07c96bb0c460ad0e1a010b1f662b23062037102a` |
| `docs/decisions.md` | `396a5175db6cdc1a00c82300b29015370a5f133a` |
| `docs/lobby-map-selection-schema-delta-review.md` | `a7a3d88df500d22e01e78052af5a2f7418e25808` |
| `docs/lobby-map-selection-execution-log.md` | `1ae914f62469322fea22950de91781ef2ecdd0a7` |

Surrounding source inspected: engine `scenario.ts`, `formation.ts`, geometry/terrain/types and relevant movement/order/combat behavior; server `game/battlefield.ts`, `game/registry.ts`, `game/replay.ts`, `game/advance.ts`, replay-test context and `orders/orderParser.ts`; accepted protocol catalog schema/budget wrappers. Verified the snapshot's complete tracked engine/protocol source and named server `battlefield.ts`, `registry.ts`, `replay.ts`, `advance.ts`, `turns.ts`, Vitest config and tsconfig against H. New pin/registry imports do not wire into a live API or existing scenario registration.

No whole-snapshot equality is claimed. W2's mutable client table work and coordinator-owned auth/store, lobby/store and shared-database test work are outside H and this review. The snapshot was used only with the scoped comparisons above. No server game, HTTP create, browser, pane, Git or product source mutation was performed. This report is the sole new output; previous reviews remain unchanged. Native High verification is supplied by the packet, not independently established through pane control.

## Source assessment

**Strict raw input and bounded work.** `parsedRaw` runs the accepted iterative JSON resource gate before Zod cloning. The raw schema rejects unknown fields at every declared object boundary, nonfinite values, coercible strings, off-mm positions/lengths and unsupported geometry/collection sizes. It deliberately supports a bounded subset of native authored input. Bounds include two sides, 128 units, 64 shape points per unit, 16 depots per side, 128 terrain features, 1,024 points per geometry and 4,096 terrain points overall. The placement estimate includes shape/centre and footprint checks plus HQ/depot samples, rejecting above two million estimated terrain-point checks before loading. This is a conservative bounded-work gate, not a measured runtime guarantee for arbitrary admitted scenarios.

The actual engine loader then validates terrain attributes/kind applicability, unique identities, side/type/formation consistency, map bounds, footprints/overlaps, passable placements/HQs and the bridge-centred victory objective. It receives validated raw native input rather than serialized engine state. No repair, fallback, coordinate rounding acceptance or client-provided assembly conversion was added.

**Redundant pin agreement.** Durable decode first budgets the entire private pin, strictly checks its envelope/version and public descriptor, budgets/validates raw input, and rebuilds the time-zero world through `loadScenario`. Canonical equality rejects altered or extra world fields. Rebuilding the expected pin then checks all public geometry, parent/resolved IDs, scenario/terrain/pairing digests, flags and outer pin identity against the same raw/world assembly. It returns the rebuilt detached value. Although loading happens twice during decode, the input and work are bounded; ordinary registry resolution clones cached validated pins rather than decoding/reloading each request.

Checksums establish content agreement, not authorization or a signature. A fully self-consistent newly authored pin can be constructed by trusted server code; later create/recovery integration must still use the authoritative resolver and immutable accepted pin/record bindings. That distinction is explicit in the tests and accepted contract.

**Identity and renaming.** Canonicalization sorts object keys recursively and preserves array order. Scenario revision hashes the complete loaded pre-runtime world; terrain identity hashes complete engine terrain, including attributes absent from the preview. Modern pairing revision binds public/resolved scenario IDs, scenario revision, terrain identity, assembly version and logical map/pairing IDs. Display renaming preserves pairing identity but changes the full private pin checksum because that pin also preserves public display metadata. Array reordering remains identity-sensitive even where gameplay might be equivalent. No legacy revision alias is accepted as a modern selection revision.

**Public boundary and compatibility.** The projection enumerates geography fields explicitly: feature ID/kind/name/layer, metre geometry, bounds and public identities. Private units, HQs, objectives, intel, traits and terrain gameplay attributes are not spread into it. The default modern map and scenario revision match the prior default projection; the modern pairing revision is intentionally different. Existing `scenarioList` and legacy metadata remain unchanged. These are pure projection checks, not new end-to-end per-side API/stream privacy acceptance.

**Retained content.** Both raw definitions are detached retained JSON, independent of a future mutable default. The Open bridge input's tested JSON SHA-256 is `9d9fe71d6eb1ddedcc38d38ba0d185064af5a5c7b0ba94adb93e397e5da18339`. Loaded-world comparison preserves the default exactly, changing only the resolved scenario ID and omission of `north-wood` and `south-wood` for the alternative. Armies, formations, seed, HQs, objective, river, road, bridge, extents and asymmetric crossing coordinates are retained. This is an explicit authored native variant; canonical generated/included assets remain unpaired.

**Availability, cache and failures.** The registry validates/caches both definitions at construction, requires the original default, rejects unknown trusted enablement IDs, and returns detached catalog/pin data. Default construction publishes only the default and refuses the known alternative as unavailable. A trusted test composition can enable both; no request controls that option. Invalid selection shape/revision, unknown pairing, foreign scenario, stale revision and unavailable pairing have distinct error codes. No API effects or new alternate public registration exist in this packet. Shared long-lived composition and transport error/status mapping remain later integration work.

## Findings and test effectiveness

**Blocking findings: none.**

**R7-N1 — nonblocking: retain meaningful logged-order regressions in the repository.** `open-bridge-v1.test.ts` completes/replays six cases with an empty input log. Those cases principally exercise the automatic hold deadline; they do not demonstrate delivery, movement, combat or replay of accepted orders. Their winner assertions establish neither AI competence nor balance. The independent six-case logged-order probe below supplies stronger current functioning evidence at H. Preserve an equivalent checked-in regression when completing chunk2's headless/replay coverage, with nonzero delivery/arrival/combat premises and a JSON-decoded pin as replay input. No actual server games are needed.

**R7-N2 — nonblocking: make native rejection tests target the validation gate they intend to protect.** Current decoder placement negatives alter raw input but leave the stored world unchanged and generally use `toThrow()`. They can remain green through redundant-world mismatch detection even if an individual placement check regresses. The native suite also lacks direct assertions for its terrain-point and estimated-placement-work ceilings. Source inspection and independent creator/budget probes below confirm the gates at H. Add direct `createNativeScenarioPin` negatives asserting engine placement/HQ/objective errors and explicit point/work-budget errors to retain that protection. Existing shared protocol resource tests remain relevant but do not substitute for native aggregate-work regressions.

The current tests otherwise exercise useful contradictions: resealing the outer checksum does not hide mutated loaded state/public metadata; JSON round trips and caller mutation check detachment; renaming, legacy projection preservation, version/unknown-field rejection and default-only availability have concrete assertions. No reviewer source mutation or independent red run was performed. Author-reported build/lint results and retained development failures are not counted as independent reviewer checks.

## Checks actually run

All executable checks used pinned Node **v22.23.3** in `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`, with the frozen-source comparisons above.

From `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/native-scenarios/open-bridge-v1.test.ts src/game/native-scenario-pin.test.ts src/game/native-battlefield-registry.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**22 tests / 3 files passed; non-emitting server typecheck passed.** Focused tests were independently run twice without an intervening R7 source change; both passed. `git diff --check P H` passed. No independent full-server/root suite, build, lint, HTTP, browser or AI run was performed. The noEmit check sees the current snapshot compilation unit, including disjoint coordinator files; it is not a claim that those files belong to H or have been reviewed.

Additional inline Node/assert probes used source imports with in-memory TypeScript transpilation and wrote no fixtures or source files:

- **14 cases passed:** raw scalar no-coercion/unknown-field/off-mm/nonfinite rejection; 5,120 terrain points reject at the native point gate; a 4,096-point/64-unit/8-shape-point input rejects at the placement-work gate before engine placement; accessors reject with zero getter calls; recursive key reordering preserves identities/readback; unit ordering changes scenario/pairing revision without changing terrain; feature ordering changes terrain/pairing identity; unit-strength change changes scenario revision without changing terrain. The retained default pin serializes to 8,995 UTF-8 bytes. This is size evidence for the current definition, not maximum-load certification.
- **3 direct creator checks passed:** impassable unit placement, impassable HQ and a non-bridge objective each throw the actual engine `ScenarioError`, with respectively `units[0] has a position on impassable ground`, `sides[0].hq must be on passable ground` and `victory.objective must be centred on a bridge`. These do not rely on stored-world mismatch.
- **6 logged-order completion/replay cases passed:** both retained definitions at seeds 1815/17/97. Pins were created with the test seed and JSON-decoded before initialization; these test-seed variants were never registered. At game time zero, logged Blue `blue-1` and Red `red-1` hold orders target the bridge `(2050000,1500000)` mm, and Blue `blue-3` moves toward `(1000000,600000)` mm. Direct `applyLoggedOrder` + `advanceUntilOver` was compared with `replayLog` from a separately decoded initial pin, using the same `startingState` hook. Complete engine state and emitted event sequence matched; every case had deliveries, arrivals, combat fire and an outcome by 60 game minutes. No parser/model/actor/HTTP call was made.

| Definition | Seed | Delivered | Arrivals | Combat fire | Emitted events |
| --- | ---: | ---: | ---: | ---: | ---: |
| Retained default | 1815 | 3 | 4 | 3 | 19 |
| Retained default | 17 | 3 | 4 | 29 | 56 |
| Retained default | 97 | 3 | 3 | 35 | 52 |
| Open bridge v1 | 1815 | 3 | 4 | 9 | 35 |
| Open bridge v1 | 17 | 3 | 4 | 11 | 37 |
| Open bridge v1 | 97 | 3 | 4 | 11 | 39 |

All six finished at 3,000,000 ms with Blue winning. That is the observation for these fixed orders, not a balance conclusion. The first reviewer inline attempt failed its own event-count assertion because it requested `order.delivered`; the engine event is `order_delivered`. Correcting only that probe label produced the six passing cases above; no product code was changed or failure hidden.

## Release boundary

Accept this exact internal native content/codec/resolver packet as a dependency. No source repair is required for R7. Preserve N1/N2 as bounded test improvements when completing chunk2; they do not authorize ownership changes or release a new writer.

Keep the alternative unavailable until chunk3 verifies actual accepted-create pin persistence, receipt transactions/recovery, authoritative membership, lobby/log agreement, legacy/new-format handling, all replay/reopen consumers, capability gating and exact live/postgame rendering. Do not infer any of those capabilities from this pure registry or headless probe. API/receipt/storage/replay-service/render wiring and the disjoint shared-database prerequisite are outside this verdict.

R5's real-browser Start-to-live gate remains pending owner approval following the earlier automatic approval rejection before execution. This review did not retry it, open games or use an API workaround. Prior R1–R6 reports and the distinction between packet acceptance and whole-product completion remain intact. No merge, deployment or external publication was performed.
