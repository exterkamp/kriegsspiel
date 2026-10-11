# Terrain and contours (#135, gate C)

Based on accepted contract commit `28a611c` and [the frozen contract](../README.md). This module supplies ground and contour vectors, independent of settlements, hydrology, the engine, clock and renderer. It contains no wall-clock or ambient-random calls. Gate acceptance and root integration checks belong to the coordinator after independent review.

## API and authoritative surface

Implementation: `src/terrain/index.ts`. The coordinator exports these APIs from the common package index; this packet does not edit that index or package metadata.

```ts
generateElevation(settings: MapSettings, seed: number): GenerationResult<Elevation>
extractContours(elevation: Elevation, bounds: Bounds, settings: MapSettings): GenerationResult<Contour[]>
generateTerrain(settings: MapSettings, seed: number): GenerationResult<TerrainOutput>
validateContourHeights(elevation: Elevation, bounds: Bounds, contours: Contour[], settings: MapSettings)
  : GenerationResult<{maxErrorM: number; segmentCount: number; partitionCount: number}>
```

`generateTerrain` generates ground, extracts contours, and returns success only after independent complete-segment height certification. `extractContours` performs the same certification on its output. `generateElevation` is available separately so changing contour parameters cannot prevent access to a valid field. None mutates caller data. Existing `createElevationQueries({elevation,bounds})` remains the sole public analytic height/gradient/slope implementation, including its error/clamp, maximum-bound and east/south seam policies. There is no competing query surface or renderer mesh.

Authoritative ground samples, bounds and spacing **must already be stable under `decimal-6-v1`**. Extraction and certification reject unstable input with `MapValidationError`, code `UNSUPPORTED_PRECISION`, and a field/sample path; they never silently normalize input while certifying a different surface. `generateElevation` emits normalized samples and requires stable grid metadata before allocating the field. A caller supplying custom analytical data must explicitly normalize it upstream and use those same samples downstream.

This is also a #136 integration requirement: hydrology must normalize any carved ground before extracting dependent contours or creating downstream queries. Keep filled drainage separate; filled drainage is not authoritative ground. If hydrology changes ground, discard previous contours and regenerate them against the normalized new ground. The regression `[.00000049,1.00000049,.00000049,1.00000049]`, 25 m square, .5 m interval, `1e-7 m` tolerance now fails explicitly; normalizing to `[0,1,0,1]` yields an exact contour at x=12.5 m. The original caller samples remain unchanged.

Output samples, contour coordinates and contour elevations are decimal-6 values. Certification occurs after coordinate/level rounding. Consecutive rounded duplicate points are removed before certification; collapsed paths, bounds violations and collapsed distinct levels return typed precision infeasibility. Independent normalization/idempotence tests verify the rounded output retains its height tolerance. Full asset/settings canonicalization and composition certification still belong to #139; this helper certifies contour heights, not every map invariant.

## Ground algorithm and streams

Record `TERRAIN_VERSION = value-noise-ridges-v1` and `CONTOUR_VERSION = bilinear-graph-v1` in the corresponding generator stage provenance. Changes to these algorithms, ordering or output normalization require a new stage version. The root seed is a nonnegative safe integer, validated through the frozen `deriveSeed` policy.

Terrain uses original integer-hashed lattice value noise with quintic interpolation. Octave `i` has feature scale `featureScaleM / 2^i` and weight `roughness^i`. The weighted signed noise is normalized by the total active weight. Each octave has a separate key:

```text
deriveSeed(rootSeed, 'terrain:value-noise-ridges-v1', 'octave:<i>')
deriveSeed(rootSeed, 'terrain:value-noise-ridges-v1', 'ridge')
deriveSeed(rootSeed, 'terrain:value-noise-ridges-v1', 'valley')
```

Ridge and valley fields use `1 - abs(signedNoise)` on independent streams. Height is `baseHeightM + reliefM/2 × (rolling + ridgeStrength×ridge - valleyStrength×valley)`, then decimal-6 normalization. Increasing ridge strength raises ground, increasing valley strength lowers it, and zero relief produces the normalized base-height plateau. Octaves, roughness, feature scale, relief and both shaping controls have independent effectiveness tests. The finest configured feature scale must be at least .001 m and fit the signed lattice range; unsupported scales fail with a setting path before sample allocation. Requested height ranges outside the contract's ±100,000 m return bounded infeasibility.

Contours are a deterministic function of ground and contour settings: they consume no RNG. Settlement draws or changed contour interval/tolerance/index settings cannot consume or alter an elevation stream. Fresh-process tests compare SHA-256 of complete generated results across TZ/LANG changes and 1,000 unrelated settlement stream derivations.

## Bilinear contour geometry

