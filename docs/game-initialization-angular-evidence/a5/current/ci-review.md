# Exact-head CI artifact audit: PR362 / 3d787b6

**Complete: run 38321508158, attempt 1, all five jobs completed successfully for the exact requested head.** No checkout/source inventory, artifact digest, ordinary gate or selected probe discrepancy was found. This accepts the CI evidence for the pinned run only. It grants no A5 feature self-acceptance, native media/browser/final-documentation acceptance or ready/merge claim.

Run: [CI 38321508158](https://github.com/exterkamp/kriegsspiel/actions/runs/38321508158). Draft: [PR362](https://github.com/exterkamp/kriegsspiel/pull/362). Final read-only API observation: `2026-10-12T23:29:42.368982+00:00`. Run created/started `2026-10-12T23:19:17Z`, updated `2026-10-12T23:21:33Z`; event `pull_request`, workflow `.github/workflows/ci.yml`. The final PR API observation reports open/draft=true, head H and base B below. This is a time-bounded observation, not a guarantee that remote main or PR head stays fixed.

Root supplied fresh native GPT-6.1-Sol/high footer verification before dispatch. No pane/model inspection occurred here. Reused the prior c387 audit method, but independently inspected the current remote records, original ZIPs, extracted data, raw logs and pinned Git objects. Sandbox-only network access initially failed; authorized read-only elevated API/download calls succeeded without automatic-review rejection. No application test/probe/check was rerun; no source/config/test/Git/PR/browser/runtime/pane/agent mutation occurred. Writes are limited to this report and its new dedicated evidence directory.

## Head, base and checkout provenance

| Record | Exact value |
| --- | --- |
| H / head / actualHead | `3d787b66cffb475f543c09a72cbb682c2e231038` |
| H tree / headTree / tree | `ed8994d2ca153fcb8be2606869122e56c4dbb2f5` |
| B / event base / mergeBase | `36406f70c485e7f23befb9f9b9e27fdfbd4c32e0` |
| B tree / baseTree / mergeBaseTree | `46006d6f67ed45d313b2b9c2125e33f0b78ecd78` |
| Node / npm | `v22.23.3` / `10.9.7` |

All three ordinary `checkout.json` records and the effectiveness `hq-effectiveness-checkout.json` are byte-identical (485 bytes), SHA-256 `45e8b5727ddea500f21219f552cfa48ce34e902e8921e2a2d8866f6fbe67ff01`. Independently compared full head/base trees and the merge-base computation with read-only local Git, the run API head_commit/tree, every artifact's workflow_run head/run identity, final PR head/base and immutable GitHub Git-commit records for H/B. All agree. Node matches H's `.nvmrc`; installation/process evidence records npm10.9.7.

Unlike the earlier c387 run, the actual event base and integration merge-base both equal the assigned B. The pinned workflow explicitly checks out H, not GitHub's synthetic PR merge commit. The audited tree is H's source; no synthetic merge-tree acceptance or remote readiness is inferred.

## Four artifact ZIPs

Downloaded the exact four assigned IDs through the artifact API. Every artifact is unexpired, belongs to run38321508158/headH, and its downloaded ZIP byte count and computed SHA-256 equal GitHub's expected metadata. Validated member paths and excluded traversal/absolute paths/symlinks before extraction.

| Artifact | ID | ZIP bytes | GitHub expected = downloaded SHA-256 | Result |
| --- | ---: | ---: | --- | --- |
| `hq-ordinary-application-38321508158-1` | 11779320293 | 333 | `2601a64b36314ed0f44eb0525347ed48f4f6062e3340d757ca7d57aca33b43d8` | Verified |
| `hq-ordinary-static-build-38321508158-1` | 11779275356 | 333 | `f8b61d7136788a8203c8f489a60c6ccaf1cc8562c19389cfa34a2109a4d1e5a1` | Verified |
| `hq-effectiveness-38321508158-1` | 11779148650 | 257814 | `16cb55f72fa103946a77992c622d32b5dac42763100701ca87f642c31aad51db` | Verified |
| `hq-ordinary-maps-38321508158-1` | 11779012676 | 333 | `f8b61d7136788a8203c8f489a60c6ccaf1cc8562c19389cfa34a2109a4d1e5a1` | Verified |

Each ordinary ZIP contains just its checkout record. Effectiveness contains 79 members: checkout, manifest, complete tracked source inventory, canonical snapshots, report and each case's recipe/result/original/mutated bytes plus raw phase/process/errors/Vitest/stdout/stderr evidence. Final logs ZIP contains 61 members and 145,454 bytes, computed SHA-256 `4ae25422e9e693fdba1ce6302590903e0ba51e39c6ce9252f045cdcab97c96aa`. The logs download has no expected artifact digest in the artifact API list; it is not counted as a fifth digest-verified artifact.

## Complete tracked source inventory

Effectiveness `source-inventory.json` contains **992 exact tracked regular Git entries: 991 mode100644 and one mode100755 (`server/backup-loop.sh`)**. Compared the complete path set against `git ls-tree -rz H`: no missing, extra or duplicate paths. Independently checked every mode/blob ID, SHA-256 over all992 Git blobs and reconstructed every Git blob SHA-1 using its type/size header. All992 agree; no symlink/submodule or mode discrepancy is present.

Inventory SHA-256: `f0093f8401305bbab3a8fd2d5a2d5f54d6bed703f9504d215520832f4946bf82`. Canonical before/after snapshots are byte-identical, SHA-256 `42f7b93803bb90c36db2b28068afccc7cbb299208b4f23eb97a1a1b268551823`, and both show H with empty tracked status. Their993 entries are exactly the992 tracked source entries plus `.git` as directory mode0755; every source SHA-256 and filesystem mode matches the pinned inventory.

This verifies complete **tracked** source provenance and the recorded effectiveness checkout's before/after preservation. Ignored dependencies, generated map packages, build output and emitted/browser module bytes are not this inventory. The ordinary artifacts provide their initial checkout records, not independent post-test whole-filesystem inventories. Do not infer ordinary filesystem restoration or browser/source bindings from those one-file artifacts. No tracked native media was visually reviewed merely because its Git hash matched.

## Actual pipeline and ordinary results

Read H's actual `.github/workflows/ci.yml` and package scripts, compared API steps and downloaded raw job logs. Workflow SHA-256 `a3a4f4d65bc67f90962d17cfda296a87027db20713ad9a122f751b449afb928e` matches Git/inventory and is byte-identical to the previously audited c387 workflow. Each ordinary matrix job has its own full-depth H checkout, source record, pinned Node/npm, map-source bootstrap and npm ci. Scripts remain split into maps and application groups; static-build runs root lint/typecheck/build, including sidecar/worker-related compilation through the pinned scripts.

| Job | Job ID | Executed required work | Conclusion |
| --- | ---: | --- | --- |
| test-effectiveness | 115050430996 | pinned source, isolated selected mutation transactions | Success |
| validation (static-build) | 115050431231 | setup:map-source, npm ci, lint, typecheck, build | Success |
| validation (maps) | 115050431252 | setup:map-source, npm ci, test:ci-maps | Success |
| validation (application) | 115050431375 | setup:map-source, npm ci, test:ci-application | Success |
| check | 115051027420 | requires validation=success and effectiveness=success | Success |

All five jobs and all required selected commands completed successfully. Ten matrix step slots are intentionally skipped (2 static-build,4 maps,4 application), and the final cancellation guard is skipped because the workflow was not cancelled. The final always-running gate executed; its raw log records both dependency results as success. Artifact upload's `always()`/warn-on-missing policy is not itself a check result; actual artifacts were separately verified.

Downloaded logs provide these current executed test summaries:

| Ordinary segment | Passing files | Passed tests | Skipped tests |
| --- | ---: | ---: | ---: |
| Maps | 28 | 262 | 0 |
| Local map catalog | 2 | 21 | 0 |
| Engine | 19 | 408 | 0 |
| Protocol | 1 | 64 | 0 |
| Server | 57 | 885 | 3 |
| Angular client | 39 | 563 | 0 |
| Plain client Vitest | 50 | 826 | 0 |
| Repository Node tests | n/a | 52 | 0 |

No failure is reported in these summaries. Current server logs specifically include `injection.test.ts`67 tests; that observed pass count does not resolve the bounded missing retry-confidentiality coverage noted in the incoming injection report. Ordinary client logs include the full52-case legacy game-time suite independently of the selected probe runs. A5 suite execution is reported as CI evidence only; the author does not independently accept their feature/test implementation from that result.

The three server skips are the same opt-in boundaries, independently verified at H: providers.test.ts545–547 gates one live Ollama schema-valid case behind OLLAMA_LIVE; leak.test.ts305–306 gates the two SIDES real-model cases behind LEAK_REAL_MODEL. Actual logs report providers49 total/1 skipped and leak28 total/2 skipped, agreeing with the server888 total/885 passed/3 skipped summary. Real-model behavior was not exercised. Matrix skips, ordinary real-provider skips and probe selection skips are separate counts.

## Selected HQ probes and raw phase audit

The current manifest is byte-identical to H `test/review/hq-mutations.json` and the c387 manifest; SHA-256 `2d4a865ae24590948779cdd722c037207a887f33e7ec28a4ea91c0ed956b3655`. Current report SHA-256 `5fdafa7483db57699c7aa284112fb75e235876035297ca791ae07249bdf30fbf`. All four reported runner hashes independently match the pinned `scripts/review` Git bytes and are unchanged from c387:

| Runner | SHA-256 |
| --- | --- |
| run-mutations.mjs | `29d6063b83774bb057645209460cc115da2a5c6b412bb04334416b7868fe821c` |
| process.mjs | `44dd86a5bb820c6812c63e4e7bcf7a551307763936af6dc066230a8fadf78672` |
| results.mjs | `a4907c833cfa3cedf27400e6ed567979e1c93e01a5657291a8e5daf60f0c8789` |
| capture-reporter.mjs | `d9bc41a8f612b0c639e9fd3261e331c9760c8b5562c985fe3cc39cef566c25f5` |

Read the result classifier and extraction/restoration/selection boundaries in the pinned runner; no runner execution occurred. All three recipes target unchanged legacy `client/src/legacy/table/gameTime.ts`, not A5 owner, session or native modal bytes. Source SHA-256 `d77034896743a94f72de8222e467ab420ed58bad35c595ad3697a0a89bda9524`; test SHA-256 `ab23a74681fa50f5f8f2d3a149640b97353bc71f753b9f408181a365c22cef4c`.

| Probe | Designated mutant assertion | Baseline / fault / restored exit |
| --- | --- | --- |
| game-time | Safe-integer boundary loses1ms; gameTime.test.ts67:28 | 0 / 1 / 0 |
| invalid-time | Negative input formats as `-1:-1:-1` instead of `Time unavailable`;74:37 | 0 / 1 / 0 |
| hours-beyond-24 | `25:01:01` wraps to `01:01:01`;19:35 | 0 / 1 / 0 |

For every recipe, independently compared captured original bytes to pinned Git, checked exactly one `before` occurrence, reconstructed the recipe replacement and compared actual captured mutant bytes/hashes. Verified manifest/recipe/source/test identities, raw per-case result equality with the summary, recorded restored source/test hashes and `testsUnchanged`/`inventoryRestored` flags. No full scratch filesystem snapshot per phase is supplied; the independent full before/after snapshot comparison is the canonical checkout evidence above.

Independently cross-checked all nine raw phases across phase.json/process.json/errors.json/Vitest JSON and the summary. Reporter run IDs/pids and write/start times are bound to their process; all52 collected task identities and modes agree across phases and channels. Exactly one selected test runs per phase: baseline/restored pass; fault fails only the exact designated AssertionError with the expected message/file/line/column. **51 other collected tests are intentionally skipped per phase; no selected case is skipped.** Zero retry/repeat, collection/hook/unhandled error, timeout/interruption/signal or unreaped process/group remains in these records. All nine stderr files are empty; stdout records the corresponding JSON result path.

Overall: detected,3 cases, notRun=[], retries0, canonicalUnchanged=true, scratchPreserved=false, interrupted=false. Bootstrap and isolated `npm ci --ignore-scripts --no-audit --no-fund` both returned0, with clean process termination. Map setup's recorded expected/actual package and tar metadata match each other and the pinned vendor snapshot; recorded stdout confirms the same hashes/Node. The generated ignored runtime tarball is not included as a downloadable artifact here, so its actual byte digest is recorded runner evidence, not a locally rehashed tarball. Package-lock independently matches `93f944c87ed233914c2bb9abd299bf4fda1ec196e92b4e93199742a498326227`. Link inspection records zero escaping links, and pinned-inventory preservation is reported true. This is the CI transaction record, not a fresh local installation or mutation run.

## Disposition, preservation and limits

No unresolved CI artifact or ordinary/selected-probe gate remains for this exact observed H run. Passing suites do not clear prior incoming staff/combat/trace/lobby findings or the narration retry privacy qualification; no broader gameplay/security review was performed here. No A5 feature self-acceptance is granted: this reviewer previously authored A5 owner/effectiveness bytes; G's independent source/test qualifications remain separate.

Native media/browser proofs and final documentation review remain pending as directed. CI success does not prove actual worker/WebGL, resource retirement, focus/modal/contrast/layout, production absence, live preservation or whole-A5 mutation effectiveness. The three selected legacy formatting probes have precisely the assertion boundaries above. Root owns the final current head/base/main checks, pending reviews and remote disposition. Any later source/docs head needs fresh exact-head evidence; these records cannot be relabeled for it.

Previous reports/evidence were not overwritten. Rechecked preserved c387 audit SHA-256 `a121318f213901189a78a687bdddd0a35962f661ccac1ece8349a89abf493fff` and incoming injection audit SHA-256 `107008bb357b8ded0d6c7d476a7705eeca98e0595b245778631bb9da7e8a90dc`.

Raw current evidence: `.local/game-initialization-landing-evidence/angular-a5-3d787-ci-audit/`: initial/final run/jobs/artifacts/PR API JSON, immutable remote H/B Git-commit JSON, observation timestamps, all four original ZIPs/extracted records and final logs ZIP/extracted logs.

Final API metadata SHA-256:

- `run-final.json`: `56e94cd70128e20a8ae2de04f19f7b370a9a9df6696a1694aa42aa2770da7933`.
- `jobs-final.json`: `a3a641e2347502d69006f88bcf2d19d3a190a8b1eb972d5acff44d88ab79462f`.
- `artifacts-final.json`: `ca7ea4fcb0337fc738e6a03a233fbd5415bca1c820ac04898c6b63bda0cb245d`.
- `pr-final.json`: `4f55184811c489a8e6b017ee80617dbba09eddf1f85cccef3a431d965315d13e`.
- `head-git-commit-final.json`: `0a838b89e2a4acae89f9dd794125b7b8d56b9d48c915192ed4c86997df6a78e6`.
- `base-git-commit-final.json`: `7757ec58b1292159b6049d0cb3e2f8e9910e8dd2db5f45f711bb3582a49e20b4`.
