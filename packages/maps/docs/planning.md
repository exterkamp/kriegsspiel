# Regional planning (#137 / gate E)

`src/planning/index.ts` owns the deterministic, generation-independent regional
planner. It consumes **accepted decimal6 authoritative ground**, bounds, water,
optional independent cover, D crossing proposals, recorded settings and a seed.
It changes none of those inputs. It does not import or execute SettleMaker.
`PLANNING_VERSION = sited-graded-fording-network-v3` (D46; `sited-graded-network-v2`, bridges
only, remains `LEGACY_PLANNING_VERSION` for saved maps); `DECK_POLICY =
linear-ground-endpoints-v1`. Changing geometry, sizing, tie breaks or cost policies
requires a planning version change. Local sizing/deck certificates retain full precision analytic metadata; frozen
asset geometry remains decimal6. When assembling a canonical asset, retain or
recompute these certificates from its authoritative geometry rather than applying
asset decimal6 rounding to derived height/grade evidence. No clock, ambient random, locale-dependent
comparison or unrecorded seed replacement participates in output.

## Public seam

```ts
generatePlanning(input: PlanningInput): GenerationResult<RegionalPlanningOutput>
certifyFootprint(input, polygon): GenerationResult<Suitability>
directionalGrade(input, from, to): GenerationResult<number>
certifyRoadSegment(input, from, to, widthM?, boundarySide?): GenerationResult<CorridorCertificate>
certifyBridge(input, candidate, deckProfile?): GenerationResult<DeckProfile>
certifyFord(input, candidate): GenerationResult<FordProfile>
validateRoadPath(input, path, widthM?): GenerationResult<{ maxDirectionalGrade: number }>
validatePlanning(input, plan): GenerationResult<{ connected: true; validationWork: number }>
reconcileLocalJoins(input, plan, actualJoins, pass?, previousWork?): ReconciliationResult
```

`PlanningInput` is defined in `src/planning/types.ts`. Required fields are
`elevation`, `bounds`, `water`, `settings`, `seed`. Optional fields are `cover`,
`crossingCandidates`, ordered frozen `overrides`, `limits`, `boundarySides`, and
`requireBridge`. One west boundary exit is the default; an explicit empty list
requests none. A singleton requested terminal returns `REGIONAL_TERMINALS`
rather than silently dropping its certified exit/approach. Zero sites with an
explicit empty boundary list is a legitimate empty plan. Independent validation
compares the complete requested boundary-side set. `requireBridge` requires a linked, used bridge in a route between
required sites, rather than merely retaining geometric proposals.

Successful output extends the frozen `PlanningOutput`: `sites`, `roadNodes`,
`roads`, `crossings`, plus `version`, `sizes`, `routes`, `decks` and resource
`evidence`. Logical route IDs describe site/exit relationships and collect actual
edge IDs; their arrays are sets in stable order, not an ordered travel itinerary.
An edge can carry multiple logical route IDs. Place IDs use the frozen recipe
slots, independent of names, seed and geometry. Node/edge IDs encode decimal6
world positions in integer micrometres; geometry changes can change those IDs.
Crossing IDs retain D proposal identity. All graph intersections are explicit
shared endpoint nodes; overlaps split into unique edges with merged provenance.

Expected impossibility is `ok:false, kind:'infeasible'`, with a named diagnostic,
constraint and remediation, and no partial success. Resource exhaustion is
`PLANNING_RESOURCE_LIMIT`; counts, exits, routes, bridges and reconciliation have
separate actionable diagnostics. Invalid input schemas, unsupported precision,
missing override IDs, malformed topology and unexpected programmer errors throw
rather than being hidden as ordinary generation failure.

## Sites and approaches

