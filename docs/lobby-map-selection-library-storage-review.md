# R28 independent library foundation review

**Verdict: Accepted at H as the bounded protocol/worker/admission/SQLite foundation. No blocking finding.** One nonblocking cursor edge and a permanent-test coverage gap are recorded below. This does not accept routes, service/composition registration, initialized capability, production Add or browser save/generation.

## Exact source and inspected inventory

- H `d915115160619ab6a3c4884e07d9005ebda0b93a`; tree `d06e2bbfbb05a9b2dc173759ed94dff1dd1ea1dc`; P `1fa53df66b348cca14e4bd7963778036969169d6`.
- Manifest `/private/tmp/lobby-map-library-foundation-candidate.json`, SHA-256 `5b7a18a38f584baaafdabcdefbd616b4dfb71a0f2cdcbd8fd532c5c8cadc01c4`.
- Accepted canonical `docs/lobby-map-library-contract.md` remains SHA-256 `9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`.

Verified H/tree/P and exact twelve-path inventory using explicit Git objects. Read the complete delta and all changed source/tests/configuration. Each manifest SHA-256 matches its Git blob and scoped snapshot file, rechecked after execution:

| Complete changed path | H blob |
| --- | --- |
| `packages/protocol/src/map-library.ts` | `ef188ac17ccb7e09b4859e31edb320f6d960788a` |
| `packages/protocol/src/map-library.test.ts` | `55f99d439a0da07f191ab79c1d402c2139e6b0b3` |
| `packages/protocol/src/index.ts` | `493aef0be384e1c47f63f5fde842641f38873109` |
| `server/src/map-library/admission.ts` | `7345c577cbd81cfecffc5e0e2cd9f2bd63f7021d` |
| `server/src/map-library/validation.ts` | `e424eff2da92a58e084cb4e203e63453368f8482` |
| `server/src/map-library/validation.test.ts` | `e8263136d4ba9882517dced5e1fef03289a7a796` |
| `server/src/map-library/store.ts` | `e9734800f609b945fee952d29bff2566d84b6dac` |
| `server/src/map-library/store.test.ts` | `b11ff502b29858c647168c78c1c44dc3ca1d8b1f` |
| `server/package.json` | `44188469a3088a15e2c6524e91e690401567e80f` |
| `server/tsconfig.json` | `15f3668832aae83e6da2f8daf96c311989e63286` |
| `server/vitest.config.ts` | `9ccc7f857ad3ef3c74db9062be5ed368db234a9c` |
| `package-lock.json` | `cfb3568308aeda29ae731000c8e765f71ec45a6b` |

Also inspected AGENTS/accepted design and D43, R18 contract acceptance, current maps import/resource/canonical/complete-validation/identity code, borrowed AuthStore ownership callbacks and creation/shared-database tests. H's maps tree is `d98257efddde932848502f62dfeb7246ad65798e`; auth source is blob `a562677a6823c700feb057f946d8dcbc17a662c5`. Maps source/build configuration and auth source match H in the snapshot. The worker's existing maps dist was independently compared with an in-memory TypeScript build: all67 emitted JavaScript files match, with zero diagnostics and no filesystem emit. This binds the actual worker's dist dependency to the inspected source without rebuilding it.

The combined snapshot contains disjoint API/service/participant/main/client work. In particular `server/src/lobby/creation-store.ts` differs from R28 H; passing composition tests/typecheck do not accept those bytes. No whole-snapshot identity or compilation-based acceptance is claimed.

## Findings and assessment

**No blocking source finding within this prerequisite.** The protocol exposes strict detached allowlisted metadata, source-bound duplicate-free pages, exact needs-scenario status, explicit owned timestamps, bounded valid names/IDs/hash/dimensions and cursor syntax. Accepted iterative byte/depth preflight runs before Zod cloning. The barrel adds only the public library API. This neither registers maps nor provides gameplay approval.

Admission is an explicit no-queue reservation with global2/owner1 limits. Release is idempotent and holds the slot until tracked retirements settle. The validator requires an active lease before worker allocation and rejects abort/oversize input first. Actual ingress reservation before application buffering/SQL remains a caller responsibility to verify in R29; acquiring here after buffering would not satisfy the contract.

The trusted worker receives text as data, imports through the bounded maps parser, runs current complete `validateBattlefield`, enforces NW-zero/settings bounds, compares exact canonical text and calculates `assetIdentity(asset, 'asset')`. It returns only strict bounded metadata plus the unchanged original string. Worker timeout/error/abort/invalid-envelope/exit failure paths terminate and await exit; successful acknowledgement also awaits retirement. Its512MiB old-generation limit is not an RSS/external-buffer guarantee. The relative maps-dist URL resolves correctly from both `server/src/map-library` and `server/dist/map-library`; maps build remains a prerequisite. Script/config/lock changes add the workspace dependency and test/dev preparation without another dependency install or gameplay change.

