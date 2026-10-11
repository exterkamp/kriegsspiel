import {
  GenerationController,
  validId,
  type GenerationWorker,
  type ReplayParameters,
  type ValidationOutcome,
} from '../generation/index.js';
import {
  parseValidationResponse,
  type ValidationRequest,
  type ValidatedFiles,
} from './protocol.js';

export interface ValidationWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: ValidationRequest): void;
  terminate(): void;
}
export class ValidationWorkerError extends Error {
  constructor(
    readonly kind: 'worker' | 'protocol' | 'programming' | 'cancelled',
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationWorkerError';
  }
}
interface Job {
  id: number;
  worker: ValidationWorker | null;
  resolve: (outcome: ValidationOutcome) => void;
  reject: (error: unknown) => void;
}
/** Owns a controller and fresh validation workers; supplies no generator or acceptance fallback. */
export function createAuthoringRuntime(options: {
  generationWorkerFactory: () => GenerationWorker;
  validationWorkerFactory: () => ValidationWorker;
  /** Finite total generation + validation watchdog. Defaults to 30 seconds. */
  waitTimeoutMs?: number;
}): {
  controller: GenerationController;
  readonly exportFiles: Readonly<ValidatedFiles> | null;
  dispose(): void;
} {
  const timeout = options.waitTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    throw new RangeError('Runtime requires a finite positive waitTimeoutMs');
  if (
    typeof options.generationWorkerFactory !== 'function' ||
    typeof options.validationWorkerFactory !== 'function'
  )
    throw new TypeError('Both worker factories are required');
  let job: Job | null = null;
  let exports: { id: number; files: Readonly<ValidatedFiles> } | null = null;
  let unsubscribe = () => {};
  function finish(target: Job, outcome?: ValidationOutcome, error?: unknown): void {
    if (job !== target) return;
    job = null;
    if (target.worker) {
      const worker = target.worker;
      target.worker = null;
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        /* Cleanup must not block settlement or replacement. */
      }
    }
    if (outcome) target.resolve(outcome);
    else target.reject(error);
  }
  function current(target: Job): boolean {
    return (
      job === target &&
      controller.state.status === 'validating' &&
      controller.state.requestId === target.id
    );
  }
  function reconcile(): void {
    if (
      exports &&
      (exports.id !== controller.state.requestId ||
        ['cancelled', 'failed', 'disposed'].includes(controller.state.status))
    )
      exports = null;
    if (job && !current(job))
      finish(
        job,
        undefined,
        new ValidationWorkerError(
          'cancelled',
          'VALIDATION_SUPERSEDED',
          'Validation no longer belongs to the current request',
        ),
      );
    if (controller.state.status === 'disposed') unsubscribe();
  }
  // Controller.dispose clears subscribers before notifying. These lifecycle overrides also
  // reconcile synchronously, closing that gap without changing controller state semantics.
  class RuntimeController extends GenerationController {
    override generate(parameters: ReplayParameters): number {
      try {
        return super.generate(parameters);
      } finally {
        reconcile();
      }
    }
    override loadSavedAsset(input: unknown): number {
      try {
        return super.loadSavedAsset(input);
      } finally {
        reconcile();
      }
    }
    override cancel(): void {
      try {
        super.cancel();
      } finally {
        reconcile();
      }
    }
    override dispose(): void {
      try {
        super.dispose();
      } finally {
        reconcile();
      }
    }
  }
  const controller = new RuntimeController({
    workerFactory: options.generationWorkerFactory,
    waitTimeoutMs: timeout,
    validateCompleteAsset: (asset, context) => {
      reconcile();
      return new Promise<ValidationOutcome>((resolve, reject) => {
        const target: Job = { id: context.requestId, worker: null, resolve, reject };
        job = target;
        try {
          const worker = options.validationWorkerFactory();
          target.worker = worker;
          worker.onmessage = (event) => {
            if (!current(target)) {
              reconcile();
              return;
            }
            // Foreign replies cannot validate or fail this candidate, even before notifications.
            const descriptor =
              event.data && typeof event.data === 'object'
                ? Object.getOwnPropertyDescriptor(event.data, 'requestId')
                : undefined;
            if (
              descriptor &&
              'value' in descriptor &&
              validId(descriptor.value) &&
              descriptor.value !== target.id
            )
              return;
            try {
              const response = parseValidationResponse(event.data);
              if (response.requestId !== target.id) return;
              if (response.type === 'validated') {
                if (response.outcome.ok && response.files)
                  exports = { id: target.id, files: Object.freeze(response.files) };
                finish(target, response.outcome);
              } else
                finish(
                  target,
                  undefined,
                  new ValidationWorkerError('programming', response.code, response.message),
                );
            } catch (error) {
              finish(
                target,
                undefined,
                new ValidationWorkerError(
                  'protocol',
                  'INVALID_VALIDATION_RESPONSE',
                  error instanceof Error ? error.message : 'Invalid response',
                ),
              );
            }
          };
          worker.onerror = (event) => {
            if (!current(target)) {
              reconcile();
              return;
            }
            finish(
              target,
              undefined,
              new ValidationWorkerError('worker', 'VALIDATION_WORKER_RUNTIME', event.message),
            );
          };
          worker.onmessageerror = () => {
            if (!current(target)) {
              reconcile();
              return;
            }
            finish(
              target,
              undefined,
              new ValidationWorkerError(
                'protocol',
                'VALIDATION_DESERIALIZATION',
                'Validation reply could not be deserialized',
              ),
            );
          };
          worker.postMessage(
            structuredClone({
              v: 1,
              type: 'validate',
              requestId: context.requestId,
              asset,
              context,
            }),
          );
        } catch (error) {
          finish(
            target,
            undefined,
            new ValidationWorkerError(
              'worker',
              'VALIDATION_WORKER_STARTUP',
              error instanceof Error ? error.message : 'Validation worker startup failed',
            ),
          );
        }
      });
    },
  });
  unsubscribe = controller.subscribe(reconcile);
  return {
    controller,
    get exportFiles() {
      return controller.exportAsset && exports?.id === controller.state.requestId
        ? exports.files
        : null;
    },
    dispose: () => controller.dispose(),
  };
}
