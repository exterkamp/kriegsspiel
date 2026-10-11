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
findCrossingCandidates(water, bounds, settings, limits?): GenerationResult<CrossingCandidate[]>
crossingCandidate(id, waterId, endpoints, settings): CrossingCandidate
validateCrossingCandidate(candidate, water, bounds, settings, limits?): GenerationResult<CrossingCandidate>
createGeographyQueries(elevation, bounds, water, settings, limits?): GenerationResult<GeographyQueries>
generateCover(elevation, bounds, water, settings, seed): GenerationResult<Cover[]>
geographyPreset('flat-countryside' | 'wooded-hills' | 'river-valley'): MapSettings
```

Inputs use the frozen types. `GeographyOutput` adds `version`, `sourceElevation`, authoritative `elevation`, `groundChanged`, `drainage`, independent `water`/`cover`, `crossingCandidates`, and deterministic work evidence, including optional shoulder policy/band/cut counts. The existing `HydrologyOutput` lacks cover and source-ground/changed-ground information; `HydrologyStageOutput` is the geography output without cover/candidates. Local `CrossingCandidate` has no final road references: it carries ID, river identity, bridge kind, endpoints/span, reserved width, conservative deck polygon, minimum abutment and policy version. #137 creates final `Crossing` links and road edges. No ford is emitted without a model of depth/traversability.

`GEOGRAPHY_VERSION = 'flood-carved-graded-backwater-v1'`, `CROSSING_VERSION = 'reserved-dry-disks-v1'`, and `GEOGRAPHY_PRESET_VERSION = 'geography-presets-v1'` freeze the policies below. Cover has its independent `COVER_VERSION = 'coherent-dry-runs-v1'`; see [cover documentation](geography-cover.md). Composition records these in generator stage provenance and materializes preset settings. Changing content rules requires a stage version change. Budgets can cause success/failure but never alter a successful result by truncation or seed substitution.

## Ground, priority flood and drainage

Ground, grid metadata and bounds must already be decimal-6-v1 stable, finite, dimensionally valid, and within sample limits. The accepted terrain precondition is reused without mutation. Input samples are copied; source ground is retained in `sourceElevation`. `filledSamples` is always a separate drainage-only array. It is never substituted into terrain queries, contours, cover or settlement placement.

Priority flood seeds **every boundary sample** as an explicit open outlet. A binary min-heap orders `(filled height, row-major sample index)`. A sample is marked on enqueue, enqueued once and popped once. Its filled height is `max(original height, discovery parent's filled height)`; there is no epsilon gradient. This raises closed depressions to their actual spill level. Pop ranks strictly increase; equal-height flats drain through their discovery parent toward an earlier rank. No arbitrary interior sink is inserted: depression lakes ultimately spill to boundary outlets, and `sinks` is empty.

Interior samples with lower filled neighbours choose steepest **metric D8 slope**, drop divided by spacing times Euclidean neighbour distance. Exact slope ties choose smaller sample index. With centre10, S8 and SE7.5, S wins (2/spacing versus 2.5/(spacing×sqrt2)). Otherwise the receiver is the discovery parent. Every receiver decreases `(filled height, pop rank)` lexicographically and reaches a boundary in at most N−1 edges. Boundary samples remain terminal even if a nearby boundary height is lower; this declares external drainage beyond the sampled rectangle rather than simulating off-map flow.

Accumulation contributes one unit per sample, including receivers. Independent Kahn traversal rejects malformed receiver indices, self-loops and cycles. The analytical graph `[4,4,5,4,7,7,7,8,-1]` gives `[1,1,1,1,4,2,1,8,9]`. Stream eligibility uses inclusive `accumulation >= riverThresholdSamples`; widths and threshold are geometry-generation assumptions rather than hydrological discharge estimates.

## Lakes and a physically explicit river policy

Uncarved lakes are conservative **wet cell cores** of actual filled depressions. A cell qualifies only when all four filled corners equal one spill level, all original corners are at/below that level, and at least one corner is lower. Bilinear convex weights guarantee the entire cell is submerged or on the waterline. Cells are grouped by spill level and connected by four-neighbour adjacency. Only the cells' bounding rectangle is allocated/scanned for each level, avoiding a full-map mask per spill level.

Boundary extraction cancels interior cell edges, uses deterministic right-turn ordering and removes only collinear vertices. Ordinary dry islands remain explicit polygon holes. Frozen simple-ring validation detects corner contacts. Lake generation partitions such invalid components into exact horizontal rectangles, each a separate feature: their union retains every wet cell and dry hole/gap, without positive-area overlap or invented water. The low-level region primitive can instead return typed `REGION_TOPOLOGY`; malformed imported polygons still throw validation errors. Excess rings/holes/features/vertices fail rather than losing cells. Lake area is represented-cell count times spacing². Partial shoreline cells are deliberately excluded, so this is a conservative wet core, **not** an exact inundation boundary or a measured lake-volume model.

Depression-only water does not provide a useful river on ordinary free-draining slopes. The versioned fallback therefore selects a **single accumulation-derived trunk** from source drainage: longest qualifying route to a boundary, sample-index tie-break, at least five samples. No alternate seed is tried. Flat fields have no trunk; required-river requests then return `RIVER_INFEASIBLE`.

Carving needs `maxRiverWidthM >= 4 × sampleSpacingM`, allowing an interior submerged node row and grid-aligned banks. Full channel cells are included only inside the requested maximum-width capsules along the source D8 trunk. Actual authoritative polygons are a conservative raster subset; `widthM` records that maximum construction width, not a promise that every raster cross-section has that exact width. Crossings independently enforce actual minimum wet width. Bounds clip water at the declared boundary outlet; infrastructure abutments receive no clipping exception.

The fallback cuts channel bank nodes to an explicit constant standing stage and interior nodes to one metre below it. The stage is `decimal6(min(source ground) − 1 m − axisGradeCap × guaranteedBandSteps × spacingM)`. The river uses explicit constant `surfaceProfileM` and `standing-water-v1` on updated ground. It follows the source's qualifying downstream trunk and terminates at the declared boundary stage; it is not a pond relabelled as a river. Outside channel nodes stay above the stage, so bilinear interpolation cannot create unsupported exterior flooded land. Banks are on the waterline. This is a coarse artificial graded valley with prescribed downstream backwater, potentially substantially cut into source terrain. It is not erosion, discharge, seasonal hydrology or surveyed bathymetry.

### Graded banks and approaches

`SHOULDER_POLICY = 'manhattan-lipschitz-cut-v1'` resolves a measured integration failure: before grading, **zero of123** river97 candidates had both outward25 m connectors below the10% maximum; the best pair was13.635%/16.126%. Dry geometry alone was insufficient.

A deterministic four-neighbour multi-source BFS measures integer Manhattan distance from channel nodes, with enqueue/pop once and a fixed N-sized queue. Set `axisGradeCap = maxGrade/(2×sqrt2) − 2e−6/spacingM` and `guaranteedBandSteps = ceil((3×spacingM + maxReservedWidthM + minimumAbutmentM)/spacingM)`. A nonpositive cap is typed `SHOULDER_PRECISION` infeasibility. Each dry node is cut to `min(existing ground, decimal6(stage + axisGradeCap × spacingM × distanceSteps))`; terrain is never raised. The stage offset ensures the cap wins against every original height inside the guaranteed band. Cardinal distance changes by at most one between neighbouring nodes, so each derivative component is bounded by `axisGradeCap + 1e−6/spacingM` after rounding. In a dry bilinear cell whose four corners lie within the guaranteed band, the **complete analytic gradient norm** is consequently at most `sqrt2 × (axisGradeCap + 1e−6/spacingM)`, below half the requested maximum. This bound includes seams and interiors, rather than checking only centres.

For river97/25 m spacing, the guaranteed Manhattan band is100 m and the norm bound is0.05 against requested0.10. **100 m is not the maximum cut extent:** the cap cuts anywhere within the bounded field where original ground exceeds it. Beyond the guaranteed band, the minimum with original terrain may retain steep source slopes; no global grade certificate is claimed. The primitive is intentionally a cut-only graded valley, not hand-waved smoothing or realistic civil engineering.

After grading, all123 candidate pairs pass an independent complete-interior25 m directional-grade oracle; the first pair has maxGrade0.03535528 on each side. Tests split every connector at sample-cell seams and evaluate quadratic derivative extrema, then conservatively bound gradient over every cell in the complete reserved-corridor bbox. Water shape/stage validity and source preservation are checked again. This supplies useful approaches, while **#137 must still independently certify exact full routes/corridors, grade transitions outside the band, bridge deck elevation and road joins**. No movement/building/gameplay rule is relaxed. Shoulder work reserves9N units before two buffers/seed-height scans/queue pops/≤4N neighbour visits; exact W succeeds and W−1 fails. Evidence records policy, guaranteed band, gradient cap, changed dry sample count and work; it is deterministic and decimal6 normalized.

Drainage is recomputed on the carved authoritative field; remaining depression lakes use this new filled surface and exclude river cells. `sourceElevation` is retained for audit, `elevation` becomes authoritative, and `groundChanged` is true. **Composition must regenerate contours from this returned normalized elevation before sites/roads/local layouts**, then independently certify them; it must not retain source-field contours or query filled drainage. The frozen asset can retain authoritative ground plus filled drainage; replay can reconstruct pre-carve source ground from the recorded terrain version/settings/seed. Persisting an extra audit snapshot would require a coordinator-owned additive contract change.

`validateWaterPhysics` independently validates shape and certifies ground at/below an explicit constant water surface over the **complete polygon**, including holes. It splits every boundary edge at grid seams, evaluates both endpoints and any quadratic maximum in each piece, and checks interior grid nodes with even/odd scanlines. Bilinear patches have no strict interior maximum; internal grid seams are linear, so those boundary extrema and grid nodes cover all maxima. This catches the river saddle `h=−(x−50)(y−50)` whose endpoints are −625 but interior reaches0, and a submerged outline enclosing a dry interior hill. Ground excess above **1e−7 m** fails; authoritative inputs/water stage must be decimal6 stable. Variable standing profiles and `carved-ground-v1` are explicitly unsupported by this certificate, rather than accepted by label. This validates the represented water area, not the complete upstream catchment or physical discharge.

## Cover and suitability queries

Composition passes authoritative original/carved ground, never filled ground, to the independent [cover module](geography-cover.md). Wood/field/open remain separate from water/infrastructure. Coherence, conservative water masking, dry islands, slope restrictions, achieved area fractions and raster/rectangle limitations are documented there. Cover settings or unrelated settlement-stream draws cannot change ground, water, drainage or crossing candidates.

`createGeographyQueries` snapshots ground, water and numeric bounds. It delegates `heightAt`, analytic `gradientAt` and `slopeAt` to **existing** `createElevationQueries`; no competing interpolation is introduced. Exact maximum bounds and seam ownership are the accepted terrain-query rules; nonfinite/out-of-bounds inputs throw. `waterAt(x,y)` returns sorted IDs of bodies covering the point, including boundaries while respecting hole interiors. `isDry(x,y,radiusM=0)` checks a closed disk is in bounds and separated from every water boundary; contact within1e−9 m counts wet. Both return bounded `GenerationResult`s with a fresh per-call work allowance. Negative/nonfinite radii are errors. Caller mutations after construction cannot alter any query.

These are point/disk suitability primitives, **not** whole-footprint certificates. #137/#138/#139 still require independent complete polygon/corridor checks for grade, buildings, roads and composition joins. Candidates do not certify bridge deck elevation, structural support, approach grade or road connectivity.

## Crossing suitability

Candidates are bridges over one identified river. Reserved width is `settings.roads.maxReservedWidthM`. The complete closed abutment disk radius is `width/2 + minimumAbutmentM`: river20 m/reserved8 m/abutment3 m requires radius7 m. **Exact tangency is rejected** by this local suitability policy, although the general contract allows tangency for some corridor relations. Search adds2e−6 m clearance before decimal6 rounding; a1e−6 m positive-control clearance succeeds. Disks, conservative deck and reserved end caps must fit bounds. The deck is a deterministic rectangle containing the round-cap reserved capsule, so its extra corners are conservative. Span must equal endpoint distance within recorded coordinate tolerance and fit `maxCrossingSpanM`.

The centreline must intersect one contiguous wet reach with actual width at least `minRiverWidthM`. Dry holes touching the entire reserved capsule are rejected, including holes missed by centre and side traces. A full transverse-strip certificate requires exactly two straight opposing banks covering every lateral offset in the reserved width; bank notches, bends, wet caps and oblique banks are conservatively rejected. Crossings of another water identity in the reserved corridor are rejected as confluences. This deliberately admits fewer crossings than a general polygon/bridge solver. Malformed geometry/parameters remain errors; ordinary unsuitability is typed infeasibility. Candidate search tests trunk-segment midpoints in order and returns all feasible candidates within the output/work caps, or failure with **no partial value**. It never returns a truncated successful list.

## Deterministic work and allocation limits

Frozen sample/feature/vertex/ring/descriptor caps are applied before expensive work; unsupported precision and nonfinite data fail with path context. `GeographyLimits` optionally lowers/sets deterministic work ceilings (positive safe integers, maximum100,000,000). Default work allowances derive from frozen `settings.limits.maxTopologyChecks`:

| Work                             | Default                   | Reservations/checks                                                                                                                                                        |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flood, per pass                  | min(100M,16×topology cap) | 7N buffer/scans before allocation; heap pushes/pops/comparisons; exactly8N flood neighbour checks; interior D8 receiver checks;4N independent accumulation work.           |
| Water construction               | min(100M,8×topology cap)  | Source/authoritative copies, complete corner scans, bounded cropped masks, queues/edges, route raster visits,9N shoulder work, ring topology and exact contact partitions. |
| Water physics/query construction | min(100M,8×topology cap)  | **N samples before Float64 query snapshot**, polygon topology, edge/grid cuts, scanline visits/sorts and interior nodes.                                                   |
| Crossing search/checks           | topology cap              | Actual metered frozen geometry checks, strip/edge scans, interval ordering and bounded output.                                                                             |
| Cover                            | topology cap              | Independently documented complete phase reservations.                                                                                                                      |

A carved map performs two separately bounded flood passes; evidence `flood` describes the final authoritative pass, not their sum. No sample is marked/popped twice **within a pass**. Flood neighbour checks are8N; the separately charged receiver scan is additional. Worst-case source plus final flood work is twice the per-pass limit. Reported work units are deterministic visits/comparisons/staging operations, not CPU instructions. Geometry loops, sorting and allocations have independent caps; timings/timestamps are absent from outputs.

Water output has shared vertex reservation across rivers/lakes. Composition reserves remaining feature/vertex allowance for cover after accounting for water and candidate decks/endpoints. Standalone candidates also have an output vertex cap. Exceeding limits returns typed `GEOGRAPHY_RESOURCE_LIMIT`/cover failure without a partial output. `GeographyFailure` and resource-only `MapValidationError` become expected infeasibility; malformed input and unexpected exceptions propagate. Exact flood work W succeeds and W−1 fails. Topology failures caused by generated cell contacts are handled only at that generated-geometry boundary.

## Presets and fixed corpus

`geographyPreset` materializes5 km-square settings using existing terrain generation. Flat countryside has zero relief, wood.15/field.6. Wooded hills has120 m relief,1000 m feature scale, wood.65/field.1. River valley has60 m relief, roughness.35,1000 m feature scale, threshold100, required river, min20/max100 m river width, reserved8 m, abutment3 m, max span150 m, wood.3/field.4 and **1000 m cover coherence**. The coarser river cover policy bounds masking work for its long channel; it does not reduce elevation resolution or alter sample counts. Other defaults remain the plan/contract settings.

Representative seeds remain flat17/hills31/river97. River97 produces a271-point downstream trunk and123 crossing candidates with grade-feasible25 m outward connectors; the first spans64.000004 m with8 m reserved width and7 m dry disks. These are component fixtures, not accepted connected settlements/roads.

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
