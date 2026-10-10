# HQ fixture assets and visual review

The fixture uses original project artwork and geometry. No historical scan, external image pack, downloaded font or map-generation branch artifact is bundled by this change.

| Asset | Source and registration | Use and terms |
| --- | --- | --- |
| `client/public/hq-preview.svg` | Original HQ illustration authored in this branch; 1200×900 pixels, artwork revision 2, full image spans 4000×3000 metres with north-west origin | Public geography preview only. Project-owned fixture; external reuse terms are unspecified. It is not a historical survey or engine terrain. |
| Table, blocks, ruler, dividers, inkwell and lamp | Procedural Three.js geometry in `client/src/table/TableScene.ts` | Original code-generated table dressing and knowledge-preview pieces. No secret terrain or game state used as decoration. |
| Personal marks and paper tags | Generated metre geometry and canvas text in `client/src/table/marks.ts` and `TableScene.ts` | Player labels render as plain text. Provenance is retained in the local document; source updates do not move annotations. |
| Paper and ink interface | CSS in the HQ shell and views; `--paper` and `--ink` theme tokens | Restrained parchment and serif text. High contrast swaps tokens to white and black; no bitmap texture obscures reading. |
| Typography | System Georgia, Times New Roman and serif fallbacks | No font files are redistributed or fetched. Metrics depend on available system fonts. |

Code review has checked token inheritance, focus indicators, text wrapping, native form semantics and reduced-motion branches. Camera transitions follow the player's and system's reduced-motion setting. Courier and signing animations remain unavailable because those services are not accepted into HQ.

Visual design approval is pending. When the user-supplied launcher is ready, capture the table overview/detail, every desk view, high contrast, reduced motion and narrow viewport. Review maximum-length paper IDs and mark labels, focus visibility, map alignment at corners and asymmetric landmarks, and readable dispatch prose. Record the browser, hardware, viewport and DPR with the 60-piece frame-time measurement. Headless checks do not establish visual quality or 60 fps.
