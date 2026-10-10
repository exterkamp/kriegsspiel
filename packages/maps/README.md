# @kriegsspiel/maps — contract gate B (#134)

Portable map contract for [the implementation plan](../../docs/map-implementation-plan.md), based on accepted #133 commit `6d181b5` and [map architecture](../../docs/map-architecture.md). This package has no engine, protocol, clock, LLM, renderer or fork dependency. The reference asset is hand-authored; no terrain or settlement generator is implemented here.

## Frozen v1 API

Import from `@kriegsspiel/maps` after building the package. Breaking geometry, numerical or serialization semantics require a new schema/policy version; generator algorithm changes require the corresponding recorded stage version. Unsupported versions fail instead of being silently migrated.

| Export | Contract |
| --- | --- |
| `MapAsset`, `MapSettings`, `MapOverride`, `MapLayers` | Versioned envelope and ordered recipe inputs; strict objects reject unknown fields. |
| `Bounds`, `Point`, `Polygon`, `Elevation` | Local geometry and row-major sampled surface. |
| `Cover`, `Water`, `RoadNode`, `Road`, `Crossing`, `Site`, `Entrance`, `Building`, `Landmark`, `Contour`, `Drainage` | Independent feature/flow contracts. |
| `TerrainOutput`, `HydrologyOutput`, `PlanningOutput` | Stage handoff types. Hydrology returns original/carved ground separately from filled drainage; dependent contours must be regenerated if ground changes. |
| `importAsset(text, lowerLimits?)`, `parseAsset(object, lowerLimits?)` | Bounded contract validation, returning a detached parsed asset or `MapValidationError` with `issues: {code,path,message}[]`. |
| `parseSettings(input)` | Descriptor-safe validation of complete settings, including elevation/planning allocation checks. Defaults are explicit, never silently merged into imported recipes. |
| `createElevationQueries({bounds,elevation}, 'error' \| 'clamp')` | Snapshot query object with `heightAt(x,y)`, `gradientAt(x,y) → {dx,dy}`, `slopeAt(x,y)`. |
| `polygonLocation`, `polygonArea`, `pointSegmentDistance`, `distance` | Polygon with holes queries and metric lengths/areas. Location is `inside`, `outside` or `boundary`; nonfinite location queries fail. |
| `localToWorld`, `worldToLocal`, `bearingDegrees` | Metre transforms and north-clockwise bearings; nonfinite transform/bearing inputs fail. |
| `placeId(kind,ordinal)`, `resolveOverrides(overrides,siteIds)`, `deriveSeed(seed,stage,featureId?)` | Stable recipe slots, ordered override resolution and independent versioned stream keys. |
| `canonicalizeAsset`, `canonicalGeometry`, `canonicalRecipe` | Canonical JSON strings, validated before and after precision normalization. |
| `assetIdentity(asset, 'asset' \| 'geometry' \| 'recipe')` | Async lowercase SHA-256 of the selected canonical UTF-8 bytes using Web Crypto. Default is geometry. |
| `GenerationResult<T>`, `Diagnostic`, `infeasible(diagnostics)` | Typed bounded infeasibility, distinct from import errors and programmer exceptions. Infeasibility requires an error diagnostic. |
| `DEFAULT_SETTINGS`, `HARD_LIMITS`, `COORDINATES`, `SCHEMA_VERSION`, `PRECISION_POLICY`, `VALIDATION_SCOPE` | Frozen constants; `structuredClone(DEFAULT_SETTINGS)` before editing. |
| `createReferenceAsset()` | Fresh generation-independent positive oracle. |

Exported Zod schemas describe shape only. Use the parsing functions at import boundaries for resource and topology checks. `validateSettings` is a relational helper for already schema-validated settings. Geometry helpers operate on parsed geometry; they are not substitute parsers.

```ts
import { createReferenceAsset, parseAsset, createElevationQueries,
  canonicalizeAsset, importAsset, assetIdentity } from '@kriegsspiel/maps';

const asset = parseAsset(createReferenceAsset());
const q = createElevationQueries(asset);
q.heightAt(12.5, 6.25); // 99.9375 m on the fixture plane
q.gradientAt(12.5, 6.25); // dx=.03, dy=-.07 (binary64 rounding applies)
const loaded = importAsset(canonicalizeAsset(asset));
await assetIdentity(loaded, 'geometry');
```

