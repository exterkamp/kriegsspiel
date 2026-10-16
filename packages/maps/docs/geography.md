# Geography, drainage and water (#136)

This module follows D18/D19, the [accepted contract](../README.md), [terrain policy](terrain.md), and the [implementation plan](../../../docs/map-implementation-plan.md). Prerequisites are `28a611c` (contract) and `27bbce4` (terrain). Coordinates remain local metres, x east/y south/z up. There is no gameplay, clock, renderer, LLM or external-source dependency. Component evidence is recorded here; the coordinator owns gate acceptance and the execution log.

## Public seam

`src/geography/index.ts` exports these APIs; the coordinator adds their common package re-export:

```ts
generateGeography(elevation, bounds, settings, seed, limits?): GenerationResult<GeographyOutput>
generateHydrology(elevation, bounds, settings, seed, limits?): GenerationResult<HydrologyStageOutput>
deriveDrainage(elevation, bounds, settings, limits?): GenerationResult<DrainageOutput>
accumulateFlow(receivers, maxWork?): number[]
streamSamples(accumulation, threshold): number[]
validateWaterPhysics(elevation, bounds, water, settings, limits?): GenerationResult<PhysicsEvidence>
findCrossingCandidates(water, bounds, settings, limits?, elevation?): GenerationResult<CrossingCandidate[]>
crossingCandidate(id, waterId, endpoints, settings, ford?: { depthM }): CrossingCandidate
riffleDepthM(widthM, slope): number
reachSlope(river, water, budget?): number
fordDepthM(river, water, budget?): number
isMinorRoute(routeId, sites): boolean
validateCrossingCandidate(candidate, water, bounds, settings, limits?): GenerationResult<CrossingCandidate>
createGeographyQueries(elevation, bounds, water, settings, limits?): GenerationResult<GeographyQueries>
generateCover(elevation, bounds, water, settings, seed, context?): GenerationResult<Cover[]>
geographyPreset('flat-countryside' | 'wooded-hills' | 'river-valley'): MapSettings
```

Inputs use the frozen types. `GeographyOutput` adds `version`, `sourceElevation`, authoritative `elevation`, `groundChanged`, `drainage`, independent `water`/`cover`, `crossingCandidates`, and deterministic work evidence, including optional shoulder policy/band/cut counts. The existing `HydrologyOutput` lacks cover and source-ground/changed-ground information; `HydrologyStageOutput` is the geography output without cover/candidates. Local `CrossingCandidate` has no final road references: it carries ID, river identity, kind (`bridge` or `ford`), endpoints/span, reserved width, conservative deck polygon, minimum abutment, policy version and, for fords, the reach's recorded riffle depth. #137 creates final `Crossing` links and road edges. Fords come from the shallow-water model below (D46).

`GEOGRAPHY_VERSION = 'flood-carved-stepped-network-v2'`, `CROSSING_VERSION = 'reserved-dry-disks-v2'`, and `GEOGRAPHY_PRESET_VERSION = 'geography-presets-v1'` freeze the policies below. Cover has its independent `COVER_VERSION = 'terrain-parcels-v2'` (D45; rectangle cover `coherent-dry-runs-v1` before it); see [cover documentation](geography-cover.md). `generateGeography(..., limits, { cover: false })` leaves cover empty; composition then lays it out around the final roads and settlements. Composition records these in generator stage provenance and materializes preset settings. Changing content rules requires a stage version change. Budgets can cause success/failure but never alter a successful result by truncation or seed substitution.

## Ground, priority flood and drainage

Ground, grid metadata and bounds must already be decimal-6-v1 stable, finite, dimensionally valid, and within sample limits. The accepted terrain precondition is reused without mutation. Input samples are copied; source ground is retained in `sourceElevation`. `filledSamples` is always a separate drainage-only array. It is never substituted into terrain queries, contours, cover or settlement placement.

