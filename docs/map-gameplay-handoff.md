# Standalone map-to-gameplay handoff

M3c exports a public static `MapAsset`; it does not implement a playable generated scenario. Keep battlefield generation, scenario assembly, simulation, visibility and player rendering as separate boundaries. The asset/query APIs below are available; a scenario conversion API is not currently exported. This document defines downstream adapter responsibilities; current standalone acceptance evidence is in the [verification report](map-verification-report.md).

## Existing asset and query boundary

`@kriegsspiel/maps` is browser-safe and independent of engine master state, protocol, clock, LLM, Three.js and the player table. Its public composition seam includes:

| API                                                     | Boundary                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `battlefieldPreset(name)`                               | Complete reference recipe: seed/settings/ordered overrides.                                                                       |
| `generateBattlefield(input)`                            | Pure synchronous seeded generation, typed bounded infeasibility or `MapAsset`; run it in an authoring worker.                     |
| `importAsset(text)` / `parseAsset(object)`              | Descriptor/resource-safe contract validation and detached data; not complete composition certification.                           |
| `supportsReplay(asset)`                                 | Exact supported schema/precision/coordinates and generator/stage/fork identity check; not physical validation.                    |
| `validateBattlefield(asset,limits?)`                    | Independent complete composition validation; saved data is inspected directly without regeneration.                               |
| `exportBattlefield(asset)`                              | Complete validation plus canonical JSON/vector SVG.                                                                               |
| `createElevationQueries({bounds,elevation},boundary?)`  | Detached authoritative bilinear height, analytic gradient and slope queries; default out-of-bounds errors, explicit clamp option. |
| `canonicalGeometry`, `canonicalRecipe`, `assetIdentity` | Separate deterministic geometry, recipe and full-asset identities.                                                                |

The Node CLI is a separate entry and is excluded from the browser public index. See [the authoring guide](map-authoring-guide.md) for fresh setup and workflow.

Use canonical JSON as the handoff source. Carry its full recorded versions/settings/overrides and exact consumed fork/source identities. SVG and Canvas2D are derived presentation; they must not become the simulation's terrain authority. The numerical elevation grid is private model data, not a movement or wire-format tile grid. Height comes from original/explicitly carved authoritative ground; the separate filled drainage surface is not interchangeable with it. Bridge deck heights and complete dry approaches matter separately from the channel bed.

Coordinates are local metres: x east, y south, z up, north-west zero origin. Preserve paths, rings, holes, stable IDs, reciprocal graph references, exact entrance joins and independent overlapping layers. Road `surfaceWidthM` is presentation/traversable surface data; reserved round-capped corridors encode generation constraints and do not automatically define formation rules. The local placement transform is the declared clockwise y-down rotation plus anchor translation; do not add population/SVG/tile scaling. Full topology and analytic terrain checks must stay tied to the same bilinear model and numerical policies.

## Proposed scenario adapter boundary

For public-geography inspection now, [the saved map table](map-table-guide.md) loads certified JSON onto a flat Three.js paper. It preserves the canonical asset as authority and has no scenario, units or live connection (D26). This bounded display handoff does not supply the scenario adapter below.

A future pure adapter should consume a fully validated, supported `MapAsset` and an explicit scenario specification, returning the engine's accepted static terrain/scenario representation with a source asset identity. Keep the original authoring asset immutable. Conversion should explicitly define coordinate transforms, elevation/crossing queries, terrain categories, feature reference mapping and any simulation metadata absent from the authoring contract. If the engine cannot represent a layer, reject or document that limitation instead of silently dropping water holes, local streets or narrow crossings.

The scenario specification supplies factions, orders of battle, starting formations, headquarters, objectives, time/weather assumptions and win conditions. Those are not inferred from buildings, residents or a “connected” generation result. A successful settlement population/capacity result is an authoring invariant, not evidence of troop accommodation, bridge capacity or scenario balance. Generation diagnostics/provenance may be stored for scenario audit; UI progress, request IDs, elapsed time and watchdog state must not enter deterministic engine state or canonical map identity.

No scenario adapter, generated objective/OOB policy, live map editor or gameplay query change is implemented by this milestone. Require a new owned packet for the concrete conversion and its engine/protocol tests.

## Follow-up ownership

