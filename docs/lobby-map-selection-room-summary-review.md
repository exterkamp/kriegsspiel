# R41 independent retained room map review

**Verdict: Accepted at `5e3b4ca5092b905506783d915d29096410e0b460` for the retained public-map room summary and inspection. No blocking finding. Two nonblocking presentation findings remain below.** Actual room/live browser acceptance is separate.

## Exact source and complete coverage

- H `5e3b4ca5092b905506783d915d29096410e0b460`; tree `c4dd3d9f964437deb70e3670b9710dd4932102e6`.
- P `e77bc85bfaeb073146599f2536bcaf5ed19195b9`.
- Manifest `/private/tmp/lobby-map-room-summary-candidate.json`, SHA-256 `b2318003ebc18e3c51855c4aba2cfba34d557032d52ff4db907c0befe343627f`.

Verified explicit Git H/tree/P, complete two-path inventory, manifest/Git/scoped-snapshot hashes and diff whitespace. The ref matched H at initial inspection; its later source-identical rewrite is separately reviewed in R43. Read both changed files completely, their delta, the actual preview TS/HTML/CSS, approved design's room requirement, public descriptor decoder, GameInfo transport, shell room routing and native retained-public-descriptor API boundary. Current AGENTS/decisions/log and prior accepted native/API reviews retain their limits. Later mutable W17 parent/shell changes are excluded; original caller context was checked through explicit Git objects.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `client/src/app/lobby/room.component.ts` | `d581aba16d119a9b044b014ddd10b03660225324` | `c46a4d07bd255d01b64072e62a2e6e4774b899c1f07bed8e1bb39edb63c17adc` |
| `client/src/app/lobby/room.component.spec.ts` | `2427f966dd8a13aa340ef1c2b5bd8804d09d9ff3` | `99a8ecba1bbd38a6d6ae97ee2946bd8636393275862774a2f08c69d6177f5895` |

## Assessment and findings

The panel precedes sides and invite markup and consumes the game's retained `battlefield`, independently bound by `decodeApprovedBattlefield` to `info.scenario`. It does not consult `/scenarios` or infer current/default terrain. The returned descriptor is detached and allowlisted; preview data has no units, HQs, private objectives, observations or gameplay attributes. A native `<details>` expands the existing interactive SVG renderer with exact metre geometry, explicit layers, touch buttons, keyboard pan/zoom/fit and text alternatives. There are no selection/Add/Use controls or new creation request.

A present malformed/null/undefined modern field is distinguished from an absent legacy field through `Object.hasOwn`. Invalid modern data renders an alert without fallback/SVG, disables host Start through the blocker and also rejects a synthetic Start handler call. Retry polls only retained game information. Absent legacy data shows unavailable copy and preserves the existing host action. A cosmetic preview issue is not substituted with another map.

Existing ready/join/leave/kick/invite/hot-seat/polling actions are retained. REST game/join already send capability1, and server auth/private-game/seat authority remains server-side. A failed catalog cannot prevent joining this pinned room because no catalog is read. Existing transition to started/live still enters the independent GameService terrain/metadata gate. The delta does not newly establish room polling lifetime or backend identity; those remain the earlier implementations and their own limits.

**N1 — The panel does not identify the scenario.** Approved design requires an immutable scenario/map summary. The new panel renders map name/extent and says “The scenario … [is] fixed,” but neither the scenario name nor `info.scenario` is displayed. With the current single public scenario this does not permit an incorrect selection/start, so it is nonblocking. Show the retained public scenario identity/name alongside the map, with an ID fallback if necessary, without introducing a latest-catalog dependency.

**N2 — Modal-specific Escape instructions are reused in a disclosure.** The unchanged interactive preview caption says “Escape fits the map before closing it.” Room supplies a `<details>` owner and no Escape-close handler; at fit, the preview's key handler simply returns. The caption therefore describes outer closing behavior this integration does not provide. Nonblocking: make the instruction accurate for room context (for example, Escape fits, with the summary used to collapse), without adding a new modal/history owner merely to satisfy the copy. This is a source-level context mismatch; no browser key behavior was asserted from a live test.

## Tests and independent execution

The four new room tests exercise actual Angular component/decoder/preview behavior with typed public fixtures and a deliberately failing catalog stub. They check DOM ordering before sides/invite, native disclosure opening and SVG viewBox, absence of changing/creation actions, no catalog calls even after polling, contradictory modern parent rejection, disabled plus synthetic Start, retained-details retry, legacy Start and existing invite/join/ready/leave/hot-seat behavior. These test safe public fixture syntax, not authenticity of a real private native pin. Existing shell tests exercise surrounding auth/routing behavior.

Pinned Node v22.23.3 PATH and SQLite Angular cache/2 workers:

- Combined focused `ng test --watch=false` on room, shell, Add state/component, browser and picker specs: **258 tests /6 files passed**. Room/shell are the51-case subset; the other four suites contain207 cases. Log `/private/tmp/lobby-map-r40-r42-review-angular.log`. This is one combined reviewer execution, not two independently rerun subsets.
- Client/server typechecks both passed: `/private/tmp/lobby-map-r40-r42-review-typecheck.log`.
- Focused ESLint including both owned files passed: `/private/tmp/lobby-map-r40-r42-review-lint.log`.
- Explicit Git/inventory/hash/diff checks passed.

Coordinator's separate51-pass room/shell and lint/format logs remain author evidence. No independent full suite, format, production build, remote CI, actual room/browser/HTTP/game or managed-main execution was performed. Supplied geography-generation screenshots do not exercise this room. Later W17 snapshot changes are unreviewed and do not invalidate the exact owned-file checks; no current whole-snapshot acceptance is claimed.

## Release limits

Accepted source dependency with N1/N2 as bounded follow-ups; final room desktop/narrow/keyboard/browser evidence is still open. Browser Start/create-to-live awaits its existing approval and was not bypassed. The reviewer wrote only the reserved R40–R43 reports, preserved historical reports and made no product/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment.

Final preservation notice: after this report was written, both mutable room files changed externally. Observed SHA-256 values are `ea4257ab1ea60bb44277a1b945d75f2a58db90f146c2c75ba2e1bf0d20fd2abc` (component) and `1d0b1b128a25cd9638e999d3dd390d6bc2187613c85e46bf2610b3d8ad4b61e6` (spec). Those later bytes were not reviewed. This verdict, N1/N2 and test evidence remain bound to original H; no repair disposition or current-snapshot acceptance is inferred. R40's two and R42's nine scoped files still matched their manifests at that final check.