Minor levels are integer multiples of `minorIntervalM` between the global sampled minimum and maximum, inclusive. The index interval is already validated as an integral multiple; index contours are flagged in the same stream, never extracted a second time. Negative and fractional levels retain their sign/value, and negative zero normalizes to zero. Near-integer quotient normalization uses the same eight-ulp convention as the query contract. Flat fields have no isolines, even on an exact level.

For one cell and level L, define corner values `a=NW-L`, `b=NE-L`, `c=SW-L`, `d=SE-L`. The local field is `F(u,v)=A+B u+C v+D uv`, with `A=a`, `B=b-a`, `C=c-a`, `D=(d-b)-(c-a)`. Edge intersections share global grid-edge keys, exact-level sample nodes share sample-index keys, and adjacent cells therefore stitch without proximity searches. Discovery and tie order is level, row, column, N/E/S/W, then edge insertion. Open endpoints/true junctions emit first; remaining degree-two components emit as closed loops. IDs encode deterministic level/path slots.

Exact-level nodes are classified positive for organizing crossings, without changing heights. Isolated zero-length point events and fully flat cell interiors are omitted. Non-flat cells' complete zero edges are deferred, owned once in row-major order and partitioned at all branch attachments from either neighbouring cell. This preserves grid-column contours and boundary T-junctions without duplicate/overlapping level edges.

Ambiguous cells use the exact filtered orientation predicate for `Q=a*d-b*c`, not the centre average. Q<0 connects N-W and S-E; Q>0 connects N-E and W-S. The analytical saddles `[10,-4;-4,1]` (Q=-6, positive centre) and `[4,-10;-1,4]` (Q=+6, negative centre) verify these choices. Q=0 with nonzero D factorizes into `D(u-us)(v-vs)`, where `us=-C/D`, `vs=-B/D`. An interior exact saddle creates four branches terminating at the common saddle node; no arbitrary diagonal continuation is selected. Boundary factorization also preserves T-junctions. Stable coefficient differences retain repeated-row/column planes despite subtraction rounding.

Each curved branch is a polyline approximation of the true bilinear level curve. Refinement bisects its dominant coordinate and solves the other coordinate on F=0. A proposed straight chord has a quadratic F along it: the maximum absolute height error occurs at an endpoint or the quadratic stationary point. Refinement accepts at half the requested tolerance to leave numerical/rounding margin; it never substitutes a midpoint-only test. Depth is bounded at 52, and nonfinite/out-of-cell/no-progress solutions return precision infeasibility.

`validateContourHeights` independently uses existing public height queries, splits every exported chord at crossed grid seams, evaluates each interval at its endpoints and midpoint, reconstructs its quadratic, and checks its stationary point. It does not reuse extractor coefficients/refinement code. Tests also have a separate row-major bilinear oracle. The classic `h(u,v)=uv`, level .25 chord has exact on-level endpoints and midpoint error .140625 m: it is rejected, then adaptive extraction passes .01 m. Both the default .05 m and analytical .01 m tolerances apply to complete segment interiors, not just vertices.

## Deterministic resource boundaries

Invalid shapes/nonfinite parameters/unstable authoritative precision throw path-specific validation errors. Bad seed/programmer arguments remain ordinary errors. Only recognized budget/precision feasibility failures become `GenerationResult` with `ok:false`, `kind:'infeasible'`, structured stage/constraint/remediation diagnostics and **no partial value**. Unexpected exceptions are not swallowed.

| Resource | Reservation/check |
| --- | --- |
| Ground allocation | Frozen full settings validation checks integral dimensions, sample count and independent planning allocation before allocating samples. |
| Noise evaluations | Complete `sampleCount × (activeOctaves + activeShapingFields)` is reserved against `limits.maxTopologyChecks`; zero relief reserves one operation/sample. |
| Levels | Safe integer enumeration and `contours.maxLevels` checked before a level graph; distinct rounded levels must remain distinct. |
| Cell-level work | Complete `(columns-1)×(rows-1)×levelCount` reserved against `maxCellLevelWork` before any graph allocation. |
| Refinement | Root and child frames reserved before stack allocation against global `maxRefinementWork`; all levels share this counter. |
| Stitching | Node/edge creation, deferred zero-edge sorting and traversal charged against `limits.maxTopologyChecks`; no global nearest-point scans. |
| Vertices | Intermediate edge-polyline vertices and final output are each bounded by `min(contours.maxVertices,limits.maxVertices)` across all levels. Shared-node duplication makes the staging cap conservative; zero-edge staging has its own same-sized bound. |
| Features | Global contour path count checked against `limits.maxFeatures` before output insertion. |
| Certification | Samples/vertices reserved before query storage; seam cuts/sorts and interval checks charged against `limits.maxTopologyChecks`. |

