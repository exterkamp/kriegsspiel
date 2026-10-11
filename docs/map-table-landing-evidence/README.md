# Saved-map landing verification

Fresh local verification on 2026-10-11 at source `2f6365a4ed5d1ee9573d865d8a46785637fd755e`, tree `90fcc869ffeaf1f78f715f2e7f82c46afb8144f3`, main base `c82aa1f8bec0aacea1a0edea9e8f2503c53d5421`. Later base refreshes must reconcile this evidence by content identity.

A disposable browser harness used unchanged saved-table markup and imported the shipped page entrypoint. Test buttons supplied canonical JSON as File objects through the actual file input change handler. Actual validation workers certified saved geometry and the renderer applied real WebGL textures. The harness and its served assets were removed; no test route ships. The native picker automation timed out, so these captures verify the file-reading/certification/rendering path, not physical picker interaction.

- [Desktop rectangular map](p0-rectangle-desktop.jpg): seed17, 5,000 × 3,000 metres, top-down registration. Full canonical identity `26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84`.
- [Narrow square map](p0-square-narrow.jpg): seed31, 5,000 × 5,000 metres, oblique view. Full canonical identity `ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed`. Viewport 390×844; document scrollWidth 375, no horizontal overflow.
- Invalid replacement reported INVALID_JSON and retained the displayed rectangle. Cancellation of rectangle certification retained the displayed square. Focused ArrowRight was exercised; quantitative camera displacement was not measured in this run. Fit/top-down/oblique were usable. Captured console warning/error list was empty.
- Square DOM inspection recorded device texture cap 16384, applied texture 4096×4096, one texture and twelve geometries after replacement. These are observations, not GPU-memory or timing guarantees.

Local root lint/typecheck/test/build passed; 2,628 tests passed with one existing optional skip. Focused loader/raster/page/preview/surface/bootstrap/shell/guest suites passed 137 tests. Typecheck retained the existing Desk CSS warning; build retained the large-chunk advisory. Source review covered all 17 PR paths at the named source without code findings. Current PR head, latest base, full required checks and independent integration acceptance are reported on the PR rather than inferred from these historical captures.