Priority flood seeds **every boundary sample** as an explicit open outlet. A binary min-heap orders `(filled height, row-major sample index)`. A sample is marked on enqueue, enqueued once and popped once. Its filled height is `max(original height, discovery parent's filled height)`; there is no epsilon gradient. This raises closed depressions to their actual spill level. Pop ranks strictly increase; equal-height flats drain through their discovery parent toward an earlier rank. No arbitrary interior sink is inserted: depression lakes ultimately spill to boundary outlets, and `sinks` is empty.

Interior samples with lower filled neighbours choose steepest **metric D8 slope**, drop divided by spacing times Euclidean neighbour distance. Exact slope ties choose smaller sample index. With centre10, S8 and SE7.5, S wins (2/spacing versus 2.5/(spacing×sqrt2)). Otherwise the receiver is the discovery parent. Every receiver decreases `(filled height, pop rank)` lexicographically and reaches a boundary in at most N−1 edges. Boundary samples remain terminal even if a nearby boundary height is lower; this declares external drainage beyond the sampled rectangle rather than simulating off-map flow.

Accumulation contributes one unit per sample, including receivers. Independent Kahn traversal rejects malformed receiver indices, self-loops and cycles. The analytical graph `[4,4,5,4,7,7,7,8,-1]` gives `[1,1,1,1,4,2,1,8,9]`. Stream eligibility uses inclusive `accumulation >= riverThresholdSamples`; widths and threshold are geometry-generation assumptions rather than hydrological discharge estimates.

## Lakes and a physically explicit river policy

Uncarved lakes are conservative **wet cell cores** of actual filled depressions. A cell qualifies only when all four filled corners equal one spill level, all original corners are at/below that level, and at least one corner is lower. Bilinear convex weights guarantee the entire cell is submerged or on the waterline. Cells are grouped by spill level and connected by four-neighbour adjacency. Only the cells' bounding rectangle is allocated/scanned for each level, avoiding a full-map mask per spill level.

Boundary extraction cancels interior cell edges, uses deterministic right-turn ordering and removes only collinear vertices. Ordinary dry islands remain explicit polygon holes. Frozen simple-ring validation detects corner contacts. Lake generation partitions such invalid components into exact horizontal rectangles, each a separate feature: their union retains every wet cell and dry hole/gap, without positive-area overlap or invented water. The low-level region primitive can instead return typed `REGION_TOPOLOGY`; malformed imported polygons still throw validation errors. Excess rings/holes/features/vertices fail rather than losing cells. Lake area is represented-cell count times spacing². Partial shoreline cells are deliberately excluded, so this is a conservative wet core, **not** an exact inundation boundary or a measured lake-volume model.

### River network (v2, #490)

`flood-carved-graded-backwater-v1` carved one accumulation trunk to a constant stage below the map's lowest ground, so its graded shoulders cut a broad trench across the whole map and no tributary existed. v2 (`src/geography/rivers.ts`, frozen constants in `RIVER_NETWORK`) builds a **stepped drainage network** on the drained v2 terrain:

- **Selection.** Channel samples have accumulation at least `max(riverThresholdSamples, 3% of the largest catchment)`, so sources are channel heads on higher ground. A main-stem decomposition (the largest channel donor continues a stream, ties by sample index) splits the channel tree into streams; a stream is emitted when its mouth accumulation reaches `max(source, 12% of the largest catchment)` and it has at least six samples. Streams are taken largest first, at most eight, and only join streams already taken, so every emitted stream ends at the map edge or on a larger stream. Flat ground has no network; a required river then returns `RIVER_INFEASIBLE`.
- **Reaches and levels.** Each stream splits at confluences and wherever the valley floor has fallen 3 m or 28 samples have passed. Every reach is its own `standing-water-v1` feature (`water:river:<stream>:<reach>`) with a constant surface `decimal6(lowest original ground within its band − stage offset)`, then lowered to the minimum of every reach draining into it (upstream first by flood rank). Surfaces therefore never rise downstream, and a tributary's last reach is never below the reach it joins.
- **Geometry.** Centrelines are Douglas–Peucker simplified D8 paths (0.6 spacing), which keeps long straight bank runs for bridges. On reaches falling less than 0.6% they meander: arc length is split into whole half-waves of 5.5 channel widths, offset sideways by alternating parabolas `4t(1−t)` up to 0.9 widths (side from a `hydrology:<version>` stream), vanishing at both reach ends so junctions are kept. Width grows with catchment, `min + (max − min)·sqrt(share)`. Polygons are the union of segment rectangles and inscribed octagon joins/caps (a subset of the true buffer), clipped to bounds; earlier, larger streams and downstream reaches own any overlap. Outlines are simplified with a 0.75 m tolerance (falling back to the exact outline if that is not a valid simple polygon). Unrepresentable tributary geometry drops that tributary and its feeders; failure on the main stream leaves no river.
- **Carving.** Every cell whose centre is within half width + half a cell diagonal + the outline tolerance of a reach centreline is wet: its four corners are cut to at most the lowest touching surface, so every polygon point lies in a cell wholly at or below its surface. Nodes within half width of the centreline become a bed 0.5–2 m below the surface (wider rivers deeper).

