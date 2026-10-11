# Map authoring feedback verification

Scope: FB-001–FB-003 from [the byte-preserved capture log](../feedback.md), implemented under [the feedback plan](../map-feedback-implementation-plan.md). Reviewed baseline: `893f62b94ff8664353c329b6c99aae3d485f1a48`, branch `feat/procedural-battlefield-maps`, [PR151](https://github.com/exterkamp/kriegsspiel/pull/151). Original capture wording, kinds, classification, priority and attachments remain unchanged. Implementation evidence is recorded here separately.

## Environment and before views

Node22.22.2; native Chrome on the existing review machine. Existing devrun `map-review` server responds at http://127.0.0.1:41660/map-authoring.html; reused without restarting. No HQ server/pane changes, prototype edits, merge, deployment or combined-build distribution.

- [Before desktop](screenshots/before-desktop.jpg): observed1456×902 CSS viewport, DPR2.
- [Before narrow](screenshots/before-narrow.jpg): explicit680×900 CSS viewport, DPR1.

Screenshot pixel dimensions are distinct from CSS viewport measurements. Temporary responsive overrides are restored after testing.

## Review and checks

The sole writer froze all six product files after37 focused behavior tests, scoped lint/format and client typecheck passed. The fresh GPT-6.1-Sol/high reviewer independently passed37/37 tests plus in-memory probes for pending validation, byte-preserving tabs, precision, mixed invalid drafts and error focus. [Final independent report](independent-review.txt) records PASS with no actionable findings. The reviewer made no edits.

Root checks all exit0: [lint](checks/lint.log), [typecheck](checks/types.log), [build](checks/build.log), [tests](checks/tests.log).1327 tests pass (1306 Vitest +21 Node), one existing server test skipped. Build retains the existing bundle-size advisory. Node22.22.2 was used.

## Native Chrome acceptance

- **FB-001:** Empty desktop and680×900 narrow preview shows the no-map card with shared Generate/load actions. Both Generate buttons block invalid settings. Real flat17 starts from the empty-state button and reaches certified ready, hiding the overlay. Malformed saved version fails visibly with usable recovery actions. A new valid saved file recovers. Cancellation and an infeasible `(0,0)` site move retain the prior map, keep the overlay hidden and disable exports; the failure reports `SITE_OVERRIDE_UNSUITABLE`.
- **FB-002:** Generate is visible near the top of the desktop sidebar without scrolling. Arrow/Home/Space tab navigation selects the correct panel without generating; also verified with native Chrome app keyboard input. Blank `roads.maxGlobalExpansions` survives Simple seed and size edits and disables both Generate actions. Fix in Advanced selects Advanced, expands the enclosing disclosure and focuses the still-blank field. Flat fields remain exactly.6 when Woodland.5 conflicts, and Woodland.3 recovers.
- **Exact recipes:** A real5×6km flat17 custom recipe with roughness/woodland both`.123456` and ordered rename generates/certifies. Simple displays Custom size and exact readouts. Saved validation across tab-only switches retains both values and the override; Advanced also exposes the exact values. Reload/re-export and fresh bounded CLI regeneration match canonical JSON byte-for-byte. [Settings](custom-settings.json), [overrides](custom-overrides.json), [hashes](asset-hashes.json), [CLI replay log](checks/cli-custom.log), [independent saved certificate](checks/cli-saved-validation.log) make this reproducible. Certificate: connected10sites/318buildings/1272assigned.
- **FB-003:** Native selector retains placeholder, stable IDs, focus ring and comfortable caret/text clearance. Native Chrome menu click→Down→Return selects Farm1 and enables Site detail. Explicit village selection reaches detail scale. Site/viewport actions are disabled before a map exists and enabled after certification.
- **Presentation and export:** Flat17 canonical JSON SHA remains`6305b91faa19915eeea48e0bb473d900415ff00584fce318866d4e79e883926a` before/after tab switches, high contrast and site detail. Custom saved/reloaded/CLI JSON SHA is`fef84239b835c411c28f036d5cf3b67af842dc6e831b1e6789a2d25cb0e6e1de`; actual SVG downloaded as well. Adjusted river saved loading preserves rename→move→exclusion order; regeneration across tab switches and actual re-export both retain canonical SHA`c3fb36409721baaf41cc82445a07f3f6dc1210ea576c0bfa7b6c2f334080cd29`. The final marked preview is ready with this real certified map and primary controls restored to the top.
- **Shared CSS:** Diagnostic canvas at1800×1400 viewport remains1440×900 CSS pixels, origin(9,209.875), completely inside the viewport. [Layout capture](screenshots/benchmark-layout.jpg). No repeated benchmark run or performance claim.

Automation limits: one browser download-event wait timed out despite a successful actual download. Files were then verified from native Chrome’s Downloads directory after UI export clicks. Synthetic keyboard calls did not exercise the background native select popup; the dedicated acceptance tab was explicitly focused in the Chrome app and native keyboard selection succeeded. Neither issue required product edits or security-setting changes.

## After views

- [Empty desktop](screenshots/after-empty-desktop.jpg) and [empty narrow](screenshots/after-empty-narrow.jpg).
- [Invalid draft focus recovery](screenshots/after-invalid-recovery.jpg), [initial failure](screenshots/after-initial-failure.jpg), [retained-map failure](screenshots/after-retained-map-failure.jpg).
- [Site detail desktop](screenshots/after-site-detail-desktop.jpg), [precise custom desktop](screenshots/after-custom-desktop.jpg), [saved map narrow](screenshots/after-map-narrow.jpg), [adjusted river desktop](screenshots/after-river-desktop.jpg).

Desktop before/empty/custom/site/river captures use observed1456×902 CSS viewport, DPR2; narrow captures use verified680×900 CSS viewport, DPR1. The initial-failure image is1456×846 pixels; its CSS viewport was not separately recorded, so no CSS viewport is inferred for that capture. Original feedback log, plan and all three original attachment hashes match [the preserved manifest](protected-sha256.txt). The dirty prototype patch and terrain hashes also match their kickoff copies. The capture log remains the original capture record; completion is documented here and in the execution log. Prior terrain corpus/resource/benchmark evidence remains in [the original verification report](../map-verification-report.md); this feedback change does not repeat or extend those claims.