## Coordinates and independent topology

Schema `kriegsspiel/local-map`, version `1`, explicitly means x east, y south, z up, horizontal and vertical metres, north-west `(0,0)` origin and a local-zero elevation datum. Bounds include their maximum edges. This is local planar vector data, **not RFC 7946 GeoJSON** or longitude/latitude. No georeferencing is claimed. `Point` has two coordinates; elevation supplies z.

Rings close with an exact copy of their first coordinate, have nonzero area, no repeated/zero-length edges, backtracking or self intersections. Either winding is accepted and preserved. Holes are strictly interior, non-touching, disjoint and unnested. Components of a single multipolygon are disjoint/non-touching; an island component inside another component's hole is valid. Independent features and layers may overlap: woods can contain roads, water can intersect an explicit bridge, and buildings remain separate features. Canonicalization does not union or flatten them. Full polygon containment partitions edges at boundaries, detecting concave escapes and holes missed by vertex tests.

Orientation uses a binary64 error filter with an exact BigInt dyadic fallback for ambiguous determinants. Cross products have area units and are never compared with a metre epsilon. Segment cuts normalize vector scale. Distance-based boundary/degeneracy checks use `1e-9 m`; the configurable `coordinateToleranceM` is reserved for later constraint/adapter acceptance, not fuzzy ring closure. Canonical precision is coarser than this import boundary. Tangential corridor contact within `1e-9 m` is accepted as dry; positive penetration beyond that tolerance requires crossing coverage. Later physical validators may require an additional configurable safety margin, without weakening this geometric policy.

## Elevation and numerical boundary policy

`samples[yIndex * columns + xIndex]` is the original or explicitly carved ground. Grid dimensions are at least 2×2; spacing is uniform, positive and covers the complete bounds, including the last row/column. Sizes and every finite sample are checked before allocating query storage. Queries snapshot the validated samples into a `Float64Array` so subsequent caller mutation cannot change them.

For a cell with north-west/east/south/south-east heights `a,b,c,d` and fractions `u,v`, height is `a(1-u)(1-v)+bu(1-v)+c(1-u)v+duv`. Analytic derivatives are `dx=((b-a)(1-v)+(d-c)v)/spacing`, `dy=((c-a)(1-u)+(d-b)u)/spacing`; slope is their Euclidean magnitude (rise/run, not degrees).

Height is continuous across cells; derivatives need not be. An interior grid node/seam belongs to its east/south cell; an exact maximum uses the last cell with fraction 1. Quotients within `8 × Number.EPSILON × max(1,|quotient|)` of an integer normalize to that node, including `.3/.1`. Values clearly outside that band retain their actual cell. Error mode rejects any coordinate outside bounds. Clamp mode clamps finite coordinates first and returns the boundary cell's derivative, not the derivative of the external clamping function. Both modes reject NaN/Infinity.

The tests use independent oracles `h=100+.03x-.07y` and the 25 m mixed cell `[2,6,10,18]`: at `(12.5,6.25)`, height `6.5`, dx `.2`, dy `.4`. These are exact interpolation contracts with binary64 rounding, not real-world survey accuracy. A 25 m grid does not model sub-cell foundation geology.

## Corridors, crossings, sites and identities

`round-caps-joins-clipped-exits-v1` defines a road's reserved corridor as the union of each centreline segment's closed capsule of radius `widthM/2`. The union produces round caps and joins. `surfaceWidthM ≤ widthM` is the travelled surface; `setbackM` is an additional building exclusion distance outside the reserved corridor, not extra bridge width. Buildings must later respect `widthM/2 + setbackM` in composition certification. Crossings and dry abutments cover the reserved width; renderers must not substitute the narrower surface width for constraint checks.

Road path ends join their authoritative node positions within recorded `joinToleranceM` (default .01 m). Intersections between graph edges require a shared endpoint node, with no overlapping edge hidden behind an unrelated node. An explicit `boundary-exit` node records a north/east/south/west side, lies exactly on it, has one incident edge and exactly matches the terminal path vertex. Only that terminal capsule is clipped at the declared map side. Other vertices retain complete reserved-cap containment; adjacent interior vertices must already be inset by the corridor radius. Ordinary junctions do not authorize clipping, including at corners.