### Graded banks and approaches

`SHOULDER_POLICY = 'banded-lipschitz-cut-v2'`. Set `axisGradeCap = maxGrade/(2×sqrt2) − 2e−6/spacingM` and `guaranteedBandSteps = ceil((3×spacingM + maxReservedWidthM + minimumAbutmentM)/spacingM)`; a nonpositive cap is typed `SHOULDER_PRECISION` infeasibility. Rivers at least half the maximum width (and a road corridor wide) get the full band; narrower brooks get one sample (`brookBandSteps`), so they lie in natural valleys rather than graded trenches. Each wet node anchors the cut at its own valley floor: the lowest original ground within its band less `1 m + band × spacing × axisGradeCap`, never below its water surface.

The cap is the cheapest eight-neighbour **chamfer** path value from any anchor, `floor + axisGradeCap·spacing·(axis + √2·diagonal)` while both nodes lie within some anchor's own band, and `steepGrade = 0.5` per metre beyond it, so cuts fade back into natural valley sides instead of leaving Manhattan diamond terraces. Keys are recomputed from integer step counts, never accumulated, so a single anchor reproduces the exact chamfer cap (tested). Within the band, axis neighbours differ by at most `axisGradeCap·spacing`, which keeps the v1 bound: the complete analytic gradient norm of a dry cell whose corners are all in band is at most `sqrt2 × (axisGradeCap + 1e−6/spacingM)`, below half the requested maximum. Ground is never raised. The search stops once popped keys reach the highest ground (nothing more can be cut). Work reserves `56N` units: two chamfer searches with ≤9N pushes, ≤9N pops and ≤8N neighbour visits, and the final scan; exact W succeeds and W−1 fails.

Drainage is recomputed on the carved authoritative field; remaining depression lakes (rare on drained v2 terrain) use this new filled surface and exclude river cells. `sourceElevation` is retained for audit, `elevation` becomes authoritative, and `groundChanged` is true. **Composition must regenerate contours from this returned normalized elevation before sites/roads/local layouts**, then independently certify them; it must not retain source-field contours or query filled drainage. The frozen asset can retain authoritative ground plus filled drainage; replay can reconstruct pre-carve source ground from the recorded terrain version/settings/seed. Persisting an extra audit snapshot would require a coordinator-owned additive contract change.

`validateWaterPhysics` independently validates shape and certifies ground at/below an explicit constant water surface over the **complete polygon**, including holes. It splits every boundary edge at grid seams, evaluates both endpoints and any quadratic maximum in each piece, and checks interior grid nodes with even/odd scanlines. Bilinear patches have no strict interior maximum; internal grid seams are linear, so those boundary extrema and grid nodes cover all maxima. This catches the river saddle `h=−(x−50)(y−50)` whose endpoints are −625 but interior reaches0, and a submerged outline enclosing a dry interior hill. Ground excess above **1e−7 m** fails; authoritative inputs/water stage must be decimal6 stable. Variable standing profiles and `carved-ground-v1` are explicitly unsupported by this certificate, rather than accepted by label. This validates the represented water area, not the complete upstream catchment or physical discharge.

