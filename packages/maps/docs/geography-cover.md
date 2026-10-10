# Bounded land cover (#136 portion)

Prerequisite: accepted terrain/contract checkpoint `27bbce4`, [map contract](../README.md), [terrain and contours](terrain.md), D15/D16 and [map implementation plan](../../../docs/map-implementation-plan.md). This packet owns only `src/geography/cover/**`, `tests/geography-cover.test.ts` and this document. Main geography implementation, shared APIs/configuration, compiled artifacts and acceptance remain with the main writer/coordinator. No #136 gate is claimed.

## API and version

```ts
import { generateCover, COVER_VERSION } from './src/geography/cover/index.js';

generateCover(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  seed: number,
): GenerationResult<Cover[]>
```

Record `COVER_VERSION = 'coherent-dry-runs-v1'` in `provenance.generator.stages.cover`. The version freezes resolution, score weights, agricultural/riparian rules, ordering, rectangle partition and decimal normalization. Changing these requires a new cover stage version. Export through the common maps index is an integration task, not an edit in this packet.

Only frozen contract, settings validation, query, geometry, resource and seed utilities are imported; no other geography or terrain implementation helper is used. The API has no engine, gameplay, clock, renderer or LLM dependency. Inputs are never modified. Water shape is detached by the contract schema, elevation is read-only, and no shared RNG is consumed. Two independent coordinate-hashed noise streams use:

```text
deriveSeed(seed, 'cover:coherent-dry-runs-v1', 'wood')
deriveSeed(seed, 'cover:coherent-dry-runs-v1', 'field')
```

Water order does not affect the union mask or output. Quintic-interpolated value noise uses `settings.cover.coherenceM` as its metre-space feature scale. Score ties use the original row-major cell index. A bounded iterative merge sort provides deterministic comparison/staging bounds; output rectangle order is north row, west column, kind, south row, east column. IDs are ascending `cover:00000` slots, independent of names and wall time.

## Resolution, geometry and water holes

The cover lattice is distinct from gameplay tiles. Its cells group elevation intervals with integer stride:

```text
step = ceil(max(1, coherenceM / (8 × sampleSpacingM),
                elevationIntervalColumns / 128, elevationIntervalRows / 128))
```

Each axis has at most 128 cells (16,384 total). Rounded interior edges and exact final bounds cover the entire rectangle, including partial final cells. The default 10 km/25 m field uses 100 m cover cells; the maximum 15 km/25 m field uses 125 m cells. Requested fine coherence is still evaluated but cannot overcome this raster resolution. `COVER_LATTICE` reports the actual resolution. This is a bounded first cover policy, not a claim of detailed botanical/cartographic fidelity.

Each water polygon is checked with its original outer ring and holes. A cell is masked if its centre is inside/on the water polygon or any outer/hole boundary segment enters its open interior. This catches sub-cell water slivers, enclosed water and diagonal/corner penetration that centre-only masks miss. A boundary coincident with a cell side does not exclude the adjacent wholly dry cell; shared polygon boundaries are permitted, while positive-area wet cover is prohibited. Location queries retain the contract's 1e-9 m boundary tolerance. Overlapping independent water features form a mask union. Dry islands inside water holes remain eligible wherever a whole dry cell fits. No water polygon is flattened, filled, carved or regenerated.

The optimized mask computes interior membership with row-centre scanlines, using the frozen ray query's half-open y test and intersection arithmetic. Sorted crossings alternate interior/exterior across outer rings and holes. Fixed-size merge buffers are reused across rows. Boundary handling traverses each edge's y range, clips that edge to each candidate row, then checks only the resulting column span. A 1e-9 m fringe only expands the candidate search; the unchanged open-cell test and frozen point-to-segment distance decide actual masking. Therefore touching corners/sides do not acquire wet area, and centre-boundary classification retains its previous tolerance. Water union writes never clear another feature's mask. The optimization changes reservation costs, not resolution, stream keys, classification or successful geometry semantics; `COVER_VERSION` remains unchanged.

Masking discards whole intersected cells conservatively. Therefore shoreline geometry is an approximation: dry area can be lost, and islands narrower than the available lattice cells may disappear. Every lost dry point lies in a masked boundary cell, within at most the maximum cell diagonal of a water boundary (plus numerical boundary tolerance). `dryAreaLossUpperBoundM2` sums masked boundary-cell areas once; it is an explicit conservative bound, not an assertion of measured true dry loss. `maskedAreaM2` includes actual water as well as sacrificed dry shoreline area. No exact union-water area is claimed for overlapping features.

