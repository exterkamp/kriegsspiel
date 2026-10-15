# Independent client delivery rebind review

**Verdict: Accepted as four source-identical dependency restacks onto accepted API `1fa53df66b348cca14e4bd7963778036969169d6`.** The earlier bounded source verdicts carry to the exact new heads below by verified blob/subtree identity and inspection of the changed server context. This does not accept native-choice parent integration, library attachment or browser creation.

## Exact bindings

Manifest `/private/tmp/lobby-map-client-delivery-stack.json`, SHA-256 `fc8985e745c93279fdf43705bffce0ebad088e01f0c1d02f116c29ec815b01ee`. Each row has a different commit identity from its reviewed source; none is described as the old head.

| Packet | New H | New tree | New P | Reviewed source |
| --- | --- | --- | --- | --- |
| Live fetch | `1029599837dd81f184f6c4aeeab5e4e48446a0a0` | `5e16ae44e1e426e45af1ef6a356c1c15f66121ba` | `1fa53df66b348cca14e4bd7963778036969169d6` | `dc6105c0e8de0e8a6a22f7e1f68357832b38cd5f` (R13) |
| Playable choices | `eb40829d0ca749c5109b658726daa4fa9d1a11ad` | `73af87de97eb281cd8d73281db51d754ffe9036a` | `1029599837dd81f184f6c4aeeab5e4e48446a0a0` | `11e1b631a77307c7d08d23de4e33e3b5d66eb6ba` (R14) |
| Live terrain | `4589aa18959b9a53714618b4cabb87ad45a0f51f` | `e1f23f6ff4974272e85f48ebd4fc30310148e61f` | `eb40829d0ca749c5109b658726daa4fa9d1a11ad` | `559271129e6172373c6e2ebe982eab909a05d7b0` (R20 plus accepted R22 repair) |
| Safe create transport | `8847a781b709708d6e3c09aea6f3549c262c82f1` | `0bee0f5854beca8fe0f0177259e0fe3fc2c10a3b` | `4589aa18959b9a53714618b4cabb87ad45a0f51f` | `9e4d437ca2e296b917d7ca330a889504c16a73f9` (R25) |

Verified the actual objects, all four branch refs, parents, trees, complete per-parent inventories and every manifest SHA-256 against the new Git blob and old reviewed blob. All23 changed path instances are byte-identical. More strongly, each new head's **entire `client` tree and entire `packages` tree** equal those at its corresponding reviewed source:

| Packet | Identical old/new `client` tree |
| --- | --- |
| Live fetch | `61696e5f58967a43c558cdfaaf48cb55bae2e0ca` |
| Playable choices | `ed527d717f6a3a5d2401ac80cce4dc0eddb6f317` |
| Live terrain | `540a85a631d58794125234dabd37a65e9b61b3e5` |
| Safe create transport | `0172de21cee1705df5b0614853fa808f143f3b6f` |

All four share packages tree `7d8b3d9b8ff95ba988599abdf5d7d98999637523`. Their server tree is `b300dd85aa7b2091bbc94db070210b3006dbee5f`, exactly the accepted API base server tree. There is no server/packages change in any of the four deltas. Complete commit/root-tree identity with the old sources is neither required nor claimed. The old source commits remain referenced by `feat/lobby-map-fetch`, `feat/lobby-map-curated-picker`, `feat/lobby-map-live-render` and `feat/lobby-map-creation-transport`, respectively.

## Complete delta inventories and carried coverage

- Fetch: `client/src/legacy/lobby/battlefield.ts` and `battlefield.test.ts`. R13's parent-bound public descriptor decode, bounded streamed read, cancellation, detachment, map projection and focused checks carry.
- Choices: `client/src/app/lobby/battlefield-map/battlefield-map.component.{ts,html,css,spec.ts}`. R14's checked playable/default versus inspection-only choices, modal/history/owner boundaries and focused child checks carry. R14's broader mixed-snapshot shell failures remain historical failures; they are not relabelled green.
- Live terrain: under `client/src/app/game/`, `flat-board.component.{ts,spec.ts}`, `table-host.component.{ts,spec.ts}`, `marks.service.{ts,spec.ts}`, `table.service.{ts,spec.ts}`, `game.service.{ts,spec.ts}`, `game.component.{ts,spec.ts}`; also `client/src/app/desk/fake-game.ts` and `client/src/legacy/lobby/api.ts`. R20 coverage with R22's accepted failure-abort repair and complete start fixture carries. R20's original blockers remain honestly recorded at its original source.
- Transport: `client/src/legacy/shell/newGame.ts`, `newGameApi.ts`, `newGameApi.test.ts`. R25's strict catalog projection, capability fields, bounded stream/deadline behavior, exact keyed body and owner-receipt reconciliation coverage carries. It does not supply parent key persistence by itself.

