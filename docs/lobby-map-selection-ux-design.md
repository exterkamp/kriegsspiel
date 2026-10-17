# Battlefield map selection in New game

Design recommendation · 13 October 2026 · approved for implementation by the owner on 14 October 2026. Implementation progress and acceptance are recorded separately in [the execution log](lobby-map-selection-execution-log.md).

## Recommendation

Put **Battlefield map** immediately after **Scenario** in the existing New game page at `/?lobby=1`. Show the selected map, its dimensions, a public-geography preview and its relationship to the scenario. Provide **Choose map** and **Add map** beside that summary. Keep side, play mode, timing and umpire controls below it, and keep the existing sticky Start/Back action area and Your games list.

Use one scenario-first flow: the scenario defines the armies, starting positions, objectives and victory conditions; the map supplies the ground. A map is selectable for play only when the server offers an approved, versioned pairing with that scenario. A saved or successfully generated map alone is not such a pairing. Adding a map saves geography to the library; it never starts a game or replaces the current playable selection implicitly.

The immediate implementation can reveal the current scenario's fixed map and the picker location. Genuine alternative-map selection and durable addition need the contracts below. Do not route the lobby's Start button into `/dev/local-board`, turn the existing live game into an empty board, or label terrain certification “ready to play.”

## Current gap and evidence

The delivered A0–A5 work exposes selection/generation through Settings → New game on `/dev/local-board`. D41 deliberately keeps that development-only, stopped, empty board separate from `/` and its authentication/scenario/live-game shell. The ordinary New game form never mounts those controls. This explains why the user cannot find a new board at the lobby URL; changing a navigation link alone would not integrate it with live play.

The actual URL was inspected in a separate task-owned Chrome tab without editing fields or submitting. It showed **Hold the Bridge**, Blue versus a computer opponent, Real time, 12:1, Standard, Dry staff officer, Start/Back and “No games yet.” The page uses centered paper, serif text, bordered fieldsets and a sticky ink-colored primary action. No map section or add action was present. See [inspection record](lobby-map-selection-ux-design/inspection.md).

