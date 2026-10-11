import { importAsset, MapValidationError, parseAsset, type MapAsset } from '@kriegsspiel/maps';
import {
  errorMessage,
  freezeData,
  parseReplayParameters,
  validId,
  parseResponse,
  parseValidation,
  ProtocolError,
  type GenerateRequest,
  type LifecycleError,
  type Progress,
  type ReadonlyData,
  type ReplayParameters,
  type ValidationOutcome,
} from './protocol';
import type { Diagnostic } from '@kriegsspiel/maps';

/** Structural subset of a native Worker; factories must return a fresh worker per request. */
export interface GenerationWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: GenerateRequest): void;
  terminate(): void;
}
export type ValidationContext =
  | { source: 'generated'; requestId: number; replay: ReadonlyData<ReplayParameters> }
  | { source: 'saved'; requestId: number };
export type CompleteAssetValidator = (
  asset: ReadonlyData<MapAsset>,
  context: ReadonlyData<ValidationContext>,
) => ValidationOutcome | Promise<ValidationOutcome>;
export interface ControllerOptions {
  workerFactory: () => GenerationWorker;
  validateCompleteAsset: CompleteAssetValidator;
  /** Total generation + validation wait. Progress does not extend it. Zero disables it. */
  waitTimeoutMs?: number;
}
export interface GenerationState {
  status: 'idle' | 'generating' | 'validating' | 'ready' | 'failed' | 'cancelled' | 'disposed';
  requestId: number | null;
  source: 'generated' | 'saved' | null;
  progress: Progress | null;
  candidateDiagnostics: Diagnostic[];
  failure: LifecycleError | null;
  lastValidatedAsset: ReadonlyData<MapAsset> | null;
  canExport: boolean;
}
interface Operation {
  id: number;
  context: ReadonlyData<ValidationContext>;
  worker: GenerationWorker | null;
  timer: ReturnType<typeof setTimeout> | null;
}
let nextId = 0;
function uniqueId(): number {
  if (nextId === Number.MAX_SAFE_INTEGER) throw new RangeError('Request ID space exhausted');
  return ++nextId;
}

export class GenerationController {
  private current: Operation | null = null;
  private snapshot: ReadonlyData<GenerationState> = freezeData({
    status: 'idle',
    requestId: null,
    source: null,
    progress: null,
    candidateDiagnostics: [],
    failure: null,
    lastValidatedAsset: null,
    canExport: false,
  });
  private cause: unknown;
  private readonly timeout: number;
  private readonly listeners = new Set<(state: ReadonlyData<GenerationState>) => void>();
  private notificationPending = false;

