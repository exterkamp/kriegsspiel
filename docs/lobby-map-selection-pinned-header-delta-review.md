# R12: independent pinned-header settings repair review

**Verdict: Accepted at H for the bounded header/storage/replay prerequisite. R11-B1 is resolved.** R11 remains unchanged as the historical Changes needed verdict at its original revision. This does not accept the disjoint Host/creation work or actor/API integration.

## Exact binding and inspected delta

- H `6ddffa08aa5efd8b805b86da6bb16a7f5bc4c42c`, tree `c0aa9a606a4d0ec51bd9475b37aa9dcd97ebe59c`.
- Verified parent P `693394d67709396c6ca4282668ab302ce2d758e4`.
- Manifest `/private/tmp/lobby-map-header-repair-candidate.json`, ref `refs/heads/feat/lobby-map-pinned-replay`.
- Canonical repository `/Users/dominic/code/kriegsspiel-game-init-landing`, protected HEAD remains `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`.

The complete P..H delta is two paths, both inspected fully in context. Manifest H/tree/parent, inventory and SHA-256 values were verified against Git blobs and the scoped snapshot files:

| Path | H blob | SHA-256 |
| --- | --- | --- |
| `server/src/game/sqlite.ts` | `10d8ddbe54350fbbe234f548841bfbd139399be8` | `71c7d18392afb1a0b31a9122cc2cd30e06edd4adf48400517576401a17c9139a` |
| `server/src/game/pinned-header.test.ts` | `2c474b1d0cc989a6cb2900d847fc70b94d99c287` | `04d850124f803dd0efca45f1cd73df2cb5e0a10082a921766b612c53bdf02893` |

All other R11 source is unchanged by Git identity and carries the prior inspection/limits. Snapshot `/private/tmp/kriegsspiel-lobby-map-implementation-1d6fcb4` also contains disjoint Host/creation/auth/lobby/client work; no whole-snapshot identity or review is claimed. Native High verification is packet-supplied; no pane operation was performed.

## Resolution and test effectiveness

SQLite readback now distinguishes modern `r.settings !== null` from the retained legacy `!!r.settings` behavior. A modern non-null empty string reaches `JSON.parse` and rejects. Other non-null JSON must pass the strict native settings schema through `detachedInputHeader`; malformed, null-valued, incomplete or unknown-enum settings cannot silently become defaults. SQL NULL remains the supported optional absence. The byte-limit gate still precedes parsing. Legacy rows explicitly retain their old handling, including omission of empty settings, without a broader compatibility change.

The added permanent test first saves nondefault dial `free` and checks it through both store readback and `loadReplayInput`. It checks SQL NULL absence through both paths, then rejects empty text, malformed JSON, JSON null, incomplete settings, an invalid dial and16385-byte settings through both paths. Finally it restores valid nondefault settings and checks readback again. Each iteration overwrites the actual settings column, so the test cannot pass merely because of a previous pin-column mutation. Existing assertions and the prior pin-corruption suite are retained.

Inspected `/private/tmp/lobby-map-header-settings-red.log`: the new regression failed on the old source because the promise resolved instead of rejecting for empty settings, with **1 failure /10 passes**. This is an assertion detection of R11-B1, not a compiler/collection failure. The red run/source binding is coordinator-supplied evidence; the reviewer did not edit source or independently recreate a mutation/red run. Green author logs are not substituted for the independent checks below.

## Checks actually run

Pinned Node **v22.23.3**, snapshot `server/`:

```sh
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/vitest/vitest.mjs run src/game/pinned-header.test.ts src/game/sqlite.test.ts src/game/replay.test.ts src/admin/replayView.test.ts --no-cache --configLoader runner
PATH=/private/tmp/game-init-landing-node/node_modules/node/bin:$PATH node ../node_modules/typescript/bin/tsc --noEmit --incremental false
```

**42 tests /4 files passed; server noEmit typecheck passed.** Typecheck and the unchanged legacy regression tests see the combined execution snapshot; they do not attribute or accept its disjoint Host/creation work. Node emitted its SQLite experimental warning. No independent build/lint/full-root/CI/browser check was performed, and no managed task-server game was created or operated.

## Remaining boundary

No blocking or new nonblocking finding was identified in this repair. Accept the exact header/storage/replay prerequisite at H, carrying R11's unchanged-source assessment with B1 resolved here. Existing JSONL whole-file-read limits, requested-game-ID checks at consumers, and all pending Host/API/receipt/lobby/recovery/render integration gates remain explicit. The acceptance does not certify those later integrations or idempotent activation.

Only this exclusive report was written for R12. Historical R11 and older reports remain unchanged. No source/test/config/Git/server/browser/pane/permission mutation, new agent, external action, merge or deployment occurred. Browser Start approval remains pending and no workaround was attempted.
