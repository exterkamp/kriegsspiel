# Complete battlefield composition (#139, gate G)

The browser-safe public seam is `src/composition/index.ts`. The coordinator owns its common package exports. All generation is synchronous and deterministic; callers run expensive generation and saved validation in a dedicated worker.

```ts
generateBattlefield(input: BattlefieldInput): GenerationResult<MapAsset>
validateBattlefield(asset: unknown, limits?: Partial<CompositionLimits>): GenerationResult<CompleteValidation>
supportsReplay(asset: unknown): boolean
battlefieldPreset(name: 'flat-countryside' | 'wooded-hills' | 'river-valley'): BattlefieldInput
exportBattlefield(asset: MapAsset): GenerationResult<{json: string; svg: string}>
```

`BattlefieldInput` contains `seed`, fully materialized `settings`, ordered optional `overrides`, and optional lower operational `limits`. The three recipes retain unchanged geography presets, seeds17/31/97 and four villages/six farms. `CURRENT_GENERATOR`, `CONSUMED_FORK`, `COMPOSITION_VERSION` and `COMPLETE_VALIDATION_VERSION` expose exact current support. `supportsReplay` checks identities synchronously; it does not certify physical suitability. Malformed imports retain path-specific `MapValidationError`; expected geometric/resource infeasibility returns structured diagnostics without partial output.

The asset records the exact installed immutable runtime artifact. The ignored development fork is never imported. Combined-work distribution remains gated; this is a local source-review implementation.

## Complete pipeline and numerical authority

`generateBattlefield` generates the original seeded ground, runs accepted geography, and extracts new contours from the returned normalized authoritative ground. Filled drainage remains separate. Regional planning uses exact public whole-footprint/corridor certificates. The installed constrained physical village API supplies local village/farm streets and dwelling footprints with `landscape:false`; dressing never changes those roads. Unconstrained, legacy and city APIs do not participate.

`complete-frontage-access-v1` requests a preferred farm extent of50m, constrained to the recorded farm area/extent interval. Villages retain the configured minimum extent. This chooses permissible geometry within unchanged settings, rather than changing population or counts. The accepted planner records and validates the actual sizes. All three unchanged5km geography recipes retain four villages of300 residents and six farms of12 residents. Narrow minimum25m farms with full8/12m regional corridors exposed truthful capacity shortfalls during the early probe; the explicit preferred-size seam resolves those shortfalls without raising dwelling capacity.

Local policy is version-bound: 5m routing lattice, 7m frontage spacing,18m street spacing,4m reserved local width,2.4m surface width and.3m setback. Each dwelling has the fork's fixed4-person capacity. Root seeds derive independent local attempt seeds with `deriveSeed(seed, 'settlements:complete-frontage-access-v1', siteId + ':attempt:' + ordinal)`. Seed, name and geometry do not change a stable place slot. Name-only ordered overrides preserve geometry; moves/exclusions rerun dependent planning and local placement. Unknown place IDs reject.

The adapter uses a detached rotation/translation frame: world(x,y)=anchor+Rθ×local(x,y); local gradients are Rθᵀ×world gradients. Compass bearings subtractθ in local space. Transformed output is decimal6 before final certification. The asymmetric90° fixture local(137,-241), anchor(3456,1234), gives world(3697,1371); plane120+.012x+.034y gives210.978m and local gradient(.034,-.012). There is no competing height implementation.

Since D50 sites are turned by whole degrees (planning v5). The frame reads their sine and cosine from the literal table in `src/rotation.ts`; any other recorded rotation keeps the snapped runtime value. A turned frame rounds each mapped point independently, so assembly keeps the joins exact: an entrance the fork kept as supplied maps back to its planned world point and bearing (no reconciliation), the inner end of its lead goes back onto the line of the entrance bearing, each access join goes back onto its world street and each doorway onto its world footprint edge, all as the decimal6 point (of the nine around the projection) nearest the line. The saved validator's entrance mouth runs along the street it excuses, which must lie on the entrance bearing within a micrometre, rather than along the bearing itself: polygonal capsules turned against each other by that micrometre's angle leave slivers at any bearing that is not a quarter turn. Site extents are measured in each site's frame.

Cover is generated last (D45): after settlement layouts are assembled and compacted, `generateCover` receives the final roads (regional, streets, access) and sites, within the feature/vertex capacity the other layers leave; `generateGeography` runs with `{ cover: false }`.

