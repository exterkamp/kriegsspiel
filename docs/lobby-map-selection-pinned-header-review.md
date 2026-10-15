# R11: independent pinned-header, storage and replay review

**Verdict: Changes needed at H. One blocking finding, R11-B1.** The focused suite passes and the pin/header/replay boundaries otherwise support this prerequisite, but SQLite can silently replace a native game's saved settings with defaults when a non-null settings column contains an empty string. This must fail visibly before dependent consumers rely on native readback. No source repair was made by the reviewer.

## Exact revision and complete inventory

- H: `693394d67709396c6ca4282668ab302ce2d758e4`.
- Tree: `2a41102e1ae6946586c45f6427a430f9d8067e7c`.
- Verified parent P: `e0644f57194e5610b0efe5da3e7029d0f8dcea98` (accepted renderer restack).
- Manifest: `/private/tmp/lobby-map-header-candidate.json`, ref `refs/heads/feat/lobby-map-pinned-replay`.
- Canonical repository: `/Users/dominic/code/kriegsspiel-game-init-landing`; HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

Independently verified H/tree/parent, the complete eleven-path delta, every manifest SHA-256 against its H blob, and all seven listed server files against the execution snapshot. Full changed source/test bodies and relevant surrounding code were inspected:

| H path | H blob |
| --- | --- |
| `server/src/game/pinned-header.ts` | `19c100af6eec20c94a3486f3f04ba775570b0104` |
| `server/src/game/pinned-header.test.ts` | `04dc63245cc2f97096e26052d85b783dee405996` |
| `server/src/game/store.ts` | `069bc4ed957a3ee66d4b037032f66e613840aa25` |
| `server/src/game/sqlite.ts` | `4ab43c87fe47a942028e24d3358e7555f9cc4d47` |
| `server/src/game/replay.ts` | `9dcf92750514e900283ca44fbf9b0e37a8d60244` |
| `server/src/game/replayCli.ts` | `4c98c31b24e8ada5198b96b736a2f36a76e895ac` |
| `server/src/admin/replayView.ts` | `2bc7ff525b41d5ee6aec3218da941830bdecf827` |
| `docs/decisions.md` | `fb144dd292dc2e700949a3c991902a910c09b9c9` |
| `docs/lobby-map-selection-native-tests-review.md` | `afdc009422a27f5540d0143b0d07708ab5976b43` |
| `docs/lobby-map-selection-render-review.md` | `8a0a358d940fee754a2cb5ee45c40019df9eeb10` |
| `docs/lobby-map-selection-execution-log.md` | `be919ec099c41839ce2853ab860776c398ac13f8` |

Complete client/packages trees are unchanged from P. Snapshot engine/protocol sources, accepted native pin/registry and retained input implementations, unchanged SQLite/replay/admin regression tests, registry/advance helpers and server test/compiler configuration were compared with H. GameHost creation/reopen and current replay callers were read for boundaries; their actor/API integration was not demanded or accepted here.

The snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` also contains disjoint borrowed auth/lobby changes, coordinator creation-intent/store modules and a separate writer fetch helper. No whole-snapshot identity or review is claimed. Earlier reports were not edited. Native High verification is packet-supplied; no pane inspection was performed.

## Blocking finding

**R11-B1 — native SQLite settings corruption silently becomes a different replay configuration.** Location: `server/src/game/sqlite.ts:201`, in `SqliteGameStore.logHeader`.

The readback spread uses `r.settings ? ... : {}`. A non-null empty TEXT value therefore skips JSON parsing and the strict native settings schema. Because settings are optional in the header, `detachedInputHeader` accepts the reconstructed native header with settings absent. A stored game that used dial `free` then replays using effective dial `standard`. This is a silent semantic substitution rather than visible corruption failure; it affects this packet's implemented SQLite/native replay path independently of any future actor/API wiring.

Independent reproduction, using only a temporary review SQLite database:

1. Save a valid native Open bridge header with `settings: { dial: 'free', persona: 'dry' }` and intact format/pin.
2. Update only that row's settings with `UPDATE games SET settings = '' WHERE game_id = ?`.
3. `await store.logHeader(id)` succeeds and returns `settings === undefined`.
4. `replayLog(read, initialWorldFromHeader(read), entries, registry, until, startingState)` succeeds with effective dial `standard`; the original header's replay has dial `free`.

The independent probe observed precisely `originalDial: 'free'` and `recoveredEffectiveDial: 'standard'`. No managed/task database was touched. The existing green tests cover pin-column corruption but do not cover this settings case.

**Required bounded correction:** distinguish SQL NULL (the supported optional-settings representation) from non-null stored settings for native rows. Parse/validate every non-null native value, including the empty string, and fail on malformed JSON or invalid schema instead of omitting it. Preserve intended legacy behavior explicitly if compatibility requires it. Add a permanent regression proving empty native settings reject on store/admin readback, valid nondefault settings survive, and intentionally absent optional settings still round-trip. Include malformed/schema-invalid/oversized settings cases as appropriate to the same gate. No transaction/actor redesign is required for this correction.

## Other source assessment

**Native marker and identity.** Own-property presence of format, pin or receipt identity routes through the strict native header decoder. Missing/unknown format, missing/corrupt pin, invalid receipt UUID, unknown header/settings fields and seed/resolved-scenario disagreement reject. Receipt identity is optional; when present it requires the complete native header. `headerPin` also checks an independently supplied expected game ID, and the admin loader passes its requested ID. Receipt syntax does not establish receipt ownership/allocation agreement, which belongs to later creation integration. Presence checks cannot by themselves detect all marker columns being deleted; later new-format record/lobby bindings remain necessary.

**Pin validation and detachment.** Native decoding uses the accepted strict resource-bounded raw/world/public/digest codec. Memory writes/readback clone accepted data. File writes validate/detach before their first `await mkdir`, so subsequent caller mutation cannot alter accepted bytes. SQLite validates/detaches before its synchronous insert. The private pin is retained without projecting its raw/world fields into a public API. The new tests check mutation during file-write suspension and mutation of returned data. This accepts private storage mechanics, not a public transport channel.

**Readback bounds.** Modern in-memory headers have a2MiB JSON/structural gate; the embedded pin retains its1MiB gate. JSONL checks first-line UTF-8 bytes against2MiB before `JSON.parse` of that line. SQLite computes pin/settings byte lengths and uses SQL CASE to avoid returning oversized pin/settings payloads to JavaScript; limits are1MiB and16KiB respectively. It rejects oversized values before parsing, and pin decoding enforces additional structure/identity limits. Apart from B1, null/missing/inconsistent native pin columns fail instead of resolving the default.

The JSONL limit is a header-parse limit, not a new streaming/file-memory bound: existing FileGameStore/CLI code still reads the whole log and `parseInputLog` splits the supplied text before checking the header. This packet does not establish a bounded total log reader. Low-level file parsing also does not bind the header game ID to a filename; native consumers with a requested game ID must use the provided expected-ID check, as the admin loader does. These are explicit integration/legacy-reader limits, not claims that this prerequisite completes actor recovery.

**Migration and compatibility.** The existing seven migrations remain byte-identical; one migration appends nullable format/pin/receipt columns. The existing migration transaction and user_version handling are unchanged. Independent opening of an actual parent-version database upgraded7→8 while preserving its legacy header/settings and log entry and leaving all three new columns NULL. Valid legacy headers still use the historical scenario lookup; unknown ordinary scenario IDs fail. Existing SQLite plain INSERT and file `wx` preserve non-overwrite behavior. MemoryGameStore's pre-existing replace-on-save semantics remain; this packet does not implement receipt/idempotent allocation policy.

**Replay and recovered statics.** Direct native `replayLog` requires exact canonical pre-runtime world equality with the decoded pin before applying header settings and initialization. CLI/admin initial-world loading resolves the pin without depending on alternative catalog availability. Legacy replay retains the previous registry path. The static recovered-world helper checks scenario/seed, full terrain identity, sides/HQs, victory configuration, start-strength baseline and effective dial while permitting evolved time/unit state. This helper is not a complete dynamic snapshot validator and is not wired into GameHost/replayFrom recovery yet. No activation/recordOf/lobby/header reconciliation was inferred as complete.

## Tests and independent checks

Pinned Node **v22.23.3**, from snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/pinned-header.test.ts src/game/sqlite.test.ts src/game/replay.test.ts src/admin/replayView.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**41 tests /4 files passed; non-emitting server typecheck passed.** Manifest/source/dependency comparisons and `git diff --check P H` passed. Typecheck sees the combined snapshot compilation unit without attributing disjoint files to H. No independent lint/build/full-root/CI result is claimed. Node emitted its SQLite experimental-feature warning.

New pinned-header tests are pure storage/engine/admin-loader calculations without HTTP or actors. The independently run unchanged regression files additionally use their existing isolated FakeTime hosts and Fastify injection. No real task-server HTTP/browser game, managed actor or existing preview/data was created or controlled.

The tests meaningfully exercise async detachment, durable SQLite reopen, legacy fallback, marker/seed/scenario contradictions, static terrain rejection, exact direct-replay initial state and oversized JSONL/pin columns. Their static-world mutation coverage is narrow (map width and moved units), settings corruption is absent, and the JSONL size test does not instrument parser invocation. The source confirms the pre-parse gate, and the independent probes below broaden agreement/compatibility checks. No source mutation/red run was performed by the reviewer.

Additional inline Node/assert probes used matched source with in-memory TypeScript transpilation. Temporary log/SQLite fixtures were removed in `finally`:

- **Seven strict-header rejections passed:** bad/present-undefined receipt, unknown settings/header fields, missing format/pin and string seed.
- **Three default/no-receipt store round trips passed:** memory, JSONL and SQLite, supplementing the suite's alternative/receipt cases.
- **Seven recovered-static rejections passed:** seed, scenario, terrain attribute, HQ, victory duration, per-unit starting strength and dial. An evolved time/position/morale case passed.
- **Real parent migration7→8 passed:** imported the parent SQLite implementation in memory, wrote a legacy header/settings and entry, closed it, opened the candidate, checked preserved values and NULL native columns. The prior migration-array prefix was compared exactly.
- **Native CLI/admin/direct replay agreed:** an Open bridge native header with dial `free`, no receipt and two logged bridge orders replayed to30 game minutes. Admin and direct paths matched complete engine state and all25 emitted events with nonzero delivery/combat; the actual CLI module read a temporary JSONL file and its `--json` result matched complete JSON engine state. No parser/model/HTTP/actor was involved in that probe.
- **B1 reproduced:** a separate temporary native SQLite row with empty settings was accepted and changed the effective replay dial as described above. This observation is a confirmed defect, not a passing acceptance test.

The first inline probe attempt used a nonexistent `startStrength.blue` test key, producing NaN and an earlier nonfinite-value rejection instead of the intended static-mismatch error. Correcting only the probe to the actual per-unit key `startStrength['blue-1']` produced the seven static checks above. Product source was unchanged; this was a reviewer-fixture correction.

## Required delta and remaining boundary

Hold acceptance of H pending R11-B1's bounded readback correction and permanent regression. Re-review the exact repair revision and rerun the affected header/storage/replay checks; do not rewrite this historical report into a pass at H.

No additional source blocker was found. Actor/API consumers, lobby/header/receipt agreement, recovered snapshot integration, idempotent activation and all live/render compatibility gates remain separate work and were neither demanded as part of this prerequisite nor accepted as implemented. Earlier R7–R10 source verdicts and renderer limits remain unchanged.

Only this exclusive report was written. No product source/test/config/Git, managed server, browser, pane or permission change occurred; no new agent, external action, merge or deployment occurred. Actual browser Start approval remains pending. No attempt or API workaround was made.