| Follow-up                                                                                | Consume this map work                                                                              | Work retained by that follow-up                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#90 scenario generation](https://github.com/exterkamp/kriegsspiel/issues/90)            | Validated static map, canonical identity, complete recorded recipe and supported provenance.       | Scenario conversion/loading, objectives, balanced orders of battle, headless completion and balance checks. Reuse battlefield generation rather than building another geography generator.                                                  |
| [#114 movement and placement](https://github.com/exterkamp/kriegsspiel/issues/114)       | Metre vectors, terrain queries, road surfaces, crossing decks/widths and building/cover geometry.  | Continuous motion/events, terrain costs, formation clearance and physical unit-placement rules. A settlement suitability certificate is not a unit-placement/movement rule.                                                                 |
| [#115 line of sight and visibility](https://github.com/exterkamp/kriegsspiel/issues/115) | Authoritative ground and vector cover/building/ridge context.                                      | Sight/occlusion/height semantics, concealment, uncertainty aging and leak-tested per-side filtering. Building height, canopy concealment and weather behavior need explicit gameplay policy; footprint geometry alone does not supply them. |
| [#118 continuous table](https://github.com/exterkamp/kriegsspiel/issues/118)             | Flat public base-map geometry or derived texture, metre transforms and stable references.          | Player table/picking, unit facing/footprints, last-known ghosts and uncertainty display through the supported `SideView`.                                                                                                                   |
| [#129 vector table follow-up](https://github.com/exterkamp/kriegsspiel/issues/129)       | Canonical vectors and coordinate conventions; reusable geometry/transform logic where appropriate. | Remove tile-display conversion/stopgaps, draw the game table and return continuous map positions. The standalone Canvas2D preview is not a drop-in player renderer.                                                                         |
| [#130 continuous routing](https://github.com/exterkamp/kriegsspiel/issues/130)           | Actual regional/local road graph, exact joins, reserved widths and explicit crossing geometry.     | Vector-aware simulation routing and formation/facing behavior. The generation lattice/work budgets do not become the engine routing algorithm or its bridge-crossability rule.                                                              |

Issue descriptions contain older decision-number references; use decision titles and current [decisions](decisions.md), [architecture](architecture.md) and [implementation plan](map-implementation-plan.md) rather than carrying those stale numbers forward. This table is a boundary map, not a claim that any downstream issue is implemented or accepted.

## Engine and visibility invariants

The engine remains pure and deterministic and advances only to supplied game time. Authoring workers and their wall-time watchdogs operate outside that engine. Reproducible scenarios must record map identity and every gameplay input, including seeded gameplay randomness; engine rates 1/4/12, manual/fast-forward modes, replay and LLM barrier invariants still apply to later integration.

The LLM returns proposals and never edits master state or canonical terrain directly. Engine validation applies accepted proposals with logged inputs and seeded dice. A generated map does not bypass those paths.

The only path from master state to clients remains the visibility filter. Standalone authoring uses public static maps, not hidden live state. A gameplay adapter must distinguish public geography from private scenario objectives, troop placements, observations and dynamic changes. The public asset must not become a shortcut for delivering master-state units or exact hidden information. Player pieces, sightings and uncertainty arrive only through the accepted per-side view.

## Required downstream regression evidence

Before a concrete scenario adapter is accepted, test asymmetric coordinates and clockwise rotation against a known plane, then compare Canvas/SVG/query/engine positions without scaling changes. Preserve lake/cover holes and dry islands; roads through woods remain independent, and water is traversed only through represented gameplay-authorized crossings. Probe narrow bridges and formation width separately from generation corridor suitability. Distinguish deck grade from river-bed elevation and evaluate continuous segment/footprint interiors, not only sampled centres.

Round-trip the original supported recipe and ordered overrides through Node/browser generation and saved import, comparing canonical geometry while preserving the original asset. Changing a name may preserve geometry but must remain visible in full asset identity. Infeasible moves/exclusions and malformed/unsupported assets must not produce playable partial scenarios. Then run scenario load/headless completion/balance checks, movement chunking/rate equivalence and visibility leak tests in the downstream owners' scopes.

## Limits and release status

Complete-map validation certifies the declared numerical/cartographic model; it does not establish surveyed terrain accuracy, historical truth, scenario balance, realistic hydrology, movement rates, tactical visibility or a performance target. Canonical decimal-six normalization and versioned seams do not establish arbitrary-platform reproducibility; record supported Node/Chromium versions and verify the cross-runtime corpus. Deterministic caps and explicit infeasibility bound work without promising success for every supported-size request.

Default/maximum generation time, measured Node RSS, actual Chromium responsiveness, saved replay and representative screenshots are recorded in the [verification report](map-verification-report.md). That evidence establishes the tested standalone recipes/profile, not gameplay acceptance or universal performance. The owner keeps combined-work distribution gated for source review (D23): preserve the exact SettleMaker GPL notices/source/artifact identities, and do not publish/deploy a combined game or worker bundle as though a technical adapter resolved licensing. See [map architecture](map-architecture.md) and [snapshot instructions](../vendor/settlemaker/README.md).
