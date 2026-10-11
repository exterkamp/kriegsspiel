# HQ feedback validation — 2026-10-10

All four findings introduced by PR #193 are implemented and accepted by independent code review. They remain selected for owner validation; this evidence does not close Epic #4 or its live-service/device acceptance gates.

## Build and environment

- Before: HQ commit `f6b4b5959dee781083b141955e02a102d25b7527`, origin `http://127.0.0.1:41161/`.
- After: fixes on `feat/hq-interface`, following reviewed integration commit `728bbed07e512ed40b17b70364bbe7bb83a059ac` and accepted main `1e2f84706a8218f6c421452874afa66069fc0e4b`. The PR records its exact published head and CI result.
- Chrome `154.0.8037.98`; desktop CSS viewport `1456 × 846`, narrow viewport `600 × 846`; mouse and native keyboard input.
- Saved-data tests used the separate validation origin `http://127.0.0.1:41292/` so the owner's HQ drafts, notes and marks at port 41161 were preserved. The fixture snapshot is the same at both origins.
- Browser zoom was not independently established. Page zoom shortcuts did not change measured viewport; the narrow-width check is responsive evidence, not a claim of actual 200% zoom. Original owner screenshot viewport/zoom remains unknown.

## Findings and evidence

| Finding | Implemented behavior | Browser and regression evidence |
| --- | --- | --- |
| HQ-FB-001: inconsistent game timestamps | One elapsed `HH:MM:SS` formatter for clock, source, roster, paper dates, journal, mark provenance, placement and map tags; readable ages; invalid values explicitly unavailable | [Before clock](hq-validation-assets/before-clock.jpg), [after clock and roster](hq-validation-assets/after-roster-footer-removed.jpg). Clock/source/roster show `01:00:00`; reader/placement show `00:30:00` written and `00:40:00` received, with observation unavailable. Boundary tests cover zero, beyond 24 hours, invalid input and exact millisecond metadata/exports. |
| HQ-FB-002: footer preferences | Header Settings opens a labelled native dialog with the existing controls | [After Settings](hq-validation-assets/after-settings-footer-removed.jpg). The bottom status bar is removed entirely; routine status appears only inside Settings and failures appear conditionally in the header. Initial focus, native Escape and return to Settings verified. Contrast/motion survive reload; letter shortcuts reset per session. Modal shortcuts do not navigate the background. Tab/Shift+Tab can visit browser chrome, then return to the modal without reaching background page controls. Storage-error regression checks preserve closed-dialog errors. |
| HQ-FB-003: roster wrapping/clipping | Shared semantic Table component, wider roster paper, unbroken value/header text, word-wrapped prose and labelled keyboard-accessible overflow region | [Before roster](hq-validation-assets/before-roster.jpg), [after desktop](hq-validation-assets/after-roster-footer-removed.jpg), [narrow action access](hq-validation-assets/after-roster-narrow.jpg). All seven ordinary columns fit a 1024px desktop table. At 600px, the 896px table scrolls inside a 554px region without page overflow; keyboard focus scrolls to the map actions. Recorded browser measurements found long decimal values fit their intrinsic cells. The [precise-coordinate scenario](hq-validation-assets/decimal-roster-narrow.jpg) captures the left side of the narrow table; Position is outside the captured view, so this image alone does not establish its value layout. Separately dated position provenance and focus actions have behavioral tests. Actual 200% zoom still needs manual validation. |
| HQ-FB-004: blue heading outline | Semantic destination heading receives focus with a plain mouse appearance and a keyboard-visible left accent; control focus outlines remain | [Before roster](hq-validation-assets/before-roster.jpg), [after roster](hq-validation-assets/after-roster-footer-removed.jpg), [high contrast](hq-validation-assets/after-roster-high-contrast.jpg). Mouse activation focuses the noninteractive H2 without outline, underline or visible border. Keyboard activation shows the accent; next Tab reaches Return to map table with its visible outline. |