Crossings carry water identity, complete span/endpoints, linked edge IDs and a deck polygon. References are reciprocal. Linked paths together cover the entire span, including split graph edges and either orientation. The deck contains its full round-capped reserved corridor. Crossing width is at least every linked reserved road width, and ford traversable width is at least reserved crossing width. Each endpoint's disk of radius `widthM/2 + minimumAbutmentM` is dry against the declared water body. Every positive road-corridor/water overlap has complete coverage by a linked crossing. A kind label alone cannot make an orphan, displaced, partial or narrow crossing valid. Ford depth is carried explicitly; hydrological traversability remains a later certification obligation.

`routeIds` are logical approach/candidate-route provenance, not edge IDs. A route may survive splitting across multiple edges. Global feature IDs and site entrance IDs are unique; route references are a separate namespace and need not point to a feature. `placeId('village',0)` is `site:village:0000`, independent of seed, geometry and name. Keep slots stable across movement/renaming and reject missing references; road/building IDs likewise belong to logical generation slots, not coordinate hashes.

Sites distinguish a permissible `placementArea` from nullable eventual `occupiedFootprint`. Configurable village/farm area and extent ranges apply to permissible sites. Occupied polygons and whole building footprints must remain contained; population assigned+unassigned equals requested, linked building residents account for assigned population, and capacity/count/global population budgets are checked. An unoccupied planning site may carry all demand as unassigned. Successful populated settlements and full allocation are later composition obligations.

Entrances record authoritative route/road/node identity, endpoint, reserved width and outward bearing. Endpoint/width agree with the road within join tolerance, the endpoint lies on the permissible site boundary, and the road's outward tangent agrees within .01 degrees. Bearings are clockwise from north: north 0, east 90, south 180, west 270. Rotation is clockwise in the x-east/y-south plane; asymmetric transform tests prevent accidental axis swaps.

Overrides retain input order. `resolveOverrides` uses last-write-wins separately for name and anchor per site; moves do not erase names. Exclusions have unique IDs and form a union of hard placement restrictions, including for moved sites. The helper resolves intent but does not generate geometry. Parsing verifies referenced IDs and exclusion geometry; #139/#141 must verify the final resolved names/anchors and excluded placement after regeneration. Renaming must never alter geometry or random streams.

## Hydrology and contour seams for later stories

River centreline/profile order is downstream. `surfaceProfileM` aligns one finite height per vertex and is non-rising. With `carved-ground-v1`, vertex heights match ground within `1e-6 m` and the actual bilinear ground along every path interior must be non-rising. The surface between vertices is the ground, not linear interpolation of the stored samples. With `standing-water-v1`, the water surface is linear between profile vertices and cannot fall below ground anywhere along the centreline. Validation partitions segments at grid seams, reconstructs the quadratic ground in each interval and checks endpoint derivatives (carved ground) or quadratic maxima of ground minus water (standing surface). Numerical tolerance is `1e-6 m` of rise per partition interval. The saddle counterexample with endpoint ground -625 m and interior 0 m is rejected under both unsupported profiles. This certifies those centreline conditions only: #136/#139 must independently validate the complete water area, banks, lake surfaces, depth, widths, profiles and physical drainage relationship.

Optional `drainage` has a separate filled surface, D8 downstream indices (`-1` for declared terminals), accumulated upstream sample counts, explicit boundary outlets and linked lake sinks. Arrays align with elevation; filling cannot lower ground. Flow goes to valid non-rising neighbours, is acyclic and has exact accumulation accounting. Filled samples never replace original ground for queries. #136 implements depression treatment/tie-breaking and must supply the graph; a filled surface is not proof of a physically valid river.

#135 receives separate terrain/contour stage versions and streams. Contours remain a vector layer; changing contour settings/version cannot consume elevation RNG. The contour recipe freezes vertical tolerance (.05 m default), maximum levels, cell-level work, refinement work and output vertices. `bilinear-asymptotic-v1` requires connectivity according to the true bilinear surface, using the asymptotic determinant for ambiguous cells. An exact saddle-level intersection must preserve the true four branches, permitting distinct paths to meet at the saddle rather than drawing an arbitrary diagonal. `symbolic-positive-v1` classifies exact-level samples on the positive side for tie organization while placing output on the actual level: no fabricated epsilon height. Zero-length point events and fully flat cell interiors produce no line; shared level edges are emitted once with deterministic row-major ownership. Extraction/refinement and contour-height certification are #135 work, not supplied by a schema label.