Local water windows intersect complete polygons and preserve dry-island holes and water identity. Their padding covers reserved entrance caps and dry-abutment clearance. Whole-shape callbacks always use the detached full world water/elevation context, so window clipping cannot authorize omitted water. All current permissible sites are wholly dry; the adapter supplies no invented local crossing. Regional bridges remain explicit accepted planning decks, with reciprocal road IDs and a linear deck rederived from authoritative dry endpoint heights during saved validation.

Exact unchanged fork entrances share the existing regional node IDs in the global graph. A changed join takes the bounded accepted reconciliation path and charges its returned work, including expected failures. Current constrained outputs preserve the supplied endpoints/bearings/widths exactly. No fabricated internal street is substituted for an infeasible local layout.

## Persisted access and occupation policy

Fork punctuation IDs are mapped to deterministic safe, place-scoped ordinal IDs. Place IDs remain the frozen geometry-independent slots. Dwelling IDs are `building:<kind>:<place ordinal>:<local ordinal>`. Local street/node ordinals follow sorted fork source IDs; names consume no identity stream. These local ordinals describe a particular versioned layout and can change when its geometry changes.

Every building's certified0.8m access corridor is persisted as an explicit `track`, with ID `road:<dwelling suffix>:access`. Its first node is a terminal at the actual footprint boundary; its second is a shared node on a real local street. The local street is split at every access projection before graph assembly. The access route ID, width, surface width, setback and ownership are independently checked on reload. Decimal6 boundary projection can be displaced by at most√2/2 micrometre; the independent doorway check allows1 micrometre, then partitions the path at footprint edges and rejects inward/backtracking access. Only that building's own access end cap has its necessary contact with the doorway; other reserved roads/access tracks plus setbacks may not contact the footprint. No access metadata is invented on saved load.

Degree-two compatible street chains merge only when dimensions, place and route memberships agree. Every path vertex/bend is retained; entrance/access/junction nodes remain explicit. Ground/deck endpoints and IDs are never smoothed. Final normalized geometry is recertified.

`occupiedFootprint` follows a versioned **convex actual-footprint envelope clipped to permissible land**, retaining resulting holes. It is derived from emitted dwelling polygons, never copied from the permissible-area box. A disconnected result is explicit infeasibility because v1 stores one Polygon. Gaps between buildings are envelope space; they are not additional occupied terrain primitives. Dryness/gradient/road clearance apply independently to every actual footprint and corridor. The saved validator recomputes only this envelope from recorded geometry and checks exact equality; it does not regenerate terrain or settlements.

## Independent saved validation

`validateBattlefield` imports/caps/descriptors-checks the supplied asset, then independently checks current identity support, retained drainage, whole-area water physics, complete-segment contour height, stable slots/counts, ordered overrides, site sizing/spacing/permissibility, population/capacity, actual footprints, road clearance, actual access geometry, exact external/local joins and graph connectivity. Each stable slot binds its kind: `site:village:<ordinal>` is a village with residential dwellings, and `site:farm:<ordinal>` is a farm with agricultural dwellings. Equal populations or permissible size intervals cannot authorize a kind swap. It checks regional route identity and connectivity through each route's own emitted edges. E's farm approaches can be `track` roads; their regional role is preserved, rather than inferred solely from the rendering kind. Place-scoped local identities distinguish local streets/access from regional tracks.

All ground corridors use analytic directional grade across every cell seam, including caps/bends. Each linked bridge edge must be its complete explicit span, with separately certified dry ground approach edges; a channel-bed grade never substitutes for deck grade. Full crossing geometry, dry closed abutments and standing-water clearance are delegated to the accepted independent bridge certificate. Fords (D46) are certified by the independent ford certificate (wadeable modelled depth equal to the recorded depth, low banks, road-grade ramps) and may carry only minor (farm) routes. Required river recipes must use a linked regional bridge; a ford does not count. A global and per-site BFS walks emitted nodes/edges, rather than planner candidates. Every local street and access component must connect to every required entry. Settlement labels agree with actual site IDs, anchors and names; unsupported decorative landmarks are not certified in v1.

The validator has no generator call, retry, healing or source-checkout dependency. `supportsReplay` checks only schema/precision/coordinate/generator/stage/fork support through safe bounded identity descriptors; it does not establish contract or physical validity. A loaded validated asset remains its supplied geometry. Exact fresh-process generation and name-only overrides have separate replay tests. The future scenario importer consumes this versioned `MapAsset` after complete validation; this packet defines no movement, combat, visibility, engine state or gameplay import behavior.

