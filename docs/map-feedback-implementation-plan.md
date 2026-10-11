# Map authoring feedback implementation plan

Plan prepared 2026-10-10 against branch `feat/procedural-battlefield-maps`, commit `893f62b94ff8664353c329b6c99aae3d485f1a48`. Origin: [PR #151](https://github.com/exterkamp/kriegsspiel/pull/151), [Epic #132](https://github.com/exterkamp/kriegsspiel/issues/132), [capture log](feedback.md). This document plans development; product implementation has not started.

## Outcome and attribution

A first-time author sees why the canvas is empty, finds Generate without scrolling through technical settings, and can create a map using a compact primary view. Exact settings, ordered adjustments and saved replay remain available in Advanced. The site selector has comfortable text/caret spacing and retains its native keyboard behavior.

| Feedback | Planned change | Classification and rationale |
| --- | --- | --- |
| FB-001 | Visible no-map state inside the preview, with Generate and Load saved map actions | Fix: refinement of the standalone preview delivered in #151; screenshot shows its blank initial canvas. Not a proven generator failure. |
| FB-002 | Simple primary controls; complete settings and overrides in Advanced; prominent Generate | Fix: owner usability refinement to the newly delivered authoring sidebar. Not a pre-existing bug merely because it extends original requirements. |
| FB-003 | Site selector width and caret clearance, including its empty state | Fix: visual refinement to the selector introduced by #151. Browser-native caret placement is a hypothesis, not a confirmed cause. |

These classifications are planning notes; preserve the original capture kinds, exact wording, priority Untriaged, unknowns and original attachments. The earlier coordinator conversation also records difficulty finding Generate; this corroborates FB-002 without inventing a new captured ID.

## Proposed interaction

- Default to a **Simple** tab. Its top action area contains a prominent **Generate map**, Cancel when applicable, progress/status, and Load saved map. Keep actions reachable in both tabs; use one shared action/controller path rather than duplicated request logic. On a normal desktop viewport Generate must be visible without sidebar scrolling.
- Simple controls: preset selector, seed input, map-size selector (5/10/15 km square plus Custom), and Roughness and Woodland sliders with numeric readouts. Presets visibly replace settings and preserve the seed and ordered overrides under the existing policy. Custom reflects rectangular or nonstandard saved settings; tab changes never apply presets or reset recipes.
- Map size changes only widthM/heightM. Roughness maps directly to terrain.roughness, Woodland to cover.woodFraction, both0–1. Do not hide changes to fieldFraction, sample spacing, resource caps or settlement counts behind a convenience slider. Show the existing field fraction and the Woodland range available alongside it (woodFraction + fieldFraction must not exceed1). Keep Simple recovery possible: reject flat preset fields=.6 plus Woodland=.5 before dispatch; restoring Woodland=.3 recovers while fields remain exactly.6. Never silently reduce fields. Existing schema validation remains authoritative; valid slider settings need not imply feasible generation.
- **Advanced** contains every current exact settings field, policies and resource limits, and the existing ordered rename/move/exclusion controls. Move the full provenance/version dump into a clearly labelled advanced/details section; keep concise readiness and diagnostics visible in both tabs.
- Both views edit one draft recipe through field-local writes. Preserve raw invalid field values instead of rebuilding the whole form from the last valid baseline. Invalid advanced input survives a tab switch and keeps generation/export guarded; do not silently coerce or overwrite it. Saved load and setParameters update every applicable control without rounding, resetting unrepresented settings, applying defaults or losing override order. Simple controls can show Custom rather than coercing unrepresentable values. Merely mounting a slider or switching tabs must preserve loaded values such as.123456 exactly, regardless of the displayed range step. Provide visible invalid-draft feedback with a “Fix in Advanced” action that activates Advanced and focuses the invalid field.
- Add an HTML empty-state panel over the empty preview: simple inline decorative map outline, “No map generated yet,” brief instruction, Generate map and Load saved map actions. No new raster asset is needed. Route these actions through existing panel actions/load input. Keep a distinct progress or failure message when no previous map exists. Once a valid map is displayed, hide the empty state; pending/failure/cancel retains the prior map.
- Disable unavailable viewport/site actions before a map exists. Give the selector a stable minimum width and visible “Select site…” placeholder; leave enough right padding for the native caret. Scope styling to this selector. Retain native select semantics, focus ring and keyboard behavior; no replacement dropdown library.
- Tabs use tablist/tab/tabpanel roles, selected state and keyboard navigation. Hidden panels leave the tab order. Arrow/Enter/Space tab navigation must never submit the generation form. Switching tabs is presentation-only: no draft revision/file-token change, cancellation, replacement or pending load rejection. An actual Simple edit while older validation is pending must preserve the newer draft and block stale export. Empty-state announcements do not duplicate noisy progress announcements or block canvas navigation after a map loads.

These are coordinator implementation choices, not additional owner feedback. Resolve ordinary spacing/copy details locally; change this plan if review identifies a recipe or accessibility issue.

## Herdr panes and model selection

Reuse the existing development tab `w1:t3`; do not create more agents merely to fill parallel slots. On 2026-10-10 the coordinator read each pane’s visible footer and verified the following native configurations. Recheck live name/pane/footer before starting work; IDs can become stale. Cost ceiling is Not supplied; actual cost Unknown. Do not change account settings or enable services.

| Pane / agent | Verified model / effort | Planned responsibility |
| --- | --- | --- |
| w1:p5 / coordinator | Existing coordinator configuration; no override planned | Own this plan, decisions/docs, integration, browser acceptance, commits and PR updates |
| w1:p8 / map-client | GPT-6.1-Sol / medium | Sole product writer for all three feedback items and focused UI tests |
| w1:p7 / map-reviewer | GPT-6.1-Sol / high | Independent read-only review of recipe synchronization, worker/export guards, accessibility and plan acceptance |
| w1:p6 / map-implementer | GPT-6.1-Sol / xhigh | Idle reserve; use only for a concrete generator/contract blocker discovered during UI work |

**Owner context rule (2026-10-10).** Before reusing a development or review pane, save any outstanding handoff in durable files, wait until the agent is idle, then start a fresh native conversation using `/clear` (fresh chat and cleared transcript, not Ctrl+L or compaction). Official behavior: [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli). Verify a blank conversation and the intended model/effort in the live footer before sending a compact work packet: baseline commit, feedback IDs, plan path, exclusive files, acceptance criteria and exclusions. Do not resume old implementation transcripts or merely compact them. Do not clear an agent while it is still working. The plan reviewer was already running when this instruction arrived; finish its bounded report, preserve findings, then clear it before development reuse. Preserve the separate capture session and all feedback files/assets. Record reset verification at each actual kickoff.

Medium effort is selected for bounded DOM/CSS integration with existing APIs; high effort for independent state/recipe review. Geometry reasoning is unnecessary for the current scope. A failed substantive attempt should first improve the work packet; escalate effort only if the failure warrants it. If an agent must be replaced, use Herdr agent start with native `--model gpt-6.1-sol -c model_reasoning_effort=medium` for the writer, `high` for review; verify returned argv and visible footer rather than trusting a role prompt. Explicit model and reasoning configuration is documented in [official OpenAI guidance](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex).

## Work packets and gates

### 0. Freeze scope and baseline — coordinator

Preserve uncommitted feedback log/assets and their byte hashes. Confirm current branch/head, server and writer ownership; avoid staging unrelated work or touching the protected fork prototype. Supply the three IDs, this plan and exact source baseline to the writer. Update D25 and the authoring guide in the same implementation change to describe Simple/Advanced and the empty-state workflow. No generator decision or source pin change is required.

### 1. Primary and Advanced controls — map-client

Own `client/src/map-authoring/controls/**`, `authoring-app.ts`, `authoring-app.test.ts`, `style.css`, `client/map-authoring.html`, and focused new UI tests if necessary. Implement FB-002 first because it defines the shared actions that FB-001 needs. Preserve standalone panel defaults, setParameters/load behavior, currentCertifiedJson provider, exact current-ready recipe guards, cancellation/replacement and diagnostic behavior. No packages/maps, worker protocol, fork, benchmark loop or root configuration edits.

Gate: tests prove tab-only changes preserve the full recipe; Simple and Advanced synchronize values; explicit preset changes preserve seed/ordered overrides; loaded custom settings remain exact; invalid hidden draft still blocks generation/export; action visibility and accessible tab behavior work. Regression oracles: blank Advanced roads.maxGlobalExpansions → Simple seed/size edit → Advanced still blank, ALL Generate/export actions blocked; loaded roughness/wood.123456 survives mounting/toggling unchanged; flat Woodland/fields conflict and recovery retain fields; pending file read/validation survives tab-only switches; actual Simple edit blocks older validation/export; Fix in Advanced focuses the invalid control; tab keys do not submit. Add behavior tests for these transitions, not broad DOM snapshots.

### 2. Preview empty state and site spacing — same writer

After packet1 freezes shared action seams, implement FB-001 and FB-003 in the same owned files. Reuse the current generation/load controller; do not introduce automatic generation, reference fixtures or an alternate export path. Confirm idle, generating, validating, initial failure and retained-map failure/cancel states. Keep the benchmark page’s fully-visible measurement workload unaffected by shared CSS.

Gate: focused tests verify empty state appears only without a displayed valid asset; actions trigger the same runtime; initial failure has recovery; a previous valid map stays visible on failed/cancelled replacement; selector placeholder/options, selection and Site detail remain functional. Verify spacing and focus visually in native Chrome rather than asserting a guessed CSS cause.

### 3. Frozen independent review — map-reviewer

Writer reports exact files, focused check results and handoff; stops editing. Reviewer inspects complete changes against FB-001–003, existing certification/export guards and this plan. Check hidden-tab input validation, no recipe resets, keyboard/focus semantics, current certified export and retained-map behavior. Findings go to coordinator; fixes return to sole writer, then reviewer rechecks only changed seams. Capture session remains capture-only.

### 4. Integration and owner preview — coordinator

Run client tests, root lint/typecheck/build and appropriate root integration tests after frozen handoff. Use the existing devrun map-review server; avoid interrupting owner feedback or touching HQ servers. Native browser checks: empty initial view, first-screen Generate, keyboard tab switching, Simple sliders, rectangular/custom saved reload, Advanced override persistence, generation/cancel/failure recovery, real representative export/replay and site detail. Compare a saved unchanged recipe’s canonical JSON before/after presentation-only/tab changes. Do not rerun expensive terrain corpus or benchmark unless source/render changes introduce a concrete reason.

Capture before/after evidence at a desktop viewport and a narrow layout; distinguish image dimensions from observed CSS viewport. Confirm shared CSS does not clip map-benchmark canvas. Provide a local preview with a real validated map for feedback; update PR151 only after review/checks pass, retaining the original resource evidence and limitations. No merge, deployment or combined distribution.

## Completion condition

All three feedback outcomes are visibly met; Generate is discoverable on first view; exact Advanced/saved recipes and current-ready export safety survive the new presentation; focused and required integration checks pass; independent review passes; updated guide/decision and actual screenshots are ready for review. Feedback is implemented only after these gates, not merely because this plan exists.

## Planning review and context preparation

Independent planning review on2026-10-10 identified combined cover-fraction conflicts, mixed-invalid/precision preservation, and tab-only asynchronous lifecycle/focus gaps. All three are incorporated above as explicit implementation and acceptance requirements. No product edits or implementation authorization inferred. Existing map-client pane cleared with `/clear`; blank conversation and GPT-6.1-Sol/medium footer verified. Reviewer findings preserved here before its reset; `/clear` completed and blank conversation with GPT-6.1-Sol/high footer verified. At actual kickoff recheck both panes and reset again if any intervening conversation has accumulated.
