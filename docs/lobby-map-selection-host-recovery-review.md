# R15: independent Host/snapshot integration review

**Verdict: Changes needed at H. Two confirmed blocking findings: R15-B1 and R15-B2.** The72-test suite and independent positive lifecycle/durable-reopen probes pass, but native allocation/recovery can still downgrade through legacy paths. No product source was edited. This report does not accept API creation, receipt adoption or the disjoint combined-snapshot work.

## Exact binding and complete inspected inventory

- H `143f0582b194bb4731df45039d85a128ee45b4dd`, tree `4ad68330d720c4770d79adb248d2e7aa92267b6b`.
- Verified parent P `6ddffa08aa5efd8b805b86da6bb16a7f5bc4c42c` (accepted R12 settings repair).
- Manifest `/private/tmp/lobby-map-host-recovery-candidate.json`, ref `refs/heads/feat/lobby-map-host-recovery`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

All seven changed paths, their complete delta and relevant surrounding lifecycle/storage code were inspected. Manifest H/tree/parent/inventory and every SHA-256 match explicit Git blobs and the seven scoped snapshot files:

| H path | H blob |
| --- | --- |
| `server/src/game/host.ts` | `50981caebe0df5659282a08dc722118a32cef4ea` |
| `server/src/game/host-pin.test.ts` | `beedace973fcc2052107451c4e6fb400b139e43c` |
| `server/src/game/snapshot-binding.ts` | `29235094685233cd326cf3bf82fe749ace4da82a` |
| `server/src/game/snapshot-binding.test.ts` | `bb8aa11d2e70c30cb74cf9fa4790b9e8496c9236` |
| `server/src/game/actor.ts` | `241a3db7859f976b2eff60687df8fb33faee57fa` |
| `server/src/game/store.ts` | `34b5c964fccb1c8bcc838c0a866b9ab9e85c0fb8` |
| `server/src/game/sqlite.ts` | `8f9bb9041368b798f91299712e1cf615ea69484b` |

Reviewed surrounding actor constructor/start/persist/close/queue/timer behavior, accepted pinned-header/native codecs and registry, replay/advance helpers, SQLite migration/storage behavior, clock/turn regressions and FakeTime. Named native/header/replay/registry/test/config dependencies and engine/protocol source used by the runs match H. Disjoint auth/creation/API and GameService work in `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` is outside this candidate. No whole-snapshot or compilation-tree identity is claimed. Native High verification is packet-supplied; no pane operation was performed.

## Blocking findings

**R15-B1 — pin-less create can overwrite a known header-only native allocation in memory.** Location: `server/src/game/host.ts:227` through the conditional header-save branch.

`doCreate` reads a previous header only when the incoming call supplies a pin. A caller omitting `clock.pin` therefore skips the existing native header entirely. MemoryGameStore's retained replace-on-save semantics then overwrite that header with a legacy one, and startup persists a legacy/unmarked snapshot for a different assembly. The new Host boundary must protect a known native allocation independently of the incoming call's claimed format.

Independent in-memory reproduction at H:

1. Save a valid native Open bridge header for `header-only`, with no snapshot or inputs.
2. Call `host.create('header-only', defaultPin.initialWorld)` with no pin.
3. Creation succeeds. Saved header changes from resolved scenario `hold-the-bridge-open-v1` to `hold-the-bridge`; actor has five terrain features instead of three, and both native header format and snapshot binding are absent.

This is an actual Host/MemoryGameStore behavior, not a request to implement API receipts. File/SQLite duplicate-header rejection does not protect the supported memory path. **Required correction:** inspect existing allocation/header state regardless of whether the new call supplies a pin; refuse omission/downgrade or a differing native allocation before header replacement/actor effects. Preserve the accepted native header. Add a permanent regression for native header-only allocation followed by a pin-less/default retry, alongside the existing matching-pin/no-input retry test.

**R15-B2 — absence of both markers is treated as legacy without proving a compatible historical world/header.** Locations: `server/src/game/snapshot-binding.ts:34` and `server/src/game/host.ts:289` onward.

`assertSnapshotHeader` returns when there is no native header binding and no snapshot marker. Host then skips `assertPinnedWorld` for a missing header, or that helper returns immediately for a legacy header. No positive historical-scenario/world/seed compatibility check occurs on this branch. A recovered native alternative can consequently be registered and persisted as an unmarked legacy actor.

Two independent in-memory reproductions at H, after creating/closing a valid native Open bridge game:

- Remove the snapshot binding and make header readback absent. `host.open` succeeds with resolved scenario `hold-the-bridge-open-v1`, three features and a newly persisted snapshot still lacking the binding.
- Remove the snapshot binding and replace the header with a legacy header naming `hold-the-bridge`, seed17. `host.open` still succeeds with world scenario `hold-the-bridge-open-v1`, seed1815. The explicit header/world contradiction is ignored.