## Cover and suitability queries

Composition passes authoritative original/carved ground, never filled ground, to the [cover module](geography-cover.md), together with the final roads and sites. Woods follow steep ground, ridges, poor soil and distance from settlements; fields, gentle ground near villages, farms and roads; river flats stay open meadow. Conservative water masking, slope rules, parcels, smoothed shared outlines and achieved shares are documented there. Cover settings or unrelated settlement-stream draws cannot change ground, water, drainage or crossing candidates.

`createGeographyQueries` snapshots ground, water and numeric bounds. It delegates `heightAt`, analytic `gradientAt` and `slopeAt` to **existing** `createElevationQueries`; no competing interpolation is introduced. Exact maximum bounds and seam ownership are the accepted terrain-query rules; nonfinite/out-of-bounds inputs throw. `waterAt(x,y)` returns sorted IDs of bodies covering the point, including boundaries while respecting hole interiors. `isDry(x,y,radiusM=0)` checks a closed disk is in bounds and separated from every water boundary; contact within1e−9 m counts wet. Both return bounded `GenerationResult`s with a fresh per-call work allowance. Negative/nonfinite radii are errors. Caller mutations after construction cannot alter any query.

These are point/disk suitability primitives, **not** whole-footprint certificates. #137/#138/#139 still require independent complete polygon/corridor checks for grade, buildings, roads and composition joins. Candidates do not certify bridge deck elevation, structural support, approach grade or road connectivity.

## Crossing suitability

Candidates are bridges over one identified river. Reserved width is `settings.roads.maxReservedWidthM`. The complete closed abutment disk radius is `width/2 + minimumAbutmentM`: river20 m/reserved8 m/abutment3 m requires radius7 m. **Exact tangency is rejected** by this local suitability policy, although the general contract allows tangency for some corridor relations. Search adds2e−6 m clearance before decimal6 rounding; a1e−6 m positive-control clearance succeeds. Disks, conservative deck and reserved end caps must fit bounds. The deck is a deterministic rectangle containing the round-cap reserved capsule, so its extra corners are conservative. Span must equal endpoint distance within recorded coordinate tolerance and fit `maxCrossingSpanM`.

The centreline must intersect one contiguous wet reach with actual width at least `minRiverWidthM`. Dry holes touching the entire reserved capsule are rejected, including holes missed by centre and side traces. A full transverse-strip certificate requires exactly two straight opposing banks covering every lateral offset in the reserved width; bank notches, bends, wet caps and oblique banks are conservatively rejected. Crossings of another water identity in the reserved corridor are rejected as confluences. This deliberately admits fewer crossings than a general polygon/bridge solver. Malformed geometry/parameters remain errors; ordinary unsuitability is typed infeasibility. Candidate search tests reach-segment midpoints in order, skipping segments shorter than two reserved widths and keeping accepted candidates on one reach at least 150 m apart; it returns all feasible candidates within the output/work caps, or failure with **no partial value**. It never returns a truncated successful list.

`reserved-dry-disks-v2` adds two rules. With carved ground supplied (geography always supplies it), each abutment moves outward in 1 m steps, within the span limit, until its ground stands `ABUTMENT_CLEARANCE_M = 0.25` above the river surface and the straight 25 m outward approach has a directional grade within 90% of `maxGrade`; banks cut through the cell a water edge crosses are otherwise at water level, and a linear deck would touch the water. Decks are also inflated by 2 µm before decimal-6 rounding so oblique decks still contain the whole round-capped corridor after their corners are rounded. Planning still certifies every approach corridor and deck independently.

## Shallow water and fords (`shallow-riffle-v1`, D46)

