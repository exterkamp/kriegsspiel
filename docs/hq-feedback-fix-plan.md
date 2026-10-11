# HQ feedback fix plan

Implementation authorized on 2026-10-10, based on the four captured items in the local feedback inbox (`docs/hq-feedback.md`). All four are fixes to UI introduced by PR #193. Implement them on the HQ branch and include them in that PR. Original screenshots and wording remain the acceptance references and are retained locally with the capture agent. Published reproduction and fix evidence is in [feedback validation](hq-feedback-validation.md). The original planning pass made no product changes; current progress is recorded in the execution log.

## Order of work

### 1. Freeze the reviewed build and reconcile the baseline

Preserve the feedback log, original screenshots and current HQ edits before any integration. Record the exact commit and browser viewport for the first reproduction. The screenshot pixel dimensions alone do not establish the CSS viewport or zoom.

Refresh main and active owners at implementation kickoff. Earlier main changes introduced overlapping desk/authentication code; resolve any remaining integration conflicts in the HQ checkout through the independent review gate before accepting a final fix build. Preserve the accepted live entry and authentication behavior. Keep the separate map-generation checkout, agents and devrun session untouched.

First capture the current behavior at the HQ preview: clock/source timestamps, roster at desktop and narrow widths, settings placement and mouse/keyboard destination focus. Reproduce with the owner's viewport/zoom if available; otherwise record the dimensions used and retain that evidence limitation. Keep the same HQ origin for saved-data checks.

### 2. Agree the presentation contracts

The coordinator records these defaults before overlapping writers start:

- **Game timestamps:** display elapsed game time as `HH:MM:SS`, with hours allowed above 24; for example, `01:00:00` and `25:01:01`. No raw millisecond suffix. Unknown or invalid values stay explicitly unavailable; zero is valid. Ages use readable durations such as `5m ago`, retaining `current snapshot` and unavailable-age distinctions. No calendar date or wall-clock conversion without a scenario date contract. Numbers in stores, payloads and exports retain their existing units and precision.
- **Settings:** a labelled Settings button in the HQ header opens a native dialog containing the existing shortcut, contrast and motion controls. Preserve current persistence/session semantics. Opening/closing has explicit focus handling; Escape closes the dialog and returns focus to Settings. Saving failures must remain discoverable when the dialog is closed.
- **Tables:** establish a shared Svelte Table component with native HTML table semantics, caption/header support, column presentation rules and a labelled keyboard-accessible overflow region. Header/numeric/coordinate text does not break inside words. Prose wraps at words. Use available page width on desktop and deliberate horizontal scrolling on smaller screens so every column and action remains reachable.
- **Destination focus:** headings remain semantic, noninteractive headings. Keep accessible focus handoff and visible keyboard focus for controls; replace the unconditional full-width blue heading outline with a deliberate heading treatment appropriate to programmatic navigation. Check mouse and keyboard paths separately.

These defaults passed the independent architecture review before implementation. They do not introduce a scenario calendar or change service authority.

### 3. Implement bounded packets

| Packet | Feedback | Owned files | Result |
| --- | --- | --- | --- |
| A: shared time presentation | HQ-FB-001 | New `hq/presentation/gameTime.ts` and tests; named clock, in-tray, journal, marks and plotting presentation files/tests | One formatter for visible HQ timestamps and ages; all existing presentations adopt it |
| B: table component and roster | HQ-FB-003; roster portion of HQ-FB-001 | New `hq/ui/Table.svelte` and focused harness/tests; `hq/views/roster/**` | Standard table presentation, compact readable provenance, accessible overflow and intact focus actions |
| C: settings and destination focus | HQ-FB-002, HQ-FB-004 | `hq/shell/**` after coordinator time wiring has settled | Header Settings dialog; corrected heading focus styling and complete keyboard behavior |
| Coordinator integration | All four | Shared contracts, Shell/App integration outside active writer ownership, configuration, docs, git and PR | Serialize overlapping changes; keep the preview and existing behavior coherent |

Freeze Packet A's formatter signature before Packet B consumes it. A and B can run concurrently only after this dependency and their exclusive file lists are agreed. The coordinator integrates the Shell timestamp call site before assigning Shell to Packet C. No two writers edit Shell, roster or shared components at the same time.

Use the existing Herdr model policy: `gpt-6.1-sol` high for shared time correctness and independent review; medium for ordinary table/settings Svelte work. Verify effective model/effort in the native session. Keep at most two HQ writers plus coordinator and one read-only reviewer; account for the simultaneous map run. The feedback capture agent remains a recorder and retains ownership of its inbox/assets. It is not an implementation writer.

## Acceptance per item

