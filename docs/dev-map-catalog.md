# Development map catalog and board preparation

The standalone development catalog serves `/__local/maps` on an explicitly opted-in loopback HTTP server. Angular proxy and setup integration follow in the preparation packet. It lists the committed defaults in `data/maps/catalog.json` and canonical JSON saved in ignored `.local/generated-maps/`. This packet restores local storage/import handling after the Angular cutover; it adds no navigation or game-start action.

`createMapCatalogHandler()` lists summaries, reads a `premade` or `generated` reference, and saves exact canonical JSON. References contain a kind and an ID, never a filesystem path. Reads and request bodies retain the map import limits. Generated writes use exclusive creation and never replace a committed default. Storage/import validation is not complete certification.

The helper uses Node-safe DTOs in `tools/local-map-catalog/types.ts`; it imports no browser, Angular or Vite code. Paths derive from the module location, independent of the launch directory. The runtime production image contains neither the helper nor generated local storage; only the Docker builder receives `tools/` to satisfy the root build. Importing the entrypoint opens no socket. Without `LOCAL_MAP_CATALOG=1`, startup does nothing; opted-in startup requires a valid `PORT` and binds `127.0.0.1`.

Build with `npm run build:local-map-catalog`, then use the managed preview runner:

```sh
LOCAL_MAP_CATALOG=1 devrun up --name init-map-catalog --port-env PORT -- node .local/local-map-catalog/serve.js
devrun url init-map-catalog
```

These services do not create engine scenarios, advance a simulation, store production games, or resume sessions. Complete browser certification/preparation and the Angular proxy are separate dependent packets. Storage/import validity alone never makes a board playable.

## Committed defaults

These generated assets use the existing pinned complete battlefield recipes. They are machine-generated canonical JSON, preserved byte-for-byte rather than reformatted. Their generation provenance remains in each asset. Tests independently validate the complete saved geography, compare the exact recipe and verify the full asset SHA-256 identity.

| ID | Recipe | Seed | Extent | Full asset identity |
| --- | --- | --- | --- | --- |
| countryside-rectangle | flat-countryside | 17 | 5,000 × 3,000 m | `26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84` |
| wooded-hills | wooded-hills | 31 | 5,000 × 5,000 m | `ecce44a083ff6f5a616d9ffc6946b5ffa53023092396ba5230836f221c59f4ed` |
| river-valley | river-valley | 97 | 5,000 × 5,000 m | `bf704cc07170dcf9b7587c11bee7db54139220ef9b8a69384c01f4de68b7aba2` |

The rectangle changes only the height from its complete preset; the other defaults use complete presets without overrides. Generated JSON volume is distinct from the handwritten service and test changes.

Focused verification: `npm run test:local-map-catalog` and `npm run typecheck:local-map-catalog`. The tests use disposable directories and real loopback HTTP sockets, checking import limits, allowlisted references, corrupt entries, exclusive writes, interrupted requests and explicitly guarded startup. These tests are included in the root test and typecheck commands.