`src/geography/shallow.ts` models the depth over a reach's riffles at ordinary water from public geometry only, so saved maps are checked with the same numbers. Downstream hydraulic geometry gives width ∝ Q^0.5 and depth ∝ Q^0.4; the reach width already follows catchment (D44), so depth grows as width^0.75. At a given discharge a steeper reach is shallower (Manning: depth ∝ slope^-0.3, taken as slope^-0.25):

```
depth = 0.3 m × (width / 10 m)^0.75 × (0.003 / slope)^0.25,   slope clamped to [0.0005, 0.03]
```

Both powers are products of square roots, so the result is exact binary64 and rounded to decimal6 when recorded. The reach slope is the fall from its surface to the downstream neighbour's (the reach starting where it ends, else the water containing its end) over its centreline length; a reach that ends at the map edge or in nothing counts as still water (the clamp floor, so deepest). A 10 m brook falling 3 m/km has 0.3 m, a 30 m river about 0.7 m and a 60 m river over 1.1 m. A reach is **fordable** at `SHALLOW_WATER.maxFordDepthM` = 0.8 m or less (the period wagon and field-gun wading limit is 0.6–0.9 m).

With ground supplied, the search adds ford candidates (`ford-candidate:<water>:<segment>:<k>`) on fordable reaches after the bridge search. Along each straight centreline segment at least two reserved widths long it tries transverse lines about 100 m apart (`spacingM`, also the minimum spacing along a reach). The ends sit just beyond the dry abutment disks (no outward search, unlike bridge abutments) and must satisfy:

- **low bank**: ground at each end at most `maxBankM` = 1.5 m above the water;
- **gentle ramp**: the ground between each end and the water no steeper than `rampGradeShare` (0.8) of the road maximum;
- **gentle approach**: within 25 m of each end, straight out or slanting an eighth turn up or down the valley, one direction no steeper than `approachGradeShare` (0.8) of the road maximum;
- the same dry-disk, single-reach and straight-bank geometry as a bridge (`validateCrossingCandidate` accepts both kinds);
- clearance: the ford's span stays more than a reserved width plus 25 m from every earlier bridge or ford candidate, so decks never overlap.

Bridge candidates are unchanged; a deep reach gets only bridges. Planning certifies and routes fords (see [planning](planning.md)). `isMinorRoute` classifies a regional route from its identity: a route with a farm at one end is a minor road, one joining only villages and boundary exits (or a required-bridge route) is a main road.

## Deterministic work and allocation limits

Frozen sample/feature/vertex/ring/descriptor caps are applied before expensive work; unsupported precision and nonfinite data fail with path context. `GeographyLimits` optionally lowers/sets deterministic work ceilings (positive safe integers, maximum100,000,000). Default work allowances derive from frozen `settings.limits.maxTopologyChecks`:

| Work                             | Default                   | Reservations/checks                                                                                                                                                        |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flood, per pass                  | min(100M,16×topology cap) | 7N buffer/scans before allocation; heap pushes/pops/comparisons; exactly8N flood neighbour checks; interior D8 receiver checks;4N independent accumulation work.           |
| Water construction               | min(100M,8×topology cap)  | Source/authoritative copies, complete corner scans, bounded cropped masks, queues/edges, network decomposition, level windows, reach clipping and cell carving,56N shoulder work, ring topology and exact contact partitions. |
| Water physics/query construction | min(100M,8×topology cap)  | **N samples before Float64 query snapshot**, polygon topology, edge/grid cuts, scanline visits/sorts and interior nodes.                                                   |
| Crossing search/checks           | topology cap              | Actual metered frozen geometry checks, strip/edge scans, interval ordering and bounded output.                                                                             |
| Cover                            | 8×topology cap            | Independently documented complete phase reservations (input/water topology within the topology cap).                                                                     |

A carved map performs two separately bounded flood passes; evidence `flood` describes the final authoritative pass, not their sum. No sample is marked/popped twice **within a pass**. Flood neighbour checks are8N; the separately charged receiver scan is additional. Worst-case source plus final flood work is twice the per-pass limit. Reported work units are deterministic visits/comparisons/staging operations, not CPU instructions. Geometry loops, sorting and allocations have independent caps; timings/timestamps are absent from outputs.

