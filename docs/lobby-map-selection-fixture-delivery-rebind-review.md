# R43 independent post-fixture delivery rebind review

**Verdict: Accepted as the bounded13-packet source-identical restack through `0af4feaaa5d20c203546ed4a1bb86a292ea9e947`, on accepted R38 `6187fdcfd07e101930ccd52f69f8b046f83829d7`.** All owned blobs match their reviewed heads. Each complete old-to-new tree differs only in the two accepted R38 fixture files. Prior verdicts and their limits carry by that verified identity, including R41's two nonblocking presentation findings. No whole-product/browser/performance acceptance follows.

## Exact manifest and independently verified objects

Manifest `/private/tmp/lobby-map-post-fixture-delivery-stack.json`, SHA-256 `f67253b752353847e164777305889dc1ace034d165ace667aa401f85cb25795d`. Verified every actual H/tree/P/ref and linear parent relation starting at R38. For all13 rows independently compared:

- complete P..H path inventory against the manifest;
- all79 packet path occurrences against their manifest SHA-256 and the exact `reviewedHead` blob;
- complete `ls-tree -rz` maps (path, mode, kind and object ID) between old/new heads;
- exact old..new changed paths against `integrationDelta`;
- both inherited fixture blobs against accepted R38;
- retained old-head archive ref and diff whitespace.

All passed. Complete old/new tree differences are exactly `client/src/app/game/clock.component.spec.ts` and `client/src/app/game/ports.spec.ts`; no source or mode discrepancy is hidden outside that pair. No old commit is described as having the new commit identity.

| Packet (owned paths) | New H | New tree | New P | Reviewed head |
| --- | --- | --- | --- | --- |
| Safe create transport (3) | `f49c6f53aa2da7d012379791ad9cd28372296f64` | `33bdd9e98c92811e8ac0249f1676fd16134969c0` | `6187fdcfd07e101930ccd52f69f8b046f83829d7` | `8847a781b709708d6e3c09aea6f3549c262c82f1` |
| Owned storage (12) | `28011596f86493b034a068b18a43d712c4c6c004` | `d3da15640085a9bc6fca1fa2fee3c04486b07b8d` | `f49c6f53aa2da7d012379791ad9cd28372296f64` | `0d1d4c861e65e57e2e4c62a5ca907f1476584416` |
| Owned API (11) | `1cca1bd69a1e11503404b09aa6662e0f555f28c9` | `f482d0152d6f2d3a90d7bf03c6a8e98a9c887ab5` | `28011596f86493b034a068b18a43d712c4c6c004` | `4e42b85a3cd05d8c24612c10b1e602f3abdef08c` |
| Add geography (7) | `d975101892e72f7d74a75f68cf4a5f1aea892a22` | `b703e1c9fdd0152ff4f4558e62aadba7c1fd52d8` | `1cca1bd69a1e11503404b09aa6662e0f555f28c9` | `5922ba2f19a8d8567d172e657f2ea860969ab951` |
| Owned picker (8) | `0c37cc4036cc5018e72fcd8443994666af958b6b` | `00f081d30d58f0416845d41f5661efd99251be84` | `d975101892e72f7d74a75f68cf4a5f1aea892a22` | `197e61e4aff7e708c11445edf72c3f28bfa7da12` |
| Retained create (6) | `8eea8d64ada8b6c0160a544626b0d2a6d660bd24` | `af4af52b8834cef63c0daaa98e080d7f25b088d6` | `0c37cc4036cc5018e72fcd8443994666af958b6b` | `9b6dd90367ce3d3226de3cf6f676b8136603547f` |
| Owned HTTP (5) | `5c0f0e2af69bbb6fa0aacde983a4277689ca8f8f` | `e5061ba272cc7e8339d2055bc41199dc369e3c93` | `8eea8d64ada8b6c0160a544626b0d2a6d660bd24` | `8530063cb8fd14eba1af82789236861552ba1b20` |
| Owned entry (2) | `555f114275e4f0e4ad2e8dad8bfcf419ec2cfce3` | `3b61186fb7a737a1dcee75a24e494ad0cff1b633` | `5c0f0e2af69bbb6fa0aacde983a4277689ca8f8f` | `c700e0d292bdf43ef958df24c6e67ccc8b17e720` |
| Worker read (7) | `591837657601d67e520a22a4bf3f76a63d2db281` | `396484ad405bb786fef86fa0e11b9725022b19b0` | `555f114275e4f0e4ad2e8dad8bfcf419ec2cfce3` | `f1f1b20701d6ba26e9fc056a1fa86fe40052d376` |
| Preparation offload (5) | `62c03dda2d696d6c0e49792ce63d4e19e3faf2cb` | `b96cdcf54b750ef617e24d41b4cb04a6106f95d8` | `591837657601d67e520a22a4bf3f76a63d2db281` | `d5b87b9531383f9f4ba37a3be89e92ce1ef85f05` |
| Main pairings (2) | `5e91b6fb15ce64fa1c3e778b1f87886deb6144da` | `3781ee077129573af4ae7f6bda439323b199f63d` | `62c03dda2d696d6c0e49792ce63d4e19e3faf2cb` | `e77bc85bfaeb073146599f2536bcaf5ed19195b9` |
| Room summary (2) | `be1b1a9e4a18af4145587f97c54544ef59a4c2b1` | `7fda6d2c1eac9764508dcc9068c1f82315e4e451` | `5e91b6fb15ce64fa1c3e778b1f87886deb6144da` | `5e3b4ca5092b905506783d915d29096410e0b460` |
| UI verification (9) | `0af4feaaa5d20c203546ed4a1bb86a292ea9e947` | `1350db5182cb6371e8ba963f0ab8ef40f59ffe9e` | `be1b1a9e4a18af4145587f97c54544ef59a4c2b1` | `6e65771fe2f163aa1b5f58237affd3611237688f` |

