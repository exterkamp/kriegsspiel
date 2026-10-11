# Development map catalog and board preparation

The development client exposes a local catalog at `/__local/maps`. It lists the committed defaults in `data/maps/catalog.json` and canonical JSON saved in ignored `.local/generated-maps/`. This packet provides services for later setup UI; it adds no navigation or game-start action.

`createMapCatalog()` lists summaries, reads a `premade` or `generated` reference, and saves exact canonical JSON. References contain a kind and an ID, never a filesystem path. Reads and request bodies retain the map import limits. Generated writes use exclusive creation and never replace a committed default. Storage/import validation is not complete certification.

`createBoardPreparation()` owns a fresh authoring runtime for each operation. Loading saved geometry runs independent certification without generation. Generation uses the exact complete recipe supplied by the caller. A successful result includes the detached asset, matching canonical export, full asset identity, and north-west-zero metre bounds. Generated results have no saved reference until a catalog save succeeds. Replacement, abort and disposal cancel owned work and terminate workers; late results cannot publish a board.

The Vite plugin installs the file helper only in development. Built applications contain no catalog endpoint. These services do not create engine scenarios, advance a simulation, store production games, or resume sessions.

## Committed defaults

These generated assets use the existing pinned complete battlefield recipes. They are machine-generated canonical JSON, preserved byte-for-byte rather than reformatted. Their generation provenance remains in each asset. Tests independently validate the complete saved geography, compare the exact recipe and verify the full asset SHA-256 identity.

| ID | Recipe | Seed | Extent | Full asset identity |
| --- | --- | --- | --- | --- |
| countryside-rectangle | flat-countryside | 17 | 5,000 × 3,000 m | `26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84` |
| wooded-hills | wooded-hills | 31 | 5,000 × 5,000 m | `ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed` |
| river-valley | river-valley | 97 | 5,000 × 5,000 m | `bf704cc07170dcf9b7587c11bee7db54139220ef9b8a69384c01f4de68b7aba2` |

The rectangle changes only the height from its complete preset; the other defaults use complete presets without overrides. Generated JSON volume is distinct from the handwritten service and test changes.

Focused verification: `npm test -w client -- dev/mapCatalog.test.ts src/game-setup/catalog.test.ts src/game-setup/preparation.test.ts`. The middleware tests use disposable directories and actual local HTTP sockets. The preparation tests cover exact recipes/exports, full identity and cancellation ownership; real browser workers remain a separate integration check.