Water output has shared vertex reservation across rivers/lakes. Composition reserves remaining feature/vertex allowance for cover after accounting for water and candidate decks/endpoints. Standalone candidates also have an output vertex cap. Exceeding limits returns typed `GEOGRAPHY_RESOURCE_LIMIT`/cover failure without a partial output. `GeographyFailure` and resource-only `MapValidationError` become expected infeasibility; malformed input and unexpected exceptions propagate. Exact flood work W succeeds and W−1 fails. Topology failures caused by generated cell contacts are handled only at that generated-geometry boundary.

## Presets and fixed corpus

`geographyPreset` materializes5 km-square settings using existing terrain generation. Flat countryside has zero relief, wood.15/field.6. Wooded hills has120 m relief,1000 m feature scale, wood.65/field.1. River valley has60 m relief, roughness.35,1000 m feature scale, threshold100, required river, min20/max100 m river width, reserved8 m, abutment3 m, max span150 m, wood.3/field.4 and **1000 m cover coherence**. Since cover v2 the coherence only sets the soil/woodland noise scale (broad 1 km soil patterns); the cover lattice is 50 m on every preset. Other defaults remain the plan/contract settings.

Representative seeds remain flat17/hills31/river97. Under v2, flat17 has no water; hills31 and river97 have brook and river networks with confluences, no lakes, and bridge candidates whose abutments clear the water (see the realism report in `src/realism.ts` and `tests/realism.test.ts`). The v1 evidence below (a 271-point river97 trunk, 123 candidates) describes the superseded stage. These are component fixtures, not accepted connected settlements/roads.

The24 diagnostic recipes use each preset with **1,2,3,7,17,31,97,55337**, extent1000×1000 m, feature scale400 m, and river threshold10 only for the river preset. All are repeated without retries/seed changes. Flat and wooded recipes all succeed; river seeds2/3/7/17/31/97/55337 succeed, river1 returns bounded `REGION_TOPOLOGY` for its channel. This explicit failure remains in the corpus rather than being replaced with a nicer seed. Fresh processes with C/en_US.UTF-8 locales and1000 unrelated seed draws hash the same full geography result. Browser identity remains a later integration gate.

## Focused commands and evidence

Existing dependencies only, Node v22.22.2 on darwin arm64/Apple M3. No installation, server, fork/client/shared source edit, root build or commit is performed. Exact focused commands from the repository root:

```sh
npm run build --workspace=@kriegsspiel/maps
npm run typecheck --workspace=@kriegsspiel/maps
npx vitest run packages/maps/tests/geography
npx eslint packages/maps/src/geography --ignore-pattern 'packages/maps/src/geography/cover/**' packages/maps/tests/geography-drainage.test.ts packages/maps/tests/geography-water.test.ts packages/maps/tests/geography-crossings.test.ts packages/maps/tests/geography-generation.test.ts packages/maps/tests/geography-queries.test.ts packages/maps/tests/geography-shoulders.test.ts
npx prettier --check 'packages/maps/src/geography/*.ts' packages/maps/tests/geography-drainage.test.ts packages/maps/tests/geography-water.test.ts packages/maps/tests/geography-crossings.test.ts packages/maps/tests/geography-generation.test.ts packages/maps/tests/geography-queries.test.ts packages/maps/tests/geography-shoulders.test.ts
npx prettier --check --ignore-path /dev/null packages/maps/docs/geography.md
```

Final combined run: **7 files/57 tests passed**,4.14 s runner duration (drainage6, water8, crossings7, query5, shoulders4, integration9, independently owned cover18). All listed build/typecheck/scoped lint/format commands exited0. Regressions include exact W/W−1, row-major bowl and D8/Y oracles, dry-island area, complete saddle/interior-hill maxima, input precision/immutability, physics sample-copy reservation, generated corner contacts and translated partitions, full-width bridge/holes/notches/tangency/wet caps/confluence/bounds, bounds shrink/enlarge query snapshots, changed-ground contours, Lipschitz-cap numerical/precision/resource checks,123 full directional/whole-corridor approach probes,24 unchanged recipes, fresh processes, useful frozen default10 km and601×601 maximum flat ground. No root integration or gate acceptance is claimed.