The current tests remove the header or marker separately and correctly reject those cases; they do not exercise combined loss or the contradictory legacy-header branch. **Required correction:** absence alone must not authorize legacy recovery of an unregistered native alternative or contradictory world. Require positive supported historical-bridge evidence and header/world identity consistency before the legacy branch; reject missing/contradictory new-format recovery instead of synthesizing a legacy interpretation. Add both regressions. A default-native world is not intrinsically distinguishable from historical bridge data after every identifying marker is removed, so any wider no-downgrade claim must rely on retained durable format evidence rather than absence alone. This fix belongs to the Host/snapshot boundary and does not require API/adoption acceptance.

## Other source assessment and passing behavior

`snapshotBinding` validates a native header and hashes its complete canonical JSON with a versioned domain. Settings/persona, optional receipt identity, complete pin and game identity are included, rather than just terrain. Strict binding decode rejects unknown fields/versions/digest shape and applies a1KiB structural/byte gate. Actor construction detaches the binding; every persisted snapshot carries a fresh copy. SQLite adds one nullable migration after the accepted existing migrations, validates binding writes, bounds marker readback in SQL before parsing, and preserves legacy NULL absence.

With valid markers present, recovery checks header/binding before replay and recovered static world both before and after tail/progress catch-up. Native creation validates exact pin/world agreement and detaches settings/pin before asynchronous storage. Header-only retry with a matching full native header and no inputs resumes without rewriting the header; differing pin/header or prior inputs are rejected on that checked branch. Receipt identity is bound syntactically/by digest, not proven against a receipt store. Rate is not part of InputLogHeader; effective-intent/rate retry enforcement remains a later caller/receipt responsibility, not established by this digest.

Actors enter `games` only after `actor.start()` resolves, so `get` does not expose an incompletely persisted actor and concurrent opens share the pending promise. Startup failures close constructed actors, and register failure calls the configured `onClose` cleanup hook, preserving cleanup errors through AggregateError. This delegates provider disposal to composition; tests/probes confirm callback execution rather than real model-provider disposal. Constructor/factory failure also reaches that hook. Existing actor close clears scheduler/pause/turn/parse timers and abandons queued dependencies. Direct close and shutdown wait for the activation they observed; this is not a new terminal Host/admission-lock contract for arbitrarily later creates.

Native pins remain pre-runtime while dial and turn/manual-clock settings apply afterward. Reopen reconstructs the binding and existing turn/history semantics. Legacy rate/manual/turn regression files passed. The two blockers above concern invalid allocation/recovery paths, not an observed regression of valid legacy clock behavior.

## Tests, effectiveness and independent runs

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/snapshot-binding.test.ts src/game/host-pin.test.ts src/game/pinned-header.test.ts src/game/sqlite.test.ts src/game/replay.test.ts src/game/clockInvariance.test.ts src/game/turns.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**72 tests /7 files passed; server noEmit typecheck passed.** Manifest/source/dependency checks and `git diff --check P H` passed. The combined snapshot compilation unit includes disjoint work without accepting it as H. No independent lint/build/full-root/CI/HTTP/browser/model run was performed. Node emitted its SQLite experimental warning.

New tests meaningfully block initial persistence, require no actor before release, test matching native retry/header-write count, reject conflicting pin/prior inputs, inject later startup failure, check timers/cleanup hook, exercise recovered terrain and separate marker/header/settings/digest contradictions, wait on pending shutdown and test corrupt/oversized durable marker readback. Their omission of pin-less retry and combined marker loss leaves B1/B2 undetected. The SQLite binding test uses a placeholder engine string to isolate metadata storage; it is not itself full native Host reopen evidence. No reviewer source mutation or independent red run was performed.

Additional inline probes used matched source with in-memory TypeScript transpilation, isolated Memory/SQLite stores, FakeTime and stub parser. They created only test actors, never task-server HTTP/browser games. Temporary SQLite fixtures were removed and test hosts shut down:

- **Three defect observations:** the B1 retry downgrade and both B2 recovery cases described above. All unexpectedly registered an actor at H; these are confirmed failures of the intended contract, not acceptance passes.
- **Four positive cases passed:** direct `close(id)` remained pending until blocked activation completed, then removed the actor and all fake timers; a throwing provider/parser factory invoked `onClose` with no registered actor/timers; a native turn-mode game persisted the full settings/receipt header binding and rejected a changed receipt digest; an actual SQLite Host close/reopen retained that binding, receipt, `free` dial and turn mode/manual clock.

The first positive-probe attempt incorrectly expected manual-clock stored rate0; existing GameClock keeps rate1 while manual mode prevents clock advancement. Correcting only that probe expectation to test manual mode produced all four positive passes. No product behavior or assertion in the repository was changed.

## Required disposition and stop boundary

Hold acceptance of H pending bounded repairs/tests for R15-B1/B2, then freeze a new exact candidate for delta review. Preserve this historical verdict. No API/create receipt/adoption/recovery-service release is implied by the passing paths. R11/R12 and all earlier reviews remain unchanged; R12/R13/R14 have their separate bounded verdicts and limits, including R14's disjoint shell failures and pending browser evidence.

Only this exclusive R15 report was written for this packet. No product source/test/config/Git, managed server, browser, pane or permission mutation occurred; no new agent, external action, merge or deployment occurred. Actual browser Start approval remains pending and no workaround was attempted. Review work stops here as requested.
