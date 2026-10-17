# R16: independent Host/snapshot repair review

**Verdict: Accepted at H for the bounded Host/snapshot prerequisite. R15-B1 and R15-B2 are resolved. No blocking or new nonblocking source finding.** The historical R15 report remains unchanged as Changes needed at its original revision. This does not accept API creation, receipt/adoption integration or the disjoint combined-snapshot work.

## Exact binding and inspected inventory

- Actual manifest/Git H: `41b89ca06c655b8eecf397d637911a9ad9509a0e`.
- Tree: `7bd43d02ed248a0cdead7b56f33334f48e121a60`.
- Verified parent P: `143f0582b194bb4731df45039d85a128ee45b4dd`.
- Manifest `/private/tmp/lobby-map-host-repair-candidate.json`; ref `refs/heads/feat/lobby-map-host-recovery`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`; protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

The complete P..H delta is three files. All changed code/tests and their surrounding paths were inspected. Manifest H/tree/parent/inventory and all three SHA-256 values were independently checked against Git blobs and the scoped snapshot files:

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `server/src/game/host.ts` | `fe74e5257de9dba015c1e0ec2b3d35f5f787b6a9` | `9cd11c8629f1db4672ef1dc64c501cf337fbe2c2794323e37c9e5ef7bac34fdf` |
| `server/src/game/host-pin.test.ts` | `835799cf67b39ea47bb9ae8f5d1680dcf27d98e4` | `dd6edc9fa4439f883df72b0349b6ffd97accd91bccedddac3b7621931b67ec5e` |
| `server/src/game/snapshot-binding.ts` | `d99a4d084cbecf2ff7e930041535d71980b279f0` | `70c7a414ea824af71eadd1bdd5cd22ee0211ea280aa057ec4b8ceb79e8878f18` |

Unchanged R15 actor/store/SQLite, binding tests, native/header codecs and registry, replay helpers, legacy actor/clock/turn tests and server config were inspected or carried by unchanged Git content. Those named runtime/test dependencies plus engine/protocol sources match H in `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4`. No whole-snapshot identity is claimed: coordinator API/auth/creation/client work is outside this candidate. Native High verification is packet-supplied; no pane operation was performed.

## Resolution of R15-B1

Creation now reads the existing header irrespective of whether the incoming call supplies a pin. Any existing header requires a supplied native pin, exact full accepted-header equality and no prior inputs before the header-only retry may continue. A pin-less retry therefore cannot overwrite a known native allocation through MemoryGameStore's replace-on-save behavior. The original accepted header remains intact and no actor/snapshot is created on the refused path.

The permanent regression seeds the native header, attempts a pin-less/default create, requires conflict, and checks exact header preservation, absent snapshot and absent registered actor. The earlier matching-pin/no-input retry and conflicting assembly/input tests remain. Rejecting overwrite of an existing legacy header is also explicit in the unconditional existing-header branch; valid legacy create/open behavior continues to pass its regression suites.

## Resolution of R15-B2

Marker/header consistency checking still runs first. After deserialization, Host now requires either the native static check or `assertHistoricalWorld`, both before replay/progress advancement and afterward. The historical gate requires a present header, no native marker fields, the requested game ID, supported `hold-the-bridge` scenario, a non-coerced integer uint32 seed and matching world scenario/seed. Missing header or an unregistered alternative cannot become historical merely through marker absence.

Historical static data is then budgeted and positively compared with the known bridge: complete terrain identity, sides/HQs, victory configuration, starting-strength baseline and effective configured/default dial. Evolved time, positions and other legitimate runtime unit state are not compared with initial placements. This is a historical identity/static compatibility gate, not a general dynamic GameState validator.

The two new combined-loss tests remove the native snapshot binding, then respectively remove the header or substitute a contradictory legacy header. Both require rejection and no registered actor. These reproduce the original R15 failures directly rather than relying on a remaining native marker to trigger a different check. Independent direct seed/static probes below cover the final strict seed gate and additional compatible/incompatible historical cases.

The acknowledged information limit remains: complete deletion of all identifying markers plus a fully compatible historical-default substitution is intrinsically indistinguishable at this boundary. Neither the source nor this verdict claims universal detection of that case. Separately retained receipt/record evidence must prevent API fallback when it establishes a modern allocation; that integration is not accepted here.

## Independent checks actually run

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/host-pin.test.ts src/game/snapshot-binding.test.ts src/game/actor.test.ts src/game/pinned-header.test.ts src/game/sqlite.test.ts src/game/replay.test.ts src/game/clockInvariance.test.ts src/game/turns.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**108 tests / 8 files passed at final H; server noEmit typecheck passed.** Manifest/blob/snapshot/dependency comparisons and `git diff --check P H` passed. Typecheck sees the combined snapshot compilation unit without accepting or attributing disjoint files to H. Node emitted its experimental SQLite warning. No independent lint/build/full-root/CI/HTTP/browser/model run was performed; author lint and earlier green logs are not counted as reviewer executions.

Additional inline Node/assert probes imported matched source through in-memory TypeScript transpilation and used only isolated MemoryGameStore, FakeTime, stub parser and test actors, all shut down afterward:

- **Three repaired R15 reproductions passed:** pin-less retry rejects while preserving the native header and creating no snapshot/actor/timers; combined marker loss with missing header rejects; combined loss with contradictory legacy header rejects. Both recovery failures leave no actor or timers.
- **Sixteen historical rejection cases passed:** eight invalid seeds (`'1815'`, undefined, null, NaN, Infinity, negative, fractional and above uint32) with the world seed deliberately matched to the invalid value; changed terrain extent/attribute, HQ, victory duration, baseline strength and dial; foreign requested game ID; and an alternative resolved scenario despite a matching alternative header/world.
- **Four historical positive cases passed:** seeds 0, 17, 1815 and 4294967295 with matching header/world and known bridge statics, while time/position/morale evolved. This verifies inclusive seed boundaries without silently requiring the authored seed1815 or initial unit positions.

These are pure isolated test operations, not managed/task-server game creation or browser Start. They supplement rather than replace the permanent tests.

## Test effectiveness and carried coverage

Read `/private/tmp/lobby-map-host-review-red.log` directly. It records **3 assertion failures / 11 passes** at the supplied old source: each new case resolved a GameActor where rejection was required. That is detection of the actual downgrade behavior rather than a compiler/collection failure. The red revision/run is coordinator evidence; the reviewer did not mutate source or independently recreate a red run. The current full 108-test run is independent and includes the final seed guard.

The new tests retain all previous assertions and check persistence/registration outcomes, not just exception text. The seed/static variant coverage above is independent inline evidence, not falsely described as additional checked-in regressions. Prior R15 passing coverage for full-header digest retention, SQLite marker readback, delayed registration, failure cleanup, pending close/shutdown, native dial/manual-turn behavior and legacy clocks carries by unchanged source plus the current actor/clock/turn/replay/SQLite runs. No new lifecycle implementation was introduced by this repair.

## Acceptance boundary and preservation

Accept the exact repaired Host/snapshot prerequisite at H. No further repair is required for R15-B1/B2. API receipt ownership/adoption, authoritative allocation/record checks, rate/effective-intent retry binding and public/live-rendering integration remain separate gates. This result does not expand the Host into a terminal admission-lock contract or certify whole-product completion.

Only this exclusive delta report was written. Historical R15 SHA-256 `67ac5d010b833398930096c5b15ab37a58ff80ae05e4dcf8efb79e3ff2b1dcdc` was checked unchanged; all earlier reviews remain unchanged. No product source/test/config/Git, managed server/browser/game, pane or permission change occurred; no new agent, external action, merge or deployment occurred. Actual browser Start approval remains pending and no workaround was attempted. Review stops after this packet as requested.