The before/after roster captures use matched CSS viewport dimensions. Full-page image height changes with the content. The precise-coordinate screenshot uses a temporary real-App fixture scenario, removed from deliverables; its source is preserved at `/private/tmp/hq-feedback-pass-20261010/decimal-roster-validation.html`. Original owner attachments and wording remain in the local capture inbox/assets; the images here are coordinator-generated fixture reproductions.

## Combined regression path

- Desk/table round trip and roster focus action return to the map.
- Local mark Save and reload preserve a labelled mark with decimal coordinates.
- Order draft and personal notes restore their exact entered text after reload.
- Opening a paper reduces its unread count; filing it survives reload.
- Numeric report placement preserves written/received provenance. During placement, first Escape closes Settings and preserves entered east coordinate `2200.25`; next Escape cancels placement. No pin is created by cancellation. A later explicit Create and Save persist the report pin across reload.
- Normal, high-contrast and reduced-motion preferences were exercised. Narrow keyboard focus reaches table actions. Native dialog modality and focus return were observed in Chrome; jsdom tests supplement these checks.

Full integrated lint, typecheck, tests and production build pass. Svelte reports zero errors/warnings. Tests: 328 engine, 55 protocol, 432 server, 852 client and 13 root — **1,680 passed**, one optional server test skipped. Build retains the main-chunk warning (832.35 kB, 229.62 kB gzip) and dependency annotation warnings. No forced dependency upgrades were made.

After the second accepted-main refresh to `6343c2b` (lobby/hot-seat, live DeskClock and admin replay), independent review accepted the resolved composition boundary. Full lint, typecheck, tests and build pass again: **1,723 passed** (328 engine, 55 protocol, 452 server, 875 client, 13 root), one optional server skip and zero Svelte diagnostics. Main bundle is 832.47 kB / 229.67 kB gzip. A browser reload reconfirmed the same HQ timestamps, seven-column desktop table and plain heading; incoming live features retain their separate routes.

Merge-readiness refresh consumes accepted main `4714b73` (reconnect/catch-up and live Orders). The entry/decision conflicts are independently reviewed and resolved while preserving the fixture router, accepted live composition and all decisions. Full lint/types/tests/build pass: **1,748 tests** (332/56/456/891/13), one optional skip and zero Svelte diagnostics; main bundle 833.08 kB / 229.85 kB gzip. Browser reload reconfirms visible fixture Orders with signing disabled, seven roster columns and no footer. The separate live Orders desk does not turn this fixture into a live HQ. PR #193 records the final published head, CI and mergeability.

## Remaining owner/epic validation

Use [the getting-started guide](hq-getting-started.md) to check actual 200% browser zoom and physical touch input. Live HQ projection/commands, shared mark authority, signing/couriers, conference/replay services, accepted generated-map handoff and measured 60-piece FPS remain separate epic gates. This pass did not merge a GitHub PR, deploy, close issues or modify the map-generation checkout.


## HQ-FB-002 follow-up: bottom status bar

The owner's 18:08 screenshot showed that the first Settings fix still left a healthy `Preferences saved (browser).` footer. The follow-up removes the footer markup and styles entirely. Preference failures and general HQ errors are conditional notices in the existing header; successful preference load/save clears its notice. Queue/revision/conflict semantics are unchanged.

Medium writer completed the two Shell files in 37s; 49 focused Shell tests, scoped lint and formatting pass. Independent high review accepted the narrow change in 18s. Full lint/typecheck/tests pass again (1,723 passed, one optional server skip, zero Svelte diagnostics); production build passed (main 832.71 kB / 229.72 kB gzip; existing chunk/annotation warnings remain). Browser at CSS 1456×846 on the owner's running preview confirmed zero footer elements and no routine preference text in the header. Opening Settings shows the saved status; closing it restores the plain page. The preview was returned to Map table, without editing marks, drafts or notes.

The latest desktop/Settings links above show this follow-up. Earlier images retained in this directory record the first fix pass and can still contain its residual footer; narrow/high-contrast evidence remains from that pass. Original owner screenshots stay with the local capture inbox.
