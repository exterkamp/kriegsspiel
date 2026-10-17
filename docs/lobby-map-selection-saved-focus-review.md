# R33 independent saved-inspection focus review

**Verdict: Accepted at H for the bounded five-path focus repair. R27-N1 is resolved in source and focused Angular tests. No blocking or new nonblocking finding.** Actual Chrome/top-layer focus and visual acceptance remain pending. The combined client typecheck failed in disjoint W12 tests; targeted R33 TypeScript checking passed. No whole-snapshot or production Add acceptance is inferred.

## Exact binding and inspected inventory

- H `cd1d1ae6c9d23aa018084f4c198f7712fd735b55`; tree `bdaf6d7aaee8a99c1ed3369c71dce80d77d0f406`; P `81ae2e9facd6dc8d1e5b2c6b80abb83659bb3225`.
- Manifest `/private/tmp/lobby-map-saved-focus-candidate.json`, SHA-256 `25d629ee086429237a6b47d48071a3238326f643012104e49c6646174b9dc874`.
- Handoff `/private/tmp/lobby-map-w11-saved-focus-handoff.md`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; execution snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified explicit H/tree/P and exact five-path inventory; every manifest SHA-256 matches its Git blob and scoped snapshot bytes. Read the complete delta and relevant existing selection/save/history/retirement/native-close/Tab/focus lifecycle:

| Changed path | H blob |
| --- | --- |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.ts` | `94d2f51b9deaf02ba6c7002cc87824f5f25035dd` |
| `client/src/app/lobby/battlefield-map/battlefield-map.component.spec.ts` | `809e3a112161a1b80e30354e5cdb8db7541219fc` |
| `client/src/app/lobby/map-library/library-browser.component.ts` | `6b88895c303dc7a9b4899cf74bfbeee1be5fdcd5` |
| `client/src/app/lobby/map-library/library-browser.component.html` | `c127f91133b4e0225c557383bf2dd55d8d98711f` |
| `client/src/app/lobby/map-library/library-browser.component.spec.ts` | `e8af3dbcfb861908b1919140288f12e2010acbcb` |

Context inspected: AGENTS, approved design's saved-entry focus requirement, execution log, historical R27 review/N1, W11 handoff/red log, accepted W8 Add outputs, W9 parent/browser boundary and W10 disclosure/transport. R27 and all other historical reports remain unchanged. Parent R30 repair and W12's new helper are disjoint; their mutable bytes are not accepted by this packet or by compilation.

## Source and finding disposition

The actual saved inspection name is now a connected, programmatically focusable h3 with tabindex=-1. It is outside ordinary Tab order and remains within the sole existing dialog. The parent performs the handoff only after render, with active/current Choose/My maps, acknowledged history, enabled entry, current browser and matching saved reference. The saved summary is consumed once, preventing later row/page work from repeatedly reclaiming focus.

The browser captures current owner generation, exact selected object identity and page for its deferred request. Its render effect checks enabled/current/not-retired/not-destroyed state and heading connection before focusing, then consumes the request. Source/library/input replacement, paging, another inspection or synchronous retirement clears the request; destruction invalidates its owner. Matching only a reused ID is insufficient. This preserves another focus owner after replacement and avoids an old saved operation stealing focus after dialog departure.

Direct Add replaces its own entry with Choose and nested Add awaits Back to the chooser before saved-heading handoff. Ordinary title/history focus runs first; the saved heading becomes the final render target, including when no list row exists for the just-saved item. Existing child cancellation, retained draft, opener restoration/native-close visits, synchronous pending-create callback, Tab containment and playable selection guards are unchanged. No new modal/history owner, timer, CSS/layout change, service request or native pairing output was introduced. A saved geography remains Needs a scenario with Use disabled.

**R27-N1 closed for this bounded source:** exact activeElement assertions now require the Saved geography h3 for direct/nested real-child save flows, rather than the generic chooser h2. Additional tests cover on-page/off-page target, render deferral and suppression after page/source/library-owner/selection/retirement/destruction changes, plus foreign/retired requests. These are meaningful ownership/focus assertions, not simply checking that a heading exists. The existing saved/canonical identity/native-candidate/no-selection-change assertions remain intact.

The raw author red log was inspected:2 failed/93 passed, both exact activeElement assertions receiving the generic h2. This review did not mutate source or independently rerun old product bytes; the red run remains author evidence. Current focused greens below are independently executed.

## Independent checks actually run

Pinned Node22.23.3, snapshot client; Angular environment `NG_BUILD_CACHE_STORE=sqlite NG_BUILD_MAX_WORKERS=2`:

```sh
node ../node_modules/@angular/cli/bin/ng.js test --watch=false --include='src/app/lobby/battlefield-map/battlefield-map.component.spec.ts' --include='src/app/lobby/map-library/library-browser.component.spec.ts'
npm run typecheck
node ../node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/styles/design-system.test.ts
```

**134 Angular tests /2 files and5 token tests /1 file passed.** Focused ESLint on the four changed TypeScript/spec files and `git diff --check P H` passed. Logs `/private/tmp/lobby-map-r33-review-{tests,style,lint}.log`.

**Full client typecheck failed**, exit2, in unreviewed W12 `src/shared/lobby-map-library/asset-check.test.ts`: spy signature/tuple, recursive mapped-type and AssetCheckResponse union errors. Raw output `/private/tmp/lobby-map-r33-review-typecheck.log` is retained. App noEmit checking completed before the spec check failed; the worker phase was not reached by the chained command. These W12 files are absent from H and are not attributed to W11. No source, tests or configuration were altered to hide the failure, and the combined workspace is not called typecheck-green.

An additional read-only TypeScript API program using the existing spec options and only the two R33 spec roots plus their transitive dependencies produced **0 diagnostics** (`/private/tmp/lobby-map-r33-review-targeted-typecheck.log`). It emitted no files and changed no configuration; it is a targeted result, not a replacement full-client pass.

Tests exercise real Angular render scheduling, DOM activeElement and same-document history with existing jsdom dialog primitives and in-process preparation/library/preview doubles. The150m reference asset/canonical/full-hash fixtures are not real default generation or durable transport/storage/browser evidence. The coordinator's236-test combined run is author evidence only. No independent production build/full-root/CI/real Chrome/touch/visual/performance run was performed. Existing Angular SQLite/splitting notices remain.

## Bounded release

Accept the five H files and close R27-N1 at the source/unit level. Require exact-source native-browser direct/nested saved-heading focus, desktop/390/320 layout and current-owner durable generation/save/readback evidence before final integrated UX acceptance. R32 server repair has its own report; R34 parent repair and W12 helper require separate acceptance. Actual browser Start approval remains pending; no workaround occurred.

Only this exclusive R33 report was written for this packet. No source/test/config/Git mutation, managed process/server/browser/game/pane/focus control, new agent, external message/action, merge or deploy occurred. R34 is separately queued next.