Every `reviewedHead` is retained at `refs/heads/lobby-map-history/pre-fixture-restack-<packet-name>` using the exact packet names in the manifest. The originally incorrect `desk/clock` expectation is coordinator process history, not a product regression or reviewer operation. The final independent path/tree/archive proof uses the actual `game/clock` path. No ref/index/source operation was reproduced or performed by this reviewer.

## What carries and why the context remains coherent

R38 changes only the two typed live test fixtures. Its accepted7-test execution and AST proof (all17 original behavior assertions retained plus22 readiness assertions) carry to their identical blobs at all13 new heads. Every production blob at a given packet equals its corresponding reviewed head, including accepted GameService terrain/metadata gating. The fixture change adds no product import, public/private contract or runtime policy.

The [four-client delivery rebind](lobby-map-selection-client-delivery-rebind-review.md) and [seven-library delivery rebind](lobby-map-selection-library-delivery-rebind-review.md) retain their earlier per-packet inventories/provenance; this review independently verifies all their rewritten packet inventories again. Storage/API repairs, protocol pages, Add disclosure, picker saved-focus, retained-creation recovery, HTTP capability/receipt and owner-gated entry remain the same accepted code, with earlier infrastructure limits preserved.

[R37 worker read](lobby-map-selection-worker-read-review.md) and [R39 opt-in preparation](lobby-map-selection-preparation-offload-review.md) carry to their exact new heads above. The new worker config, trusted optional-candidate canonical agreement, current complete certification, HTTP phase signal and preparation owner/export guards are unchanged. Historical socket EPERM and earlier mutable-workspace type failures are not retroactively erased.

Current [R40 main](lobby-map-selection-main-pairings-review.md), [R41 room](lobby-map-selection-room-summary-review.md) and [R42 UI](lobby-map-selection-ui-verification-review.md) verdicts remain bound to the original full heads in the table and carry by this tree proof. R41-N1 (missing scenario identity in the displayed summary) and N2 (modal-specific Escape caption in a disclosure) also carry unchanged. There is no new integration finding from restacking.

## Independent integration evidence and its limits

Alongside this rebind, the reviewer independently ran27 native API/registry tests,258 Angular tests across room/shell and four UI suites,63 helper/style tests, client/server typechecks and focused lint; all passed. Logs `/private/tmp/lobby-map-r40-review-native-tests.log`, `lobby-map-r40-r42-review-angular.log`, `lobby-map-r42-review-helper-style.log`, `lobby-map-r40-r42-review-typecheck.log`, `lobby-map-r40-r42-review-lint.log`. All660 prior UI assertion expressions were independently preserved. These are the executions recorded in R40–R42, not additional duplicate runs performed for each identical restack.

An independent checkpoint compared1158 tracked blobs of final0af to the snapshot, excluding `docs/` and root AGENTS/README; zero differences. Later W17 work changed parent/shell paths outside R40–R42. That earlier binding is not a current whole-snapshot claim. The final browser artifact's separate1160-file binding records its own capture checkpoint and shell-spec exception; R42 attributes that supplement explicitly. No W17 source is accepted by this review.

No unchanged full suite was rerun solely for rebinding. Earlier891-Angular/full-root claims are source-context-specific author evidence, not a post-W16 reviewer full-suite result. Actual15km module-worker/generation/save/read/canvas evidence is bounded supplementary coordinator evidence in R42. It does not prove room/gameplay, real-main execution, memory/long-task guarantees or every possible64MiB input. Browser Start/create-to-live remains pending its existing approval, with no workaround.

Only the four authorized R40–R43 reports were written. Historical reports remain unchanged and protected canonical HEAD stays `1d6fcb4b76a8a9a5881e8d909e72eddbbb4a4aa4`. No remote PR/CI/publication state was checked. No source/test/config/Git/runtime/browser/game/pane mutation, new agent, external action, merge or deployment occurred. Stop after these reports.

Final preservation notice: after R41 was recorded, the mutable room component/spec changed externally in addition to the later parent/shell work. See R41's exact drift hashes. No later room bytes or repair are accepted here. The13 immutable Git object comparisons and original source verdict bindings remain valid; no assertion that the current workspace equals final0af is made.
