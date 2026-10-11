# SettleMaker architecture fixtures (#133)

These scripts are an assessment harness, not a battlefield generator. They compare physical village/city and legacy village/city at committed source `d5cf3590cf59e1d382110d25a6910f12507299e2`. They never write into the fork, import the dirty terrain prototype, install dependencies, or add a root workspace dependency. The [architecture note](../../docs/map-architecture.md) explains planner selection and bounded #138 work.

## Files

- `build-source.mjs`: extract pinned Git objects into a new directory, check six installed dependency versions against integrity-bearing lock entries, compile source and browser bundle using existing tools, and write build provenance. It refuses an existing output directory.
- `geometry.mjs` / `geometry.test.mjs`: analytical metre transforms, plane grades, hole-aware areas, distances and conservative complete corridor buffers.
- `run.mjs`: dynamically import the pristine compiled library, execute sixteen flat/constrained comparisons, assess complete footprints/corridors/joins, and write a report. Repeats each fixture in-process, checks physical export/scene parity and render invariance, and verifies that scalar elevation cannot constrain placement.
- `replay.mjs`: run the harness in a fresh Node process and compare fixture hashes, geometry diagnostics, route joins and controls against the recorded report; exclude elapsed timing.
- `results.json`: full observed provenance, settings, source metadata, hashes, diagnostic IDs/counts, joins and measured single-run timing. This file is evidence, not a canonical battlefield asset.

## Commands and observed results

Run from the Kriegsspiel repository root, with existing fork `node_modules` available. No `npm ci` is performed by the harness. Exact worker commands on 2026-10-10:

```sh
node scripts/maps-assessment/build-source.mjs .local/settlemaker /private/tmp/kriegsspiel-map-assessment-133
node --test scripts/maps-assessment/geometry.test.mjs
node scripts/maps-assessment/run.mjs /private/tmp/kriegsspiel-map-assessment-133/source/dist/index.js scripts/maps-assessment/results.json
node scripts/maps-assessment/replay.mjs /private/tmp/kriegsspiel-map-assessment-133/source/dist/index.js scripts/maps-assessment/results.json
node_modules/.bin/eslint scripts/maps-assessment/*.mjs
node_modules/.bin/prettier --write scripts/maps-assessment/results.json
node_modules/.bin/prettier --check scripts/maps-assessment/*.mjs scripts/maps-assessment/results.json
```

| Command | Result |
| --- | --- |
| Pristine source build | Exit 0; ESM, declarations, source maps and 2.3 MB minified browser bundle built. Source tree `ee7db196403a98c5a2ab2378fcaed7c757080250`. |
| Analytical tests | Exit 0; 5 tests passed (rotation/scale round trip, known plane, distances/grades, polygon holes, full corridor width/caps). |
| Comparisons | Exit 0; 16 cases, both seeds × four candidates × flat/constrained; every in-process repeat matched, all eight control/parity checks passed. |
| Fresh process replay | Exit 0; 16 hashes and complete diagnostics/joins/controls matched; timing excluded. |
| Scoped ESLint | Exit 0; no findings. |
| Scoped Prettier | Exit 0; all checked files formatted. Markdown is excluded by the existing root `.prettierignore`; it is reviewed directly. |

The first analytical test run returned exit 1 (3/4 passing) because the test's handwritten expected plane height was 211.138 instead of **210.978**. Corrected the expected arithmetic; production transform/height logic was unchanged. Added the corridor test afterward; the final five-test command above passed. Early fixture runs were followed by complete reruns after adding corridor and site-bound diagnostics; `results.json` corresponds to the final runner.

Preservation check: SHA-256 of `git -C .local/settlemaker diff --binary` remains `4a64b570bc97762ff4abf656b5009d83effcbc3c2d3ecebfe037e2280cb36d28`, matching the coordinator baseline manifest. All four untracked `src/terrain/*.ts` hashes also match that manifest. The fork's original dirty source is preserved byte-for-byte.

The build script's executed build operations are `node <existing-fork>/node_modules/typescript/bin/tsc --project <temporary-source>/tsconfig.json` and `<existing-fork>/node_modules/.bin/esbuild src/index.ts --bundle --format=esm --target=es2022 --minify --outfile=dist/settlemaker.browser.js` with an exact-fork GPL source banner, running in the temporary source directory. All source/dependency references are read-only; outputs remain temporary. To rerun the source build, use a new output directory and substitute its entrypoint in subsequent commands. For a release, the coordinator must separately test a network-fresh integrity-locked install and packaging; upstream's `npm pack` cleans and rebuilds first.

## Evidence and limits

The environment was Node `v22.22.2` on `darwin/arm64`. The pinned lock SHA-256 is `b4b573af49d188d144273d19662485290924d5558a7653c805dbe9d0bed34e01`; installed checks covered TypeScript `5.9.3`, esbuild `0.25.12`, polygon-clipping `0.15.7`, splaytree `3.2.3`, robust-predicates `3.0.3` and @types/geojson `7946.0.16`. This verifies the versions used, not all installed dependency bytes. Public GitHub pin verification and a separate fresh `npm ci` were reported by the coordinator, not executed by this worker.

Every case uses 300 residents and explicit asymmetric approaches. Constrained water is supported input; the 13% plane, excluded rectangle and bounded site are external diagnostic requirements with no supported terrain-context API at the pin. Exact polygon intersections check the entire footprint, including holes. Road corridors use every emitted segment plus conservative round caps/joins (circumscribed 32-gons, ≤0.484% radial excess). Physical road widths are travelled surfaces; reserved widths are missing from that export. Legacy city has some missing widths, reported explicitly, so complete corridor certification is unavailable there. Water overlaps may be approved crossings; the fixture counts them without silently treating every one as invalid. No general sampled-terrain validator is claimed.

Seed 2 physical village has 75 dry buildings, but 27 hit the exclusion, all 75 fail the plane limit and 129 road segments exceed 10%. It has 4 water-intersecting corridors and zero exported bridges; legacy village carries 4 crossing records for its corresponding constrained layout. Physical village flat endpoint gaps are 7.219/55.121/7.549 m, while legacy village meets its internally chosen circular boundary within 1e-6 m. Physical city loses all three route-matched street identities. These differences motivate explicit joins, structured water/crossing diagnostics and full terrain/placement support in #138.

Legacy city constrained water is converted using the flat run's population/extent heuristic for diagnosis only. The resulting scale drifts (seed 2: 4.7194536308 → 3.5372204176 m/unit), so this is not a reliable metric adapter. The reported building-water overlap is against the requested metric water, not a certification of legacy city input/output alignment. Nonzero coast shifts are documented from source; the chosen fixtures report zero shift.

The report removes only `generated_at` for legacy canonical hashes. Timings exclude import and diagnostics and are single warm-process observations; the legacy-city public convenience call includes SVG whereas the other calls skip SVG. No generation/preview performance target, peak memory limit, large-city corpus or cross-runtime determinism claim is established. No repository-wide checks were run or shared files changed by this packet.

The root repository has no licence grant. The fork is GPL-3.0-only; engine/source/dependency notices and separate artwork terms must be retained, and the combined-work licensing/source-distribution gate must be resolved before a distributable integration ships. See the architecture note's release checklist. This harness imports an existing GPL program but copies no engine implementation into these scripts.