| ID | Fix | Required evidence |
| --- | --- | --- |
| HQ-FB-001 | Replace inconsistent raw millisecond displays with shared game-time and duration presentation across clock, source line, roster, paper reader/list, journal, mark provenance and placement panel | Same time appears consistently across views; valid zero and times beyond 24 hours; unknowns remain unknown; rate/status/barrier behavior unchanged; before/after screenshots |
| HQ-FB-002 | Move the preference controls into Settings | Reachable without scrolling to the footer; dialog labels/focus/Escape work; contrast/motion persistence and session-only shortcut toggle preserved; errors remain visible/discoverable |
| HQ-FB-003 | Adopt the shared table component and fix sizing/wrapping/overflow | Commander header and formation names remain readable; no cut-off position values; all seven columns including the focus action can be reached at narrow widths/zoom; long prose wraps; roster semantics and unknown/provenance distinctions remain intact |
| HQ-FB-004 | Correct the heading's visual focus presentation | Clicking/navigating to Roster does not give its heading a control-like full-width blue border; heading has no action; keyboard navigation still has clear focus and sensible next Tab target; no blanket removal of focus indicators |

Source findings are narrower than browser diagnosis: there are several independent time formatters; the shell applies `overflow-wrap: anywhere` to main content and an explicit `h2:focus` outline; the roster sizes its own table inside a narrower paper panel. The exact navigation sequence and overflow behavior still require browser reproduction. Do not call a screenshot-only hypothesis a proven cause.

## Verification and delivery

1. Add focused behavioral checks where meaningful: time boundaries/unknowns and consistent adoption, Settings focus/keyboard/save failures, and preserved roster focus/semantics. Update assertions that intentionally expected the old raw millisecond presentation. Avoid tests that merely restate CSS declarations.
2. Review substantive keyboard/time changes independently. Each writer repairs its own findings; coordinator inspection precedes integration.
3. Use the running HQ browser for actual layout and interaction evidence. Record browser/version, CSS viewport, zoom and input method; check normal/high-contrast/reduced-motion modes, desktop/narrow widths and 200% zoom. Take matched before/after screenshots for each feedback ID. Screenshot pixel size alone is insufficient for responsive claims.
4. Exercise a short regression path: desk/table camera round trip, roster focus, read/file a paper, create/cancel a report placement, save/reload a mark, restore an order draft and save/reload notes. Settings or focus changes must not disrupt these interactions.
5. Run required lint, typecheck, tests and build on the integrated branch, then verify CI on the exact published head. Update the user guide and execution log for changed controls/time presentation.
6. Use small commits mapped to feedback IDs in the existing PR #193. Keep feedback entries Captured until accepted evidence is attached; have the capture owner record the outcome and any remaining questions. Unresolved findings remain open. Deliver the updated preview and PR for review; do not merge, deploy or close Epic #4.

A fix is complete when its expected behavior works in the real browser, its relevant regression checks pass and the feedback ID has matching evidence. Existing live-game/service/performance gates remain separate; fixing these four UI findings does not complete the epic.


## Frozen presentation API — 2026-10-10

Independent high-effort review accepted the bounded display API with these clarified boundaries. `hq/presentation/gameTime.ts` exports `formatGameTime(value: number | null | undefined): string` and `formatGameAge(ageMs: number | null | undefined): string`. Valid input is a nonnegative safe-integer millisecond count. Invalid inputs return `Time unavailable` / `Age unavailable`; zero formats as `00:00:00` / `current snapshot`. Display timestamps floor seconds without wrapping elapsed hours. Ages 1–999 ms read `less than 1s ago`; otherwise floor to whole seconds below one minute, minutes below one hour, hours below one day, days thereafter (`5m ago`). Data/calculations and existing export precision are unchanged. The journal export retains its original precise formatter separately from visible display.

`formatGameDuration(value: number | null | undefined): string | undefined` supplies exact ISO duration metadata for the source `<time>` element. It retains the integer second and millisecond remainder independently, including `Number.MAX_SAFE_INTEGER` (`PT9007199254740.991S`); invalid values have no duration attribute. This metadata supports precise synchronization checks without exposing raw units in the visible timestamp.

Keep main's accepted live renderer/helper at `table/TableScene.ts` / `table/marks.ts`; HQ's stricter fixture renderer/helper are `table/FixtureTableScene.ts` / `table/fixtureMarks.ts`. Both existing behavioral test sets are preserved separately. This avoids combining incompatible live side-shared mark authority with scoped private HQ marks. HQ adapters import the fixture renderer. Shared public types are additive; optional overlay/mark fields do not imply a service capability.

Table component API is local UI: semantic caption and column/row headers, caller-supplied header/body snippets, labelled focusable overflow region, explicit column classes for prose/values/actions. It must fit all seven ordinary fixture columns at the desktop check while allowing deliberate horizontal scrolling at narrow widths. Remove repetitive per-cell snapshot paragraphs only when the same provenance remains explicit in the table-wide caption/description; unknown values and missing commander remain explicit. Roster may use the wider shell paper variant, coordinated during the serialized Shell packet.