## Validation boundary and resource limits

`VALIDATION_SCOPE = 'contract-only-v1'`. A parsed `MapAsset` is **not a certified playable/composed map**. Parsing does not prove network connectivity, dry/suitably sloped complete building footprints, road grade, building-road setbacks, settlement spacing, internal street-to-entrance joins, full population success, contour accuracy, lake/whole-water-area physics or override regeneration. #137/#138 build these constraints; #139 must expose an explicit composition validator and certify them independently before save/export success. In particular, the positive fixture deliberately has a regional entrance without an internal street: it passes the reference contract, not composition certification. No generation-success flag or policy label bypasses that later gate.

Text byte size is checked before JSON parsing. Objects/settings are preflighted by own-property descriptors before Zod cloning. Plain JSON data is required: no accessors, hidden or symbol properties (including on arrays), sparse arrays, functions, cycles, nonfinite numbers or non-plain objects or custom array prototypes. Accessor tests prove getters are not executed. JavaScript Proxies can execute traps during reflection and are outside the plain-data interface; untrusted callers should pass JSON text. No parser can undo memory already allocated by its caller.

| Hard import cap | Value |
| --- | ---: |
| UTF-8 text / estimated JSON object bytes | 64 MiB |
| Samples per grid / aggregate values across ground and three drainage arrays | 400,000 / 1,600,000 |
| Aggregate features, entrances and identified exclusions | 50,000 |
| Aggregate geometric point occurrences | 1,000,000 |
| Vertices per ring / holes per polygon / components per feature | 2,048 / 64 / 2,048 |
| Deterministic topology work | 5,000,000 checks |
| Object depth / visited values | 32 / 6,000,000 |
| Overrides / diagnostics | 256 / 1,024 |

Lower import limits are configurable but cannot exceed hard limits. Recorded recipe sample/feature/vertex limits apply before schema cloning; topology work uses the smaller import/recipe cap. Reference arrays cap at the feature limit; geometric path/ring collections cap at the vertex limit, and generic arrays use the independent node limit. Oversized arrays fail before inspecting elements. Site-count and global demand excess fail before geometry traversal. Reciprocal references and per-site buildings are indexed once; reference processing, span scans/sorts, segment checks, river partitions and drainage allocations consume deterministic work. Imports can return `RESOURCE_LIMIT` on complicated geometry even below count caps, rather than run an unbounded topology algorithm. Limits bound work, not a demonstrated 512 MiB end-to-end generation benchmark.

Plan defaults are 10 km square, 25 m samples, 10/50 m contours, road grade .10, building gradient .08, four villages and six farms. 5–15 km settings are tested; the contract also allows 25 m–5 km diagnostic extents, while production authoring's initial supported range remains 5–15 km. Default 10 km needs 401²=160,801 samples; maximum 15 km needs 601²=361,201. Planning allocation is capped independently at 400,000 nodes before routing allocation. Defaults also cap one route at 1,000,000 expansions, all routes at 5,000,000, placement at 8 attempts/site and 256 globally, and reconciliation at 4 passes and 500,000 global work units. These are parameters and deterministic algorithm obligations for later stories, not algorithm implementations here. Exceeding requested bounded feasibility returns `GenerationResult` with structured stage/constraint/remediation diagnostics; malformed imports throw `MapValidationError`; invalid programmer arguments throw ordinary `TypeError`/`RangeError`. Unexpected programming exceptions must never be converted into a successful empty map or routine infeasibility.

## Canonical replay and provenance

`decimal-6-v1` rounds nonintegral finite numbers to six decimal places using JS `toFixed(6)` and normalizes negative zero. Maximum absolute quantization error is approximately `0.5e-6` in the field's unit (metres for coordinates). Object keys and feature/entrance arrays sort lexically by ID; reference ID arrays and outlet indices sort. Paths, rings, sample/profile arrays and overrides retain order. Ring winding/start changes therefore change identity. Quantized output is reparsed: collapse of a narrow ring or an invalid numerical seam is rejected, never silently repaired. No elapsed times, timestamps or unknown ephemera are allowed in the strict envelope.

