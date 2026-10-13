2026-10-12. **CI artifact audit complete: run 38319019440, attempt 1, completed successfully for exact head c387.** All three ordinary validation jobs, the selected effectiveness job and the final check gate succeeded. All four downloaded artifact ZIPs match GitHub's expected SHA256 digests and sizes. No artifact/source-provenance discrepancy was found. This is CI evidence acceptance for the pinned run, not A5 self-acceptance, final documentation/browser acceptance or merge readiness.

Run: [CI 38319019440](https://github.com/exterkamp/kriegsspiel/actions/runs/38319019440). Assigned draft: [PR #362](https://github.com/exterkamp/kriegsspiel/pull/362). Read-only API observation captured at `2026-10-12T22:55:37.815702+00:00`; run started `22:51:31Z`, final API updated `22:54:34Z`. The initial live observation had application pending; it completed during downloads. No unavailable/pending CI gate remains in this observed run.

User supplied freshly verified native GPT-6.1-Sol/high dispatch provenance. No pane/model verification was performed. Work used read-only gh/API, pinned Git objects, downloaded ZIP/JSON/log data and hashing. No application/tests/probes were executed locally; no source/test/config/Git/PR/comment/approval/merge/browser/runtime/pane/agent operation was performed. Writes are limited to this report and the dedicated `angular-a5-c387-ci-audit/` downloaded evidence directory. The first sandboxed API calls could not connect; authorized read-only network access then succeeded, with no automatic-review rejection.

**Actual source records and the moving base.** All three ordinary checkout.json records and the effectiveness checkout record are identical, SHA256 `a7902bad5d73a8d08143d4704cc34d8e4dabea09e2182ea4cf3d242100cf3789`.

| Record field | Actual value |
| --- | --- |
| head / actualHead | `c38727836520003bfe5d5419917fa465d7abbae3` |
| headTree / tree | `e1fe9818f07cac1edb866b2ef297d00fbcd67279` |
| event base | `3454ac4479b979e64ad767d7a3a4aa48baf7b5fb` |
| baseTree | `4e67ccdbf3bb8b3bece1a73295a7fa993e22a076` |
| mergeBase | `68bea3420e6aa5d1584597afc781d1a9b61e9356` |
| mergeBaseTree | `49dfa417c9e041506b7de2bde5219534ad92aaea` |
| Node | `v22.23.3` |

Independently compared head/base/merge-base trees and the actual merge-base computation with local read-only Git objects. The run API head_commit tree, run head SHA and every artifact workflow_run head SHA agree. Node agrees with pinned `.nvmrc`; npm installation/result records identify 10.9.7.

**The assignment's integration base remains 68bea34, but the actual event base is already 3454ac4.** These are distinct recorded facts, not a checkout mismatch. Workflow explicitly checks out the candidate head, rather than a synthetic PR merge tree. Therefore success tests c387's tree; it does not prove that the newer main delta has been integrated or reviewed. No claim is made that current main stays fixed. Root owns fresh incoming compatibility, head/base/mergeability and readiness checks; a later documentation/source head needs fresh head-bound evidence.

**Complete inventory verification.** Effectiveness `source-inventory.json` has **971 exact tracked regular Git entries: 970 mode 100644, one mode 100755 (`server/backup-loop.sh`)**. Compared the complete inventory/path set with `git ls-tree -rz c387`, including every mode and blob ID, computed SHA256 from every Git blob, and independently recomputed each Git blob SHA1 with its blob header. All 971 match; no missing/duplicate/extra source entry, symlink or submodule appears. Source-inventory SHA256: `7ce29e833d922c45ad849e480564416ccc2983b0a619ed26dc3e0aa402a7993f`.

Canonical before/after snapshots are byte-identical, SHA256 `5f24b4f767142ff252fb23ba183d678571b2011aeae9c8c0693c6465e7cf6a49`; both show c387 and empty tracked status. Their 972 entries consist of the same 971 source entries plus `.git` recorded as a directory (mode 0755), not a source discrepancy. All source SHA256 and filesystem modes agree with the pinned inventory. This demonstrates the recorded effectiveness checkout remained unchanged. Ordinary artifacts each contain only checkout.json: they bind their initial checkout head/tree, but do not independently provide a post-test complete filesystem inventory. Do not overstate that artifact coverage.

The prior incoming-current report is preserved, SHA256 `282898d01d645e52f0fc0bf1229b3f020b35ee1b7335a18564d47b7fcbe6d120`; prior 27-path c387 inventory is preserved, SHA256 `995fad6e400458703f18808abdc0c36e3b9691696196fc117cb5f60d46553652`. This audit does not reopen or self-accept owner/effectiveness feature bytes.

**Artifact ZIP integrity.** Downloaded via the authorized run/artifact API. For every ZIP, independently computed SHA256 and byte count equal GitHub's artifact metadata; expired=false, run=38319019440 and head=c387. Safe member paths were inspected before extraction. “Verified” below means downloaded ZIP digest equals expected API digest, not merely an extracted file hash.

| Artifact | ID | ZIP bytes | Expected = actual SHA256 | Result |
| --- | ---: | ---: | --- | --- |
| `hq-ordinary-maps-38319019440-1` | 11778045727 | 378 | `bd6170b6d835754c1dca092f577c384ce6b2fac7bfa6d71b03cc06854e263574` | Verified |
| `hq-ordinary-static-build-38319019440-1` | 11777849578 | 378 | `df8db85926610bc7d9f907102c9dc6dbc5aa097e683fbf90acb306979d67099b` | Verified |
| `hq-effectiveness-38319019440-1` | 11777619735 | 254173 | `f1a54c2fcf39a5492f86c4cdc7b76e743087a9ac8ab447e9645bd07060ec57e2` | Verified |
| `hq-ordinary-application-38319019440-1` | 11776829913 | 378 | `818c93582dfac9f92ddeb4608400cc05cb07ca7064ac7996c912cc6e894190ce` | Verified |

Ordinary ZIPs each contain one checkout.json. Effectiveness contains 79 members: checkout record, manifest, complete source inventory, canonical snapshots, summary and per-case original/mutated/recipe/result and raw phase/process/errors/Vitest/stdout/stderr evidence. Final run logs ZIP (145,359 bytes, 61 entries) is also retained; it has no expected artifact digest in this API listing and is not misrepresented as one of the four digest-verified artifacts.

**Actual pipeline and ordinary gates.** Read pinned `.github/workflows/ci.yml`, root scripts and actual API/log step records. Pipeline SHA256 `a3a4f4d65bc67f90962d17cfda296a87027db20713ad9a122f751b449afb928e` matches the complete inventory. The three matrix jobs each have a separate full-depth candidate checkout, exact source record, pinned Node/npm, map-source bootstrap and npm ci. Static-build runs root lint, typecheck and build; maps runs verify-map-source/maps/catalog suites; application runs verify-map-source/engine/protocol/server/client plus repository tests. Actual step and log evidence matches this split.

| Job | Job ID | Actual required work | Conclusion |
| --- | ---: | --- | --- |
| validation (static-build) | 115042400007 | setup-map-source, npm ci, lint, typecheck, build | Success |
| validation (maps) | 115042400091 | setup-map-source, npm ci, test:ci-maps | Success |
| validation (application) | 115042400022 | setup-map-source, npm ci, test:ci-application | Success |
| test-effectiveness | 115042399773 | exact source, selected isolated mutation transactions | Success |
| check | 115043250474 | requires validation=success AND effectiveness=success | Success |

No required job was skipped/cancelled. Matrix conditional skips are expected: static-build skips two other test commands; maps and application each skip four other group commands (10 skipped step slots total). The final cancellation guard skips because the run was not cancelled; its always-running success gate executed, and raw check log explicitly records both dependency results as success. Workflow's artifact upload uses always() and warn-on-missing, so upload success alone is insufficient; the four actual artifacts were separately inspected above.

| Ordinary test segment | Passing files | Passed tests | Skipped tests |
| --- | ---: | ---: | ---: |
| maps | 28 | 262 | 0 |
| local map catalog | 2 | 21 | 0 |
| engine | 18 | 390 | 0 |
| protocol | 1 | 64 | 0 |
| server | 55 | 812 | 3 |
| Angular client | 39 | 560 | 0 |
| plain client Vitest | 50 | 826 | 0 |
| repository Node tests | n/a | 52 | 0 |

Counts come from the downloaded job logs. All reported tests have zero failures. The three server skips are known opt-in cases: one `live Ollama` schema-valid output case in providers.test.ts gated by OLLAMA_LIVE; two side-parameterized real-model leak cases in leak.test.ts gated by LEAK_REAL_MODEL. Their pinned declarations and run summaries agree. Real-model behavior was not exercised. Matrix command skips, these three ordinary tests, and probe selection skips are separate counts.

**Effectiveness evidence and its exact limit.** Inspected the manifest, result/case/phase/process/error/Vitest records, captured original/mutated bytes and pinned runner/result/classification source. Manifest is byte-identical to c387 `test/review/hq-mutations.json`, SHA256 `2d4a865ae24590948779cdd722c037207a887f33e7ec28a4ea91c0ed956b3655`; report SHA256 `07ebf94a7e5098ead7e7473b2c447140b810627397381810c17a467001d26d10`. Runner/run-mutations, process, results and capture-reporter hashes all independently match their Git bytes. Package-lock SHA256 is `93f944c87ed233914c2bb9abd299bf4fda1ec196e92b4e93199742a498326227`.

All three cases target unchanged legacy `client/src/legacy/table/gameTime.ts` / gameTime.test.ts. They are **not A5 owner/native-modal/session mutation probes**:

| Probe | Designated failure at mutant | Baseline / mutant / restored |
| --- | --- | --- |
| game-time | 1ms loss at safe-integer boundary; gameTime.test.ts:67:28 | 0 / 1 / 0 exit codes |
| invalid-time | negative input formats instead of unavailable; :74:37 | 0 / 1 / 0 |
| hours-beyond-24 | 25:01:01 wraps to 01:01:01; :19:35 | 0 / 1 / 0 |

For every case, verified pinned source/test SHA256, exactly one recipe replacement, captured original/mutated bytes and corresponding hashes, unchanged tests/restored inventory, exact selected identity and expected assertion message/location. Each of nine raw phases matches the summary and raw process JSON: one selected test ran (baseline/restored pass; mutant fails), **51 other collected tests intentionally skipped per phase**, zero retries/repeats, no timeout/interruption/signal, children reaped/process group absent, zero collection/hook/unhandled errors. Raw Vitest counts independently agree. No selected test was skipped. Those selection skips are not missing ordinary coverage; the ordinary client suite ran separately.

Overall classification is detected, three cases run, notRun empty, retries zero, canonicalUnchanged true, scratchPreserved false and interrupted false. Map bootstrap and isolated `npm ci --ignore-scripts --no-audit --no-fund` returned zero; map artifact metadata matches pinned vendor snapshot and actual output, source inventory is reported unchanged, and link inspection records no escaping links. These are the recorded CI transactions; nothing was rerun locally.

**Disposition and remaining gates.** There is no unresolved CI artifact or ordinary-job gate for this exact observed c387 run. This does not clear prior upstream staff/combat/trace findings merely because suites passed, establish genuine browser/worker/modal/layout/production isolation behavior, validate whole A5 effectiveness, or accept final documentation. I previously authored A5 owner/effectiveness bytes; G's independent feature review remains necessary. Root owns the newer-main compatibility and final head/base/CI/merge-readiness disposition. Later documentation/source changes require fresh head records and checks; this run remains evidence only for c387.

Raw evidence is retained under `angular-a5-c387-ci-audit/`: initial/final run/jobs/artifact API JSON, observation timestamps, all four original artifact ZIPs/extracted records and final logs ZIP/extracted logs. Final metadata SHA256: run `3ba98ebede24f8f752f5968a122edf25a634b90326b804d49800af05c61ed867`; jobs `060a109080e7523d882bcbed20a08b0373414fa864219e621038549066069444`; artifacts `07b6acf04663be25009e392c310f60e656c7cbd8d3883bb488d47598f334e91b`.
