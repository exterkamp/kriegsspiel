# HQ fixture assets and visual review

The fixture uses original project artwork and geometry. No historical scan, external image pack, downloaded font or map-generation branch artifact is bundled by this change.

| Asset | Source and registration | Use and terms |
| --- | --- | --- |
| `client/public/hq-preview.svg` | Original HQ illustration authored in this branch; 1200×900 pixels, artwork revision 2, full image spans 4000×3000 metres with north-west origin | Public geography preview only. Project-owned fixture; external reuse terms are unspecified. It is not a historical survey or engine terrain. |
| Table, blocks, ruler, dividers, inkwell and lamp | Procedural Three.js geometry in `client/src/table/FixtureTableScene.ts` and `client/src/table/dressing.ts` | Original code-generated table dressing and knowledge-preview pieces. No secret terrain or game state used as decoration. |
| Personal marks and paper tags | Generated metre geometry and canvas text in `client/src/table/fixtureMarks.ts` and `FixtureTableScene.ts` | Player labels render as plain text. Provenance is retained in the local document; source updates do not move annotations. |
| Paper and ink interface | CSS in the HQ shell and views; `--paper` and `--ink` theme tokens | Restrained parchment and serif text. High contrast swaps tokens to white and black; no bitmap texture obscures reading. |
| Typography | System Georgia, Times New Roman and serif fallbacks | No font files are redistributed or fetched. Metrics depend on available system fonts. |

Code review has checked token inheritance, focus indicators, text wrapping, native form semantics and reduced-motion branches. Camera transitions follow the player's and system's reduced-motion setting. Courier and signing animations remain unavailable because those services are not accepted into HQ.

Visual design approval is pending. When the user-supplied launcher is ready, capture the table overview/detail, every desk view, high contrast, reduced motion and narrow viewport. Review maximum-length paper IDs and mark labels, focus visibility, map alignment at corners and asymmetric landmarks, and readable dispatch prose. Record the browser, hardware, viewport and DPR with the 60-piece frame-time measurement. Headless checks do not establish visual quality or 60 fps.

## Table benchmark harness (#49)

`client/table-benchmark.html` (dev server, `/table-benchmark.html?seconds=10&orbit=1`) renders the 60-piece performance fixture (30 own, 15 fresh contacts, 15 stale ghosts) on the public artwork and samples `requestAnimationFrame` intervals after a 2 s warmup. The result is in the page and on `window.__tableBenchmark` (frame percentiles, draw calls, textures, DPR, viewport). It must be run on a real GPU: a software-rendered headless run (SwiftShader, 4-core i3) measured about 4 fps and is not evidence for the 60 fps criterion. Draw calls measured there: 194 for 60 pieces.