## Resource and error boundaries

`limits.maxConstraintWork` defaults to200million and `maxValidationWork` to100million; callers may only lower these version-bound caps. They are operation metadata outside canonical assets, so lower limits affect success/failure rather than successful geometry. Limits are read using exact own allowlisted data descriptors before full traversal; accessors, symbols, hidden properties, inherited names, arrays and custom prototypes reject without getter invocation.

The global constraint meter includes factory descriptor/schema/surface initialization, local window transformations/overlay reservations, graph/footprint assembly, each fork result's own work and world-certificate work. The active fork `ConstraintBudget` is bound in `try/finally`; callbacks reserve both fork and aggregate capacity before geometry work. Per-attempt fork `maxWork` is at most its accepted20million cap and remaining global capacity. Returned failed-attempt work is charged before another bounded attempt. Resource exhaustion is terminal, never an unsuitable candidate followed by a reset. Per-site/global attempts remain the recorded settings caps. Reconciliation returns cumulative work on success and expected failure; its work is charged before any future attempt.

Window transformation and conservative overlay work are reserved before detached coordinate copies or clipping. Ring size256 and aggregate10,000 local input points count permissible rings, entrances and **all** clipped water rings. Excess clipped output rejects before mapping/appending it. Local output feature/coordinate staging is checked before transformations against remaining root caps. Compaction reserves sort/copy work and preserves all geometry. Export bounds SVG bytes at64MiB before joining chunks.

Terrain/geography/planning retain their separately documented accepted stage budgets. Their finite sum plus composition/validation caps bounds the complete operation; this does not claim a single resettable timer budget. Saved validation meters input descriptors/schema copies, geometry scans and shared queries. It reserves the full accepted parser topology, whole-water physics and contour-validation ceilings before those separately budgeted algorithms. Reservations are conservative, deliberately reported as work rather than elapsed time. Maximum-size/default/full-corpus wall time and peak memory are coordinator/J evidence.

Saved validation builds metered polygon bounds/edges and road bounds once, with reservation before coordinate reads or edge copies. Repeated building-pair, building-road and regional-site comparisons reuse these caches. Metered site/node/road/incident/access/terminal indexes replace repeated full-array filters. Every remaining repeated scan or copy reserves separate work before execution; initial import/preflight work is not credited again. Certificate exhaustion stops before any subsequent road scan. Assembly indexes all dwelling accesses once by street and reserves sorting/copy work; unmatched streets do not scan every access. These internal helpers are not public certificate APIs.