These are separate deterministic stage counters, not one shared consumption stream. Maximum work is bounded by their sum. The sample, stitching and certification counters each use the recorded topology-work cap. Hard import limits still apply during descriptor-safe field/contour preflight. Exhausting any budget fails the whole request, without truncating levels, branches, paths or vertices into a false success. No watchdog or elapsed time affects geometry.

The maximum supported 15 km/25 m field is 601×601 (361,201 samples). Analytical tests accept its flat field and reject a dense level request before graph allocation. Tiny intervals, levels, cell-level work, refinement, stitching, features and vertex caps each have failure tests. The default budgeted 10 and 15 km generated fields succeed. This packet adds no renderer-owned geometry or hillshade raster; a later preview can derive hillshade from the existing analytic gradient without changing terrain identity.

## Focused checks and evidence

Executed from the repository root on 2026-10-10, Node `v22.22.2`, Darwin arm64, existing TypeScript/Vitest 3.2.7/ESLint/Prettier. No installation or root/fork/client edits by this packet. Build is serialized before fresh-process tests; the client writer does not build compiled map artifacts.

```sh
npm run build --workspace @kriegsspiel/maps
node_modules/.bin/vitest run packages/maps/tests/terrain-contours.test.ts packages/maps/tests/terrain-generation.test.ts
npm run typecheck --workspace @kriegsspiel/maps
node_modules/.bin/eslint packages/maps/src/terrain packages/maps/tests/terrain*.test.ts
node_modules/.bin/prettier --check packages/maps/src/terrain packages/maps/tests/terrain*.test.ts
```

Final focused suite: **35 tests in two files** (25 contour, 10 generation), including fresh processes and the review precision precondition regression; Vitest duration **1.76 s**, default+maximum generation/certification test **771 ms**. Build, typecheck, scoped lint and scoped formatting exit 0. Root full integration checks are reserved for coordinator acceptance.

The fixed future corpus is eight seeds `1,2,3,7,17,31,97,55337` for each of the three later presets (flat, hilly/wooded, river crossing): **24 cases**, representative seeds **17/31/97** respectively. This packet tests all eight at 500×400 m diagnostic extents; it does not implement/accept those composed presets. The coordinator records the future corpus in the execution log it owns.

Terrain-only focused probe: generate seed17 at 5/10/15 km, certify again independently and hash `JSON.stringify(TerrainOutput)`. Exact command:

```sh
/usr/bin/time -p node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS } from './packages/maps/dist/index.js';
import { generateTerrain, validateContourHeights } from './packages/maps/dist/terrain/index.js';
for (const size of [5000, 10000, 15000]) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = size;
  const result = generateTerrain(settings, 17);
  if (!result.ok) throw new Error(JSON.stringify(result));
  const { elevation, contours } = result.value;
  const evidence = validateContourHeights(elevation, {minX:0,minY:0,maxX:size,maxY:size}, contours, settings);
  if (!evidence.ok) throw new Error(JSON.stringify(evidence));
  console.log(JSON.stringify({size,seed:17,columns:elevation.columns,samples:elevation.samples.length,paths:contours.length,vertices:contours.reduce((n,c)=>n+c.path.length,0),...evidence.value,sha256:createHash('sha256').update(JSON.stringify(result.value)).digest('hex')}));
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,maxRSSKiB:process.resourceUsage().maxRSS}));
JS
```

| Extent | Samples | Paths / vertices | Certified maximum error | TerrainOutput SHA-256 |
| --- | ---: | ---: | ---: | --- |
| 5 km | 40,401 | 32 / 3,326 | .024929674370184826 m | `d444e47f6c575496698c82385d40b53d989a82563aab5f83c5a27b22d07c9b85` |
| 10 km | 160,801 | 102 / 15,261 | .024982925422691243 m | `d2f1baf9823cf16f27fe9026142bdc0b226b6a98c83b3cf3189b5927c0bae4a0` |
| 15 km | 361,201 | 207 / 34,490 | .024982925422691243 m | `e113705e262e82ba83187ef8379dbfc8a7d378bdb2e2175c31510fc923d1d1be` |

Final probe exited **0**, with `real 1.33`, `user 1.46`, `sys 0.06` seconds for all three sizes together. Node reported process-wide peak `maxRSSKiB:206480` (**201.64 MiB**). The probe includes generation, repeated certification, startup and hashing; it is not an end-to-end hydrology/settlement/browser benchmark. Timing and peak RSS are process measurements, excluded from generated diagnostics/identity. `/usr/bin/time -l` could print timing but exited 1 because sandbox `sysctl kern.clockrate` was denied; CPU-model `sysctl` was also denied. The supported fallback is `time -p` plus Node's process-wide peak-RSS counter. Browser runtime replay, preview frame time, full-map memory and composed preset feasibility remain later gates.