Polygonization merges identical horizontal class runs across consecutive rows into rectangles. Simplification adds **zero** additional geometric/area error relative to the classified lattice: all eligible dry cells are represented exactly once as wood, field or open, and masked cells remain uncovered. Holes/gaps and dry islands are preserved by this partition, rather than represented as one union polygon with hole rings. Each rectangle is its own `Cover` feature with one polygon and empty `holes`; neighbouring features may share boundaries. This avoids invalid touching components or self-touching rings inside a single multipolygon. It produces blocky outlines and more features than a full connected-region boundary extractor. It never connects islands, bridges wet gaps or simplifies away occupied dry cells. Output coordinates are decimal-6 stable and stay inside the supplied bounds.

## Suitability and achieved density

For each cover cell, the algorithm bounds slope over every covered bilinear ground cell, including immediate seam neighbours to conservatively handle rounded cover edges. For corners a/b/c/d, the bound is `hypot(max(abs(b-a),abs(d-c)), max(abs(c-a),abs(d-b))) / spacingM`. This bounds the authoritative analytic derivative throughout that cell; it can overestimate the true maximum. Including neighbours can also reject agriculture immediately beside steep ground. Neither a flat centre nor averaging hides a steep corner.

Agricultural cells require the fixed, versioned `MAX_FIELD_SLOPE = .08` rise/run and must lie beyond the first dry lattice-cell band next to masked water. This is a cover-generation assumption, not a gameplay or settlement movement rule. Multi-source four-neighbour BFS supplies bounded Manhattan bank distance. Woods are ranked by coherent noise plus up to .25 steepness preference and .3/(bankDistance+1) riparian preference. Fields use their separate noise minus slope and the same riparian penalty. No water means no bank penalty/band exclusion.

Wood allocation uses an area-weighted prefix of its ranked dry cells, nearest to the requested target. Field allocation then uses an independently ranked prefix of suitable remaining cells. Remaining eligible dry ground is explicit open cover. Whole-cell allocation quantizes density by at most one cell's area; scarce suitable land or previous wood allocation can further limit fields. An all-wet mask returns explicit successful empty cover with `COVER_NO_DRY_AREA`; it does not invent dry land. Field shortfall beyond half the maximum cell area emits `COVER_FIELD_SHORTFALL` with requested and achieved fractions.

`COVER_ACHIEVED.message` is JSON containing numeric `dryEligibleAreaM2`, `maskedAreaM2`, `dryAreaLossUpperBoundM2`, `fieldSuitableAreaM2`, `woodFraction`, `fieldFraction`, `openFraction` and `maxCellAreaM2`. Fractions use **whole-cell eligible dry area** as denominator, not total map area or an uncomputed true shoreline area. With no dry area, all fractions are zero. `fieldSuitableAreaM2` is suitability before wood allocation, not a promise that that entire area becomes fields. Areas/fractions are rounded for reporting; geometry allocation uses binary64 values. Diagnostics use the accepted `stage: 'cover'` and cover codes/constraints.

## Validation and deterministic bounds

`parseSettings` supplies the complete frozen policy/dimension/planning validation. Descriptor-safe preflight occurs before cloning or accessing data; sampled ground/bounds must match settings, cover seed/coherence must fit the supported noise lattice, and authoritative ground/grid/water polygon coordinates must already be decimal-6 stable. Invalid parameters/precision raise hard errors. Frozen `validatePolygon`, `polygonsOverlap` and `TopologyBudget` check water rings, holes and same-feature multipolygon components. This validates water geometry for masking; it does not certify hydrology profiles, lake physics or terrain composition.

All algorithm reservations share `settings.limits.maxTopologyChecks`. Before each phase's buffers/work, the implementation reserves:

| Phase | Conservative reservation |
| --- | --- |
| Water topology and ground scan | `2 × sum(featurePolygonVertexCount²) + sampleCount`; frozen geometry checks run within the reserved topology allowance. |
| Lattice, noise, BFS and two ranks | `N × (32 + 6 × ceil(log2(max(2,N))))`; fixed-size arrays/queue are bounded by N≤16,384. |
| Water mask storage and row-edge scans | `2N + 2C + R + sum(E × (R + 2 + 2Ly))`, before mask/centre/crossing buffers. C/R are lattice dimensions, E is polygon edge count, and Lx/Ly are `ceil(log2(axisCellCount+2))`. |
| Scanline ordering and interior writes | For each row's K crossings, reserve `3K × ceil(log2(max(2,K))) + 2K × Lx` before sorting/span searches; reserve each actual interior span length before writing its cells. |
| Edge-local boundary traversal | Reserve `8 + 2Lx` before each intersected row's clipping/range searches, then twice that row's actual candidate-column count before open-cell/distance tests. Edge row-range searches are included in the storage reservation. |
| Full-cell slope | Complete ground-cell visit count including seam neighbours, before slope arrays/visits. |
| Rectangle partition | `3N` before run staging; each emitted rectangle must fit both feature and five-vertex budgets. |
| Final ordering | `3R × ceil(log2(max(2,R)))`, reserved before merge-sort staging. |

Units are deterministic visits/evaluations/comparisons/staging operations, not CPU instructions or a hardware time guarantee. Hard descriptor/import caps also bound validation input. Topology validation remains conservatively quadratic, and sufficiently complex water can still be infeasible under the recorded cap. Mask work is now row-edge scans plus crossing sort/span writes and edge-local candidate tests, rather than bounding-box cells multiplied by complete ring scans. No allocation depends on an unbounded contour/geometry traversal; no timing watchdog changes output. `CoverLimit` alone becomes typed `infeasible` with an error diagnostic and **no partial value**. Input validation and unexpected programming exceptions propagate. Feature/vertex exhaustion never truncates geography or silently returns only the rectangles that fit. Composition must reserve its own aggregate limits across cover, water and later infrastructure.

## Focused validation and handoff

Checks executed on existing dependencies, Node v22.22.2; no build, installation, dist test, server or shared-file edit:

```sh
node_modules/.bin/vitest run packages/maps/tests/geography-cover.test.ts
npm run typecheck --workspace @kriegsspiel/maps
node_modules/.bin/eslint packages/maps/src/geography/cover packages/maps/tests/geography-cover.test.ts
node_modules/.bin/prettier --check packages/maps/src/geography/cover packages/maps/tests/geography-cover.test.ts packages/maps/docs/geography-cover.md
```

All four commands exited **0**. Source suite: **18 tests**, including analytic all-open/all-wood/all-field, steep/full-footprint fallback, aligned wet-ring/dry-island area, sub-cell and diagonal water, riparian band, all-wet fallback, independent canopy neighbour-agreement >.85 for seeds 7/17/31, density/reordered-water replay, input immutability, decimal stability, partial final bounds, 15 km maximum ground, work/feature/vertex refusal, frozen settings-policy rejection and unexpected-error propagation. The optimized mask is compared byte-for-byte (wet and boundary flags) against an independent brute-force oracle using frozen polygon queries and segment cuts: holes, islands, slivers, diagonal/corner/side contacts, centre boundaries, concave shapes, overlaps, reversed rings/water order and partial final cells. A sparse 402-edge winding water corridor across 10 km succeeds at seed 17 under the unchanged 5,000,000 cap; a lower bound on its previous bbox-ring reservation exceeds 15,000,000. It retains water exclusion, dry area, replay and input immutability checks. Generated cover is reloaded through the full frozen asset parser in bounded fixtures; success/failure diagnostics use `stage: 'cover'`, and success diagnostics are parsed against `DiagnosticSchema`. Typecheck/lint/formatting are focused; fresh-process/browser identity and composed hydrology remain integration work.

Optimization trigger: the primary writer's real default 10 km seed-17 `generateGeography` probe reported `COVER_LIMIT`, with the old whole-cell water-mask reservation 3,523,132 versus 1,048,709 remaining of 5,000,000. This packet does not raise that cap, loosen masking or change the cover lattice. The main writer owns the rebuilt-dist/default integration probe rerun; the sparse source regression is not a substitute for that result.

Main writer: import the cover submodule, pass normalized authoritative original/carved ground and generated water, accumulate diagnostics, record the cover version and account for aggregate budgets. Do not pass filled drainage as ground. If water/ground changes, regenerate cover. Coordinator owns public index exports, build artifacts and any contract/common-doc changes. The simple raster/rectangle coastline and conservative field suitability are deliberate limitations for independent review; this packet does not certify #136, supply roads/crossing candidates or claim representative real-map/browser performance.
