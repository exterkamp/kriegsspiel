# Local game initialization in Angular

The local New game implementation is being restored as native Angular components and services. The saved-map inspector is available at `/map-table`. The certified setup services and native setup component have no application route yet; board presentation, personal data and the session owner follow as separate packets. `/` retains the menu, authentication, guest, scenario and live-game flows.

## Certified preparation

`client/src/shared/game-setup/preparation.ts` accepts canonical saved JSON or the complete current replay recipe. It certifies geometry in a dedicated module worker, hashes canonical bytes, and returns a detached, structured-cloneable `CertifiedBoard`: public map asset, canonical JSON, full SHA-256 identity, summary/reference and north-west-zero metre bounds. A catalog summary or successful save is storage metadata, not independent certification. The returned rectangular default covers 5000 × 3000 metres.

Each operation owns its generation and validation resources. Cancellation, replacement and disposal invalidate late results. `dispose()` invalidates immediately but may retire an in-flight factory asynchronously: a consumer must retain and await its operation promise before acknowledging teardown or allocating through a new owner. Replacement within one preparation object already waits for that retirement. Consumers must register destruction cleanup before awaiting startup and must not publish after destruction.

The minimal local contracts contain no simulation capabilities: fresh local scope, certified binding and fixed presentation time/rate, with empty pieces, roster and papers. Personal marks and notebook storage use the separate session-owned adapters described below.

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

## Native map selection and generation

`SetupComponent` is a standalone Angular component with a constructor-owned signal state and a separately owned canvas preview. Its `catalog`, `preparation`, `onStart` and `onCancel` inputs match `SetupProps`; `initialRef` is optional. The parent supplies its lifetime and dialog. There is no application route or live-game dependency in this packet.

Selecting a saved map loads and independently certifies its bytes. Generation preserves complete recorded settings and ordered overrides while editing preset, seed and size. A generated map must be saved before Start; a failed save retries identical canonical bytes without regeneration. Start submits detached certified data once and awaits the parent callback. Changing a recipe or selection invalidates late generation/save results, and returning to an exact unsaved recipe permits retry. Late catalog lists retain newer saved metadata.

Cancel immediately invalidates work and releases the preview, then calls `onCancel` after owned preparation settles. The parent can await `cancel()` or `dispose()` before another owner allocates resources; destruction initiates disposal synchronously. The Start callback is excluded from this retirement ledger so the parent can dispose setup inside that callback without a self-await cycle. Callback updates preserve work; changed ports retire their old ownership before successor work.

Angular canvas replacement recreates the preview and preserves setup state, draft and operation ownership. Labels, status/error text, keyboard preview controls and responsive layout are native template bindings. Fifty focused state/component assertions include the eleven retained P4 behaviors, late native option selection, deferred/reentrant startup, stale results, callback refresh, detached values and canvas recreation. Actual browser evidence and final source-bound acceptance travel with this packet; full dialog/session replacement remains A5.

## Fixed board host

`BoardHostComponent` is the native fixed-map rendering boundary. Supply a fresh local session key, detached CertifiedBoard and matching LocalPresentation; consume its keyed initialization and repeatable availability events. Await `teardown()` before replacing an owner. A retained host replaces its canvas safely and reuses its raster; mark-only updates never regenerate artwork. Camera and general interaction gates are independent so explicit manual placement can pick metres while camera movement is locked.

The host paints only stopped, empty local presentation and validated render-only marks. It has no live GameService, MarksService, simulation or storage capability. The personal repository is described below; the final development route and session owner follow separately. Actual native-worker/WebGL desktop/narrow, picking/gates, canvas HMR and teardown evidence is in [fixed-board verification](game-initialization-verification/angular-local-board/README.md); full-parent HMR remains an integration requirement.


## Personal marks and notebook

`PersonalRepository` and `PersonalStore` belong to a fresh local scope and complete certified binding. The parent calls `initialize()` before allowing writes and awaits `dispose()` at session retirement; native tools/notebook components consume the store without initializing or disposing it during navigation. Storage uses a new versioned namespace and complete JSON tuple keys. A fresh session on the same map starts empty; retained old records have no resume pointer.

Manual pin, symbol, ring, line and arrow tools support numeric metre coordinates, labels, edit/delete and explicit canvas placement. Drawing disables camera motion while accepting current-key points. Ordered lines/arrows require2–256 points and an explicit Finish. Escape stops drawing while retaining drafts, and shortcuts ignore editable inputs. General interaction gating blocks actions without discarding drafts. Scene projection contains only validated render marks; artwork is reused by the fixed board surface.

Marks are limited to200, labels to256 characters, and complete serialized records to1,048,576 JavaScript string characters. Notebook text is limited to16,384 characters and its complete record to131,072. Search ignores surrounding query whitespace and case; selectable export includes the current unsaved text. There is no truncation or HTML interpretation.

Loads preserve corrupt, unsupported, oversized or foreign records and block writes until a valid explicit reload. Observed raw-record/revision changes produce a visible conflict. Browser storage failures preserve dirty drafts for retry and never report memory as durable storage. Reloading a failed notebook record preserves its current dirty text for export; replacing the session constructs an entirely new store. These components provide no live/server integration, simulation or session resume. Actual browser and final acceptance evidence accompany the focused personal-feature packet; whole-session composition remains A5.
