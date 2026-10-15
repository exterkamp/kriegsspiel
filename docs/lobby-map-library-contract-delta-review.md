# R18 independent library contract delta review

**Verdict: Accepted as the bounded library contract. R17-B1/B2 are resolved; no remaining blocking or new nonblocking contract finding.** Portable Add presentation may use this port. Production Add/save capability still requires independently reviewed durable storage/transport and integration evidence; this verdict does not release those capabilities or approve arbitrary geography as playable.

## Exact binding

- Canonical `docs/lobby-map-library-contract.md`: SHA-256 **`9d7cbab0a9882dc3d605c3b0d57e334fba804de9b9f43caecf39f52033b0ad6a`**.
- Frozen `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4/client/src/shared/lobby-map-library/contracts.ts`: SHA-256 **`a092029d36ce1392d0df585393aa485704d40d3778a25d6cc68fcfc85a1f1c76`**.
- Historical R17 report preserved: `docs/lobby-map-library-contract-review.md`, SHA-256 `03a58cda44cf8aada91161d76d30b7c6c39d20e9c9a637745546e1f717ff3df5`.

Read the full amended document and full port independently, compared them with R17's recorded document/port and findings, and re-read relevant D43, approved design/library boundaries, accepted pairing contract and execution-log checkpoints. Existing maps import/full-identity/complete-certification and BoardPreparation boundaries inspected in R17 remain the reference; no implementation is inferred from the amendment. No whole-snapshot identity is claimed.

## Findings disposition

**B1 resolved:** save quotas are distinguished from list limits. Each response is capped at20 summaries/32KiB, with explicit continuation and no aggregate-all fallback. The port now takes source/signal/optional cursor and returns `{items,nextCursor?}`. Deterministic keyset order, owner/source-bound authenticated cursors,512-character ASCII cap, explicit old-epoch/invalid restart and reachability of every retained adopted entry remove the previous120-entry contradiction. Adoption cannot silently truncate retention or listing.

**B2 resolved:** authenticated admission is explicitly in `onRequest` before buffering or large SQL materialization. Shared global2/owner1 capacity covers writes and byte-bearing reads/reconciliation through readback and awaited worker retirement. Streamed64MiB accounting, strict UTF-8, rejection of non-identity encoding, separate30s receipt/worker deadlines and bounded client reads are concrete. SQL length checks/CASE avoid retrieving oversized values. Tiny metadata lookups remain separate. The512MiB old-generation ceiling is accurately limited to the V8 heap rather than presented as an RSS guarantee.

R17's routine interpretations are adopted normatively: final transactional principal/ownership/key/tombstone/quota recheck after validation; full asset hash rather than the geometry default; existing node/work budgets and current-version certificate scope; accepted-key retries and ambiguous post-commit failure; strict summaries/metadata; explicit development-reference adaptation; actually initialized durable storage capability. Request/response metadata bounds are now specified. Exact bytes remain separate from display name, and every library summary remains `needs-scenario`. No owner/product decision is outstanding for this bounded agreement.

## Evidence and release limits

**Tests run for R18: none.** This packet is a contract/port delta, not an implementation. Complete reads and independent SHA-256 checks were performed. Future implementation must still prove pagination above quota, admission before allocation, worker termination/slot ownership, current complete validation, transactional races, retry/restart, adoption/expiry and privacy. Transport/UI must reject malformed page/asset responses at runtime; TypeScript alone is not validation.

Only this reserved R18 report was written. R17 and all earlier reports remain unchanged. No source/contract, process/browser/game/pane/Git mutation, new agent, external action, merge or deployment occurred. Browser Start/create-to-live acceptance remains unestablished. This acceptance is the coordinator's concrete contract gate for a bounded portable Add writer; it is not full chunk4/5 acceptance.
