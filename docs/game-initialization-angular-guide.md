# Local game initialization in Angular

The local New game implementation is being restored as native Angular components and services. The saved-map inspector is available at `/map-table`. The certified setup services in this packet have no route or setup UI yet; the board, selection dialog and session owner follow as separate packets. `/` retains the menu, authentication, guest, scenario and live-game flows.

## Certified preparation

`client/src/shared/game-setup/preparation.ts` accepts canonical saved JSON or the complete current replay recipe. It certifies geometry in a dedicated module worker, hashes canonical bytes, and returns a detached, structured-cloneable `CertifiedBoard`: public map asset, canonical JSON, full SHA-256 identity, summary/reference and north-west-zero metre bounds. A catalog summary or successful save is storage metadata, not independent certification. The returned rectangular default covers 5000 × 3000 metres.

Each operation owns its generation and validation resources. Cancellation, replacement and disposal invalidate late results. `dispose()` invalidates immediately but may retire an in-flight factory asynchronously: a consumer must retain and await its operation promise before acknowledging teardown or allocating through a new owner. Replacement within one preparation object already waits for that retirement. Consumers must register destruction cleanup before awaiting startup and must not publish after destruction.

The minimal local contracts contain no simulation capabilities: fresh local scope, certified binding and fixed presentation time/rate, with empty pieces, roster and papers. Personal marks and notebook storage are separate future adapters.

## Development default and catalog

The initial default loads `/__local-default/countryside-rectangle.json` without a catalog or live API. Its exact canonical SHA-256 is `26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84`; startup checks identity, reference and bounds after certification. `scripts/prepare-local-map-default.mjs` checks the pinned source and copies only this map into the ignored Angular workspace directory `client/.local/local-defaults`. Development, test and `build:development` use it; production assets do not.

See [development catalog](dev-map-catalog.md) for the opt-in loopback sidecar. Set `LOCAL_MAP_CATALOG_URL` when starting the Angular development preview. Its development proxy forwards `/__local/maps` and child paths to that sidecar, preserving the path; it never forwards those requests to the live API. If the sidecar is stopped or missing, list/load/save reject visibly. Default loading remains independent.

Use Node from `.nvmrc`, the repository map-source setup and a locked dependency installation. Build map declarations before starting a clean preview. Start all previews with `devrun`:

```sh
npm run setup:map-source
npm ci
npm run build:local-map-catalog
LOCAL_MAP_CATALOG=1 devrun up --name local-map-catalog --port-env PORT -- node .local/local-map-catalog/serve.js
LOCAL_MAP_CATALOG_URL=$(devrun url local-map-catalog) devrun up --name web --port-env PORT -- npm run dev -w client
```

An existing application API can be selected with `API_URL`; the local default does not require one. Do not start a second server over an existing protected preview. Production `npm run build -w client` excludes the development default; no production catalog endpoint or local New game route is added by this packet.

## Verification

Focused tests cover catalog signals/errors/DTO compatibility, retained recipe validation, exact certification/hash, cancellation and reentrant/deferred allocation, and default startup ownership/failure/identity. The temporary isolated Angular diagnostic harness exercises actual emitted workers, default and catalog loading, generation, saving and cancellation. It is verification tooling, not shipped application UI. Browser measurements and source hashes travel with the packet; the full New game flow remains an integration acceptance gate.
