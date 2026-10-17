# Lobby map selection execution log

## Implementation authorization and launch — 2026-10-14

The user reviewed the lobby map-selection design and wireframes and approved implementation: “cool looks good. get some agents implementing”. The design in `lobby-map-selection-ux-design.md` is the product direction. Begin execution in its small deliverable chunks, not another design cycle. Generated-scenario automation remains the separate follow-up described by chunk 6. Resolve routine choices using the approved recommendations; surface genuinely material unresolved decisions when they become dependencies.

Implementation, local commits, managed previews, tests, independent review, and focused PR-ready changes are in scope. The new task does not authorize deployment or unrelated changes. Do not infer permission to merge this new work from the completed A0–A5 task; preserve publication authorization accurately in the final handoff.

### Refreshed baseline

- Checkout: `/Users/dominic/code/kriegsspiel-game-init-landing`, branch `main`, HEAD `0405581a8e9e55208ff6401978ff1451f284e934`.
- Successful fetch: `origin/main` is `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c` (#461). No checkout/source mutation performed by the dispatch session.
- Existing untracked task content: approved design Markdown and `docs/lobby-map-selection-ux-design/`. Preserve these artifacts.
- Open PRs observed: #460, #459, #458, #456, #454, #394. Other owners retain their work; especially check current shell/live-board overlap before integration.
- Protected earlier checkout `/Users/dominic/code/kriegsspiel-map-table` and its scale-marker edits remain outside this task.
- Managed previews observed up: landing web41930, APIs41932/41043, catalog41114; HQ41271/41412/41161; map-table41503. Preserve existing processes/data. Registry caller IDs are stale; use actual live Herdr inventory.

### Team and ownership

All participating panes are sibling panes in w3:t1, with cwd `/Users/dominic/code`; user focus stays on w3:p1. Inherited caller IDs say w1:p1 and are stale.

| Pane | Label / agent | Ownership |
| --- | --- | --- |
| w3:p1 | lobby-map-dispatch | User communication and initial dispatch only; no concurrent product edits |
| w3:pK | lobby-map-coordinator / lobby-map-ux | Implementation lead; contracts, branch/Git/config/entrypoints, integration, log, previews, bounded writer dispatch and review |
| w3:pM | lobby-map-writer / lobby-map-writer | Exclusive source/test packet assigned by the coordinator after baseline/contract establishment |
| w3:pN | lobby-map-reviewer / lobby-map-reviewer | Independent read-only contract/source/evidence review; no implementation edits |

Native footers verified before dispatch: coordinator GPT-6.1 Sol High (session setting), writer GPT-6.1 Sol High, reviewer GPT-6.1 Sol High. High is appropriate for map/scenario contracts, modal/input state, persistence and independent correctness review. No additional agents; four participants including dispatch. Coordinator rechecks effective settings after any context reset.

The implementation lead must establish a feature branch without overwriting the approved artifacts, record exact writable ownership before writers begin, and run focused baseline checks. Start with chunk 1's actual scenario-default metadata/preview and lobby chooser, then proceed through accepted prerequisites for playable selection and owned map addition. Do not represent standalone geography as playable, route live Start into the empty sandbox, or stop at an inert button as if the full design were delivered.

Use the installed Herdr and herdr-pr-review skills. Keep review and validation proportional: one focused source review, required repository checks, real desktop/narrow browser verification, bounded repair/delta review where needed. Retain valid evidence; do not create a new verification project. Separate packet readiness from complete product acceptance.

## Coordinator execution checkpoint — 2026-10-14

### Baseline and present access limits

- Rechecked initial HEAD `0405581a8e9e55208ff6401978ff1451f284e934` and fetched `origin/main` `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`. Only task-owned design/log files were untracked; no tracked changes existed. Upstream delta concerns Claude bridge/configuration, not the lobby or board. Read updated AGENTS and D42.
- Created `feat/lobby-map-entry` from `origin/main` without changing local `main`, creating worktrees or removing artifacts. Current accepted base is `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`.
- `HERDR_ENV=1` verified. Installed CLI syntax and both requested skills read. `herdr agent list` and `herdr pane list --workspace w3` return `Operation not permitted` on session socket access. A requested elevated read was rejected by the environment because sandbox escalation is disabled. Therefore no packet has actually been dispatched; prior model/pane observations remain dispatch-session evidence, not a newly verified coordinator observation. No new agents or panes were created. No blocked approval dialog was answered.
- `devrun ls --all --json` fails opening `/Users/dominic/.local/state/devrun/registry.lock` with `operation not permitted`. Read-only registry inspection confirms 41930 runs the landing checkout directly; client changes would hot-update that protected preview. Until task runtime isolation is established, do not edit the watched Angular client or reinstall dependencies beneath that preview. No preview process was restarted/stopped.
- Correct Node available at `/private/tmp/game-init-landing-node/node_modules/node/bin/node` is v22.23.3; all checks below prepend that bin directory. Default shell Node v22.22.2 is not used for checks.

### Coordinator-owned metadata prerequisite (implemented, awaiting independent review)

Ownership: `packages/protocol/src/battlefield.ts`, its barrel export, `server/src/game/battlefield.ts`, `server/src/game/battlefield.test.ts`, `server/src/game/registry.ts`, `server/src/api/battlefield.test.ts`, decisions/design/log. No writer ownership is active yet.

Contract candidate: `ScenarioBattlefield = { map, pairing, capabilities }`. `map` carries `id`, display name, source, metre bounds, full versioned `terrainIdentity` and an allowlisted geometry preview; `pairing` carries id, revision, scenario id, initial-scenario revision and matching terrain identity. Hashing sorts object keys, preserves array order and includes complete initial scenario/terrain inputs. Metadata for the actual engine-native default is not a canonical MapAsset certification. `capabilities.addMaps` is false. No change to CreateGame, seats, replay or local-board services. This interface is a **review candidate**, not frozen/accepted for dependent implementation until the reviewer responds.

Tests: focused baseline registry 1/1 and unchanged client form rules 15/15 pass. New default descriptor/API-injection/registry set passes 6/6: actual dimensions/bridge/river coordinates, no private preview fields, detached geometry, identity sensitivity to terrain attributes and armies, rejection of noninitial world, anonymous scenario metadata and unchanged unauthenticated-create rejection. First client baseline invocation was run from the wrong cwd and found no tests; corrected client-cwd run passed 15/15. All protocol tests pass 81/81. Root lint passed, followed by a targeted ESLint/Prettier check on the final source. Server and protocol typechecks pass. Root typecheck fails because installed dependencies lack `fast-check` (engine test typing) and `axe-core` (client a11y typing). Do not suppress these checks or alter assertions. Dependency reconciliation must preserve the protected preview. Root build verifies source and compiles engine/protocol/maps/server, then the unchanged Angular production build aborts with signal 6 (exit 134); targeted client retry with `NG_BUILD_MAX_WORKERS=2` also exits 134 without diagnostics. Full root tests are not run while dependencies are incomplete; browser acceptance and independent review are not established.

### Ready writer packet W1 (NOT DISPATCHED: Herdr socket blocked)

Target: existing `lobby-map-writer`, dispatched pane `w3:pM`; verify live ID/label/model High again after access restoration, without focus changes or resets. Source: feature branch based on exact base above, then independently accepted metadata prerequisite revision.

Exclusive writable release **after contract acceptance and protected-preview isolation**: new `client/src/app/lobby/battlefield-map/` component `.ts/.html/.css/.spec.ts` files only. Coordinator reserves NewGameComponent/shell integration, legacy ScenarioInfo/Form/API types, shared modal/focus implementation, protocol/contracts, tests outside that directory, all config/docs/Git/preview control. Writer must not commit, switch branches, start servers, control panes or edit unowned files.

Deliver isolated standalone OnPush/signal `BattlefieldMapComponent`, input required `ScenarioBattlefield` plus scenario display name, with Battlefield map summary directly usable beneath Scenario. Render actual descriptor geography using SVG/template bindings (no hard-coded schematic, master-state import or unsafe innerHTML). Own Choose/Add/View dialog state; candidate preview is separate from Use confirmation. Default-only Use closes/announces without game creation. Add displays the approved truthful capability explanation and Back to maps. View is read-only. Reuse ks-theme/tokens and shared modal conventions without changing shared files. At desktop show approximately 960 px dialog with controls/preview columns; 390/320 px single scroller and visible footer, no horizontal overflow. Modal entry traps keyboard/background interactions, Escape/Cancel restores opener, Enter cannot submit the parent game form. Body/browser-history integration needs coordinator contract; return a bounded request rather than editing shell. Preserve defaults/side/rate/mode/turn values. Test actual geometry binding, no submit, cancel/back/focus, unpaired/add capability, repeated actions and invalid/missing metadata behavior. Return exact changed paths, focused checks and integration requirements. No generated-map readiness or production sidecar.

### Ready reviewer packet R1 (NOT DISPATCHED: Herdr socket blocked)

Target: existing independent `lobby-map-reviewer`, dispatched pane `w3:pN`; verify live identity/label/model before assignment. Read-only review of the complete coordinator metadata diff against `d82eec1027d1fe300c9c0e4613da7e3a2d0b6a5c`, including all owned paths above, `/scenarios` serialization, `loadScenario`, CreateGame and replay callers, approved design, D41/D43. No source/Git/pane/server/external mutations.

Assess actual terrain fidelity, full immutable identity and initial-scenario binding, privacy allowlist, backward compatibility, performance/DTO limits, and whether the candidate is a sufficient minimal chunk1 UI input without promising chunk2/3 readiness. Identify actual inspected paths, tests/evidence, blocking/nonblocking findings and a packet-scoped verdict tied to the frozen candidate. Do not treat passing tests or the author's conclusions as independent evidence. UI packet remains gated on this contract verdict.

### Continuation order

Restore permitted Herdr socket/devrun registry access; inventory only assigned panes, preserve dispatch focus w3:p1, then send R1 and freeze the accepted interface. Establish task-owned preview isolation without changing 41930 or creating unauthorized worktrees/panes/tabs. Reconcile missing dependencies safely. Release W1 while coordinator integrates approved descriptor into form/API types. Complete chunk1 browser desktop/390/320 evidence and independent source review, required checks and focused draft PR. Then proceed through curated pairing/create/reopen/render agreement and owned library/generation prerequisites. No claim of completed chunk1 or full design, no merge/deploy, and no replacement agent stack while access is blocked.
