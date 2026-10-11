# Commit-specific review record template

Copy this template into external evidence or an authorized commit-bound review. Replace placeholders with observations; use **Pending / Not run / Not applicable (reason)** for missing evidence. Follow the [workflow](../review-workflow.md). This template supplies no acceptance verdict. Do not commit a purported final report naming the commit that contains it.

## Identity and scope

`[review r<N>] <full H>`

- Repository / PR / round / evidence run ID: <values>
- Scope: <bounded packet or complete declared PR scope; delivered behavior>
- Verdict: <Accepted / Changes needed / Inconclusive; justification>
- Authorization / exclusions: <implementation/publication authority; merge/deploy/closure limits>
- Independent reviewer: <agent identity, actual response/link, inspected scope>
- Effective model / effort: <selection, verifier and verification evidence; unknown if unavailable>
- Authors / operator / coordinator: <identities and exclusive paths; independence statement>
- Publishing account: <authenticated account, distinct from reviewer; pending if unpublished>

## Source pinning

| Identity | Full commit | Git tree |
| --- | --- | --- |
| Candidate H | <SHA> | <tree> |
| Accepted base B | <SHA> | <tree> |
| Merge-base M | <SHA> | <tree> |
| Ordinary CI checkout | <actual SHA> | <actual tree; equality proof or separate integration review> |
| Effectiveness CI checkout | <actual SHA> | <actual tree; equality proof or separate integration review> |

- Inventory command/range and NUL-delimited artifact/digest: <PR M-to-H / integration B-to-H; source objects>
- Hosted paginated inventory cross-check: <result/limit>
- Dirty/untracked records preserved: <inventory; preliminary source digests if inspected>
- Accepted prerequisites / integration resolution evidence: <revisions, automatic/manual merge inspection>
- Carry-forward evidence: <prior round, unchanged content identities and integration justification; none if fresh>

## Complete file matrix

Repeat rows for **every** changed file, including this workflow's tooling/docs, tests, config and assets. Identify rename source/destination, deletion objects and binary provenance. Assignment is separate from completed inspection.

| Path / change / category | Primary packet / reviewer; secondary concern | H / content digest (algorithm); prior object | Actual inspection | Criterion / ordinary-browser evidence / limits | Findings / repair / re-review |
| --- | --- | --- | --- | --- | --- |
| <file> | <one primary> | <identity> | <diff + context or provenance> | <observable claim> | <IDs or none observed> |

Inventory reconciliation: <method/artifact, candidate, total rows/files; missing / duplicate-primary / unexpected counts>. Full coverage gate: <pending/pass with evidence>.

## Ordinary and browser evidence

| Check / criterion | Exact command or browser steps | Tested source/tree / environment | Expected / observed result; counts/skips | Raw evidence |
| --- | --- | --- | --- | --- |
| <install/lint/types/tests/build> | <command> | <identity; Node/dependency versions> | <exit/counts/failures> | <log/run> |
| <visible interaction/layout> | <route, setup, input, steps> | <identity; fixture/live, origin, browser/OS, viewport/device> | <visible outcome; console/network findings> | <commit-bound screenshot/trace> |

Delivered fixture criteria: <verified scope>. Preserved live composition: <inspection/runtime evidence>. Remaining live integration, browser contrast/playthrough, device and performance criteria: <explicit pending criteria and applicable stories>. Unit/axe results do not establish these broader criteria.

## Selected effectiveness probes

Runner/CI status: <implementation revision, independent acceptance and actual positive/negative evidence; pending gates>. `review:mutations` invocation: <full H/B, manifest, unused outside-repo output directory>. Manifest path / SHA-256 / approval: <values>. Applicability or non-applicability: <reviewed risk/reason; no artificial docs/asset requirement>.

| Case / invariant / rationale | Source path/digest; exact before → after recipe | Selected test files/names; expected assertion; timeout | Baseline | Mutant | Restored | Classification / independent review |
| --- | --- | --- | --- | --- | --- | --- |
| <stable ID> | <unique valid replacement> | <identities/counts> | <result/report> | <assertion + all error channels> | <result/hashes> | <outcome + rationale> |

- Scratch source and isolation: <unique owned extraction from H, locked dependencies, no canonical source/dependency links or preview>
- Bootstrap: <setup command/cwd/process logs, pinned inventory and tarball integrity, or explicit verified legacy absence; cancellation/reaping before install>
- Fresh reports and test identity/count stability: <per-phase paths/digests, nonzero counts>
- Structured error capture: <actual reporter/schema plus collection/hook/unhandled channel; missing information means inconclusive>
- Restoration: <original/restored hashes, cleanup evidence; timeout/interruption process/child termination and reaping before restore>
- Classifier review/tests: <invalid/unmatched, zero/wrong/changed tests, stale reports, unrelated failure, expected assertion failure plus unhandled error, timeout/interruption, restoration failure, canonical source unchanged>
- CI positive and controlled negative run: <URLs/artifacts, actual failure propagation; pending if not demonstrated>

Use **Detected** only for passing baseline/restored runs and the expected assertion failure with matching selected tests and no other errors. **Survived** opens a coverage finding. **Invalid/unmatched**, **Inconclusive**, **Restore failed**, and independently justified **Equivalent** never count as detection. Expected failure plus unhandled error is inconclusive. Stop after restoration failure and retain all failure evidence.

## Findings, repairs and re-review

| ID / severity / behavior | Missing criterion/assertion | Owner / released paths | Repair revision / checks | Independent re-review / disposition |
| --- | --- | --- | --- | --- |
| <finding> | <observable gap> | <owner> | <revision + original/mutant/restored and ordinary evidence> | <reviewer response; blocking/open/resolved/accepted non-blocking rationale> |

After a failed substantive repair: <invariant/test reassessment before retry>. Non-blocking follow-ups: <existing issue links and rationale; no implied closure>. Blocking gate: <pending/resolved with evidence>.

## Evidence access and final handoff

| Bundle / record | Source + manifest identity / bundle SHA-256 | Location / collaborator access verification | Retention / actual expiry |
| --- | --- | --- | --- |
| <raw baseline/mutant/restored logs, errors, hashes, commands, versions, timings/retries; include failures> | <digests> | <CI artifact/run or authorized archive; local staging explicitly labelled> | <requested 30 days subject to limits; actual date or unknown> |
| <coverage/verdict/reviewer response/browser records> | <H + digest> | <commit-bound review URL; verify published links> | <availability/expiry> |

Secrets excluded: <method>. Unexposed usage/cost: <unknown>. Archive requirement/access gaps: <owner/next action before expiry>.

- Final verdict location: <outside H or published after H; no self-referential committed final SHA>
- Publication: <authorized COMMENT review, `commit_id: H`, actual account, verified body/links; pending otherwise>
- Remote head/base and mergeability recheck: <time, full IDs, result; changed head invalidates final claim until delta review; changed base requires integration check>
- Final ordinary/effectiveness gates and full selected-set revalidation: <exact-source CI results; pending if unavailable>
- Remaining acceptance / exclusions: <fixture/live/device/performance limits and next owner action>
- Handoff: <review-ready only when required gates hold; PR remains open; no merge/deploy/issue closure>
