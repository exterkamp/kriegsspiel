# Procedural map architecture: SettleMaker assessment (#133)

Assessment of [story 9.1](https://github.com/exterkamp/kriegsspiel/issues/133), under [D18](decisions.md#d18-procedural-battlefield-maps-are-a-standalone-milestone) and the [M3c implementation plan](map-implementation-plan.md). The coordinator owns decision-log, roadmap, execution-log and GitHub updates. This note selects extension seams; it does not accept or resume the preserved elevation prototype.

## Selection and authority

Use SettleMaker's **physical `createSettlementModel` pipeline, village preset**, behind a narrow adapter. Retain the physical city preset as a compatible metre-based option for a later dense settlement requirement, without making elaborate cities a milestone requirement. Do not build battlefield composition on the legacy city API. The physical village reuses the legacy village frontage solver; it is a common model/output boundary, not a new terrain solver.

The owner has chosen SettleMaker, simple building footprints, and a standalone generation/preview/adjust/export milestone. Planner choice, package seams and the configurable values below are engineering recommendations/assumptions supported by this assessment. They are not owner-approved gameplay rules. Numerical elevation supplements the flat HQ map; no elevation mesh, gameplay loading, unit movement, visibility migration or scenario balancing is included.

The selected planner **cannot yet produce a validated terrain-constrained battlefield settlement**. Water-aware placement is useful, but exact regional joins, terrain gradients, exclusions, bounded site geometry and complete constraint diagnostics require #138 before #139 accepts composed layouts. Drawing contours over an unconstrained settlement or deleting unsuitable buildings after allocation is not acceptance.

## Immutable source and evidence

| Item | Assessment pin |
| --- | --- |
| Fork | `https://github.com/dfezzie/settlemaker.git` |
| Upstream | `https://github.com/barrulus/settlemaker.git` |
| Commit | `d5cf3590cf59e1d382110d25a6910f12507299e2` |
| Git tree | `ee7db196403a98c5a2ab2378fcaed7c757080250` |
| Commit subject | Merge pull request #13: “Unify settlement appearance and planning; cap legacy temple sizes” |
| Source package version | `3.0.1`; physical planning is documented as an unreleased development preview, so this version alone is insufficient |
| `package-lock.json` SHA-256 | `b4b573af49d188d144273d19662485290924d5558a7653c805dbe9d0bed34e01` |
| Worker runtime | Node `v22.22.2`, `darwin/arm64`; TypeScript `5.9.3`, esbuild `0.25.12` |

The worker extracted committed Git objects into `/private/tmp/kriegsspiel-map-assessment-133/source`, compiled ESM/declarations/source maps and a browser bundle using existing fork dependencies, and imported that pristine build. Six installed build/runtime dependency versions matched integrity-bearing entries in the pinned lockfile. No fork files, existing build outputs or dependencies were changed. This is a fresh **source** build, not proof of a fresh dependency installation. The coordinator separately reported that public GitHub confirms the commit/tree and that a fresh archive at `.local/map-clean-source/settlemaker` passed `npm ci`; the coordinator records its exact commands and final build result in the execution log.

The dirty fork `src/index.ts`, `src/village/render.ts` and untracked `src/terrain/` are excluded by `git archive`; the committed tree contains no `src/terrain/`. The original experiments remain in the checkout and the coordinator's baseline `.local/map-run-baseline/20261010-105130`. They are neither a source pin nor accepted implementations.

Source references below are relative to the fork at this exact pin. See the [fixture runner and command record](../scripts/maps-assessment/README.md) and [machine-readable results](../scripts/maps-assessment/results.json).

## Comparison matrix

| Capability | Physical village | Physical city | Legacy village | Legacy city |
| --- | --- | --- | --- | --- |
| Entry | `createSettlementModel(..., {development:{preset:'village'}, seed})` | Same, `preset:'city'` | `generateVillage`, or `generateSettlement` with `engine:'village'` | `generateFromBurg`, or `generateSettlement` with `engine:'city'` |
| Public units | Local metres, x east/y south | Local metres, fixed internal ×3 conversion | Local metres | Mesh units with population/extent heuristic |
| Shared model | `SettlementModel.scene`, buildings, districts, residents | Same | `VillageModel`, separate exporter | `Model`, wards/scene and separate exporter |
| Water | Shared measured site reader, frontage lot clipping/routing | Shared metric site reader; water divided by 3 before block solver | Measured water, river widths, polygon water | Rejects measured `waterContext`; legacy polygon units, optional coast pull |
| Terrain | No height/gradient/footprint suitability API | Same gap | Same gap | Same gap; scalar elevation input is ineffective |
| Road joins | Bearing/route provenance, internally selected circular entry; shaping and landscape extension change approaches | Bearings into block solver; road scene/export loses route IDs | Exposes `contractRadiusM`, route provenance and junctions | Gates can echo routes; road exports do not establish authoritative joins |
| Diagnostics | Resident shortfall and string layout diagnostics; site result not exposed | Resident shortfall, bounded city supply attempts; site result not exposed | Village/site/water diagnostics | Dropped requests and building-count shortfall, not resident accommodation |
| Output cost | Can skip SVG; shared metre exporter | Same | Can skip SVG with model/export calls | Public convenience API includes SVG; low-level model/export available |
| Assessment | **Selected foundation**; extend solver before acceptance | Metre-compatible but additional route/placement work; optional dense layouts | Useful compatibility tests and lower-level frontage seam | Reject as battlefield foundation: scale/shift and incompatible measured units |

Source evidence: `src/settlement/generate.ts` selects `frontageLayout`/`blockLayout`, retries city supply at most four times and performs common dressing/allocation. `src/settlement/layouts.ts` calls `generateVillage(..., {landscape:false, occupancy})`, uses `BLOCK_METRES_PER_UNIT=3`, scales all scene lengths/coordinates, and converts water into block units. `src/settlement/model.ts` defines the authoritative metre contract. `src/village/placement.ts`, `parcels/lots.ts` and `dwellings.ts` are the village lot/footprint acceptance seams; `src/village/skeleton/` owns routes. `src/generator/model.ts`, `city-frontage.ts`, `city-blocks.ts` and ward geometry are the block solver seams.

`AzgaarBurgInput.elevation` is a scalar, not a numerical terrain surface. Source inspection found no gradient callback in either physical layout. Setting elevation to 999 leaves canonical geometry unchanged for all four candidates in the fixture. Qualitative route `relief` metadata is not a measured road-grade constraint.

## Diagnostic fixtures and results

The runner assesses all four planners at population 300, unwalled temperate sites, seeds 2 and 7, explicit approach bearings derived from asymmetric local endpoints `(137,-241)`, `(211,173)` and `(-263,41)` with route IDs. Flat and constrained cases give **16 results**, each regenerated in-process. A separate fresh process compares hashes and diagnostic results. The constrained case supplies measured water east of x=45 m, checks the whole footprint against an exclusion rectangle `[-70,-20] × [-30,60]`, a ±500 m site bound and the exact plane `z=120+0.12x+0.05y`. Only water is a supported planner constraint. The plane, bounds and exclusions are independent diagnostic demands; the runner does not pretend they were enforced.

The plane has 13% gradient everywhere, so checking its complete footprint is analytically exact; every accepted building fails the proposed 8% constraint. Each straight street segment's longitudinal grade is evaluated analytically against 10%. Complete building polygons are intersected with water/exclusions using `polygon-clipping`, retaining holes. Street corridors cover every segment and round cap/join using rectangles plus circumscribed 32-gons: conservative radial excess ≤0.484%. Legacy village checks its reserved `width_m`; physical checks exported surface `width`; legacy city scales its emitted width. Missing widths are reported. This is diagnostic geometry, not the production sampled-terrain validator. Water corridor intersections may be valid bridges; they are not automatically failures.

| Candidate (seed 2) | Flat buildings / streets | Constrained buildings / streets | Building-water overlaps | Excluded footprints | Building gradient failures | Road segment grade failures |
| --- | --- | --- | --- | --- | --- | --- |
| Physical village | 75 / 13 | 75 / 35 | 0 | 27 | 75 | 129 |
| Physical city | 45 / 39 | 45 / 39 | 0 | 5 | 45 | 28 |
| Legacy village | 75 / 16 | 75 / 35 | 0 | 27 | 75 | 147 |
| Legacy city | 75 / 31 | 75 / 27 | 0 | 23 | 75 | 48 |

These are successful unconstrained/water-aware model outputs with measured failures under the additional demands, not validated constrained settlements. Both physical models allocate all 300 residents in these small cases. Seed 7 also produces dry footprints but all buildings fail the plane limit; see the results for corridor intersections, site bounds and exact IDs. The flat fixture's zero water/grade failure counts are controls, not a general suitability guarantee. Adversarial controls detect a wet footprint edge with a dry centre and a wet corridor edge with a dry centreline.

At seed 2 the constrained physical village has 4 water-intersecting street corridors but exports 0 bridge features, while legacy village exports 4 crossing features. This is evidence that the physical wrapper's narrow-bridge-only conversion loses crossing information, not proof that those four streets are inherently invalid. Physical city seed 7 has 2 water-intersecting corridors and no exported bridge. Legacy city omits width on 5–8 street features in these cases, so its complete corridor coverage cannot be certified from the export; unknown widths are reported rather than replaced by an invented engineering width.

At seed 2, physical village flat route-matched endpoint gaps are **7.219, 55.121 and 7.549 m**; constrained gaps are **106.562, 124.028 and 28.524 m**. The legacy village does meet its own generated contract circle at all three bearings (gap <1e-6 m), which is a different contract from accepting supplied endpoints. Physical city has **zero route-matched street features** for each requested route. Two constrained requested endpoints lie in water; #138 must reject or use an explicitly supplied crossing, rather than invent a dry approach that claims the original endpoint was joined. Exported entrances are absent for these unwalled physical cases.

Legacy city seed 2 scale changes from **4.7194536308** to **3.5372204176 m/unit** after introducing water, despite unchanged population. The constrained input was diagnostic-calibrated from the flat scale, so it cannot maintain authoritative metre water alignment. These particular cases have zero origin shift; nonzero coastal shifting is established by source (`computeOriginShift`/`applyOutputShift`) rather than claimed from this fixture. Physical city ×3 is fixed at its internal layout boundary and is completely separate from this heuristic.

Physical model-to-export building and street coordinates match exactly. Every physical output coordinate round-trips through a rotated asymmetric metre transform to <1e-9 m. Different render widths/view bounds and theme leave exported geometry unchanged and declare 1 px/metre. Source `exportSettlement` emits no changing timestamp; legacy exports include `generated_at`, which alone is removed for diagnostic replay identity. Production identity additionally records generator/adapter/fork versions, settings and overrides.

## Coordinate adapter contract

The battlefield frame is **local metres**, origin at its north-west authoring bound, x east, y south, elevation z up in metres relative to a recorded local datum. A settlement is anchored at `a=(ax,ay)` and rotated clockwise by θ in this y-down frame. For local metre point `p`, use:

```text
world(p) = a + [ cosθ·px − sinθ·py, sinθ·px + cosθ·py ]
local(w) = [ cosθ·(wx−ax) + sinθ·(wy−ay),
             −sinθ·(wx−ax) + cosθ·(wy−ay) ]
world bearing = (local bearing + θ in degrees) modulo 360
direction for compass bearing B = (sin B, −cos B)
```

For `a=(3456,1234)`, θ=90° and `p=(137,-241)`, world=(3697,1371). On `z=120+0.012wx+0.034wy`, this point has z=210.978 m; advancing 100 local x metres raises world height by 3.4 m. This checks signs, rotation, datum and unequal axes, rather than only an origin or symmetric square. Rotate/inverse-transform geometry before querying the same authoritative battlefield surface. Heights are sampled from that surface; do not scale or rotate z as a planar coordinate. Transform width/length as metres and bearings consistently.

Physical outputs and legacy village GeoJSON already use metres: **do not multiply physical city outputs by 3 again**. Do not convert physical geometry through population, SVG viewBox or farmland bounds. Physical SVG uses local metre viewBox and zero origin attributes. Legacy village SVG instead uses `X=(x−frame.minX)·pxPerMetre` and the corresponding Y, with `data-origin-*`/`data-px-per-metre`; recover local metres via `(svgX−originX)/pxPerMetre`. SVG is presentation, not canonical geometry.

For diagnostic legacy city geometry only, read `s=metadata.scale.meters_per_unit`. Its exported coordinates already include `local_origin_shift`; multiplying exported coordinates by s then placing the result must not apply the shift again. Raw city model coordinates require the one shift before scaling. Since s depends on generated extent, this does not yield a stable metric input contract; reject it for terrain composition. Neither local GeoJSON variant is longitude/latitude or an RFC 7946 geographic asset. Battlefield export must identify units/axes explicitly; geographic reprojection remains out of scope.

## Module boundaries and ownership

Create portable `packages/maps` in #134, independent of `GameState`, `SideView`, protocol, clock, LLM and Three.js. The coordinator owns workspace/lockfile integration. The map authoring worker reads public generation settings and static assets, never live hidden master state. Later gameplay must still pass through the visibility filter; the standalone authoring export must not become a shortcut around it.

| Kriegsspiel module | Responsibility |
| --- | --- |
| `contract/`, `geometry/` | Versioned envelope/settings/overrides; local units, stable place IDs, transforms, limits, spatial operations |
| `terrain/` | Single seeded height field, bilinear height/gradient queries, contours, drainage, water and land cover |
| `planning/` | Suitable sites, regional road graph/routes, explicit crossings and authoritative approach endpoints |
| `settlements/` | Pinned fork adapter, inverse terrain queries, constraints/joins/diagnostics translation; strip non-authoritative landscape |
| `generation/`, `validation/`, `export/` | Stage orchestration and independent RNG streams; bounded infeasibility; complete invariant checks and canonical/vector exports |
| `client/src/map-authoring/` | Dedicated Canvas2D preview, request-tagged worker bridge, bounded settings/overrides and saved asset handling |

The fork owns generic local street/lot/building constraint support, entrance preservation and settlement diagnostics. Kriegsspiel owns hydrology, regional geography, authoritative terrain, crossing policy, composition/schema and the authoring UI. Do not maintain two elevation generators or expose the fork renderer wrapper as the terrain authority. New fork extensions should be additive options retaining seed/output compatibility for calls without constraints, tested against both legacy APIs and physical presets where promised. Changes to the paused experiment require separate review and ownership.

## Bounded extension packet for #138

Use #134's frozen contract plus #135–#137's height/water/site/road interfaces; no production code is added here. Define an optional local constraint context with finite site bounds, height/gradient queries or whole-feature suitability predicates, prohibited polygon tests, road/building thresholds, authoritative approaches `{routeId, endpointM, bearingDeg, widthM, crossingId?}` and deterministic operation/retry budgets. Pure callbacks read the battlefield surface through the inverse transform; record their terrain asset identity/version, not functions, in saved generation inputs. Fail typed infeasibility if required demand/joins cannot be met.

| Gap at pin | Required #138 work / acceptance |
| --- | --- |
| Placement knows water but no quantitative terrain/exclusions | Evaluate full lot and complete building polygons before acceptance/allocation, including every covered bilinear cell and boundaries. Check full street reserved corridors for prohibited areas and longitudinal grade along the declared surface. Reroute/recut before resident allocation; never quietly filter buildings after a successful population account. |
| Bearings generate circular entries | Preserve explicit endpoint/bearing/width/route identity through trunks, relaxation, `shapeVillageApproaches` and `dressSettlement`. Report and validate actual final joins at a frozen configurable tolerance; proposed 0.01 m join tolerance and 0.001 m geometry tolerance are assumptions for #134/#138 tests, not GIS accuracy claims. Wet approaches require linked feasible crossings or typed failure. |
| Physical city roads lack route IDs; unwalled physical export omits entrances | Add stable street provenance and explicit entrances independent of walls; validate every required route reaches its endpoint and settlement network. Start with selected physical village; extending dense city constraints is not a reason to accept a village gap. |
| Bridge paths omit lane linkage/deck contract | Preserve crossing ID, linked local street IDs/route IDs, complete reserved span, deck and dry abutments; reconcile against regional crossing authority. `frontageLayout` currently retains only narrow bridge centrelines/width, and physical exporter loses bridge-lane linkage. |
| Physical road `width` is surface width | Retain reserved width, travelled surface width and setback distinctly (`roadCrossSection` has these already); validate reserved corridor, render surface. |
| Diagnostic strings/site results lose context | Preserve structured measured-water results and layout constraint IDs/locations/remediation. `frontageLayout` filters `water strangled...` diagnostics; the physical model drops its `Layout.site` and `waterContextResult`. Measured input exceptions remain useful, but successful model output is not a complete water diagnostic report. |
| Common landscape overlaps battlefield authority | Add an option to skip common `dressSettlement` fields/vegetation and approach extension, or a constrained local agricultural refinement contract. Ignoring exported fields after generation is insufficient because dressing already changes roads/bounds and adds work. Authoritative battlefield water remains independent of infrastructure; since D45 cover is laid out after, and around, the final roads and settlements. |
| Population/cost-dependent growth and IDs | Explicit per-place seeds from stage streams; stable versioned IDs, deterministic ties and per-site/global operation caps. Existing city retry count and village local growth bounds are useful but not whole-map resource limits. Return shortfall/infeasibility without silently reducing requested settlements or inflating capacity. |

Production tests must include a hillside whose centre is suitable but footprint spans an unsuitable cell, a narrow river touching only a footprint/corridor edge, rotated sites, water holes, exact road joins after shaping/dressing, impossible sites, preserved unconstrained behavior, fresh-process seeds and work-limit failures. This assessment's constant plane/intersection controls demonstrate the gap; they do not implement those production tests.

## Configurable assumptions

Retain the plan defaults; these fixtures provide no evidence that whole-map performance or 25 m terrain sampling should be revised. Validate settings before allocation and record them in canonical assets. Separate thresholds from gameplay movement rules.

| Setting | Default / initial support |
| --- | --- |
| Extent | 10 × 10 km default, 5–15 km per side; test minimum/default/maximum |
| Samples | 25 m; max 400,000 samples; 401²=160,801 default, 601²=361,201 maximum |
| Surface/contours | Metres with one local datum; 10 m minor/50 m index contours; separate work/vertex caps |
| Road/building thresholds | 10% maximum longitudinal road grade, 8% maximum full-footprint terrain gradient |
| Sites | 4 villages + 6 farm sites; bounded counts, minimum suitable area/spacing resolved in #137; report infeasible requests |
| Resource targets | ≤10 s default / ≤30 s maximum generation, peak ≤512 MiB; measure documented hardware in #142 |
| Preview target | p95 frame ≤33 ms, 1440×900; later browser measurement, not a claim from Node fixtures |

The supported Node CLI/resource measurement profile uses `--max-old-space-size=256`; `npm run maps:cli` and corpus child processes apply it explicitly. This sets a256MiB V8 old-space limit, not total heap or process RSS (Node22.22.2 reports304MiB total heap limit). Reports retain actual flags, V8 heap limit and separate generation-through/post-check whole-process peak RSS. The512MiB target is measured, not guaranteed by that flag. The initial unconstrained-heap default diagnostic reached578MiB and failed; the bounded-profile diagnostic preserved identical asset/geometry identities. Final accepted-source evidence belongs in the resource report. Browser worker/page memory remains a separate, unmeasured quantity.

| Overrides | Rename, move settlement anchors, exclude placement regions. Names leave geometry unchanged; moves/exclusions regenerate dependent local layouts and roads with stable place IDs. |

No terrain brush, arbitrary road drawing, building editor, hydrology editor or multiplayer authoring. Relief/land-cover density are generation settings and regenerate. Reject missing override IDs and unsupported recorded versions. The later contract/planning/composition gates establish configurable population, footprint, spacing and work limits; these early village fixtures alone do not establish them. Do not promise arbitrary cross-runtime float identity.

## Fork build, packaging and distribution gate

Use an **immutable fork revision + integrity-pinned package artifact** as the production source strategy. #138's accepted fork changes replace the assessment pin with an exact full commit; record base, patch ownership, generator version and changelog. Keep a maintained fork branch for PR work, but never use a branch name or `3.0.1` as a saved-asset identity. Publish the engine package with a separate complete corresponding-source archive containing its lockfile, build inputs and notices; record both SHA-256 values and package integrity in the root lockfile/provenance. Upstream's npm tarball includes source but is explicitly not a full development clone, so `npm pack` alone does not prove the source archive is complete. Do not introduce `.local/settlemaker` as a workspace/file dependency or vendor a dirty build. If release hosting is unavailable, a committed attributed source snapshot at the accepted tree is the fallback, with the same lock/build/source verification; no such snapshot is added in #133.

Reproducible source setup for the coordinator or future clean build (not run by this worker because external access/install is coordinator-owned):

```sh
git clone https://github.com/dfezzie/settlemaker.git settlemaker-source
cd settlemaker-source
git checkout --detach d5cf3590cf59e1d382110d25a6910f12507299e2
git rev-parse HEAD HEAD^{tree}
shasum -a 256 package-lock.json
npm ci
npm run clean
npm run build
npm run build:lib
npm pack
```

`npm pack` reruns clean/build/browser build via `prepack`. Verify tar contents, notices/source/build files and artifact checksum, import its ESM and browser bundle, rerun fixture hashes and focused compatibility tests before accepting a release. Upstream's default browser banner points to upstream; a modified fork release must identify its exact corresponding fork source. Source retrieval must remain available alongside distributed bundles; a floating homepage or npm package version is insufficient. Node 22 is the Kriegsspiel assessment baseline; upstream documents Node 24 release checks, so production release validation should document the chosen supported runtime(s).

**Accepted source-review bootstrap (D23).** The attributed snapshot in `vendor/settlemaker` pins accepted fork `e08ec2e09f9a15f9110a3048123a31a58d08c341`. Run `npm run setup:map-source` before root `npm ci`. The setup verifies the payload, uses its standalone locked compiler dependencies, rebuilds the complete tar payload and checks its pinned SHA, verifies the committed canonical engine-only gzip encodes that exact tar, and checks original compressed SHA-256/SHA-512 identities before staging the ignored local root dependency. Node22.22.2/npm10.9.7 are pinned; different platform zlib encodings do not change the consumed artifact. The complete original fork archive identity remains separate. See [current bootstrap instructions](../vendor/README.md) and [immutable snapshot notes](../vendor/settlemaker/README.md). This implements the committed-source fallback for local review; publication remains gated.

**Distribution gate: open.** On 2026-10-10 the owner chose to keep distribution gated and prepare source changes for review, without changing the root licence. Kriegsspiel currently has no repository licence grant or package licence declaration. Inspecting the pinned `LICENSE`/`NOTICE` establishes GPL-3.0-only for the engine, including its TownGeneratorOS-derived core. Before publishing a combined application/browser worker bundle containing this engine, the coordinator must resolve the combined work's licensing with the owner and verify corresponding-source distribution. A worker, adapter, dynamic import, CLI or separate package is a technical boundary, not a licensing conclusion. Continue local development and fixtures; do not silently license Kriegsspiel or ship a combined build as though the gate passed.

Prepare release compliance from the actual pinned notices/terms (no external legal retrieval was performed by this worker): preserve `LICENSE`, `NOTICE`, upstream copyright and warranty statements; mark fork modifications and dates; include GPL terms and applicable interactive legal notices; supply complete machine-readable corresponding source and scripts under the applicable licence alongside the distributed object code (the planned network route is GPL §6(d)). Include any installation information required by the actual distribution form. GPL §§1, 4–6 in the pinned licence define these obligations. Review the whole distributed work and dependencies rather than treating the source link alone as compliance.

Preserve `polygon-clipping`, `splaytree` and `robust-predicates` notices from `NOTICE`. Default symbol collections are CC BY 4.0 with the specific rendered-output exception in `symbols/LICENSE`; retain `symbols/CREDITS` and per-symbol authorship when redistributing the artwork library. Do not generalize that exception to engine code. Copperline is separately GPL-3.0-only and is outside the default artwork exception; simple footprints avoid needing those example assets. These are source-based release requirements and a pending gate, not a claim that package separation settles the legal status of a combined work.

## Validation boundary and handoff

Focused analytical tests, all sixteen comparisons, export parity, scalar-elevation controls, measured-water rejection and fresh-process replay are recorded beside the fixture. Builds/tests are scoped to the assessment; no root workspace or fork suites were modified, no dependency was installed and no branch/commit/GitHub action was taken. Generation timing measurements exclude diagnostics/import; legacy-city convenience timing includes SVG, so do not rank solver speed from that table. Whole-map memory, contour costs, large populations, browser responsiveness and a wider seed corpus remain #142 evidence.

Coordinator: review this note and fixture, reconcile the planner selection/assumptions into owned decision/roadmap/log files, attach the clean-install/build evidence, and handle PR/GitHub closure only after independent review. #134 can freeze the metre/limits/provenance interfaces from this note. #138 owns the bounded fork gaps above. #139 must reject unconstrained or mismatched layouts until the constraints and authoritative joins are verified. The licensing gate blocks distribution, not this architecture assessment or local development.

## Regional planning handoff (D22)

The regional planner consumes accepted authoritative ground, water and crossing proposals without running the local settlement planner. `sited-graded-network-v2` (D44, which replaced `sites-lattice-decks-v1`) ranks complete permissible site footprints by a landscape score, routes bounded terrain-cost lattice edges that reuse earlier roads and certifies the normalized emitted network. Since D48 (`sited-graded-any-angle-network-v4`) the lattice has sixteen neighbours and the routed chains are string-pulled, re-anchored at junctions and rounded into certified any-angle curves. `linear-ground-endpoints-v1` records continuous bridge deck heights separately from channel ground. Stable site slots and explicit boundary entrance endpoints/bearings/route references form the fork handoff; permissible regions are not occupied layouts or population success.

[The planning package policy](../packages/maps/docs/planning.md) defines complete footprint/corridor checks, graph validation, stage budgets and actual-join reconciliation. Composition must accumulate reconciliation work across attempts and validate local streets, capacity, occupied footprints and all joins independently. Planning success alone does not certify a composed/exportable asset. Source review retains the owner’s distribution gate.

## Accepted standalone runtime and milestone evidence

The verified runtime pair is Node22.22.2 (Darwin/arm64) and Chrome154.0.8037.95 on the documented M3/macOS machine. Current source produces identical canonical full assets across Node and real browser workers for flat17, hills31, river97 and a saved rename/move/exclusion recipe. This is the tested supported pair, not an arbitrary cross-runtime floating-point promise.

Complete composition uses `complete-frontage-access-v1` and independent saved certification `complete-map-v1`; D24/D25 establish the final composition/worker/export boundaries. Actual connected settlements, certified footprints and access, reciprocal bridges, saved replay and rejected candidate handling are covered by the [verification report](map-verification-report.md), with raw21-seed records, default/maximum resource measurements and overview/detail screenshots.

Supported CLI/measurement children explicitly use256MiB V8 old space (actual total V8 heap limit304MiB), while generation RSS is measured independently. Default10km17 and maximum15km flat17 meet the10s/30s/512MiB targets on that machine. The unrestricted default's578MiB failure remains recorded. Three representative1440×900 preview runs meet p95≤33ms; initial generation/export/load costs and raw long frames remain visible. Browser memory, GPU completion, native input latency and worst-case performance over every permitted recipe are not established. Combined-work distribution remains gated.
