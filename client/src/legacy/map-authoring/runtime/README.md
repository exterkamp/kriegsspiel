# Dedicated complete-validation runtime preparation

`createAuthoringRuntime({generationWorkerFactory, validationWorkerFactory, waitTimeoutMs?})` returns `{controller, dispose}`. Both factories must return fresh dedicated workers. The runtime supplies no generator, complete validator, version acceptance or fixture fallback. `controller` retains the existing GenerationController API/state/export semantics. Every generated candidate and saved import gets a fresh validation worker; saved loading never creates a generation worker. The total generation plus validation watchdog defaults to 30 seconds. This adapter requires a positive finite integer timeout; disabling the watchdog is not supported.

Validation transport v1 carries `{v:1,type:'validate',requestId,asset,context}`; context preserves the generated recipe or saved source and matches the request ID. Responses are `{v:1,type:'validated',requestId,outcome}` or `{v:1,type:'error',requestId,code,message}`. Descriptor/resource preflight, strict keys, exact replay matching and the existing validation-outcome parser guard the worker boundary. Wrong valid IDs are ignored; malformed current messages fail. No worker metadata or validation result changes canonical assets.

`createValidationRunner({validate,postMessage})` runs one candidate in a dedicated worker, calling the injected complete validator on detached frozen data. Expected infeasibility remains a typed outcome; validator exceptions become explicit error replies. Invalid inbound messages and broken transport reject; a future real worker entry must surface those rejected promises through the native worker error channel. A contract parser is not a complete validator.

Controller subscriptions terminate and reject superseded validation jobs, including total timeout. A small controller subclass also reconciles direct generate/load/cancel/dispose synchronously: the base controller clears subscribers before disposal notification, and queued notifications alone cannot guarantee prompt cleanup. Replies additionally consult live controller state before parsing or accepting. Termination clears handlers first, settles pending promises, and captured late messages/errors cannot revive jobs. Controller acceptance guards remain unchanged. Runtime dispose owns controller disposal and unsubscribes; repeat disposal is safe.

Transport/validator faults reject the mandatory validation callback. The unchanged controller exposes these as `programming/VALIDATOR_EXCEPTION`, with a `ValidationWorkerError` in `failureCause` distinguishing `worker`, `protocol`, and `programming` plus specific codes. Expected infeasibility has candidate diagnostics and no lifecycle failure. Timeout remains the controller's `timeout/WAIT_TIMEOUT`. All failures retain the last validated preview and disable current export.

Focused commands (existing dependencies only):

```sh
node_modules/.bin/vitest run client/src/legacy/map-authoring/runtime
npm run typecheck --workspace @kriegsspiel/client
node_modules/.bin/eslint client/src/legacy/map-authoring/runtime
node_modules/.bin/prettier --check client/src/legacy/map-authoring/runtime
node_modules/.bin/prettier --ignore-path /dev/null --check client/src/legacy/map-authoring/runtime/README.md
```

Lifecycle fixtures and unconditional validators in tests are explicit test doubles. Real worker entries, G full-validator/export integration and browser measurements remain H/I work; these tests do not accept #139/#140/#141. No changes to accepted controller/controls/preview internals are required.

## Worker export extension

`createValidationRunner` accepts optional `exportValidated(asset)` returning `GenerationResult<{json,svg}>`. Production injects G's real `exportBattlefield`; absence supplies no export files. It runs only after complete validation succeeds, in the same dedicated worker. Strict success/infeasibility/diagnostic/file checks reject malformed callback results; export infeasibility yields no partial files. Exact duplicate diagnostics are suppressed. Successful replies may carry `files:{json,svg}` only with an accepted outcome. The runtime's read-only `exportFiles` getter additionally checks live controller ready/request identity. Replacement/cancel/failure/disposal makes it null; stale replies cannot replace it. The combined reply retains the protocol's conservative 64 MiB JSON preflight cap; large generated exports may explicitly fail that boundary and require measured future transport work, never truncation.