Known constraint/capacity/resource failures return structured `GenerationResult` diagnostics with no partial asset/export. Malformed imports and malformed input (settings, seed, limits) still throw before generation starts. Once input is accepted, `generateBattlefield` never throws (#542): an exception no stage expected becomes `ok:false` with one `GENERATION_INTERNAL_ERROR` diagnostic whose `stage` is the stage that was running and whose message keeps the error's name and message. It is never a routine infeasibility code, and the fault behind it is a bug to fix where it was thrown. The editor's worker and the lobby rely on a result, not a throw. No clock, watchdog or ambient RNG affects canonical content.

## CLI and vector export

From root, after the coordinator's ordinary package build:

```sh
node packages/maps/dist/composition/headless-cli.js --preset river-valley --output /tmp/battlefield.json
node packages/maps/dist/composition/headless-cli.js --preset river-valley --output /tmp/battlefield.svg
node packages/maps/dist/composition/headless-cli.js --validate /tmp/battlefield.json
```

Optional `--seed`, `--settings <JSON file>` and `--overrides <ordered JSON file>` fully record the supplied inputs. Without `--output`, canonical JSON goes to stdout. Validation prints the direct certificate result and never generates. Exit0 is success,1 named infeasibility,2 malformed input/CLI/programming error. Failed candidates write no output. The coordinator owns the root `maps:cli` alias.

SVG uses the same saved polygon/path coordinates with even-odd holes, surface road widths, actual decks/building footprints, contours and escaped names. It identifies local metre axes explicitly and makes no RFC7946/geographic claim. Canonical JSON/SVG export independently validates the normalized asset before producing strings. The Node-only CLI is deliberately excluded from browser exports. SVG is a cartographic vector export, not the fork's decorative glyph renderer.

## Focused verification and scope

Commands executed from root with existing Node22.22.2, TypeScript, Vitest3.2.7, ESLint and Prettier; no install, ignored fork import, root build, server, agent, commit or branch action:

```sh
npm run build --workspace @kriegsspiel/maps
npm run typecheck --workspace @kriegsspiel/maps
node_modules/.bin/vitest run packages/maps/tests/composition-contract.test.ts packages/maps/tests/composition-budgets.test.ts packages/maps/tests/composition-representatives.test.ts packages/maps/tests/composition-cli.test.ts
node_modules/.bin/eslint packages/maps/src/composition/{assemble,budget,compact,export,frame,generate,headless-cli,identity,index,settlements,types,validate,windows}.ts packages/maps/tests/composition*.test.ts
node_modules/.bin/prettier --check packages/maps/src/composition/{assemble,budget,compact,export,frame,generate,headless-cli,identity,index,settlements,types,validate,windows}.ts packages/maps/tests/composition*.test.ts packages/maps/docs/composition.md
```

The root-owned `source.ts` was read and imported, never edited or formatted by this packet. Source tests cover complete/saved round trips, real graph walks, dangling local route/access mutations, forged logical provenance/capacity/envelopes, overrides, interior steep samples, asymmetric detached transforms, zero-getter limits, pre-transform work, aggregate water input, holes, callback exception cleanup, compaction, fresh-process/no-clock/no-random replay and headless JSON/SVG/validation/failure behavior. The underlying accepted B–F numerical/geometry oracles remain required component evidence.

The first combined representative run passed19 assertions but exited1 with Vitest `[vitest-worker]: Timeout calling "onTaskUpdate"`. Native timer yields between unchanged generation/export/reload checks resolved the RPC starvation; no assertion or timeout was weakened. Its clean affected rerun passed4 representative/replay tests in70.27s.

The complete final focused run passed **21 tests in4 files**, exit0, Vitest duration **71.88s** (test work73.23s across parallel workers). The three representative tests include generation, canonical/vector export, reload, independent validation and a separate emitted-graph walk: flat17 **4578ms**, hills31 **33202ms**, river97 **32037ms**. These test durations include repeated validation and test instrumentation; they are not generator benchmarks. Three fresh-process replay checks passed with ambient random/clock disabled and different locale/timezone settings. Build, package typecheck, scoped lint and scoped formatting exit0. The CLI smoke test writes/reloads/validates canonical JSON and SVG and proves named failure writes no candidate file.

Early compiled real probes, before the final source checks, observed flat17:1686roads/2007ms; hills31:1570roads/7596ms; river97:1845roads/10618ms. Each had10sites/318buildings/1272 assigned, and river97 used1bridge. These are single whole-generation observations, not fresh-process resource measurements or percentile claims. Timing is absent from assets. The coordinator owns final default/maximum/corpus/memory and browser measurements; this packet does not duplicate them.

The subsequent independent kind/work-accounting review repairs were checked with only the two affected source test files, package typecheck and scoped lint/format:

```sh
node_modules/.bin/vitest run packages/maps/tests/composition-contract.test.ts packages/maps/tests/composition-budgets.test.ts
npm run typecheck --workspace @kriegsspiel/maps
node_modules/.bin/eslint packages/maps/src/composition/validate.ts packages/maps/src/composition/assemble.ts packages/maps/tests/composition-contract.test.ts packages/maps/tests/composition-budgets.test.ts
node_modules/.bin/prettier --check packages/maps/src/composition/validate.ts packages/maps/src/composition/assemble.ts packages/maps/tests/composition-contract.test.ts packages/maps/tests/composition-budgets.test.ts packages/maps/docs/composition.md
```

This repair run passed **20 tests in2 files**, exit0, **1.94s**:12 contract tests and8 budget tests. The added regressions reject stable-kind swaps with equal populations/size intervals and wrong dwelling kinds; prove a low cap permits zero coordinate/key reads before bounds/access indexing; prove cached distant1000-point paths have no repeated coordinate reads; and exhaust the successful footprint callback's remaining budget to prove zero subsequent road/incident visits. Typecheck and scoped lint/format pass. No build, representative/corpus/default/maximum generation or root test was repeated for this repair packet; the coordinator owns the next integrated build and acceptance checks.

Gate acceptance, public source pinning, full root integration, browser worker/UI tests and story closure remain coordinator/reviewer responsibilities. Numerical suitability is exact against the coarse declared bilinear surface, not surveyed terrain. Constrained cities, arbitrary decorative landmarks, disconnected occupied envelopes, general partial deck-edge splitting and gameplay behavior are outside this v1 composition policy. Publication/combined distribution remains gated under D23.