  constructor(private readonly options: ControllerOptions) {
    this.timeout = options.waitTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 0 || this.timeout > 2_147_483_647) {
      throw new RangeError('waitTimeoutMs must be an integer in [0,2147483647]');
    }
    if (
      typeof options.workerFactory !== 'function' ||
      typeof options.validateCompleteAsset !== 'function'
    ) {
      throw new TypeError('Worker factory and complete-asset validator are required');
    }
  }
  get state(): ReadonlyData<GenerationState> {
    return this.snapshot;
  }
  /** Original unexpected exception for debugging; never included in canonical assets or wire data. */
  get failureCause(): unknown {
    return this.cause;
  }
  subscribe(listener: (state: ReadonlyData<GenerationState>) => void): () => void {
    this.assertLive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Only the current successfully validated operation can supply an export asset. */
  get exportAsset(): ReadonlyData<MapAsset> | null {
    return this.snapshot.canExport ? this.snapshot.lastValidatedAsset : null;
  }
  generate(parameters: ReplayParameters): number {
    const id = this.begin('generated');
    const operation = this.current!;
    let request: GenerateRequest;
    try {
      request = { v: 1, type: 'generate', requestId: id, ...parseReplayParameters(parameters) };
      const { seed, settings, overrides } = request;
      operation.context = freezeData({
        source: 'generated',
        requestId: id,
        replay: { seed, settings, overrides },
      });
    } catch (error) {
      this.fail(operation, 'invalid-input', 'INVALID_REQUEST', error);
      return id;
    }
    try {
      const worker = this.options.workerFactory();
      operation.worker = worker;
      worker.onmessage = (event) => {
        void this.receive(operation, event.data);
      };
      worker.onerror = (event) => {
        if (operation.worker === worker)
          this.fail(operation, 'worker', 'WORKER_RUNTIME', new Error(event.message));
      };
      worker.onmessageerror = () => {
        if (operation.worker === worker)
          this.fail(
            operation,
            'protocol',
            'MESSAGE_DESERIALIZATION',
            new ProtocolError('Worker message could not be deserialized'),
          );
      };
      // A second detached copy prevents injected/native transport from mutating replay parameters.
      worker.postMessage(structuredClone(request));
    } catch (error) {
      this.fail(operation, 'worker', 'WORKER_STARTUP', error);
    }
    return id;
  }
  /** Import and complete validation only: never calls the worker factory or generator. */
  loadSavedAsset(input: unknown): number {
    const id = this.begin('saved');
    const operation = this.current!;
    let asset: MapAsset;
    try {
      asset = typeof input === 'string' ? importAsset(input) : parseAsset(input);
    } catch (error) {
      this.fail(operation, 'invalid-input', 'INVALID_SAVED_ASSET', error);
      return id;
    }
    void this.validate(operation, asset, []);
    return id;
  }
  cancel(): void {
    this.assertLive();
    this.stop();
    this.cause = undefined;
    this.update({
      status: 'cancelled',
      progress: null,
      candidateDiagnostics: [],
      failure: null,
      canExport: false,
    });
  }
  dispose(): void {
    if (this.snapshot.status === 'disposed') return;
    this.stop();
    this.listeners.clear();
    this.update({ status: 'disposed', progress: null, candidateDiagnostics: [], canExport: false });
  }
  private begin(source: 'generated' | 'saved'): number {
    this.assertLive();
    const id = uniqueId();
    this.stop();
    this.cause = undefined;
    const operation: Operation = {
      id,
      context: freezeData({ source: 'saved', requestId: id }),
      worker: null,
      timer: null,
    };
    this.current = operation;
    this.update({
      status: source === 'generated' ? 'generating' : 'validating',
      requestId: id,
      source,
      progress: null,
      candidateDiagnostics: [],
      failure: null,
      canExport: false,
    });
    if (this.timeout > 0)
      operation.timer = setTimeout(() => {
        this.fail(
          operation,
          'timeout',
          'WAIT_TIMEOUT',
          new Error(`Generation/validation exceeded ${this.timeout} ms wait watchdog`),
        );
      }, this.timeout);
    return id;
  }
  private async receive(operation: Operation, input: unknown): Promise<void> {
    if (!this.active(operation) || this.snapshot.status !== 'generating') return;
    // Ignore a well-identified foreign request before parsing an expensive candidate payload.
    if (input !== null && typeof input === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(input, 'requestId');
      if (
        descriptor &&
        'value' in descriptor &&
        validId(descriptor.value) &&
        descriptor.value !== operation.id
      )
        return;
    }
    try {
      const response = parseResponse(input);
      if (response.requestId !== operation.id) return;
      switch (response.type) {
        case 'progress':
          this.update({ progress: response.progress });
          break;
        case 'error':
          this.fail(
            operation,
            response.error.kind,
            response.error.code,
            new Error(response.error.message),
          );
          break;
        case 'infeasible':
          this.finish(operation);
          this.update({
            status: 'failed',
            candidateDiagnostics: response.diagnostics,
            progress: null,
            failure: null,
            canExport: false,
          });
          break;
        case 'candidate': {
          if (response.diagnostics.some((item) => item.severity === 'error'))
            throw new ProtocolError('Candidate success contains error diagnostics');
          const replay = operation.context.source === 'generated' ? operation.context.replay : null;
          if (
            !replay ||
            response.asset.provenance.seed !== replay.seed ||
            JSON.stringify(response.asset.settings) !== JSON.stringify(replay.settings) ||
            JSON.stringify(response.asset.overrides) !== JSON.stringify(replay.overrides)
          ) {
            throw new ProtocolError(
              'Candidate does not match requested seed/settings/ordered overrides',
            );
          }
          this.terminateWorker(operation);
          await this.validate(operation, response.asset, response.diagnostics);
          break;
        }
      }
    } catch (error) {
      this.fail(operation, 'protocol', 'INVALID_RESPONSE', error);
    }
  }
  private async validate(
    operation: Operation,
    asset: MapAsset,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    if (!this.active(operation)) return;
    // Candidate storage is private and immutable while async validation is pending.
    const candidate = freezeData(asset);
    this.update({ status: 'validating', progress: null, candidateDiagnostics: diagnostics });
    try {
      const raw = await this.options.validateCompleteAsset(candidate, operation.context);
      if (!this.active(operation)) return;
      const outcome = parseValidation(raw);
      this.finish(operation);
      this.update({
        status: outcome.ok ? 'ready' : 'failed',
        candidateDiagnostics: [...diagnostics, ...outcome.diagnostics],
        failure: null,
        canExport: outcome.ok,
        ...(outcome.ok ? { lastValidatedAsset: candidate } : {}),
      });
    } catch (error) {
      this.fail(operation, 'programming', 'VALIDATOR_EXCEPTION', error);
    }
  }
  private fail(
    operation: Operation,
    kind: LifecycleError['kind'],
    code: string,
    error: unknown,
  ): void {
    if (!this.active(operation)) return;
    this.finish(operation);
    this.cause = error;
    const diagnostics: Diagnostic[] =
      error instanceof MapValidationError
        ? error.issues.slice(0, 1024).map((issue) => ({
            severity: 'error',
            stage: 'validation',
            code: issue.code.slice(0, 96),
            message: issue.message.slice(0, 512),
            path: issue.path.slice(0, 512),
          }))
        : this.snapshot.candidateDiagnostics.map((item) => structuredClone(item) as Diagnostic);
    this.update({
      status: 'failed',
      progress: null,
      candidateDiagnostics: diagnostics,
      failure: { kind, code, message: errorMessage(error) },
      canExport: false,
    });
  }
  private active(operation: Operation): boolean {
    return this.current === operation;
  }
  private finish(operation: Operation): void {
    if (!this.active(operation)) return;
    this.current = null;
    if (operation.timer !== null) clearTimeout(operation.timer);
    this.terminateWorker(operation);
  }
  private stop(): void {
    if (this.current) this.finish(this.current);
  }
  private terminateWorker(operation: Operation): void {
    const worker = operation.worker;
    operation.worker = null;
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    // Invalidate first; a faulty injected terminate cannot revive or block a replacement.
    try {
      worker.terminate();
    } catch (error) {
      this.cause = error;
    }
  }
  private assertLive(): void {
    if (this.snapshot.status === 'disposed') throw new Error('GenerationController is disposed');
  }
  private update(patch: Partial<GenerationState>): void {
    this.snapshot = freezeData({ ...this.snapshot, ...patch });
    if (!this.notificationPending && this.listeners.size) {
      this.notificationPending = true;
      queueMicrotask(() => {
        this.notificationPending = false;
        for (const listener of this.listeners) listener(this.snapshot);
      });
    }
  }
}
