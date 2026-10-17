# Land cover (`terrain-parcels-v2`)

Cover lays woods, fields and open ground over a generated battlefield so they follow the ground, the water and the settlements, with organic outlines and field parcels. It replaces the rectangle cover `coherent-dry-runs-v1` (#136), which put square blocks on the map regardless of terrain. Decision record: [D45](../../../docs/decisions.md). Issue: #500.

## API and version

```ts
import { generateCover, COVER_VERSION } from './src/geography/cover/index.js';

generateCover(
  elevation: Elevation,
  bounds: Bounds,
  water: Water[],
  settings: MapSettings,
  seed: number,
  context?: {
    roads?: { path: Point[] }[];
    sites?: { kind: 'village' | 'farm'; anchor: Point; placementArea: Polygon }[];
  },
): GenerationResult<Cover[]>
```

`COVER_VERSION = 'terrain-parcels-v2'` is recorded in `provenance.generator.stages.cover`. It freezes the lattice, scores and weights, allocation, clean-up, parcels, compartments, boundary smoothing and output order. Changing any of them needs a new cover version.

Composition calls `generateGeography(..., { cover: false })`, plans roads and settlements, assembles the settlement layouts, and only then calls `generateCover` with the final roads (regional, streets, access tracks) and sites. Cover gets the feature and vertex capacity the other layers leave. `generateGeography` on its own still produces cover, with no road or site context.

Maps saved with rectangle cover keep loading and certifying: `LEGACY_GENERATORS` holds both the v1 stage identity and the D44 identity with `cover: 'coherent-dry-runs-v1'`. Neither can be regenerated (`supportsReplay` is exact to the current stages). `data/maps` is unchanged.

Inputs are never modified. All randomness comes from coordinate hashes keyed by `deriveSeed(seed, 'cover:terrain-parcels-v2', <stream>)`, with streams `wood`, `field`, `soil`, `warp`, `parcels`, `compartments`, `regional` and `junctions`. There is no shared RNG, wall clock or locale access. Arithmetic uses only `+ - * /`, `Math.sqrt`, `floor`/`ceil`/`round`, `min`/`max` and `abs`, with no transcendental functions.

## Lattice and water

Cover is classified on a lattice whose cells group whole elevation intervals:

```text
step = ceil(max(1, min(50 m, min(width, height) / 24) / spacing,
                (columns - 1) / 200, (rows - 1) / 200))
```

The 5 km presets and the 10 km default use 50 m cells (100 or 200 per axis). The 15 km maximum uses 75 m cells. Unlike v1, the lattice no longer depends on `coherenceM`, which now only sets the scale of the soil and woodland noise.

Water masking is unchanged from v1 (`mask.ts`): a cell is wet if its centre is in a water polygon or any water boundary enters its open interior, so cover never covers water. Masked cells carry no cover. `dryAreaLossUpperBoundM2` bounds the dry ground lost in partly wet cells.

## What goes where

For every cell the generator computes:

- **ground**: mean height, mean gradient from the cell's corner samples, and the v1 conservative slope bound over the cell and its seam neighbours;
- **relative height**: height minus the mean within about 400 m, scaled by its spread over the map, so ridges are positive;
- **distances** (8-neighbour chamfer): to water (with the bed height of the nearest wet cell), to road cells (with that road's direction), to village ground and to farm ground. A site's ground is the cells whose centres are in its placement area, plus its anchor cell;
- **soil**: two octaves of value noise at `coherenceM` and `coherenceM / 2.5`, domain-warped so its outlines are organic. High soil means poor ground.

Scores, before a two-pass 3×3 box blur:

| term | wood | field |
| --- | --- | --- |
| steepness, `slope / 0.15` capped at 1 | +1.1 | −0.6 |
| ridge, relative height above the surroundings | +0.5 | −0.4 |
| poor ground (soil) | +0.9 | +0.8 × (1 − soil) |
| near a village (1.2 km) or farm (0.5 km) | −0.9 | +0.9 |
| near a road (400 m) | −0.3 | +0.4 |
| gentle ground, below the field slope limit | | +0.3 |
| river flat (wetness) | −1.2 | excluded above 0.35 |
| own noise at 0.7 × coherence | +0.4 | +0.3 |

Wetness is `(1 − d/250 m) × (1 − h/3 m)`, where `d` is the distance to water and `h` the height above the nearest wet cell's bed. It is 1 at the water's edge on level ground and 0 beyond 250 m or 3 m up.

Hard rules:

- **Fields** need the conservative slope bound ≤ `MAX_FIELD_SLOPE` (0.08), wetness below 0.35, and at least one dry cell between them and water (more than one cell diagonal away). They never go on a site's ground. The slope bound covers the cell and one sample beyond it. Smoothed outlines move at most a quarter of a cell from the lattice, and a quarter cell is never more than one sample spacing. So no point of a field polygon stands on ground steeper than 0.08.
- **Woods** never go on a site's ground or on water. Flats are strongly penalised but not excluded.
- A site's ground is always open.

Woods are allocated first: the best-ranked eligible cells, taking the area-nearest prefix of `woodFraction × dry area`. Fields follow on the remaining cells. Then the clean-up runs:

1. Wood or field patches smaller than 2 ha (`MIN_PATCH_M2`) become open.
2. Open clearings under 2 ha that are enclosed by a single kind take that kind, if every cell is eligible for it.
3. Each kind is brought back to its share. Cells are added along existing patch edges in rank order (up to 8 passes), or the worst-ranked edge cells are trimmed. Specks never return.

The rest of the dry ground is open. River flats are therefore open water meadow, and so are site grounds and steep ground beyond the wood share.

## Parcels and compartments

**Field parcels** form an anisotropic Voronoi partition of field cells. Seeds sit on a jittered grid about 220 m apart (`PARCEL_SPACING_M`). Each seed's cell is stretched 1.3–1.8× along its own strip direction:

- within 300 m of a road, perpendicular to that road, so strips run back from it;
- on slopes (smoothed gradient above 1.2%), along the contour;
- elsewhere, along one regional direction per map.

Cell positions are domain-warped, so parcel edges wander slightly. Roads split parcels: pieces are connected through road-free cells first, and road cells then join the adjacent piece with the lowest number. Pieces under 1.2 ha join the neighbouring parcel they share the longest edge with.

**Wood and open compartments** come from a warped isotropic Voronoi partition with seeds about 800 m apart. They keep every feature, its outline length and its hole count small.

Each feature is one 4-connected component of one (kind, parcel or compartment) label.

## Outlines

Before outlines are traced, diagonal pinches are removed. A pinch is a 2×2 block whose diagonal cells share a label that neither other cell has. The fix copies the label onto an eligible off-diagonal cell, or copies a neighbour's label onto the pinching cell. After six passes, any remaining pinching cells are left uncovered, repeating until none remain. After this, every region's boundary passes each lattice vertex at most once, so rings are simple and holes never touch the outer ring.

Boundaries are traced once as chains between junctions (vertices where three or more labels meet, or where the kind of boundary changes). The same chain geometry is used by both features on either side, so features never overlap and leave no gaps. Chains are smoothed according to what lies on each side:

- **cover | cover**: the lattice outline through the midpoints of its unit edges, then simplified at half a cell (lattice steps become their underlying straight lines), densified to half-cell spacing, averaged over two neighbours each side in two passes, and simplified at 0.1 cell. Interior junctions where only such chains meet move up to 0.3 cell along each axis, so straight runs between junctions do not stay axis-aligned.
- **cover | water or uncovered**: only the cover side's convex lattice corners are cut at edge midpoints. The outline never moves into a masked cell, so cover never grows over water.
- **cover | map edge**: exact.

Every feature is checked with the frozen `validatePolygon`, at most 2048 vertices per ring and at most 64 holes. If a feature fails, all its chains drop one smoothing level (averaged, then midpoint only, then exact lattice), and so does every feature they touch. This repeats until all features are valid. The exact lattice outline is always valid once pinches are removed. Coordinates are decimal-6. Features are ordered by their first cell in row-major order and get the IDs `cover:00000`, `cover:00001`, and so on.

## Diagnostics and budgets

`COVER_ACHIEVED` is JSON holding `dryEligibleAreaM2`, `coveredAreaM2`, `maskedAreaM2`, `dryAreaLossUpperBoundM2`, `fieldSuitableAreaM2`, the wood, field and open fractions of the covered polygon area, `maxCellAreaM2`, `features` and `demotedChains`. `COVER_FIELD_SHORTFALL` and `COVER_WOOD_SHORTFALL` warn when a share falls more than 5 points (`COVER_SHARE_TOLERANCE`) below the recipe. `COVER_NO_DRY_AREA` is unchanged.

Input validation and water topology reserve within `settings.limits.maxTopologyChecks`, as in v1. The rest of the stage meters its work against `COVER_WORK_FACTOR × maxTopologyChecks` (8×, so 40,000,000 units at the default). The units are cell visits, comparisons, raster samples, smoothed points and frozen-geometry checks, reserved before each phase. They are not CPU time. Exhausting them returns typed `COVER_LIMIT` with no partial cover. So does exceeding the stage's feature or vertex allowance, or a feature needing more than 64 holes.

## Measured

`coverRealism` (part of `realismReport`, `src/realism.ts`) samples every elevation cell centre, takes the cover feature containing it, and reports:

- each kind's share;
- the mean slope under woods and under fields, and the steepest point under any field;
- the mean distance from woods and from fields to the nearest site;
- what covers river flats (points within 150 m of a river and under 2 m above its surface);
- the share of outline length, away from the map edge, on axis-aligned segments, both overall and on edges two features share.

`tests/realism.test.ts`, `tests/realism-checks.ts` and `composition-representatives.test.ts` require:

- woods steeper than fields (on maps with relief);
- no field point above 0.08;
- fields nearer the settlements than woods;
- shares within 3 points of the recipe;
- under 5% axis-aligned land boundaries, and under 25% overall (water-side outlines keep the cell mask);
- river flats over 60% open and under 30% wood.

The checks run on river-valley 97 and 3, wooded-hills 31 and 7, and the three full preset assets. `tests/geography-cover-terrain.test.ts` covers:

- a hillside next to a village;
- road-split parcels;
- determinism and the effect of context;
- a ten-seed sweep of rough ground with lakes, roads and sites, checked for contract validity, non-overlap and no cover on water.

`tests/geography-cover.test.ts` keeps the v1 water-mask oracle and the budget tests. Renders and numbers are in `docs/map-realism/land-cover/`.

## Limits

- Water-side outlines follow the conservative cell mask (with corners cut), so a thin uncovered margin stays along rivers and lakes, and those edges are partly axis-aligned.
- Hedgerows are not drawn as separate features. Parcel edges are the field boundaries, and the renderer (D43) washes fields without outlining parcels.
- Sites change the cover around them, but cover does not move sites or roads.
