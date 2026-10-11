# HQ interface implementation plan

Deliver [Epic 4](https://github.com/exterkamp/kriegsspiel/issues/4): a game playable through a general's map table, incoming papers, written orders, roster and journal. Build the interface alongside the independent battlefield-generation work, with a coordinator assigning bounded agent packets and accepting each dependency gate before integration.

This is a proposed implementation sequence, dated 2026-10-10. The owner requested planning with Herdr and model selection in the orchestration layer. Implementation agents have not been launched. This plan does not authorize merges, deployments, new paid services or changes to other owners' issues.

## Baseline and completion boundary

- HQ worktree: `/Users/dominic/code/kriegsspiel-hq`, branch `feat/hq-interface`, initial base `074bf7aa5857cf5fb3a25eb6804e45a5272ac3a9`. The map worktree remains separate.
- Epic 4 is open, unassigned and Todo; all thirteen stories #48–#60 are open. [#22](https://github.com/exterkamp/kriegsspiel/issues/22) is closed and its fixture-driven Three.js table is present locally.
- Local client has a tile texture, pieces, stale contacts, camera controls and picking. It has no Svelte, live transport or desk views. Existing tests are a starting point, not evidence for the new interface.
- Fetch failed during worktree creation. Live [#129](https://github.com/exterkamp/kriegsspiel/issues/129) describes a continuous-space wire/engine baseline newer than this checkout. Refresh and reconcile the base before implementation; do not treat the cached checkout as current main.

Two delivery gates keep progress honest. **Interface gate:** a coherent fixture-driven HQ with all views and interactions, reload-safe local data, accessibility and visual evidence. **Epic gate:** the real game can be played start to finish through that interface, including server-backed marks, orders, dispatches and authorized post-game replay. Fixtures alone cannot satisfy live-server or persistence acceptance criteria.

## Dependencies and ownership outside Epic 4

| Dependency | Verified state on 2026-10-10 | Integration responsibility |
| --- | --- | --- |
| [#20 WebSocket API](https://github.com/exterkamp/kriegsspiel/issues/20) | Open, assigned to exterkamp | Consume its accepted API; coordinate rather than implement a competing server |
| [#23 live client](https://github.com/exterkamp/kriegsspiel/issues/23) | Open, unassigned; depends on #20/#22 | Reuse one transport/store beneath the HQ; agree ownership before taking this cross-epic packet |
| [#109 engine-to-wire view](https://github.com/exterkamp/kriegsspiel/issues/109) | Open, unassigned | Require a schema-valid, leak-tested projection; absent supply must remain unknown |
| [#21 replay](https://github.com/exterkamp/kriegsspiel/issues/21) | In Progress, assigned to exterkamp, linked PR #143 | Wait for accepted replay API/revision; do not duplicate the log implementation |
| [#37 UmpireClient](https://github.com/exterkamp/kriegsspiel/issues/37) | Closed | Wrapper exists; a staff-conference endpoint is still a separate contract gap |
| [#118 continuous table](https://github.com/exterkamp/kriegsspiel/issues/118), [#129 vector table](https://github.com/exterkamp/kriegsspiel/issues/129) | Open, unassigned | Coordinate one table migration and coordinate adapter with these issues |
| [#132 battlefield authoring](https://github.com/exterkamp/kriegsspiel/issues/132), [#134 map contract](https://github.com/exterkamp/kriegsspiel/issues/134) | Active work in the map branch | Consume an accepted public asset contract and fixture; do not build generation here |

Before dispatch, refresh these states, owners, PRs and exact revisions. Scope gaps become proposed follow-ups tied to their existing parent; this planning pass does not edit GitHub. The coordinator must obtain clear ownership for external implementation rather than silently widen an Epic 4 packet. Continue independent fixture/UI work while dependencies are unavailable, keeping affected stories open.

## Product and architecture defaults

These are proposed defaults for execution, not new owner decisions. Confirm them through the initial architecture gate and record any changed design in `decisions.md` and the affected doc.

1. Retain vanilla Three.js and add Svelte for the desk. One persistent canvas survives navigation; Svelte controls DOM papers and forms. Introduce readable typography, focus handling, reduced motion and theme tokens from the first packet.
2. Begin with desk objects opening focused views, rather than a walkable room. The map remains the main planning surface. Small clock and incoming-paper indicators stay available without a conventional game HUD.
3. Reports suggest a location; the player explicitly plots it. Existing marks never move because a fresher contact arrived. The map can show stale beliefs. Optional staff auto-plotting must be a separate explicit policy, with provenance and a defined accuracy model before enabling it.
4. Treat the base map as public artwork and geography. Never import engine master state into client code or pass live secrets as decorative map metadata. All gameplay knowledge comes from filtered server payloads.
5. Use continuous map metres at the rendering boundary. Keep legacy tile fixtures behind a temporary explicit adapter; remove it at the continuous-table integration gate. Do not adopt the map generator's sampling grid as a gameplay grid.
6. Persistence is scoped by game, side and player. Local drafts, read state and private notes use a versioned browser repository with migrations and storage-failure feedback. Shared marks use server authority. Do not claim cross-device persistence from local storage.
7. Keep unsupported capabilities visibly unavailable. Do not invent delivery estimates, courier risk, commander names, supply values, barrier status or report timestamps from unrelated fields.

### Module boundaries

| Module | Responsibility |
| --- | --- |
| `client/src/hq/` | Svelte shell, navigation, shared selection, themes and application composition |
| `client/src/hq/contracts/` | Typed UI interfaces and capability descriptions; coordinator-owned changes |
| `client/src/hq/data/` | Validated live/fixture adapters, store reducers, scoped persistence and display-time projection |
| `client/src/hq/views/` | In-tray, orders, roster, journal, conference and replay views in separately owned directories |
| `client/src/table/` | Scene lifecycle, continuous picking, public map artwork, pieces and player marks |
| `client/src/hq/interactions/` | Shared pointer/touch/keyboard plotting and drag state |
| `client/src/hq/testing/` | Schema-valid fixtures and browser scenario harness; no production hidden-state fixture imports |
| `packages/protocol/`, `server/` | Wire schemas and authoritative commands/projections, through agreed cross-epic owners |

Use narrow interfaces such as `MapSurface`, `HqDataSource`, `HqRepository` and `ReplaySource`. Freeze signatures, coordinate units, errors and lifecycle semantics before parallel writers. A fixture source and live source implement the same contract; demo mode is explicitly identified. Keep application selection and navigation separate from server state.

### Contract gate

The current protocol needs reconciliation before UI can honestly expose all planned features:

- **Clock:** rate/status/anchors exist, but manual/fast-forward mode and LLM-barrier status do not. Define the authoritative mode, effective game time and barrier messages with their server owner. Re-anchor on incoming state; interpolate only eligible running real-time clocks. Paused/manual/barrier time must not advance locally; fast-forward follows received progress. Test rates 1, 4, 12 and 1000.
- **Roster:** current own-unit strength/morale/supply has no per-field reported-at provenance or commander. The engine's morale scale differs from the wire scale. Define conversion, unknown values, source report and timestamps; do not present current truth as a dated historical report.
- **Orders:** `issueOrder` references a draft ID; `draftEdit.ops` is an undefined stub. Agree a bounded single-player draft submission format, acknowledgement, rejection/clarification, idempotency, pending/delivered/failed status and reconnect behavior. Collaborative drafts and authority remain Epic 6. Courier choices and annexes need server support before acceptance of #53.
- **Papers:** agree stable dispatch IDs, category mapping, written/received times and attachments. Exclude secret reliability while retaining approved player-visible confidence. Duplicate dispatch messages cannot create duplicate journal entries.
- **Marks:** define IDs, continuous geometry, source dispatch/time, ownership scope, revisions, create/update/delete commands, persistence and reconnect conflict handling. Validate finite bounded coordinates, size limits and side/player authorization server-side. A view update cannot overwrite a player's annotation geometry.
- **Conference:** define a fixture adapter and endpoint request/response/error/cancellation contract. #37 supplies a model wrapper, not the conference service. Advice uses known information; consuming recorded responses must not initiate model calls.
- **Replay:** define ended-game authorization, timestamped frames/events, rulings/dice and each side's historical beliefs. A final-state replay CLI alone cannot supply arbitrary-time scrubbing. Live and post-game payloads must remain distinct, with the server denying reveal requests before game end.

Make additive/backward-compatible schema changes where feasible. If a breaking revision is necessary, version it explicitly and update both clients and server projections together. Validate persisted/imported data, text sizes and geometry limits; treat dispatch text as text rather than executable markup.

## Work waves and acceptance gates

GitHub dependencies remain authoritative. Early fixture scaffolding is permitted, but story closure requires its full acceptance conditions.

| Wave | Packets and prerequisites | Deliverable and acceptance evidence |
| --- | --- | --- |
| A | Coordinator baseline; architecture/contracts agent; independent reviewer | Refresh base without touching the map checkout, inventory owners and revisions, baseline checks, freeze interfaces/fixtures and document contract gaps. Resolve Svelte tooling and shared-file ownership. |
| B | #48 desk shell after #22; #49 table polish can run alongside it with disjoint paths | Persistent canvas, desk-object navigation, dolly/fade, keyboard shortcuts and shared selection. Preserve camera/scene on round trips. Public texture pipeline, tags, stale styling and props. #49 requires measured 60 fps with 60 pieces on a recorded mid-range laptop. |
| C | #50 marks after #22 and continuous-coordinate contract; #23 adapter after accepted #20/#109; #54 roster, #55 journal, #56 clock after #48 | Typed marks and browser persistence first; server sync completes #50 later. Roster focuses pieces and distinguishes unknown/stale data. Journal deduplicates events, saves notes, searches and exports. Clock reflects all supported modes. Data work and view work own different paths. |
| D | #51 in-tray and #53 orders after #48/#23 | Categorized papers, written/received dates, persistent unread/file state and attached sketches; 200-dispatch benchmark. Autosaved forms, actual courier capabilities, sign/send flow and authoritative delivery progress. Lost connection and retries cannot silently duplicate signed orders. |
| E | #52 after #48/#50/#51; #57 conference after #48/#37 and agreed endpoint contract | Report-to-table plotting with preview and provenance, pointer cancellation, mouse/touch/keyboard parity. Fixture conference with documented service contract, loading/error states and no hidden knowledge. |
| F | #58 after #50/#21 and replay service; generated map adapter after accepted map/vector contracts | Ended-game replay, arbitrary-time scrubber, rulings and belief overlays; server rejects premature/cross-game access. Generated artwork, table pieces and all marks agree in metres at corners and asymmetric landmarks. |
| G | #59 after #51/#53; #60 after #51/#53/#54; final integration | Full keyboard play, ARIA/text reading, high contrast and reduced motion; no critical axe findings. Period visual review, documented assets and performance regression checks. Complete live-game playthrough and fresh setup before epic acceptance. |

Accessibility and restrained period styling start in B; G verifies and finishes them rather than retrofitting them. Views in C can be split into small sequential packets so one writer does not own the entire desk. Parallelism follows file ownership and dependencies, not the number of available panes.

The critical UI chain is A → #48 → #51/#53 → #52/#59/#60 → final playthrough. Live completion also requires #20/#109 → #23 and replay/conference/annotation services. Map authoring is independent of the desk shell; only the generated-map handoff waits for an accepted map contract/artifact. A public handcrafted map can support the HQ epic while map generation proceeds.

## Herdr orchestration

Follow the [Herdr skill](/Users/dominic/.agents/skills/herdr/SKILL.md). Verify `HERDR_ENV=1` before control commands. Read the installed `herdr --help`, `herdr agent` and `herdr pane` syntax; inspect live agents and caller layout before creating anything. This planning session verified the environment and help, but `herdr status` could not access the session socket. Restore permitted socket access at execution kickoff; never bypass the sandbox or assume live IDs from another run.

Use one coordinator, up to two writers and one read-only reviewer for HQ. Inventory the simultaneous map run and reduce HQ concurrency if shared host resources or account limits are constrained. Give HQ agents unique `hq-` names. Do not reuse or control map agents or panes merely because they are visible.

Implementation cwd is the owner-requested HQ worktree. Keep new agents there, with sibling panes in the coordinator's current tab and `--no-focus`. If the caller shell belongs to the original checkout, explicitly preserve the authorized HQ cwd rather than inheriting the wrong directory. Choose right/down from live layout. Parse pane IDs from returned JSON, never from sidebar order or examples.

At kickoff the permitted workflow is:

```sh
test "${HERDR_ENV:-}" = 1
herdr --help
herdr agent
herdr pane
herdr agent list
herdr pane current --current
herdr pane layout --current
herdr pane split --current --direction right --cwd /Users/dominic/code/kriegsspiel-hq --no-focus
```

Use the returned pane ID to start an agent; do not paste a fictional ID. `agent start` needs an available shell pane and accepts native model arguments only after `--`. Prompt through `herdr agent prompt`, then inspect `agent get` and `agent read --source recent-unwrapped`. Use waits of at most 60 seconds between coordinator updates. A timeout, successful submission, `done` or `unknown` lifecycle label does not prove deliverable completion. Inspect artifacts/checks before acceptance and inspect stalled prompts before resubmitting. Read blocked dialogs and request the owner's input as required by the skill; do not answer them automatically.

### Shared checkout ownership

All HQ agents share this worktree. Writers receive exclusive directories and explicit exclusions. The coordinator owns root/client package manifests, lockfile, Vite/TypeScript/lint/test configuration, shared contract/store entry points, `main.ts`, `index.html`, decisions, roadmap, commits and GitHub tracking. No writer changes branches, commits, pushes, resets, formats the whole repository, installs dependencies or starts other agents.

Shell agent owns `hq/shell/`; view agent owns one named `hq/views/<view>/` directory; table agent owns designated table files; interaction agent owns `hq/interactions/`. Common changes return to the coordinator for integration. Serialize shared files, installs, full builds and browser verification. A reviewer is read-only; a writer fixes its findings. Overlapping packets run sequentially.

Keep the map branch isolated. Coordinate proposed contract/path changes before integrating either branch, especially `client/package.json`, `client/vite.config.ts`, `package-lock.json`, `table/`, protocol schemas and decisions. Consume accepted committed revisions, not another agent's dirty working files. Fetch/merge prerequisites into HQ without resetting the original worktree.

## Model selection at the orchestration layer

Choose the development model and reasoning effort per packet; keep them out of game/client product configuration. The game's UmpireClient model settings remain separate. The coordinator may choose within existing configured access and any owner-supplied cost limit without routine per-packet confirmation.

The inspected local Codex default is `gpt-6.1-sol` with `medium` reasoning. Treat this as the kickoff default, not a promise about other account models or prices. Confirm available models and supported reasoning levels through the installed agent before dispatch. [Official configuration guidance](https://learn.chatgpt.com/docs/config-file/config-reference) documents model-dependent reasoning settings; [CLI guidance](https://learn.chatgpt.com/docs/developer-commands?surface=cli) describes the account-scoped model picker and status verification.

| Packet class | Initial policy | Escalation rule |
| --- | --- | --- |
| Coordinator, ordinary Svelte views and persistence | Configured default, medium | Raise effort after diagnosing a substantive correctness/integration failure |
| Architecture/contracts, coordinate migration, drag-and-drop, clock, reconnect and authorization | Configured default, high if supported | Use an available stronger model when a well-specified problem still defeats a focused attempt |
| Independent security/correctness review | High reasoning; separate agent/context | Escalate unresolved cross-layer findings; reviewer independence matters more than a different model name |
| Bounded styling, fixture expansion, asset manifest and documentation | Faster/lower-cost available model, after checking suitability | Return to default if output fails the same acceptance gate or needs extensive repair |

At startup record model ID, supported effort, selection reason and verified effective selection. Local `codex --help` supports `-m` and `-c`; pass verified overrides through Herdr, for example `herdr agent start hq-shell --kind codex --pane <returned-id> -- -m <verified-model> -c 'model_reasoning_effort="medium"'`. Verify actual model/effort in agent status; writing a model name into the task prompt does not configure the process.

Reuse an idle agent only when its model, context and ownership suit the next packet. A model change uses supported native controls or a newly started named agent after the old packet is settled; inspect effective selection again. Do not kill a working agent to change tiers. If alternate models or effort settings are unavailable, use the default and record the limitation.

Record elapsed time, retries, verification failures and measured tokens/cost when exposed, distinguishing unknown cost from zero. No spending ceiling was supplied. Use existing account limits, bounded packets and at most the planned concurrency; do not invent a monetary cap or enable new services. Apply any later ceiling across HQ work, including review and retries, and coordinate account usage with the map run. Prefer improving an ambiguous packet over repeatedly buying more reasoning. After one focused repair fails for the same substantive reason, review the contract/approach before escalating; never weaken acceptance to make a cheaper model pass.

### Agent packet template

```text
Implement [issue/packet] under AGENTS.md and docs/hq-implementation-plan.md.
Read [issue, decisions, relevant docs] and accepted prerequisites [SHAs].
Own only [exclusive paths]. Shared files [list] belong to the coordinator.
Build [bounded output] against [frozen contract and fixture revision].
Verify [specific acceptance and failure cases]. Exclude [out-of-scope services].
Effective model/effort: [verified configuration]; reason: [complexity].
Budget: [owner limit if provided; otherwise existing account limits].
Do not commit/push/switch branches/install/start agents/edit unowned files.
Preserve existing changes. Report changed paths, checks, limitations and next dependencies.
If blocked, identify the concrete prerequisite and continue independent work.
```

## Validation and recovery

Each accepted packet needs focused behavioral tests, relevant type/build checks, coordinator inspection and independent review for meaningful contract/security/interaction changes. Test observable failure cases rather than implementation-shaped snapshots. Visual work needs browser inspection and screenshots of the actual running artifact; passing unit tests alone cannot approve layout or picking.

- **Fixture suite:** both sides, fresh/stale/unknown roster fields, no dispatches and 200 dispatches, duplicate/out-of-order messages, storage failure, malformed data, long text, failed orders, disconnect during signing, game end and reveal denial.
- **Navigation:** desk/table round trips preserve camera and scene; focus follows navigation and returns to the initiating object; text editing does not trigger global shortcuts. Reduced motion skips dolly animations.
- **Geometry:** use asymmetric landmarks and non-square metre bounds. Verify map corners, raycast positions, marks, report drops, piece dimensions and facing, at overview/detail zoom and resized viewports. No metre-to-tile guesswork.
- **Information:** hidden fields fail wire validation; enemy truths do not enter live payloads or DOM. Dispatch reliability stays private. Reveal authorization is enforced server-side, including early, cross-game and cross-side requests.
- **Time:** fake-clock tests for rates 1/4/12/1000, paused/stopped/manual/fast-forward/barrier state, re-anchors, reconnect and report age. UI projections never advance the engine.
- **Persistence:** reload drafts, marks, unread/file state and journal notes; switch game/side/player without bleeding data; migrate old versions and surface storage errors. Server-backed marks survive another browser session and concurrent revision conflicts.
- **Accessibility:** full keyboard route through reading, plotting, drafting/signing and replay; screen-reader semantics, high contrast, reduced motion, touch cancellation and automated axe checks with no critical issues.
- **Performance:** record machine/browser versions and frame-time measurement method for #49's 60-piece/60 fps requirement; benchmark dispatch sorting/rendering with 200 papers, using a proposed target of p95 under 100 ms for opening/filtering on the recorded reference laptop. Agree any changed target before acceptance.
- **Final gate:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; clean dependency install; live two-side game through orders, movement, incoming reports, plotting, reload/reconnect, journal export and ended-game reveal. Capture overview/detail/desk/high-contrast evidence and known limits.

Node follows `.nvmrc` (22). Start managed servers with `devrun` as required by AGENTS.md, with distinct ports from the map run. The referenced `~/CLAUDE.md` and launcher are absent in the planning environment; resolve the launcher setup before browser/live verification. Continue static/headless work while that setup is pending.

At kickoff create `docs/hq-execution-log.md` with base SHA, dirty/untracked inventory, accepted external revisions, model defaults, resource limits and each packet's state. Preserve pre-existing source changes with binary patches and untracked copies in an ignored local backup outside the deliverable. Record agent/pane, exclusive paths, prerequisite SHAs, actual model/effort, review findings, checks, accepted commit, blockers and next action. Do not rely on terminal scrollback as the only record.

Resume from the log, git state, open PRs and live agent inventory. Recover in-progress work before assigning replacements. Never overwrite partial artifacts or reset another agent's branch to recover. Herdr manages agent terminals; sustained implementation still needs an active coordinator session. This plan starts no detached scheduler.

## Delivery and first dispatch

Integrate accepted packets in story-sized commits on `feat/hq-interface`. Use one accumulating Epic 4 PR with a story/evidence matrix; external prerequisite PRs retain their existing owners and scopes. Include `Closes #...` only for stories whose entire criteria hold. Pending server/map handoffs remain clearly open. Project Done closes issues, so it cannot mean fixture-ready or review-ready.

Update decisions and affected design docs when implementation actually settles a design change. Keep map planning edits from the other branch when resolving documentation conflicts. Do not close Epic 4 until the live end-to-end condition holds, regardless of the number of completed UI packets. Merge/deployment is a separate delivery action, outside this planning request.

First dispatch after implementation is requested: coordinator refreshes/records the baseline and active owners, then assigns architecture/contracts and read-only review. Accept that gate, install Svelte tooling through the coordinator, and start #48 plus a disjoint #49 packet. Advance through ready waves automatically, continuing useful fixture work when an external dependency is pending.