Source snapshot: landing checkout was clean on branch `main`, HEAD/local `main`/`origin/main` all `0405581a8e9e55208ff6401978ff1451f284e934` (#444). Merge `adc137b0f914584f329b3103d5cf0eba76b660b1` (#362) is an ancestor. Between that merge and this checkout, the inspected shell/lobby/local-board paths and scenario registry are unchanged; `server/src/api/app.ts` has changed and was read at this HEAD. Remote main refresh was attempted read-only, but GitHub DNS failed and the web fallback could not retrieve the commit. Thus these are refreshed local refs, not verified latest remote main. The retained preview's exact build/HMR revision was not established; its observed appearance corroborates the flow, not a source-bound implementation test.

The protected map-table checkout was checked read-only: it retains unrelated edits to `client/map-table.html`, `client/src/map-table/page.ts`, `docs/decisions.md`, `docs/map-table-guide.md`, plus an untracked landing plan. None was used as an extraction source or changed. This document did not exist before this task. No branch, product code, preview process, game, issue, PR or decision log is changed by this proposal.

## Reviewable wireframes

- [Desktop: New game, chooser, Add map](lobby-map-selection-ux-design/desktop.svg) · [PNG](lobby-map-selection-ux-design/desktop.png)
- [Narrow screen: the same three states](lobby-map-selection-ux-design/narrow.svg) · [PNG](lobby-map-selection-ux-design/narrow.png)

These are static design wireframes, not screenshots of implemented behavior. Terrain thumbnails are schematic. The chooser explicitly includes today's unpaired canonical maps; it does not invent a playable River valley variant. Lower settings are abbreviated in the wireframes, not removed from the product.

Use the shell's `ks-theme`, `--ks-*` tokens, fieldsets, `ks-panel`, `ks-choice`, `ks-status`, `ks-primary`, `ks-page-frame` and `ks-modal`. Match paper/ink/brass, Georgia serif, 3 px corners, visible focus rings and existing high-contrast behavior. The development setup styles currently have exemptions and literal colors; reuse its preparation/preview algorithms and state behaviors, not those styles unchanged in the lobby.

Keep New game's current 560 px frame. Its map preview is a compact approximately 160 px high public thumbnail with text summary underneath. **View map** opens a larger read-only preview. At ≥700 px, the picker uses an approximately 960 px paper dialog, with a 300 px list/control column and flexible preview/details column. Below 700 px it becomes a full-height paper dialog: heading, source choices, list or generation controls, preview, summary, sticky actions in one scrolling column. At 390 px and at 320 px, controls wrap without horizontal scroll; target new actions at least 44 px high. Do not lock body scrolling without providing a usable dialog scroller. Keep footer space reserved so actions and the software keyboard do not obscure errors or inputs.

## Flow and content

### 1. New game: understand what will be played

Continue opening this screen from the existing main menu **New game** and `/?lobby=1`. Preserve the authenticated/guest shell behavior. Scenario remains first and defaults exactly as now. New section:

> **Battlefield map**  
> **The bridge battlefield** · 4 × 3 km  
> Scenario default · Ready for Hold the Bridge  
> The scenario supplies the armies, starting positions and objectives.  
> **Choose map** · **Add map** · **View map**

“The bridge battlefield” is the proposed display name for the existing engine scenario's 4000 × 3000 m map, not the 5000 × 3000 m local-board countryside default. Its preview must derive from the actual scenario's public terrain/artwork. Do not substitute a canonical standalone asset simply because both have rectangular extents.

Under the briefing, show **Armies and objectives** as a disclosure containing only server-approved public facts (or the selected side's briefing after seating). For the current scenario, summarize Blue defending and Red attacking the bridge and the 50-minute hold condition. Do not expose enemy starting positions, secret objectives or a full master-state order of battle on the preview. Army composition counts should be omitted until a public briefing contract exists, rather than hard-coded in this UI.

Essential visible controls remain Scenario, Battlefield map, Your side, How the game is played and its timing. Keep the existing rules dial visible because it affects resolution. The umpire's manner can be a collapsed **Umpire's manner** disclosure, preserving its value and copy. Do not hide important gameplay defaults in a generic Advanced menu.

The footer gives **Start game** when the action really creates and starts immediately; this is a clearer label for the current **Start** behavior. If an existing caller explicitly creates a waiting room with `lobby: true`, label that action **Create lobby**, with “Invite players before starting.” Only the room then offers **Start game**. Do not infer waiting-room creation from the `?lobby=1` URL: today's `NewGameComponent` calls `newGameApi.createGame` without `lobby: true` and starts immediately. This design does not introduce a new session-mode selector or change that default.

### 2. Choose map: inspect, then confirm

**Choose map** opens **Choose battlefield map** over the retained New game draft. Use a radio source control **Scenario maps** / **My maps**, plus **Add map**. Scenario maps lists the scenario default first and any server-approved alternatives, then a separate **Other included maps** group for bundled geography that still needs a scenario. My maps lists saved owned geography, including unpaired maps, with their status. Empty copy: “No saved maps yet. Add a map to build your library.”

Each item has name, extent, source (“Scenario default”, “Included map”, “Saved map”) and explicit status. Candidate selection updates only the picker preview. It is not confirmation and never submits a game. The details panel says either **Ready for Hold the Bridge** or **Needs a scenario** / **Not available for Hold the Bridge**, with a concrete reason. The canonical countryside, wooded-hills and river-valley assets currently belong to the latter category. “Contains a river” is not a compatibility rule.

Footer: **Cancel** and **Use map**. Use map is enabled only for a loaded, validated, saved candidate with a current server-approved pairing. It commits the pairing to the New game draft, closes the picker and announces “Map selected: [name].” Selecting the already selected default is a harmless no-op. Cancel/Escape discards picker selection, preserving every New game field and its previous pairing.

If a map has approved pairings only with other scenarios, show **Available scenarios** as information and **Choose a scenario** to return focus to the parent scenario control. Do not silently switch scenario, side, armies or timing. No recommendation here to automatically adapt arbitrary maps or provide a scenario editor.

### 3. Add map: generate geography, save explicitly

**Add map** opens **Add battlefield map** within the same dialog owner (also reachable directly from the New game summary). Essential controls: **Landscape** (Countryside / Wooded hills / River valley), **Map size** (the existing supported 5 × 5, 10 × 10, 15 × 15 km sizes), then **Generate map**. Default to Countryside and 5 × 5 km for a modest initial request. This generation default does not redefine the existing scenario map. Explain above the action:

> Create terrain for your map library. A map needs a scenario with armies and objectives before it can be played.

Place **Repeat this map** in a collapsed disclosure with **Map number** (the current deterministic seed), “Use the same number and settings to repeat this terrain.” Random-number selection is a UI draft choice outside the engine; never alter an imported recorded recipe invisibly. Preserve complete settings and ordered adjustments even if only basic fields are shown. Changing one basic value does not reset other recorded settings. Show “Custom settings” for unsupported preset/size representations. No terrain sliders, stable-ID editor or terrain painting in this lobby flow; the existing authoring tool remains a separate advanced workflow.

Generation yields a preview, dimensions and **Unsaved map**. Show an editable **Map name** after a valid result; the durable catalog contract needs separate display metadata so renaming does not rewrite certified canonical bytes unintentionally. **Save map** stores the exact certified result; it is separate from selection. On success: “Map saved. It needs a scenario before it can be played.” Offer **Done** to return to the chooser and **Generate another map**. Focus the new saved entry there. Preserve the original New game selection. If a future backend returns an approved pairing, show its verified readiness and offer **Use map**, still as a separate explicit action.

Under a secondary **Already have a map?** disclosure, offer **Import map file**, limited to canonical map JSON and the existing resource/schema limits. After reading/certifying, use the same unsaved preview and Save map path; an imported file is not durable server storage. Do not accept SVG/images as playable terrain. Initial implementation may omit import until the adapter is wired; generation remains the recommended primary addition path.

For the immediate UX slice before storage/scenario prerequisites exist, show the summary and chooser for the current default. Keep **Add map** discoverable; opening it shows “Adding maps to live games is not available yet. You can keep playing on the scenario's default map.” with **Back to maps**. Do not load the development sidecar in production or offer an active Save button backed only by process-local storage. The wireframes show the eventual generation state, labeled as a target capability; it ships only after the relevant chunks pass.

## Action, navigation and state specification

Maintain separate parent selection, picker candidate, generation draft, certified result and durable reference. Readiness is the server-approved pairing, not a boolean inferred from client validation. All async callbacks carry an operation/lifetime identity; stale load/generation/save results never replace a newer candidate or publish into a departed dialog.

| Action/state | Exact label/copy and behavior |
| --- | --- |
| Summary entry | **Choose map** opens with current pairing selected; **Add map** opens generation; **View map** is read-only. No game/auth/seat mutation. |
| Candidate loading | “Loading map…” then “Checking map…”; keep old selection untouched; Use map disabled. Keep Cancel usable. A previous thumbnail may remain labeled “Previous preview.” |
| Confirmation | **Use map** commits only the current candidate/pairing; repeated activation guarded. No POST /games until Start game/Create lobby. |
| Internal back | **Back to maps** retains generation draft/result in this dialog lifetime. Returning to Add map restores it. Browser Back first unwinds the open overlay/subview, with the same cancel/discard behavior, before leaving New game. No changes to existing game-route reload ownership. |
| Cancel clean | **Cancel**, Escape or close control discards candidate and closes. Scrim click does not dismiss. Restore trigger focus and scroll position. |
| Unsaved result or dirty generation recipe on close/leave | Dialog **Discard map draft?**: “Your map and settings have not been saved.” Actions **Keep editing** (initial focus) / **Discard draft**. Canceling an in-progress operation without a result does not need an extra prompt unless edited settings would be lost. |
| Draft edit after generation | “Settings changed. Generate the map again before saving.” Disable Save/Use; previous preview explicitly marked stale. Editing back to the exact certified recipe can restore eligibility. |
| Generation progress | “Generating map…” then “Checking map…”; no fake percentage. **Cancel generation** aborts, waits for owned resource settlement, retains settings and returns to editable Add map. Late completion is ignored. |
| Invalid input | Inline “Enter a whole map number of zero or more.” and supported bound guidance; associate with field, set aria-invalid, focus first invalid field on Generate. Unsupported/imported settings preserve their data and explain the problem. |
| Bounded infeasibility/timeout | “This map could not be generated with these settings.” or “Map generation took too long.” Retain draft; **Try again** repeats the same recipe; **Change settings** focuses Landscape. Never silently choose another seed or raise work limits. Show concise cause when known; diagnostic details are optional. |
| Saved/imported map fails validation | “This map could not be checked. It cannot be used for a game.” **Retry checking** for transient worker failure, **Choose another map** for invalid/unsupported bytes. Keep parent selection; never repair the asset or enable Use from metadata alone. |
| Preview unavailable | “Map preview unavailable.” **Retry preview**. Provide text name/extent/status. A cosmetic preview failure alone does not negate a server-approved pairing; corrupt terrain/identity does. No canvas-only error or readiness signal. |
| Saving | “Saving map…”; lock duplicate save and recipe edits. Cancel requests settlement; re-query durable identity if the write may have succeeded. Never report a timeout as proof the map was not saved. |
| Save failure | “Map could not be saved. Your generated map is still here.” **Retry save** retries identical canonical bytes and metadata with the same operation key. No regeneration; no Use until durable readback and pairing verification succeed. |
| Save succeeds after cancellation | Do not select or focus a closed dialog. The saved item remains in the library on refresh. Discard never deletes an already saved map. |
| Catalog unavailable | “Saved maps are unavailable. Try again or use the scenario's default map.” **Retry maps**; distinguish “No saved maps” from failure. The approved current default remains usable independently if its scenario service/pairing is available. Never treat missing list as a changed selection. |
| Server readiness/identity revoked | “This map is no longer available for this scenario.” Disable final game action for the invalid selected pairing; offer **Choose map** / **Use scenario default**. Do not silently downgrade to a different map. Revalidation of candidate need not disable Start on an unchanged valid parent selection. |
| Scenario change | Apply existing chooseScenario side/rate defaults and retain mode, turn inputs, dial/persona. Switch to the new scenario's approved default and announce “Scenario changed; its default map is selected.” Invalidate previous candidate checks. Any unsaved map draft follows the discard rule. |
| Start/Create pending | **Starting game…** / **Creating lobby…**; lock parent settings, map entry and duplicate submission. No cancellation that falsely promises the server did not create a game. Existing shell route transitions remain. |
| Final validation failure | Keep draft; focus visible alert adjacent to actions, describe reason and **Choose map** remediation. Client validation cannot override a server rejection. |
| Definite create failure | Keep all form values. **Try again** after correcting the reason; retain existing game-limit, seat, auth and error handling. |
| Ambiguous create timeout | “Checking whether your game was created…”; reconcile by idempotency key before enabling another create. Then open the existing game or offer **Try again** with the same key. This requires the server chunk; the current API has no such guarantee. |
| Auth expires during setup | Use existing sign-in/return-target behavior; do not sign in or create a guest automatically. Warn before discarding unsaved geography; saved maps remain owned records. Persisting a New game draft across auth/reload is not assumed by this design. |
| New game Back / ← Main menu | Existing menu destination, no game created. Within the current shell visit retain the form draft so returning from the menu can restore it; full reload starts existing defaults. Dirty map draft prompts only when it would be lost, not for ordinary side/rate edits. |

Keyboard: native radio arrow keys and Space select candidate/source; Enter on Use map confirms only that action. Pressing Enter in search/name/recipe fields must not bubble to game creation. Dialog traps Tab/Shift+Tab and gates background click/keyboard actions synchronously. Put initial focus on dialog heading (tabindex -1) to convey context, then candidate controls; adjust the shared modal's current first-control focus behavior deliberately. On Add map, focus the heading; validation failure focuses the field/error. Announce loading/success with polite status, failures with alert; avoid announcements on every animation frame. Escape first exits active preview manipulation, then uses dialog cancellation rules. Preview supports labeled **Fit map**, **Zoom in**, **Zoom out**, arrows and +/-/F when its canvas is focused; never capture those keys in editable controls. Provide a text alternative and touch buttons rather than requiring hover, drag or pinch. High contrast and reduced motion use the existing system settings. Close restores the actual opener; if it disappeared, focus Battlefield map heading.

Room: display the immutable scenario/map summary before sides and invite link, using only public information. No map changing after creating a room in this first delivery; otherwise changing terrain would require ready-state reset and participant notification. Preserve existing join, Ready/Not ready, Leave seat, kick, host gating, polling, `/?game=<id>` invite, guest privacy, hot-seat behavior and live WebSocket route. A failed catalog must not prevent joining an existing pinned game.

## Capability and minimum engineering contract

### What exists, and what it does not establish

`MapCatalog`, `MapRef`, `CertifiedBoard`, `BoardPreparation`, `SetupState` and canvas preview algorithms already implement list/read/save, generation, complete certification, cancellation and detached identity. The development catalog lists three premade maps and writes generated JSON to ignored `.local/generated-maps`; it is opt-in loopback infrastructure, absent from the production image. The local session host has no game, units, live service or scenario conversion.

The live API's strict `CreateGame` schema accepts `scenario` but no map/ref/pairing. `SCENARIOS` registers only Hold the Bridge. `startGame` loads by scenario ID; log headers/replay/reopen also resolve scenario identity. `loadScenario` validates terrain, side HQs, troop placement/formations and a victory objective centered on a bridge. Current public standalone terrain must be converted to that engine representation; its canonical JSON is not an accepted engine scenario. The existing client live-table artwork/terrain path also needs to resolve the same selected terrain identity, rather than continue using fixed bridge art. No arbitrary objective templates are implied by the UI.

### Proposed smallest contract (names illustrative, not implemented)

1. **Public catalog descriptor:** stable map ID, full asset identity, schema/provenance version, display name, metre extent, accessible preview reference, ownership/source, availability, and approved pairing descriptors. An engine-native scenario default can have its own immutable terrain identity and public preview; do not pretend it is a `CertifiedBoard` if it is not canonical MapAsset data.
2. **Approved pairing:** immutable pairing ID/revision binds scenario ID/version, exact source map identity, conversion/assembly version and resolved engine scenario identity. Public descriptor includes readiness, human sides, approved briefing, public objectives and reason codes. Compatibility is exact approved assembly, not a name/preset/geometry hash match. Unpaired map status is informational; a list summary cannot certify playable data.
3. **Pure assembly plus acceptance:** consume certified canonical geography and an explicit scenario specification (armies, HQs, start formations, objectives, time/victory assumptions, seeded gameplay randomness). Define metres-to-engine millimetres, terrain categories, crossings/elevation/cover, holes and feature references without silently dropping unsupported layers. Reject unsupported conversion. Run load/placement checks, deterministic replay, visibility leak checks and headless completion; balance/playability approval remains separate from geography certification. Approve one curated pairing first. An arbitrary-map automatic scenario builder is a later scope, not necessary to make this picker honest.
4. **Durable owned map storage:** authenticated list/read/save; canonical bytes plus display metadata; validated size/work limits; stable refs and exact readback; idempotent saves; retention independent of dialog lifecycle. Define guest ownership/adoption/expiry consistent with existing guest policy. A live game's pinned terrain must remain resolvable even if the library entry is renamed or removed. Do not promote the development sidecar to production by proxy configuration.
5. **Create/start/reopen agreement:** extend creation to accept approved pairing ID/revision (or a compatible equivalent) with a request idempotency key. Validate auth, ownership, availability and immutable identity server-side before seat/lobby/game effects. Preserve old scenario-only clients by resolving their default pairing. Persist the resolved scenario/map/adapter inputs in lobby record and replay header or an immutable assembly store available to both. Revalidate room start against pinned data, not a mutable “latest” catalog. Public room/list DTOs expose safe name/extent/identity summaries. Reopen/replay and per-side renderer consume exactly the same terrain; no client-supplied certified payload bypasses server approval.

The minimum unresolved seam is **a server-recognized immutable scenario–map pairing that can be created, rendered, replayed and reopened consistently**. Without it, the picker can inspect/save geography but cannot change a live battlefield. Production save is a second prerequisite for newly added maps; certification alone satisfies neither.

## Independently reviewable implementation chunks

No jumbo PR, no full terrain editor. Contract names can change during engineering review; behavior and boundaries should not.

| Chunk | Scope and dependency | Observable acceptance criteria |
| --- | --- | --- |
| 1. Reveal current battlefield | Immediate shell UX; current default only. Add map summary/public preview, chooser with default, capability explanation for Add map; clearer Start game label. Introduce truthful public default-map metadata if needed. Reuse page/modal/tokens. | At `/?lobby=1`, map is visible directly below Scenario at desktop/390/320 px. Default remains the actual bridge terrain. Cancel returns unchanged values and focus. Clicking Choose/Add/View causes no game POST, guest creation or WebSocket. Original Start request and room/auth/invite paths still work. No production local-board/catalog import. |
| 2. Define and register one approved pairing | Server/engine prerequisite; accepted immutable descriptor/assembly contract, one curated alternative, default backward compatibility. No arbitrary generation policy. | Unsupported/unpaired assets are rejected without seat/game/log effects. Asymmetric coordinates, bridge/objective placement and unsupported layers tested. Default and new pairing load, run headlessly and replay deterministically; public DTO contains no private placement. Adapter version and terrain identity are pinned. |
| 3. Select and play approved maps | Depends on 2; actual picker Use map wiring plus create/start/lobby/log/reopen/render persistence and idempotent creation as one end-to-end behavior. Reuse ShellApi and live services. | Candidate click creates nothing; Use commits draft only. Start opens live play on the chosen terrain; pieces align with it. Create-lobby callers preserve waiting/ready/invite behavior and show map summary. Server rejects stale revisions; retries produce one game; reopen/replay use the same terrain even after catalog update. Existing scenario-only callers pass. |
| 4. Save an owned map | Independent production storage prerequisite (after descriptor agreement); authenticated durable list/read/save and guest semantics. No game readiness claim. | Save/readback retains exact canonical identity across process restart; renamed metadata does not alter bytes. Duplicate retries yield one record; access checks prevent foreign read/write. Guest adoption/expiry and pinned-game retention verified. Catalog outage differs from empty list; defaults remain usable. |
| 5. Generate/add from the lobby | Depends on 4 for durable addition; reuse preparation workers, setup state cancellation/recipe behavior and preview. Small presentation adapter changes Start semantics to Save/Use rather than local session replacement. Import can be a separate follow-up. | New game draft survives opening/canceling Add map. Generate → check → unsaved preview → Save → My maps works at both widths. Save failure retains identical bytes for retry; stale callbacks cannot select another map. An unpaired saved map says Needs a scenario and cannot enable Use or Start. Production capability is explicit; no dev sidecar fallback. |
| 6. Approve a generated-map scenario recipe | Follow-up product/engine scope, only after owner decision below; deterministic assembly policy or curated approval, not a terrain editor. | At least one generated map gains an approved pairing only after army/HQ/objective/placement, replay, visibility and headless playability evidence. Infeasible generation/assembly stays unplayable with actionable copy. Existing live and default flows stay intact. |

Each chunk needs its own focused failure/lifecycle checks and source-bound browser evidence where it changes UI. The implementation owner refreshes current main before beginning; the retained preview and this design do not establish CI or runtime acceptance. Record adoption in decisions and affected guides when a product decision is actually accepted; do not rewrite D41 to imply this design was already delivered.

## Decisions

**Material owner decision:** should the first playable generated-map offering use an authored, constrained scenario template (recommendation: one bridge-defense template with explicit armies/objective-placement and balance checks), or require human approval of each scenario–map pairing? This changes engine/content work materially. Until decided and implemented, newly generated maps remain saved geography with Needs a scenario. It does not block chunks 1–5 or playing curated approved maps. Recommendation is to ship curated alternatives first and make the template a separate follow-up, not build an automatic scenario maker inside the picker.

**Storage/release decisions before production addition:** confirm retention/access for saved maps and guest-owned maps; recommended default is owner-private library, existing guest adoption/expiry, immutable game snapshots retained with games. Existing D23 combined-work distribution decision remains a separate release prerequisite, not a reason to withhold a local UX design. No publication is authorized here.

**Routine design choices resolved here:** scenario-first ordering; explicit candidate/Use confirmation; Add map as library creation; current default preselected; source radios rather than a multi-step wizard; basic landscape/size visible; map number collapsed; no automatic scenario switch; no map editing in an existing lobby; preserved timing/rules behavior; descriptive primary labels based on actual server action; reversible drafts within one shell visit; explicit errors, keyboard support and responsive paper dialog. No additional owner approval is needed to review this recommendation.

## Source references

- [AGENTS](../AGENTS.md), [decisions](decisions.md): accounts/lobby, standalone assets, Angular/fixture retirement, D41 local-only boundary.
- [Angular guide](game-initialization-angular-guide.md), [landing plan](game-initialization-angular-landing-plan.md), [map handoff](map-gameplay-handoff.md), [authoring guide](map-authoring-guide.md), [development catalog](dev-map-catalog.md), [HQ interface](hq-interface.md).
- [New game component](../client/src/app/shell/new-game.component.ts), [shell](../client/src/app/shell/shell.component.ts), [form rules](../client/src/legacy/shell/newGame.ts), [create API](../client/src/legacy/shell/newGameApi.ts), [room](../client/src/app/lobby/room.component.ts).
- [Setup component](../client/src/app/local-board/setup/setup.component.html), [setup state](../client/src/app/local-board/setup/setup-state.ts), [preparation contracts](../client/src/shared/game-setup/contracts.ts), [design tokens](../client/src/styles/tokens.css), [controls](../client/src/styles/ui.css), [modal](../client/src/app/ui/modal.component.ts).
- [Server create/start](../server/src/api/app.ts), [registry](../server/src/game/registry.ts), [lobby records](../server/src/lobby/store.ts), [scenario validation](../packages/engine/src/scenario.ts), [Hold the Bridge](../packages/engine/src/scenarios/holdTheBridge.ts), [canonical catalog](../data/maps/catalog.json).
