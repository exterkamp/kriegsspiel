# Preparatory #141 generation lifecycle

Isolated E-wave scaffolding against the frozen public map contract at `78b918a`, under the M3c plan. This directory supplies no generator, complete composition validator, worker entry, UI controls or generated assets. The existing standalone preview remains a contract-only reference fixture. #139 integration and real browser/save/replay acceptance remain prerequisites; #141 stays open.

## API and transport v1

`index.ts` exports the controller, runner, protocol types and boundary parsers.

- `GenerationController({ workerFactory, validateCompleteAsset, waitTimeoutMs? })`: both callbacks are required. The factory returns a fresh dedicated native `Worker` (or structural `GenerationWorker`) for each generation request. No fallback validator exists.
- `generate({ seed, settings, overrides }): number`: validates/detaches parameters and returns the request ID. Settings use frozen `parseSettings`; overrides retain their exact order and geometry, without canonical rounding or intent resolution. Shape-invalid requests fail before worker creation.
- `loadSavedAsset(objectOrJsonText): number`: imports, snapshots and starts complete validation of recorded data. Returns an operation ID immediately; never calls the worker factory or regenerates. Observe state for asynchronous completion. Use text for untrusted file inputs.
- `state`: immutable snapshot with `status`, ID, source, progress, candidate diagnostics, lifecycle failure, `lastValidatedAsset` and `canExport`. `subscribe(listener)` coalesces subsequent notifications in a microtask; it does not emit an initial snapshot. `failureCause` retains the original local exception for debugging.
- `exportAsset`: returns the immutable asset only for the current `ready` operation. During generation, validation, failure, cancellation or disposal it returns null. The previous validated map remains available for preview through `lastValidatedAsset`; it never masquerades as the failed candidate.
- `cancel()` terminates the current worker and clears candidate status/diagnostics; `dispose()` also removes subscribers and is idempotent. Further operations on a disposed controller throw.
- `createWorkerRunner({ generate, postMessage }).handleMessage(data)`: injectable one-request runner. Generator receives detached, deeply frozen `GenerateRequest` plus a progress callback; returns `GenerationResult<MapAsset>`. It emits a **candidate**, never a certified success. Invalid inbound requests reject before callbacks run; the future entry adapter must surface that rejection as a worker error. Terminal transport failures also reject rather than silently disappear.

Wire request: `{ v: 1, type: 'generate', requestId, seed, settings, overrides }`. IDs are positive safe integers, monotonically allocated across controller instances within this module lifetime, including saved loads and failed attempts. Exhaustion throws rather than reusing an ID.

Wire responses all carry `{ v: 1, requestId }` and exactly one payload:

| Type         | Payload                                      | Meaning                                                                             |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `progress`   | `{ progress: { stage, fraction, message } }` | Display-only stage/fraction in [0,1]; stages may reset the fraction.                |
| `candidate`  | `{ asset, diagnostics }`                     | Contract-parsed candidate awaiting complete validation.                             |
| `infeasible` | `{ diagnostics }`                            | Expected bounded failure; at least one error diagnostic required.                   |
| `error`      | `{ error: { kind, code, message } }`         | Protocol/programming/transport/input/watchdog failure, separate from infeasibility. |

No IDs, progress, timing, transport errors or callback diagnostics are inserted into the canonical asset. Generated candidates must match requested seed, parsed settings and ordered overrides exactly. Asset geometry and hole/ring ordering are preserved by parsing, with no simplification or repair. Successful generation/validation outcomes cannot contain error diagnostics. Expected infeasibility is `status: 'failed'` with candidate error diagnostics and `failure: null`; an operational/programming failure also sets `failure` with a distinct kind/code.

## Validation and future integration requirements

`CompleteAssetValidator(asset, context)` receives a frozen contract-parsed asset and either `{ source: 'generated', requestId, replay }` or `{ source: 'saved', requestId }`. It returns `{ ok: true, diagnostics }` or `{ ok: false, kind: 'infeasible', diagnostics }`, synchronously or asynchronously. Only its explicit successful result enables export. Malformed outcomes or thrown exceptions are programming failures, retaining the local original exception; they are never coerced into routine infeasibility.

The G integration adapter must provide the actual #139 complete composition validator: topology/physical constraints, roads/buildings/population/contours, supported generator/fork versions, and resolved overrides. Frozen `parseAsset` alone is **contract-only-v1** and cannot supply this callback. Override request parsing checks schema/resource shape only: topology, exclusions, existing stable IDs, in-bounds anchors and regeneration feasibility must be checked by the real generator/validator. No independent geometry validation implementation is introduced here.

