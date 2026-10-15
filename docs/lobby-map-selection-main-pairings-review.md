# R40 independent main native allowlist review

**Verdict: Accepted at `e77bc85bfaeb073146599f2536bcaf5ed19195b9` for the explicit two-native-pairing entrypoint composition. No blocking or nonblocking finding.** This is source acceptance; main was not executed by the reviewer and actual browser Start/create-to-live remains outside this verdict.

## Exact binding and coverage

- H `e77bc85bfaeb073146599f2536bcaf5ed19195b9`; tree `2aaef0af2d8dc8a9a11f094d4d53fa805fd7e8ce`.
- P `d5b87b9531383f9f4ba37a3be89e92ce1ef85f05` (accepted R39).
- Manifest `/private/tmp/lobby-map-main-pairings-candidate.json`, SHA-256 `24e9862184b5e338d05cf3d0c3f8a5cc79f7dbc9ac8e5efd33a4f2af73a75020`.

Verified explicit H/tree/parent, complete two-path delta, manifest SHA against Git/scoped snapshot and diff whitespace. The branch ref matched H at initial inspection; its later coordinator restack is a separate R43 rebind, not this original-head identity. Read current canonical AGENTS/decisions/execution log, candidate D44–D46, all changed main wiring and surrounding composition, the full registry, retained authored content/pin and API/receipt/capability boundaries, and relevant earlier native reviews. No whole-snapshot identity or ancestor-wide reacceptance is claimed.

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `server/src/main.ts` | `8245d2976f89243b5acfa53c68431a8ed686743f` | `8ea86dd2699c52b5313df2f37e0a9914ea3b75390cfc67a3a3b8d8c3b0beb3ca` |
| `docs/decisions.md` | `afce1207e85ba92d286917539bf01c926c67f7e8` | `d14877b85104b5269bbac3d16e64e415c24a70257b8b158a60b212110ce9a3d4` |

## Assessment

Real `main.ts` now constructs exactly `new NativeBattlefieldRegistry([DEFAULT_BRIDGE_PAIRING, OPEN_BRIDGE_PAIRING])` and passes that same instance into `buildApp`. The list is trusted source configuration. No body/query/environment/library record supplies extra entries, and the constructor still defaults to the original pairing for other callers. Unknown enabled IDs or removal of the original default are rejected by the unchanged registry. Its two cached authored definitions remain the sole resolvable assemblies.

The enabled alternative is the retained Open bridge approaches native input, not canonical generated-map conversion. Prior accepted pin/content checks preserve armies, seed, HQs, objective, extents and asymmetric crossing coordinates, omitting only `north-wood` and `south-wood` and changing the resolved scenario identity. Modern pairing revisions still bind the complete initial scenario/terrain/assembly. No arbitrary placement, new content, renderer policy or balance/AI claim is introduced.

Passing this instance exposes the two-entry public catalog through the accepted API and resolves modern selection against the same registry. No-key legacy default resolution is unchanged. Exact pin/receipt/lobby/header/snapshot/reopen and capability1 admission remain the accepted API's authority. Enabling availability does not bypass those validators. Library initialization remains independently conditional on the shared durable owner and fully certified included catalog; library geography never enters the native allowlist.

D44 now points to D46 for integrated entrypoint availability, while retaining the historical prerequisite/default-constructor boundary. D46 explicitly distinguishes source preparation from deployed service/browser acceptance and keeps geography unpaired. The documentation does not claim that source review itself created a game or established balance/performance.

## Independent checks actually run

Pinned Node v22.23.3 PATH, existing dependencies:

- Snapshot server: `vitest run --configLoader runner --no-cache src/api/battlefield-selection.test.ts src/game/native-battlefield-registry.test.ts`: **27 tests /2 files passed**. Log `/private/tmp/lobby-map-r40-review-native-tests.log`.
- Read-only TypeScript AST probe against exact main H verified the literal two-constant constructor and the same `battlefields` shorthand supplied to actual `buildApp`. Main was not imported/executed. Log `/private/tmp/lobby-map-r40-review-entrypoint-binding.log`.
- `npm run typecheck -w client -w server`: both passed. Log `/private/tmp/lobby-map-r40-r42-review-typecheck.log`.
- Focused ESLint on changed main and the separate R41/R42 TS paths passed. Log `/private/tmp/lobby-map-r40-r42-review-lint.log`.
- Git/inventory/hash/diff checks passed.

The registry cases exercise default-only constructor behavior, trusted two-entry resolution, strict pin roundtrip, unknown/stale/foreign/unpaired rejection, detachment and invalid composition. API cases exercise actual allocation/persistence/auth/capability seams through disposable test composition, not the managed main process. The test title referring to default-only production availability covers the constructor; source inspection/AST establish the changed real-main composition. No managed service or browser game was created by the reviewer. No independent full suite/build/format/remote CI was run. Coordinator lint/format and earlier27-pass logs remain separate author evidence.

The checks used combined snapshot dependencies with exact owned-path binding. Later parent/shell work outside these two paths is unreviewed; it does not belong to this verdict. Historical reviews remain unchanged.

## Bounded release

Accepted as the source dependency for the coordinator's separately authorized task-only real-main verification. The reviewer performs no restart or preview control. Actual main/runtime verification, room/live browser behavior, browser Start approval and performance evidence remain separate gates; source acceptance is not merge/deploy authorization. Only this reserved report and the other specifically reserved R41/R42/R43 reports are writable in this task. No source/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment occurred.