Full asset identity includes names, diagnostics, population and provenance. Geometry identity includes actual bounds/elevation/drainage and independent geometry, IDs, references, widths, bearings and contour/water values; it excludes names, recipes/provenance, diagnostics, population and building capacity/residents. Recipe identity includes seed, all versions/provenance, coordinates, settings and ordered geometry-changing overrides; it excludes rename overrides and display names. Renaming changes full asset identity, preserving both geometry and generation recipe identity. Recipes carry the information needed by later generators, but this story does not implement regeneration.

`fnv1a-stage-v1` hashes an ASCII length-delimited root seed, stage key and optional stable feature key into a nonzero uint32. It derives deterministic streams, not globally unique IDs or cryptographic randomness; 32-bit collisions are possible. Algorithms must record/version their own stage key and must not use `Math.random`, time or shared stream consumption.

Fork provenance distinguishes `reference-only` (no dependency consumed) from `consumed`. Consumed assets require commit/tree, GPL-3.0-only notice, `sourceArchiveFormat`, SHA-256 of the **exact retrieved source archive bytes** (compressed bytes for tar.gz), and separate SHA-256 plus SHA-512 SRI of the **exact consumed npm package tarball bytes**, not an unpacked directory or source-tree hash. Those digests must be measured by the immutable retrieval/build workflow; schemas validate representation, not authenticity. The fixture references the accepted pin/tree without inventing artifact digests. This package copies no fork code and does not import `.local/settlemaker`. The root project remains unlicensed; combined fork distribution stays behind the GPL notices/source and owner licensing gate documented in #133. Nothing here resolves that distribution gate.

## Focused evidence and limits

Run from the repository root with existing dependencies; no installation is needed. Tested on Node `v22.22.2` (`.nvmrc`: 22), TypeScript build, Vitest 3.2.7, existing root Zod and ESLint.

```sh
npm test --workspace @kriegsspiel/maps
npm run typecheck --workspace @kriegsspiel/maps
node_modules/.bin/eslint packages/maps/src packages/maps/tests
node_modules/.bin/prettier --check packages/maps
```

Results on 2026-10-10: `npm test --workspace @kriegsspiel/maps` exited 0 (build passed; **62/62 tests in 5 files**); `npm run typecheck --workspace @kriegsspiel/maps` exited 0; scoped ESLint exited 0; scoped Prettier check exited 0.

Focused suite: 62 tests across 5 files, including malformed rings/bowties/holes, overlap retention, whole polygon containment, bridge kinds/orphans/reciprocal links/displacement/partial coverage/width/dry abutments, authoritative entrance data, resource caps/getter attacks, planning/population budgets, separate drainage graph/accounting/cycles, continuous river profile checks, tiny and translated geometry, decimal seams, boundary exits, ordered overrides and canonical precision. The fresh-process test launches two new Node processes under different TZ/LANG settings, reverses unordered features and compares canonical strings, all three SHA-256 identities and stage seeds. Positive plane and mixed-term numerical oracles pass. Build precedes this test so it executes current compiled code.

Browser bundle/runtime replay, real seeded generators, independent composition certification, root integration checks and performance/memory targets are not evidenced by these contract fixtures. They remain coordinator/component and later story gates. Focused passing tests do not self-accept those stories.

### Metered water topology cache

Strict import builds one private polygon-edge row index per parsed water polygon.
Conservative EPS-expanded bounds skip geometry that cannot affect the accepted
horizontal-ray, boundary, capsule or crossing-cut predicates. Dry holes, tangent
corridors and the larger crossing-abutment radius retain their existing exact
checks. Metered100m segment indexes exclude disjoint road pairs and long-path
self-intersection pairs before exact predicate work. Small paths retain their
original checks; adjacency, closed-ring endpoint exceptions and EPS-expanded
bounds preserve the same geometry authority. Ring staging, row insertions, scans and detached cut-pair copies reserve
work first; distant misses still consume the caller's topology budget. This
changes validation cost, not geometry semantics or the configured caps.