Candidate anchors occupy a deterministic coarse lattice with stride
`max(planningSpacing, floor(max(planningSpacing,minSpacing/6)/planningSpacing)
* planningSpacing)`. This does not resample or reduce authoritative elevation.
v2 (`SITE_PREFERENCES`, #490) ranks candidates by a landscape score, lower is
better, then a `places:v1` derived seed, then y/x. The score adds
`3 × (footprint gradient / maxBuildingGradient)²`; a summit penalty (2 × the
anchor's height above the mean of eight points on a 400 m ring, relative to 15%
of map relief) and a smaller valley-floor bonus; on maps with rivers, a bog
penalty when the anchor stands less than 2 m above the nearest river surface,
a penalty for being within 120 m of a river bank or more than 700 m from any
river, and bonuses within 500 m of a bridge candidate and 600 m of a
confluence (farms weigh water terms at 0.3); and a margin penalty within 400 m
of the map edge. Villages therefore settle on gentle valley floors near
crossings and confluences, not on summits or river flats. Nearest-river
queries use 250 m segment bins. Greedy required slots preserve spacing and
reject footprint overlap.
Hard moved anchors place first. The frozen ordered override resolver provides
last-write-wins names/anchors and a union of exclusions. Renaming changes no
geometry or geometry identity. An exclusion never silently reduces required
counts.

The v1 permissible square takes the smallest extent satisfying **both** the
configured area and extent intervals, rounded upward to planning spacing when
still permitted. Default villages are 100 × 100 m (10,000 m²); farms are 25 × 25 m
(625 m²). These are recorded permissible regions, not eventual occupied layouts.
Population remains requested, assigned zero and unassigned equal to requested.
F must fit actual buildings, streets and populations or return bounded
infeasibility; no fictional internal streets/buildings are emitted here.

Footprint certificates clip outer/hole boundaries against every overlapping
bilinear elevation cell. In a cell the analytic gradient is affine, so its norm
has its maximum at vertices of the clipped permissible region. Cell corners,
clipped boundary vertices and hole boundaries are checked; an interior raised
node cannot hide behind a flat anchor/outer ring. A hole excludes its interior;
its boundary remains authoritative. Complete bounds and closed water contact
checks preserve dry islands. Area and extent, measured from actual polygon area
and world-axis bounds, are independently recomputed at validation and compared
to configuration and sizing evidence. A point query is never a footprint
certificate.

Each site has one real regional entrance: a boundary midpoint with an outward
certified connector to an external planning node. The network therefore connects
required approaches without depending on a future internal street graph. Other
site regions block road search. The terminal approach has permission to meet its
own permissible boundary; no occupied footprint exists yet. Entrance width is
reserved width, bearing is clockwise from north toward the external tangent,
and node/path endpoint/route provenance is explicit.

## Terrain-cost routing, crossings and normalization

The bounded internal lattice uses eight neighbours (axes and diagonals), so roads
run at 45° as well as along the grid instead of in staircases. v2 traversal
cost (`ROUTE_COSTS`, #490) is length × `(1 + 6g + 120g² + margin)`, where `g`
is the certified maximum directional grade and `margin` rises to 0.6 within
150 m of the map edge: roads wind along contours, valleys and spurs and keep
off the margin. A bridge costs `2 × span + 250 m`, so routes share crossings.
Edges already emitted by earlier routes cost 0.55 ×, so later routes join the
network at junctions rather than running in parallel. Search is weighted A*
(Euclidean heuristic, at most `1/0.55` above the optimal cost) and lazy: a
lattice edge is queued with the lower bound given by its endpoint height
difference and certified only when popped; a dearer certified cost is
re-queued and an uncertifiable edge dropped, so every emitted edge is certified
exactly as before. Cover remains an independent layer and does not block roads
or change height; no wood cost penalty applies. Equal f/g costs break by node
index, then predecessor. A deterministic nearest connection process grows the
required spanning network; failed pairs are excluded with a bounded retry
count. Configured extra site links add bounded redundancy. Requests that cannot
be satisfied return infeasibility.

Ground segments use existing `createElevationQueries`, not a competing height
implementation. Centreline segments split at every elevation cell seam. Three
height samples determine the quadratic restriction of the bilinear surface;
both derivative endpoints give its complete directional-grade extremum. This
finds equal-endpoint humps. A contour-following road may pass even when gradient
norm is large: road grade is the gradient dotted with travel direction.

Reserved round capsules are checked for complete closed water contact and
bounds. Gradient certification conservatively examines all corners of each cell
touched by the capsule, bounding its clipped interior as well as bend/end caps.
Touched cells are found by `segmentNearCell`, an allocation-free form of the
same predicate (endpoint in the closed cell, a Liang–Barsky crossing, or an
endpoint/corner distance within the radius plus the 1e-9 m contact slack).
This may reject a road that an exact curved capsule intersection could accept;
it cannot accept an over-grade corridor under the declared bilinear model.
Grade tolerance is **1e-12**; it is not relaxed to accommodate rounding. Only a
terminal, normal connector at an explicit boundary exit clips its round cap at
that map edge. Other cap containment is unchanged.

Bridge proposals are rechecked with D's caller-metered full geometry validator,
including **all water**, full reserved width and closed dry-abutment disks of
radius `width/2 + minimumAbutment`. No deck-bbox filter may omit water relevant to
those larger disks. Geometry alone is insufficient: both endpoints receive
certified outward planning-spacing connectors and lattice attachment connectors.
Each exported abutment must actually join an emitted certified ground edge.

The explicit bridge deck is linear between authoritative dry endpoint heights,
with continuity tolerance **1e-7 m**, and constant endpoint cap heights. Deck
grade is their height difference divided by span; underwater ground is not a
road-grade shortcut. Both heights must be finite and form a length-two tuple.
Planning accepts only constant standing-water river reaches; the deck must remain
strictly above that surface by **1e-7 m** over the complete wet interval/full
transverse reach certified by D. Unsupported variable/carved profiles return a
named infeasibility. Detailed clearance, structural physics and gameplay bridge
capacity are outside this stage.

### Fords (D46)

Ford candidates (`shallow-riffle-v1`, see [geography](geography.md)) are certified
by `certifyFord`: the same full crossing geometry as a bridge; a constant
standing-water reach whose modelled riffle depth is at most 0.8 m and equals the
recorded `depthM` (1e-6 m); both ends at most 1.5 m above the water; and dry
ramps from each end to the water no steeper than the road maximum. The
`FordProfile` records depth, bank heights and ramp grade; the plan lists them in
`fords` as bridges are listed in `decks`. A ford edge costs `3 × span + 120 m`.
Each ford end joins the lattice by every certified straight connector to a node
within two spacings ahead of the bank, each costed by grade like a lattice edge,
so the road can slant up the valley side toward where it is going.

**Main roads never ford.** A route with a farm at either end is a minor road and
may use ford edges; a route joining only villages and boundary exits, and the
required-bridge route, may not. Since road IDs carry their route IDs,
`validatePlanning` and `validateBattlefield` check this from the asset alone
(`FORD_MAIN_ROAD`). `requireBridge` (and a required river map) still needs a
linked bridge; a ford does not satisfy it. Emitted fords set
`traversableWidthM` to the reserved width.

No smoothing is performed. The public path validator checks replacement geometry
from scratch. It requires at least two finite, nondegenerate points and checks
all capsules, bend caps and seams. A bridge-aware simplifier must preserve deck
endpoints/IDs/joins and validate with `validatePlanning`; `validateRoadPath`
certifies ground paths only. Planarization rounds intersections to decimal6 and
**revalidates the complete emitted result**, including newly split segments. The
regression with a nearly limiting asymmetric plane proves a rounded subsegment
is rejected as `ROAD_CORRIDOR`, even when original segments passed.

Final validation separately walks the actual certified emitted graph, enforces
exact counts/entrance references/bearings, reciprocal crossing references,
continuous grade-valid decks and ground approaches, boundary exit degree one,
and rejects unjoined geometric intersections. Validation resolves input overrides again, enforces geometry-independent slots,
hard moves, names and exclusions, and checks each logical route's reciprocal
road/crossing memberships and graph connectivity through its own emitted edges.
Ground paths cannot backtrack or enter unrelated permissible regions; an actual
terminal tangent must leave its own region outward. Contract parse alone is not
this certificate.

## Bounded actual-join reconciliation

F supplies `LocalJoin` world-space metres, after its complete local transform:
stable `siteId`, existing `entranceId`, `endpoint`, clockwise-from-north bearing,
and reserved width. V1 replaces one terminal ground approach with a direct
outward tangent and connector to its existing external attachment. It preserves
logical/edge/entrance IDs, validates the complete changed plan and never claims
the local internal street network is certified. A wet, steep, out-of-region,
intersecting or incompatible actual join returns named infeasibility. It does
not silently relocate buildings or regenerate a settlement. A later composition
policy may retry the local layout within the frozen caps.

Passes are bounded by `maxReconciliationPasses`. `ReconciliationResult` exposes top-level `work` and `passes` on **both success
and expected infeasibility**. Pass those fields into the next call as
`previousWork` and `pass = passes + 1`; failure consumption therefore survives
retries. A subsequent pass with zero prior work is rejected. The returned work
is cumulative, including construction/validation work consumed before a failure.
All validation charges during reconciliation also consume
`maxGlobalReconciliationWork` **before** execution, including failed joins.
Composition owns this state across retries and must not reset it. Work or pass
exhaustion is explicit. This seam checks regional joins only; F/G must independently
certify actual streets, occupied footprints, building exclusions, population
success and all composed joins.

## Resource policy

Every schema-counted output coordinate is reserved before its node/road/crossing
insertion, including site placement rings, anchors and entrance endpoints.
Features also reserve before insertion; max-feature-1 and max-vertex-25 regressions
stop before the forbidden map allocation.

Settings remain the frozen configurable defaults. No caps are silently increased.
Planning cells are checked before arrays or the node lattice are allocated.
Height snapshots reserve sample work first. Descriptor-safe imports reject
nonfinite data and accessor/prototype anomalies. Water topology, spatial-edge
index creation and every query are charged to one shared validation meter.
Crossing validation forwards its charges into that same meter, including failed
proposals. Per-route and global A* expansions are separately enforced; heap
comparisons, stale entries and per-search arrays also consume bounded work.
Candidates, placements, routing retries, output and reconciliation have separate
caps. Successful output includes deterministic operation counts; timestamps and
timings are excluded.

Optional `PlanningLimits` can lower or explicitly increase stage work caps without
changing successful geometry: candidate work defaults to
`min(100000000, maxPlanningCells*64)`, validation work to
`min(100000000, maxTopologyChecks*20)`, heap work to
`min(100000000, maxGlobalExpansions*16)`. Each override is a positive safe integer
at most 100 million. Output uses the smaller stage feature override when supplied
and settings feature/vertex caps. Candidate suitability scans are budgeted work,
not local-layout retries; v1 attempts at most one pre-certified placement per
required site, within the per-site/global placement attempt settings. Network
pair attempts are at most terminal-count squared; expansions and validation
remain aggregate even on failed searches. No exhausted pass returns truncated
success.

## Focused evidence and limits

Focused commands (repository root, existing dependencies only):

```sh
npm run build --workspace=@kriegsspiel/maps
npm run typecheck --workspace=@kriegsspiel/maps
npx vitest run packages/maps/tests/planning*.test.ts
npx eslint packages/maps/src/planning packages/maps/tests/planning*.test.ts
npx prettier --check packages/maps/src/planning packages/maps/tests/planning*.test.ts packages/maps/docs/planning.md
```

The final focused suite contains **31 tests in five files**. It includes full
clipped footprints/holes, thin edge water, plane directional grade, bilinear
hump, full bridge geometry and continuous deck heights, malformed tuple/path
regressions, exact counts/spacing, naming/moves/exclusions, emitted graph walk,
asymmetric join reconciliation, normalized planarization rejection, resource
failures, fresh processes/locales/unrelated streams, default/max and fixed seeds.
Exact final results and measurement commands are recorded below.

The fixed diagnostic corpus retains seeds **1,2,3,7,17,31,97,55337** for each D
preset, with recorded 1 km diagnostic dimensions, terrain feature scale 400 m,
site spacing 150 m and zero extra links; river threshold is 10. These settings are
explicit diagnostic recipes, not replacements for the production representatives.
The required production recipes retain actual **5 km** preset settings and seeds
**flat17, hills31, river97**, each with **four villages and six farms**. The river
representative explicitly requires a used bridge. An independent fixture fixes
sites on opposite banks and demonstrates a bridge on their actual regional route.

All certificates are against the accepted coarse bilinear field, not surveyed
foundations. Four-neighbour search, coarse anchor candidates, conservative
capsule gradient bounds and direct join reconciliation can return infeasibility
where a finer or different bounded planner would find a solution. F/G own full
settlement capacity/geometry/composition validation. E does not certify water
physics anew, render anything, publish/distribute GPL code or accept later stories.

The 24 diagnostic results are reproducible typed outcomes:

| Preset (1 km diagnostic) | Seeds 1 / 2 / 3 / 7 / 17 / 31 / 97 / 55337 |
| --- | --- |
| flat-countryside | All eight succeed |
| wooded-hills | All eight `SITE_COUNT_INFEASIBLE`: ten 150 m-spaced complete footprints cannot be placed under the recorded steep 400 m feature-scale recipe |
| river-valley | Seed 1 retains upstream D `REGION_TOPOLOGY`; the other seven succeed with used bridges |

Performance command (after the focused package build; timing and RSS appear only
in this evidence, never in an asset/result):

```sh
node --input-type=module <<'JS'
import { DEFAULT_SETTINGS } from './packages/maps/dist/contract.js';
import { generateElevation } from './packages/maps/dist/terrain/index.js';
import { generateGeography, geographyPreset } from './packages/maps/dist/geography/index.js';
import { generatePlanning } from './packages/maps/dist/planning/index.js';
for (const [name, seed, extent] of [
  ['flat-countryside', 17, 5000], ['wooded-hills', 31, 5000],
  ['river-valley', 97, 5000], ['default', 17, 10000],
  ['flat-countryside', 17, 15000],
]) {
  const s = name === 'default' ? structuredClone(DEFAULT_SETTINGS) : geographyPreset(name);
  s.widthM = s.heightM = extent;
  const bounds = { minX: 0, minY: 0, maxX: extent, maxY: extent };
  const ground = generateElevation(s, seed);
  if (!ground.ok) throw Error(JSON.stringify(ground));
  const geography = generateGeography(ground.value, bounds, s, seed);
  if (!geography.ok) throw Error(JSON.stringify(geography));
  const t = performance.now();
  const result = generatePlanning({settings:s, seed, bounds,
    elevation:geography.value.elevation, water:geography.value.water,
    cover:geography.value.cover, crossingCandidates:geography.value.crossingCandidates,
    requireBridge:name==='river-valley'});
  console.log(JSON.stringify({name,seed,extent,elapsedMs:Math.round(performance.now()-t),
    peakRSSMiB:Math.round(process.resourceUsage().maxRSS/1024*10)/10,
    result:result.ok?{sites:result.value.sites.length,nodes:result.value.roadNodes.length,
      roads:result.value.roads.length,bridges:result.value.crossings.length,
      evidence:result.value.evidence}:result}));
}
JS
```

Final measurement results on Node **v22.22.2**, one sequential process:

| Recipe | Planning cells | Sites | Nodes / roads | Used bridges | Planner ms | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 km flat17 | 40,401 | 10 | 897 / 900 | 0 | 486 | 125.1 |
| 5 km hills31 | 40,401 | 10 | 685 / 688 | 0 | 511 | 164.8 |
| 5 km river97 | 40,401 | 10 | 1,090 / 1,100 | 2 | 1,101 | 222.3 |
| Default 10 km seed17 | 160,801 | 10 | 1,166 / 1,169 | 0 | 2,573 | 249.7 |
| Maximum 15 km flat17 | 361,201 | 10 | 2,729 / 2,734 | 0 | 4,607 | 386.0 |

Each has four villages and six farms, ten placement attempts and one explicit
west boundary exit. Timing measures the planner only; process peak RSS is
cumulative and includes terrain/geography generation and prior cases. These are
local measurements, not an isolated per-stage memory guarantee or a performance
acceptance ceiling. Maximum nonflat maps were not measured here.

| Recipe | Candidate work | Validation work | Heap work | A* expansions |
| --- | ---: | ---: | ---: | ---: |
| 5 km flat17 | 541,278 | 3,079,493 | 1,287,969 | 19,217 |
| 5 km hills31 | 607,910 | 6,980,470 | 1,429,576 | 28,206 |
| 5 km river97 | 697,747 | 12,633,269 | 1,645,101 | 28,888 |
| Default 10 km seed17 | 1,322,516 | 26,001,653 | 5,049,301 | 43,275 |
| Maximum 15 km flat17 | 5,091,806 | 28,298,757 | 11,620,072 | 160,410 |

Final focused checks all exit **0**:

- `npm run build --workspace=@kriegsspiel/maps`
- `npm run typecheck --workspace=@kriegsspiel/maps`
- `npx vitest run packages/maps/tests/planning*.test.ts`: **31 passed / five files**, 18.05 s wall duration. Files: geometry 12, network 7, review 7, rounding 1, generation 4.
- `npx eslint packages/maps/src/planning packages/maps/tests/planning*.test.ts`
- `npx prettier --check packages/maps/src/planning packages/maps/tests/planning*.test.ts packages/maps/docs/planning.md`

The independent reviewer reports source probes PASS for all relayed findings.
In particular, a failed small-map join returns work321/pass1; carrying it into
pass2 under cap641 returns `PLANNING_RESOURCE_LIMIT` with cumulative work641,
while exact cap642 returns `RECONCILIATION_ID` with work642. Pass2/priorwork0 is
rejected. An ordinary outward reconciliation returns matching top-level/value
work948. Descriptor probes invoke zero getters. Output feature cap1 allocates
zero output map entries; vertex cap25 stops at twelve entries before the forbidden
thirteenth. The asymmetric 30° outward-tangent regression passes; inward and
backtracking connectors reject. These are source-only probes, separate from the
focused package suite. No root checks or browser/settlement acceptance were run
by this implementer; the coordinator owns final checkpoint acceptance.

## Reusable composition certificates

`createPlanningCertificates(input)` constructs one private terrain/water index and
returns bounded `footprint`, `roadSegment`, `directionalGrade` and `bridge`
methods, plus metered `heightAt`/`gradientAt` queries and cumulative `work`.
Methods delegate the same accepted numerical validators; they add no second
surface or geometry policy. Query samples, water, settings, bounds and grid
metadata are detached from caller changes. Every check, including failed checks,
shares one aggregate validation budget. Composition must retain this instance
through its local-layout attempts rather than reset it for each building or retry.
The returned callable object is an implementation context, never canonical asset
data. Invalid schemas/callback arguments throw; expected resource exhaustion uses
the existing typed planning diagnostics.

The coordinator’s default10km flat-ground probe took820ms for ten standalone
footprint calls, versus148ms including initialization with one reusable context.
Separate fresh processes observed178MiB and111MiB peak RSS respectively. These
are small context-reuse observations, not full composition/performance acceptance.
Four focused regressions cover numerical parity, detached mutation, exact shared
exhaustion across repeated failures and zero getter invocation. Integration and
independent review are recorded in the execution log.

The reusable certificate factory also accepts an optional ephemeral work-charge
callback. It reserves the caller's work before every metered operation and
propagates callback exceptions without changing their identity. Composition can
bind the fork's local callback budget during an authority call while retaining
the factory's aggregate global budget; work is never charged only after a query
has already run. This hook is not serialized as a generation input.

## Derived site sizing preference

Composition may supply `preferredSiteExtentM` for villages or farms. Preferences
are descriptor-safe, finite, and inside the intersection of the recorded area
and extent intervals. They are checked before terrain query allocations and
copied into the planning context. The planner rounds upward on its existing
lattice when that remains inside the interval; otherwise it uses the permitted
preference. Omitted preferences retain the accepted minimum-size behavior.
Whole permissible-area certificates, spacing, topology and independent sizing
validation still apply. The caller records any content-affecting derived sizing
policy in its generator version; preferences do not overwrite saved settings.

The reusable `roadSegment` accepts the existing optional boundary-exit side.
It forwards the same certificate policy, with the interior endpoint first and
the boundary endpoint second, retaining shared cumulative work. This exposes
the accepted clipped-boundary rule without rebuilding the surface context.