Loading must validate supported recorded provenance and the saved asset directly; it must not manufacture a replacement through regeneration. If later controls regenerate a loaded recipe, the adapter must explicitly support its recorded generator/fork/stage versions or report unsupported versions; seed/settings/overrides alone cannot prove version-compatible replay. A mutable-input generator API may receive its own detached clone from the adapter. Never substitute the hand-authored fixture or unconditional successful test callback for real generation/certification.

Future worker integration must forward `MessageEvent.data` to the runner, connect `postMessage`, and surface rejected runner promises through the worker's error channel. The injected generator retains its deterministic operation limits and independent seeded streams. Worker termination is an authoring lifecycle action outside deterministic generation. A received candidate ends the generation worker; an injected asynchronous validator may continue independently, but its late outcome cannot update a superseded operation. Real worker construction/bundling and UI integration are intentionally absent.

## Cancellation, isolation and bounds

Replacement, cancellation, failure, saved loading and disposal clear the prior timer and terminate its worker. Captured late worker handlers cannot revive it, including worker errors after a candidate starts validation. Valid foreign IDs are ignored before inspecting their candidate payload; malformed current envelopes fail explicitly. Duplicate terminal/progress events during validation are ignored. Async validation checks operation identity after its await, covering replacement, cancellation, timeout and disposal of both generated and saved candidates.

The total wait watchdog defaults to 30,000 ms, spans generation and validation, and is not extended by progress. Configure integer `waitTimeoutMs` from 0 to 2,147,483,647 (0 disables it). Timeout reports `WAIT_TIMEOUT`, invalidates acceptance and retains the last valid preview. It is a host wait policy, not a generation work cap, benchmark claim or canonical field. Host timers cannot preempt synchronous main-thread work; an expensive validator must provide an appropriate asynchronous/worker adapter. Loading returns its operation ID immediately even if a validator never resolves.

Descriptor preflight rejects getters without executing them, hidden/symbol properties, custom prototypes/arrays, cycles, sparse arrays and nonfinite/non-JSON values. Wire bounds are depth 32, 6,000,000 visited values and a conservative 64 MiB JSON/UTF-8 estimate (short control-character escapes are charged at six bytes). Overrides cap at 256, diagnostics at 1,024 per payload, progress/error messages at 512 characters. Assets additionally use frozen `parseAsset` resource/topology/recipe caps. Plain-data reflection cannot protect against executing Proxy traps; proxies are outside the interface. Boundary work and structured-clone memory must still be measured with real browser assets. Deep-freeze caching avoids rewalking the retained asset on each progress/state change.

## Focused checks

From the repository root, using installed dependencies only:

```sh
node_modules/.bin/vitest run client/src/legacy/map-authoring/generation
npm run typecheck --workspace @kriegsspiel/client
node_modules/.bin/eslint client/src/legacy/map-authoring/generation
node_modules/.bin/prettier --check client/src/legacy/map-authoring/generation
node_modules/.bin/prettier --ignore-path /dev/null --check client/src/legacy/map-authoring/generation/README.md
```

Results on 2026-10-10: focused tests **36/36 in two files**, client source typecheck, scoped ESLint and scoped Prettier all exited 0. No builds, dist writes, installation, server or common configuration changes were performed.

FakeWorker probes cover rapid A/B/C; stale progress/candidates/message errors/native errors; cancel/retry/dispose; factory/post startup failure; wrong IDs; malformed/contract-invalid/mismatched candidates; delayed accepted/rejected validator outcomes; saved-load replacement; generation/validation timeout retention; unchanged deep-detached ordered replay parameters; direct saved loading with no worker; recoverable infeasibility versus programming defects; and detached immutable export/state. Runner probes cover bounded infeasibility, exceptions, malformed callback data, late progress and broken terminal transport, and rejection of nonstring error kinds (including coercible arrays). A dense 1.6-million-value boundary probe exercises the contract-scale numerical payload without charging array indices as serialized property names. Fixture acceptance callbacks are test doubles, not representative visual or composition evidence.

Real generated assets, concrete worker entry/bundling, composition/version adapters, controls/adjustments/save/export integration, saved-file replay identities, browser responsiveness and cancellation/memory benchmarks remain coordinator/integration acceptance work. This preparation does not accept or close #141.