The SQLite store borrows the caller's DatabaseSync and does not close it. Initialization and saves use transactions; accepted exact name/hash/bytes retries precede current quota checks. UTF-8 bytes, guest/account map/byte ceilings, live-user existence and strict saved summaries are checked before commit. Asset bytes and operation metadata commit together. A lost COMMIT acknowledgement leaves an accepted retry recoverable; unresolved COMMIT+ROLLBACK failure poisons public authoritative reads/writes, including after an external rollback. Active foreign transactions also block those public methods.

SQL canonical reads use byte length plus CASE to avoid retrieving values above64MiB into JavaScript; bounded metadata selection and page LIMIT21 prevent aggregate asset reads. Keyset pages retain20 items and a bounded signed cursor, bound to source/owner/process epoch, ordered by immutable timestamp/UUID. Adoption retains all120 entries in the supplied over-quota fixture, preserving both colliding operations and rejecting ambiguous owner/key lookup without creating a third asset. Auth ownership callbacks run only inside the shared transaction. Delete removes canonical bytes/name/hash/dimensions while retaining inaccessible operation tombstones. The store accepts a trusted ValidatedLibraryAsset; it does not itself run certification on writes/readback, authenticate sessions, establish durability capability or register its callbacks. Those are explicit service/composition obligations.

**N1 — Explicit empty cursor silently restarts at the store boundary.** `LibraryStore.list` uses `if (cursor)`, so `list(owner, '')` returns the first page rather than restart_map_list. The stricter cursor decoder would reject it if reached. Independently reproduced. Nonblocking for this internal foundation, whose normal emitted cursors are nonempty, but the production request path must reject an explicitly supplied empty/invalid cursor rather than silently treating it as absence; it can do so in route validation or the store. No owner decision is needed.

**N2 — Retain the stronger boundary premises as permanent regressions.** The test titled “aborted or oversized request” only supplies an already-aborted tiny input; it never submits oversize data. The real worker test asserts a64hex identity pattern rather than equality to an independently computed full hash, and its negative fixture is only noncanonical whitespace. Source implements the intended checks, and independent probes below exercise them successfully; these are test-strength gaps rather than demonstrated implementation failures. Add permanent UTF-16-length/multibyte oversize no-factory assertions, exact full-versus-geometry hash equality and canonical-but-current-certification-invalid rejection when strengthening this area.

## Independent executed checks

Pinned Node22.23.3, snapshot directories:

```sh
# server/
node ../node_modules/vitest/vitest.mjs run src/map-library/store.test.ts src/map-library/validation.test.ts --no-cache
node ../node_modules/vitest/vitest.mjs run src/map-library/store.test.ts src/map-library/validation.test.ts src/lobby/shared-database.test.ts src/lobby/creation-store.test.ts --no-cache
npm run typecheck
# packages/protocol/
node ../../node_modules/vitest/vitest.mjs run --no-cache
```

**18 foundation tests /2 files passed;39 tests /4 files passed in the additional composition/core run; all116 protocol tests /5 files passed; server typecheck and focused ESLint passed.** The39 count is the actual independently selected set, not the coordinator's different41-test claim. Logs `/private/tmp/lobby-map-r28-review-{tests,composition,protocol,typecheck,lint}.log`; in-memory dist comparison `/private/tmp/lobby-map-r28-review-dist-binding.log`. `git diff --check P H` passed.

Additional stdin-only source probes, with no source edits, passed: no worker allocation for both a string over64MiB characters and multibyte UTF-8 over64MiB; real worker full-hash equality and inequality to geometry hash; rejection of topology-importable canonical geography with unsupported generator provenance by current complete validation; returned-metadata detachment; transactional account/library delete rollback; actual file-backed close/reopen preserving operation/exact bytes; SQL rejection of an oversized persisted value; and all public read/write poison guards after manual rollback. These use disposable workers and temporary SQLite, not a managed server/game. Logs `/private/tmp/lobby-map-r28-review-probes-cjs.log` and `/private/tmp/lobby-map-r28-review-sqlite-probes.log`.

Two earlier probe harness failures are retained, not hidden: `/private/tmp/lobby-map-r28-review-probes.log` first used the wrong fixture path (`server/data/maps`, ENOENT); `/private/tmp/lobby-map-r28-review-probes-final.log` then inherited the stdin harness's `--input-type=module` into the CommonJS eval worker. Correcting the fixture path and using a CommonJS stdin harness, without changing product source, produced the passes above. Ordinary foundation tests had already passed using the default worker. Experimental SQLite/Transform Types notices remain. No independent full build/root suite/CI/browser or actual HTTP/game test was run.

## Bounded release

Accept R28 H as a foundation dependency. R29 must independently prove real onRequest admission before buffering/large SQL, deadlines/UTF-8/encoding handling, slot retirement on every path, live session/ownership rechecks across awaits, participant registration on the same transaction, included startup certification, exact readback and genuinely durable initialized capability. Neither passing foundation fixtures nor imported metadata enables public Add.

Only this exclusive R28 report was written for this packet. Prior reviews, including R27, are unchanged. No product/test/config/Git mutation, managed process/server/browser/game/pane control, new agent, external message/action, merge or deploy occurred. Browser Start approval remains pending. R29 is a separately queued following review.