The earlier reports were reread for their applicable limits and remain unchanged: [R13](lobby-map-selection-fetch-review.md), [R14](lobby-map-selection-picker-review.md), [R20](lobby-map-selection-live-render-review.md), [R22](lobby-map-selection-live-render-delta-review.md), [R25](lobby-map-selection-creation-transport-review.md), and accepted base [R24](lobby-map-selection-native-api-delta-review.md). This rebind compares every inventory/blob and reads the changed boundary context; it does not claim a fresh full reread or reexecution of every unchanged implementation.

## New base context and findings

No blocking or nonblocking rebind finding was identified. Explicit new Git object reads checked the delivered fetch helper, GameService/game REST/WS capability handling, transport/catalog/receipt shapes and inherited parent against base `server/src/api/app.ts` and `server/src/main.ts`.

The accepted base exposes the versioned public catalog under each scenario, a detached public pinned battlefield on authenticated game GET and an owner-only request receipt endpoint. The fetch helper binds the returned game/scenario and decodes the approved descriptor using the independent public scenario ID. The unchanged protocol decoder and render adapter are present in the identical packages/client trees. Client REST/join and WS requests supply `battlefieldVersion=1`, matching the API's alternative-map gate before seat/upgrade effects. The live loader obtains metadata/terrain before WS and retains R22's sibling cancellation and successful-stream lifetime behavior.

The creation endpoint accepts the delivered modern fields and retains legacy no-key defaults. Reconciliation returns matching request/game IDs and the pending/recovery/lobby/started statuses that the transport handles; uncertain/conflicting outcomes do not authorize a replacement key or another automatic POST. Main supplies shared receipt/auth/lobby composition and uses the default-only native registry. No alternative registration or owned library follows from these restacks.

The inherited `client/src/app/shell/new-game.component.ts` still binds the default preview and `canOpen`, without the modern choice/selection outputs, and creates via `toRequest(form, options)`. Therefore these deliveries do not wire the separately reviewed R30/R34 parent stable-intent flow or activate an alternative playable selection. W8/W9/W10/W11/W12 library/worker work is also outside these new heads. These are explicit dependency boundaries, not evidence of complete lobby-map delivery.

## Actual checks and evidence carried

This rebind independently ran object/ref/parent/tree verification, complete inventory comparison, manifest SHA-256 and old/new byte comparisons, client/packages subtree equality, inherited server-tree equality and `git diff --check`. All passed. No test suite was rerun solely for an unchanged source restack. The earlier independent checks carry **by the verified client/packages identity**, with their original execution context and limitations:

- R13:70 focused tests /5 files and client typecheck passed.
- R14:81 focused Angular tests /2 files passed; the broader mixed-snapshot failures remain separately recorded.
- R22:84 Angular tests /7 files and client typecheck passed after the failure-abort repair.
- R25:130 framework-free tests /3 files and client typecheck passed.
- R24's independent server review remains the authority for the inherited API base; client identity does not prove a new end-to-end run against it.

No fresh combined-stack browser, HTTP, build, full suite or remote CI check was performed. Draft PR numbers472/473/474 and parent471 CI status are coordinator publication information, not reviewer-verified remote evidence. No publication or external message was performed. Browser Start/create-to-live remains unverified and subject to the existing approval gate. No whole-snapshot acceptance, library attachment or performance acceptance is inferred.

Only this reserved report and the R35 verifier report were written for this pair of packets. Protected canonical HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`; earlier reports are unchanged. No product/test/config/Git/runtime/browser/game/pane mutation, new agent, merge or deployment occurred.