Performance command (generation time excludes source elevation creation; peak RSS is the whole fresh Node process over all cases, including source generation):

```sh
node --input-type=module <<'JS'
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {DEFAULT_SETTINGS} from './packages/maps/dist/contract.js';
import {generateElevation} from './packages/maps/dist/terrain/index.js';
import {geographyPreset,generateGeography} from './packages/maps/dist/geography/index.js';
const cases=[...['flat-countryside','wooded-hills','river-valley'].map((name,i)=>({name,seed:[17,31,97][i],settings:geographyPreset(name)})),{name:'default',seed:17,settings:structuredClone(DEFAULT_SETTINGS)},{name:'maximum-flat',seed:17,settings:{...geographyPreset('flat-countryside'),widthM:15000,heightM:15000}}];
for(const {name,seed,settings} of cases){
  const ground=generateElevation(settings,seed);
  if(!ground.ok)throw Error(JSON.stringify(ground));
  const start=performance.now();
  const r=generateGeography(ground.value,{minX:0,minY:0,maxX:settings.widthM,maxY:settings.heightM},settings,seed);
  console.log(JSON.stringify({name,seed,milliseconds:Math.round(performance.now()-start),...(r.ok?{ok:true,samples:r.value.elevation.samples.length,water:r.value.water.length,cover:r.value.cover.length,crossings:r.value.crossingCandidates.length,evidence:r.value.evidence}:r)}));
}
console.log(JSON.stringify({maxRSSKiB:process.resourceUsage().maxRSS,node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model}));
JS
```

The final command exited0, with all five cases successful:

| Recipe/seed            | Samples | Water | Cover | Candidates | Geography time |
| ---------------------- | ------: | ----: | ----: | ---------: | -------------: |
| Flat5 km/17            |   40401 |     0 |   665 |          0 |         119 ms |
| Hills5 km/31           |   40401 |   157 |  1189 |          0 |         208 ms |
| River5 km/97           |   40401 |    25 |   288 |        123 |         451 ms |
| Frozen default10 km/17 |  160801 |    96 |  1620 |          0 |         763 ms |
| Maximum flat15 km/17   |  361201 |     0 |  2766 |          0 |         605 ms |

Process peak RSS292144 KiB (**285.30 MiB**) on Node v22.22.2/darwin arm64/Apple M3. These are single-run observations, not percentiles or final composed-map timings. River shoulders changed17292 dry samples and used363609 deterministic work units; final flood enqueued/popped40401 samples with323208 flood neighbour checks. Source-plus-final flood work is additional to this final-pass count. `/usr/bin/time -l` was attempted earlier: generation succeeded but the measurement command exited1 because sandboxed `sysctl kern.clockrate` is unavailable; the RSS above uses Node `process.resourceUsage`, not that failed measurement.

The earlier default failure was reproduced exactly: `COVER_LIMIT`, constraint `whole-cell water mask`, "Cover work reservation3523132 exceeds remaining1048709 of5000000." The exclusive cover writer resolved it with bounded scanline/edge-local masking while preserving predicate/output parity, holes, sub-cell water, lattice resolution, five-million cap and elevation counts. Final default regression and the24 unchanged seed recipes pass as specified (river1 remains explicit bounded topology infeasibility). No cover path was edited by the main geography writer.

Coordinator handoff: common public exports are integrated; record the new graded-backwater/shoulder policy and the fixed corpus/resource results in shared decisions/execution documentation. Composition must use returned ground, regenerate contours, retain source provenance, and certify roads/settlements/joins. Browser replay, full15 km complex-water composition, survey-grade water boundaries, hydraulic/erosion models, variable river profiles and general oblique/bending bridges remain outside this component evidence. The coordinator/reviewer determines gate D acceptance.
