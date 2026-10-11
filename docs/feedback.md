# Development feedback inbox

## Session

- Project / worktree: Kriegsspiel, `/Users/dominic/code/kriegsspiel`.
- Originating change: [Epic #132](https://github.com/exterkamp/kriegsspiel/issues/132), [PR #151](https://github.com/exterkamp/kriegsspiel/pull/151); procedural battlefield generation and standalone map authoring. Related pinned [SettleMaker PR #1](https://github.com/dfezzie/settlemaker/pull/1).
- Review build: branch `feat/procedural-battlefield-maps`, setup commit `893f62b94ff8664353c329b6c99aae3d485f1a48` (coordinator verified). Local authoring server started and river valley seed97 generated/certified before this capture session. Subsequent build confirmation: Unknown.
- Preview: http://127.0.0.1:41660/map-authoring.html. Real local standalone generation, independent saved validation, preview, ordered overrides and JSON/SVG export; no live game state or LLM connection. Server is coordinator-owned `map-review` under devrun.
- Capture policy: [herdr-feedback SKILL.md](/Users/dominic/.codex/skills/herdr-feedback/SKILL.md), repository AGENTS.md. Relevant context: [authoring guide](map-authoring-guide.md), [verification report](map-verification-report.md), [implementation plan](map-implementation-plan.md), decisions D18–D25.
- Session initialized: 2026-10-10, America/Los_Angeles.
- Herdr workspace / tab / pane: `w1` / `w1:t4` (Map feedback) / `w1:p9`; coordinator-created dedicated tab.
- Feedback agent: `map-feedback`; launch explicitly approved by the owner after automatic review and capture session started on 2026-10-10. Coordinator verified Herdr start argv `codex`. Native model / effort: Unknown; no model/effort override supplied and no visible footer confirmation. Cost: Unknown.
- Mode: capture only. Preserve exact owner wording and original evidence, stable `FB-NNN` IDs, priority Untriaged unless supplied. Attribution remains Not reviewed until requested.
- Writable ownership: `/Users/dominic/code/kriegsspiel/docs/feedback.md` and `/Users/dominic/code/kriegsspiel/docs/feedback-assets/**` only. Product changes, commits/pushes, installs/tests, GitHub mutations, server control and other panes/worktrees belong to the coordinator.
- Owner boundary: combined-work distribution remains gated; no merge or deployment.

## Index

| ID | Title | Kind | Classification | Priority | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| FB-001 | Empty map visual state | Visual | Not reviewed | Untriaged | Captured | [Original screenshot](feedback-assets/FB-001-empty-map-original.png) |
| FB-002 | Simple generation controls with advanced tab | Feature request | Not reviewed | Untriaged | Captured | [Original screenshot](feedback-assets/FB-002-simplified-controls-original.png) |
| FB-003 | Site selector caret spacing | Visual | Not reviewed | Untriaged | Captured | [Original screenshot](feedback-assets/FB-003-site-selector-spacing-original.png) |

## Entries

### FB-001 — Empty map visual state

- Captured: 2026-10-10 17:57:38 America/Los_Angeles (UTC−07:00).
- Kind: Visual
- Classification: Not reviewed
- Priority: Untriaged
- Status: Captured
- View / build / viewport / input device: Battlefield authoring, no validated map visible. Session setup branch/commit recorded above; screenshot build confirmation Unknown. Browser, viewport and input device Unknown; screenshot pixel dimensions do not establish viewport.
- Evidence: [Byte-preserved original screenshot](feedback-assets/FB-001-empty-map-original.png). Copied from supplied Image #1 attachment; byte identity verified. SHA-256: `a9abde2bb6b3119ba5f1ef8bf259edfc8283dcf0d86e95edeb5f8cee2e6cea34`.

**User feedback:**

> let's add a default - empty state when theere is no map. some visual indication that nothing has been built yet

**Visible observation:** The preview area is blank pale gray, with navigation controls and a north indicator. The header says “No validated map · generate or load a saved asset.” The left panel instructs the user to generate or load a map and shows seed 17 and custom / recorded settings. No empty-state message or illustration appears within the preview area.

**Steps:** Not supplied.

**Expected:** A default empty state when no map exists, with a visual indication that nothing has been built yet.

**Actual:** The screenshot shows a blank preview area; the existing no-map status and instructions appear outside it. No generation failure or underlying cause is established by this evidence.

**Open questions / related IDs:** Exact visual treatment Not supplied. No related IDs yet.

**Later action:** Proposed coordinator handoff: add the requested visual empty state to the map preview. Capture only; no implementation performed.

### FB-002 — Simple generation controls with advanced tab

- Captured: 2026-10-10 18:00:02 America/Los_Angeles (UTC−07:00).
- Kind: Feature request
- Classification: Not reviewed
- Priority: Untriaged
- Status: Captured
- View / build / viewport / input device: Map authoring sidebar. Session setup branch/commit recorded above; screenshot build confirmation Unknown. Browser, viewport and input device Unknown; screenshot pixel dimensions do not establish viewport.
- Evidence: [Byte-preserved original screenshot](feedback-assets/FB-002-simplified-controls-original.png). Copied from supplied Image #1 attachment; byte identity verified. SHA-256: `79f84c1b613bb61ea20fdb633af0dceca64b912b77238ce1c3dedefb8188c1ee`.

**User feedback:**

> feature request. this side bar is too powerful/detailed for general use cases. This should be hidden in an advanced tab. The main view should be simple selectors, sliders, etc that will make it easy to generate a map

**Visible observation:** The supplied image shows the sidebar with seed, preset, width, height and elevation sample spacing inputs. Geometry policy is collapsed; Relief and roughness is expanded with Base Height M, Relief M, Roughness (0–1), Octaves and Feature Scale M inputs. The visible controls expose detailed numerical settings.

**Steps:** Not supplied.

**Expected:** Move the detailed sidebar controls into an advanced tab. Provide simple selectors, sliders and similar controls in the main view to make map generation easy for general use cases.

**Actual:** The owner reports that the sidebar is too powerful/detailed for general use cases. The screenshot shows the detailed controls directly in the sidebar; usability beyond the reported concern was not independently tested.

**Open questions / related IDs:** Exact main-view selectors/sliders, their mappings and which settings belong in the advanced tab are Not supplied. Related FB-001 concerns the initial no-map presentation; this is a separate request about generation controls.

**Later action:** Proposed coordinator handoff: design simplified primary generation controls and an advanced tab containing detailed settings. Capture only; no implementation performed.

### FB-003 — Site selector caret spacing

- Captured: 2026-10-10 18:01:18 America/Los_Angeles (UTC−07:00).
- Kind: Visual
- Classification: Not reviewed
- Priority: Untriaged
- Status: Captured
- View / build / viewport / input device: Map authoring site selector, supplied close-up. Session setup branch/commit recorded above; screenshot build confirmation Unknown. Browser, viewport and input device Unknown; screenshot pixel dimensions do not establish viewport.
- Evidence: [Byte-preserved original screenshot](feedback-assets/FB-003-site-selector-spacing-original.png). Copied from supplied Image #1 attachment; byte identity verified. SHA-256: `2ec3680cf1dfe9ab4ec11e279416f8bac19798e316ad20376aa0b2f6057d84af`.

**User feedback:**

> the select site selector here is very close to the down caret.

**Visible observation:** The close-up shows a selector labelled “Select site...” with a blue outline and a down caret near its right border. The image does not establish the control's CSS spacing or browser-native rendering behavior.

**Steps:** Not supplied.

**Expected:** More comfortable spacing around the site selector's down caret (inferred from the owner's spacing concern); exact spacing and which adjacent edge/text needs adjustment are Not supplied.

**Actual:** The owner reports that the select site selector is very close to the down caret. The caret is visibly near the right border; no underlying cause is confirmed.

**Open questions / related IDs:** Exact desired spacing Not supplied. No related IDs yet.

**Later action:** Proposed coordinator handoff: review and adjust the site selector's caret spacing based on the supplied visual concern. Capture only; no implementation performed.
