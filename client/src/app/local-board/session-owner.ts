import { signal, type Signal } from '@angular/core';
import type {
  BoardPreparation,
  CertifiedBoard,
  MapCatalog,
  SetupProps,
} from '../../shared/game-setup/contracts';
import { createMapCatalog } from '../../shared/game-setup/catalog';
import { createBoardPreparation } from '../../shared/game-setup/preparation';
import {
  createLocalBoardBinding,
  sameLocalBinding,
  snapshotCertifiedBoard,
  validateLocalBinding,
} from './board-binding';
import type {
  BoardSurfaceFactory,
  BoardSurfaceHandle,
  LocalBoardAvailability,
  LocalBoardPoint,
} from './board-host.component';
import type {
  LocalBoardBinding,
  LocalInitializationResult,
  LocalPresentation,
  LocalScope,
  LocalSessionKey,
} from './contracts';
import { loadDefaultBoard } from './default-board';
import { PersonalRepository, snapshotPersonalScope } from './personal-repository';
import { PersonalStore } from './personal-store';
import { SessionSurface as NativeSessionSurface } from './session-surface';

export type { LocalBoardAvailability, LocalBoardPoint } from './board-host.component';
export type OwnerToken = symbol;
export type HostToken = symbol;
export type SetupToken = symbol;
export type RetirementReason = 'replace' | 'failure' | 'departure' | 'pagehide' | 'superseded';
export interface SessionSurface {
  readonly key: LocalSessionKey;
  readonly factory: BoardSurfaceFactory;
  dispose(): Promise<void>;
}
export interface LocalSessionHandle {
  readonly key: LocalSessionKey;
  readonly scope: LocalScope;
  readonly board: CertifiedBoard;
  readonly binding: LocalBoardBinding;
  readonly personal: PersonalStore;
  readonly surface: SessionSurface;
  readonly initialized: Promise<LocalInitializationResult>;
  dispose(reason: RetirementReason): Promise<void>;
}
export interface LocalSetupHandle {
  readonly token: SetupToken;
  readonly props: Readonly<SetupProps>;
}
export interface OwnerSnapshot {
  readonly phase:
    'idle' | 'preparing' | 'retiring' | 'mounting' | 'ready' | 'failed' | 'suspended' | 'disposed';
  readonly session: LocalSessionHandle | null;
  readonly setup: LocalSetupHandle | null;
  readonly available: boolean;
  readonly error: string | null;
  readonly canRetry: boolean;
  readonly canReturnToDefault: boolean;
}
export interface SessionOwnerPorts {
  readonly loadDefault: (signal: AbortSignal) => Promise<CertifiedBoard>;
  readonly bind: (board: CertifiedBoard, signal: AbortSignal) => Promise<LocalBoardBinding>;
  readonly freshKey: () => LocalSessionKey;
  readonly makeRepository: (scope: LocalScope, binding: LocalBoardBinding) => PersonalRepository;
  readonly makePersonal: (
    scope: LocalScope,
    binding: LocalBoardBinding,
    repository: PersonalRepository,
  ) => PersonalStore;
  readonly makeSurface: (
    key: LocalSessionKey,
    board: CertifiedBoard,
    binding: LocalBoardBinding,
  ) => SessionSurface;
  readonly makeCatalog: () => MapCatalog;
  readonly makePreparation: () => BoardPreparation;
}
export interface HostRegistration {
  readonly token: HostToken;
  readonly factory: BoardSurfaceFactory;
  initialized(result: LocalInitializationResult): void;
  availability(result: LocalBoardAvailability): void;
  pointed(result: LocalBoardPoint): void;
  destroyed(): void;
  isCurrent(): boolean;
}
export interface SetupControl {
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
export interface SetupRegistration {
  destroyed(): void;
}
export interface RouteOwnerClaim {
  readonly owner: SessionOwner;
  readonly predecessorRetired: Promise<void>;
  release(reason: RetirementReason): Promise<void>;
}
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function join(promises: readonly Promise<unknown>[]): Promise<void> {
  const promise = Promise.allSettled(promises).then((results) => {
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Local session retirement failed.');
  });
  void promise.catch(() => {});
  return promise;
}
function call(invoke: () => unknown): Promise<void> {
  try {
    return Promise.resolve(invoke()).then(() => undefined);
  } catch {
    return Promise.reject(new Error('Local resource release failed.'));
  }
}
/** Tickets acknowledge leaf settlement, not domain success. Never track coordinator continuations. */
class Leaves {
  private readonly pending = new Set<Promise<void>>();
  reserve(): () => void {
    const ticket = deferred<void>();
    this.pending.add(ticket.promise);
    return () => {
      this.pending.delete(ticket.promise);
      ticket.resolve();
    };
  }
  invoke<T>(invoke: () => T): T {
    const settle = this.reserve();
    try {
      return invoke();
    } finally {
      settle();
    }
  }
  operation<T>(invoke: () => Promise<T>): Promise<T> {
    const settle = this.reserve();
    try {
      return Promise.resolve(invoke()).finally(settle);
    } catch (error) {
      settle();
      return Promise.reject(error);
    }
  }
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}
interface HostRecord {
  readonly token: HostToken;
  phase: 'never-attached' | 'attached' | 'revoked' | 'destroyed';
  readonly destroyed: Deferred<void>;
  readonly leases: Set<OriginLease>;
  readonly acquisitions: Leaves;
  readonly predecessor: Promise<void>;
  teardown?: () => Promise<void>;
  retirement?: Promise<void>;
}
interface SessionRecord {
  readonly key: LocalSessionKey;
  readonly scope: LocalScope;
  readonly board: CertifiedBoard;
  readonly binding: LocalBoardBinding;
  readonly abort: AbortController;
  readonly acquisitions: Leaves;
  readonly operations: Leaves;
  readonly first: Deferred<LocalInitializationResult>;
  readonly hosts: Set<HostRecord>;
  host: HostRecord;
  hostFence: Promise<void>;
  repository?: PersonalRepository;
  personal?: PersonalStore;
  surface?: SessionSurface;
  handle?: LocalSessionHandle;
  closed: boolean;
  retirement?: Promise<void>;
}
interface SetupRecord {
  readonly token: SetupToken;
  readonly abort: AbortController;
  readonly acquisitions: Leaves;
  readonly operations: Leaves;
  readonly destroyed: Deferred<void>;
  phase: 'never-attached' | 'attached' | 'revoked' | 'destroyed';
  preparation?: BoardPreparation;
  preparationReleased: boolean;
  preparationRelease?: Promise<void>;
  control?: SetupControl;
  handle?: LocalSetupHandle;
  closed: boolean;
  committed: boolean;
  retirement?: Promise<void>;
  cancellation?: Promise<void>;
}
const defaults: SessionOwnerPorts = {
  loadDefault: loadDefaultBoard,
  bind: createLocalBoardBinding,
  freshKey: () => `local-${crypto.randomUUID()}`,
  makeRepository: (scope, binding) => new PersonalRepository(scope, binding),
  makePersonal: (scope, binding, repository) => new PersonalStore(scope, binding, repository),
  makeSurface: (key, board, binding) => new NativeSessionSurface(key, board, binding),
  makeCatalog: createMapCatalog,
  makePreparation: createBoardPreparation,
};
const predecessors = new WeakMap<SessionOwner, Promise<void>>();
function hostRecord(predecessor = Promise.resolve()): HostRecord {
  return {
    token: Symbol('host'),
    phase: 'never-attached',
    destroyed: deferred<void>(),
    leases: new Set(),
    acquisitions: new Leaves(),
    predecessor,
  };
}
function validBoard(input: CertifiedBoard): CertifiedBoard {
  const board = snapshotCertifiedBoard(input);
  const ref = board.summary.ref;
  if (
    !ref ||
    !['premade', 'generated'].includes(ref.kind) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(ref.id)
  )
    throw new Error('Start requires a certified saved map reference.');
  return board;
}

/** Route-local lifecycle owner. Angular bridges provide origin and actual destruction acknowledgment. */
export class SessionOwner {
  readonly token: OwnerToken = Symbol('owner');
  private readonly snapshot = signal<OwnerSnapshot>(
    Object.freeze({
      phase: 'idle',
      session: null,
      setup: null,
      available: false,
      error: null,
      canRetry: false,
      canReturnToDefault: false,
    }),
  );
  readonly state: Signal<OwnerSnapshot> = this.snapshot.asReadonly();
  private readonly ports: SessionOwnerPorts;
  private readonly leaves = new Leaves();
  private readonly sessions = new Set<SessionRecord>();
  private readonly setups = new Set<SetupRecord>();
  private readonly usedKeys = new Set<LocalSessionKey>();
  private session?: SessionRecord;
  private setup?: SetupRecord;
  private intent = { personal: false, board: false, camera: false };
  private terminal = false;
  private transition = false;
  private generation = 0;
  private operation?: AbortController;
  private startingSetup?: SetupRecord;
  private startup?: Promise<void>;
  private action?: Promise<void>;
  private disposal?: Promise<void>;
  private fence = Promise.resolve();
  private retryBoard?: CertifiedBoard;
  private setupRetiring = 0;
  private retirementFailed = false;

  constructor(ports: Partial<SessionOwnerPorts> = {}) {
    this.ports = { ...defaults, ...ports };
  }
  private publish(change: Partial<OwnerSnapshot>): void {
    this.snapshot.set(Object.freeze({ ...this.state(), ...change }));
    this.gates();
  }
  private current(generation: number, abort: AbortController): boolean {
    return !this.terminal && this.generation === generation && !abort.signal.aborted;
  }
  private check(generation: number, abort: AbortController): void {
    if (!this.current(generation, abort)) throw new Error('Local session operation retired.');
  }
  private gates(): void {
    const record = this.session;
    const open =
      !this.terminal &&
      !this.transition &&
      !this.setup &&
      !this.setupRetiring &&
      !this.retirementFailed &&
      !!record &&
      !record.closed &&
      this.state().available;
    record?.personal?.setInteractionEnabled(open && this.intent.personal);
    for (const host of record?.hosts ?? []) for (const lease of host.leases) lease.refresh();
  }
  setInteractionState(
    state: Readonly<{ personal: boolean; board: boolean; camera: boolean }>,
  ): void {
    this.intent = { ...state };
    this.gates();
  }
  private allowed(record: SessionRecord, host: HostRecord): boolean {
    return (
      !this.terminal &&
      !record.closed &&
      this.session === record &&
      record.host === host &&
      host.phase === 'attached'
    );
  }
  private leaseGates(record: SessionRecord, host: HostRecord): { board: boolean; camera: boolean } {
    const board =
      this.allowed(record, host) &&
      this.state().available &&
      !this.transition &&
      !this.setup &&
      !this.setupRetiring &&
      !this.retirementFailed &&
      this.intent.board;
    return { board, camera: board && this.intent.camera && !!record.personal?.cameraEnabled() };
  }
  startDefault(): Promise<void> {
    if (!this.startup) this.startup = this.begin(() => this.run());
    return this.startup;
  }
  private begin(invoke: () => Promise<void>): Promise<void> {
    if (this.terminal) return Promise.reject(new Error('Local route retired.'));
    if (this.action) return this.action;
    const action = deferred<void>();
    this.action = action.promise;
    void Promise.resolve()
      .then(invoke)
      .then(
        () => {
          if (this.action === action.promise) this.action = undefined;
          action.resolve();
        },
        (error: unknown) => {
          if (this.action === action.promise) this.action = undefined;
          action.reject(error);
        },
      );
    return action.promise;
  }
  retry(): Promise<void> {
    if (!this.state().canRetry) return this.action ?? Promise.resolve();
    return this.begin(() => this.run(this.retryBoard));
  }
  returnToDefault(): Promise<void> {
    if (!this.state().canReturnToDefault) return this.action ?? Promise.resolve();
    return this.begin(() => this.run());
  }
  private async run(input?: CertifiedBoard, setup?: SetupRecord): Promise<void> {
    if (this.terminal) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.operation = abort;
    this.startingSetup = setup;
    let committed = !setup;
    let candidate: SessionRecord | undefined;
    this.transition = true;
    if (!setup)
      this.publish({
        phase: 'preparing',
        available: false,
        error: null,
        canRetry: false,
        canReturnToDefault: false,
      });
    else this.gates();
    try {
      // Registry fences include inherited failures; no loading may cross them.
      await (predecessors.get(this) ?? Promise.resolve());
      this.check(generation, abort);
      await this.fence;
      this.check(generation, abort);
      const board = input
        ? validBoard(input)
        : validBoard(await this.leaves.operation(() => this.ports.loadDefault(abort.signal)));
      this.check(generation, abort);
      const binding = validateLocalBinding(
        await this.leaves.operation(() => this.ports.bind(board, abort.signal)),
      );
      this.check(generation, abort);
      if (
        binding.assetIdentity !== board.assetIdentity ||
        binding.bounds.maxX !== board.bounds.maxX ||
        binding.bounds.maxY !== board.bounds.maxY
      )
        throw new Error('Certified board binding disagrees.');
      if (setup && (this.setup !== setup || setup.closed)) throw new Error('Setup origin retired.');
      const old = this.session;
      committed = true;
      if (setup) setup.committed = true;
      this.retryBoard = board;
      this.session = undefined;
      this.setup = undefined;
      this.publish({ phase: 'retiring', session: null, setup: null, available: false });
      this.fence = join([
        this.fence,
        ...(old ? [this.retireSession(old)] : []),
        ...(setup ? [this.retireSetup(setup)] : []),
      ]);
      await this.fence;
      this.check(generation, abort);
      const key = this.leaves.invoke(() => this.ports.freshKey());
      this.check(generation, abort);
      if (this.usedKeys.has(key)) throw new Error('A local session key cannot be reused.');
      const scope = snapshotPersonalScope({
        gameId: key,
        sideId: 'blue',
        playerId: 'local-general',
      });
      this.usedKeys.add(key);
      candidate = {
        key,
        scope,
        board,
        binding,
        abort: new AbortController(),
        acquisitions: new Leaves(),
        operations: new Leaves(),
        first: deferred<LocalInitializationResult>(),
        hosts: new Set(),
        host: hostRecord(),
        hostFence: Promise.resolve(),
        closed: false,
      };
      this.sessions.add(candidate);
      const record = candidate;
      record.hosts.add(record.host);
      record.repository = record.acquisitions.invoke(() =>
        this.ports.makeRepository(scope, binding),
      );
      this.check(generation, abort);
      record.personal = record.acquisitions.invoke(() =>
        this.ports.makePersonal(scope, binding, record.repository!),
      );
      this.check(generation, abort);
      record.personal.setInteractionEnabled(false);
      record.surface = record.acquisitions.invoke(() =>
        this.ports.makeSurface(key, board, binding),
      );
      this.check(generation, abort);
      await record.operations.operation(() => record.personal!.initialize(record.abort.signal));
      this.check(generation, abort);
      record.handle = Object.freeze({
        key,
        scope,
        board,
        binding,
        personal: record.personal,
        surface: record.surface,
        initialized: record.first.promise,
        dispose: () => this.retireSession(record),
      });
      this.session = record;
      this.transition = false;
      this.publish({ phase: 'mounting', session: record.handle, available: false });
      const result = await record.first.promise;
      this.check(generation, abort);
      if (!result.ok) throw new Error('Local board initialization failed.');
      this.publish({ phase: 'ready', error: null });
    } catch {
      if (!committed && !this.terminal && this.generation === generation && setup) {
        this.transition = false;
        this.gates();
        // Origin loss abandons validation; only commit may remove the retained session.
        if (setup.closed || abort.signal.aborted) return;
        throw new Error('The saved board could not be validated. The current board was retained.');
      }
      if (candidate) this.fence = join([this.fence, this.retireSession(candidate)]);
      if (this.current(generation, abort)) {
        this.session = undefined;
        this.transition = false;
        this.publish({
          phase: 'failed',
          session: null,
          setup: null,
          available: false,
          error: 'Local board initialization failed. Retry or return to the default board.',
          canRetry: true,
          canReturnToDefault: true,
        });
      }
    } finally {
      if (this.operation === abort) {
        this.operation = undefined;
        this.startingSetup = undefined;
      }
    }
  }

  openSetup(): LocalSetupHandle {
    if (this.setup?.handle && !this.setup.closed) return this.setup.handle;
    if (this.setupRetiring || this.retirementFailed)
      throw new Error('Previous local resources have not retired.');
    if (this.terminal || this.transition || this.action || !this.session || !this.state().available)
      throw new Error('A ready local board is required before setup.');
    const record: SetupRecord = {
      token: Symbol('setup'),
      abort: new AbortController(),
      acquisitions: new Leaves(),
      operations: new Leaves(),
      destroyed: deferred<void>(),
      phase: 'never-attached',
      preparationReleased: false,
      closed: false,
      committed: false,
    };
    this.setup = record;
    this.intent = { personal: false, board: false, camera: false };
    this.setups.add(record);
    this.gates();
    try {
      const catalog = record.acquisitions.invoke(() => this.ports.makeCatalog());
      if (record.closed || this.terminal) throw new Error('Setup retired.');
      record.preparation = record.acquisitions.invoke(() => this.ports.makePreparation());
      if (record.closed || this.terminal) throw new Error('Setup retired.');
      const current = () => {
        if (record.closed || this.terminal || this.setup !== record)
          throw new Error('Setup retired.');
      };
      const prepare = (
        invoke: (signal: AbortSignal) => Promise<CertifiedBoard>,
        signal: AbortSignal,
      ) =>
        record.operations.operation(async () => {
          current();
          if (record.preparationReleased) throw new Error('Preparation retired.');
          const board = await invoke(AbortSignal.any([signal, record.abort.signal]));
          current();
          if (record.preparationReleased) throw new Error('Preparation retired.');
          return board;
        });
      const preparation: BoardPreparation = {
        load: (json, summary, signal) =>
          prepare((signal) => record.preparation!.load(json, summary, signal), signal),
        generate: (recipe, signal) =>
          prepare((signal) => record.preparation!.generate(recipe, signal), signal),
        dispose: () => {
          this.releasePreparation(record);
        },
      };
      const guardedCatalog: MapCatalog = {
        list: async (signal) => {
          current();
          const value = await catalog.list(AbortSignal.any([signal, record.abort.signal]));
          current();
          return value;
        },
        read: async (ref, signal) => {
          current();
          const value = await catalog.read(ref, AbortSignal.any([signal, record.abort.signal]));
          current();
          return value;
        },
        save: async (json, signal) => {
          current();
          const value = await catalog.save(json, AbortSignal.any([signal, record.abort.signal]));
          current();
          return value;
        },
      };
      record.handle = Object.freeze({
        token: record.token,
        props: Object.freeze({
          catalog: guardedCatalog,
          preparation,
          initialRef: this.session?.board.summary.ref ?? undefined,
          onStart: (board: CertifiedBoard) => {
            current();
            // Detach synchronously before scheduling validation; never retain the callback in a leaf ledger.
            const snapshot = validBoard(board);
            return this.begin(() => this.run(snapshot, record));
          },
          onCancel: () => {
            if (this.setup !== record || record.closed || record.committed) return;
            this.setup = undefined;
            this.publish({ setup: null });
            this.fence = join([this.fence, this.retireSetup(record)]);
          },
        }),
      });
      this.publish({ setup: record.handle });
      return record.handle;
    } catch (error) {
      if (this.setup === record) this.setup = undefined;
      this.fence = join([this.fence, this.retireSetup(record)]);
      this.publish({ setup: null });
      throw error;
    }
  }
  attachSetup(handle: LocalSetupHandle, control: SetupControl): SetupRegistration {
    const record = this.setup;
    if (!record || record.handle !== handle || record.closed || record.phase !== 'never-attached')
      throw new Error('Setup attachment retired.');
    record.phase = 'attached';
    record.control = control;
    return Object.freeze({
      destroyed: () => {
        if (record.phase === 'destroyed') return;
        record.phase = 'destroyed';
        record.destroyed.resolve();
        if (!record.committed && this.setup === record) {
          this.setup = undefined;
          this.publish({ setup: null });
        }
        this.fence = join([this.fence, this.retireSetup(record)]);
      },
    });
  }
  cancelSetup(): Promise<void> {
    const record = this.setup;
    if (!record) return this.fence;
    if (record.committed || this.transition) return Promise.resolve();
    if (record.cancellation) return record.cancellation;
    const cancellation = deferred<void>();
    record.cancellation = cancellation.promise;
    const cancel = record.control ? call(() => record.control!.cancel()) : Promise.resolve();
    void cancel
      .then(() => {
        if (this.setup === record) {
          this.setup = undefined;
          this.publish({ setup: null });
        }
        this.fence = join([this.fence, this.retireSetup(record)]);
        return this.fence;
      })
      .then(cancellation.resolve, cancellation.reject);
    return cancellation.promise;
  }
  private releasePreparation(record: SetupRecord): Promise<void> {
    if (!record.preparationRelease) {
      const released = deferred<void>();
      record.preparationRelease = released.promise;
      record.preparationReleased = true;
      record.abort.abort();
      void record.acquisitions
        .settled()
        .then(() => call(() => record.preparation?.dispose()))
        .then(released.resolve, released.reject);
    }
    return record.preparationRelease;
  }
  private retireSetup(record: SetupRecord): Promise<void> {
    if (record.retirement) return record.retirement;
    const retired = deferred<void>();
    record.retirement = retired.promise;
    ++this.setupRetiring;
    record.closed = true;
    if (!record.committed && this.startingSetup === record) this.operation?.abort();
    const attached = record.phase === 'attached' || record.phase === 'revoked';
    if (record.phase !== 'destroyed') record.phase = 'revoked';
    record.abort.abort();
    const control = record.control ? call(() => record.control!.dispose()) : Promise.resolve();
    const preparation = this.releasePreparation(record);
    const finish = () => {
      --this.setupRetiring;
      record.control = undefined;
      record.preparation = undefined;
      this.setups.delete(record);
    };
    void join([
      control,
      preparation,
      record.operations.settled(),
      ...(attached ? [record.destroyed.promise] : []),
    ]).then(
      () => {
        finish();
        retired.resolve();
      },
      (error: unknown) => {
        this.retirementFailed = true;
        finish();
        retired.reject(error);
      },
    );
    return retired.promise;
  }

  attachHost(handle: LocalSessionHandle, teardown: () => Promise<void>): HostRegistration {
    const record = this.session;
    if (!record || record.handle !== handle || record.closed || this.terminal)
      throw new Error('Host attachment retired.');
    if (record.host.phase !== 'never-attached') {
      const predecessor = this.retireHost(record.host);
      record.hostFence = join([record.hostFence, predecessor]);
      record.host = hostRecord(record.hostFence);
      record.hosts.add(record.host);
    }
    const host = record.host;
    host.phase = 'attached';
    host.teardown = teardown;
    this.publish({ available: false });
    const current = () => this.allowed(record, host);
    return Object.freeze<HostRegistration>({
      token: host.token,
      isCurrent: current,
      factory: (key, board, binding, notify) => {
        if (
          !current() ||
          key !== record.key ||
          board.canonicalJson !== record.board.canonicalJson ||
          !sameLocalBinding(binding, record.binding)
        )
          throw new Error('Host origin retired or disagrees.');
        let raw: BoardSurfaceHandle | undefined;
        const lease = new OriginLease(
          current,
          () => this.leaseGates(record, host),
          host.predecessor,
          () => raw!,
        );
        host.leases.add(lease);
        try {
          raw = host.acquisitions.invoke(() =>
            record.surface!.factory(key, board, binding, (ready, error) => {
              if (current() && !lease.closed) notify(ready, error);
            }),
          );
          if (!current()) {
            void lease.dispose();
            throw new Error('Host origin retired.');
          }
          lease.refresh();
          return lease;
        } catch (error) {
          if (raw) void lease.dispose();
          throw error;
        }
      },
      initialized: (result) => {
        if (!current() || result.key !== record.key) return;
        record.first.resolve(
          Object.freeze({
            ...result,
            ...(result.ok ? {} : { error: 'Local board initialization failed.' }),
          }),
        );
        if (!result.ok) this.hostFailure(record);
      },
      availability: (result) => {
        if (!current() || result.key !== record.key) return;
        this.publish({ available: result.ready });
        if (result.error) this.hostFailure(record);
      },
      pointed: (result) => {
        if (current() && result.key === record.key && this.leaseGates(record, host).board)
          record.personal?.acceptPoint(result);
      },
      destroyed: () => {
        if (host.phase === 'destroyed') return;
        host.phase = 'destroyed';
        host.destroyed.resolve();
        void this.retireHost(host);
        if (!record.closed && this.session === record && record.host === host)
          this.publish({ available: false });
      },
    });
  }
  private hostFailure(record: SessionRecord): void {
    record.first.resolve({
      key: record.key,
      ok: false,
      error: 'Local board initialization failed.',
    });
    if (this.session !== record || record.closed || this.terminal) return;
    this.retryBoard = record.board;
    this.session = undefined;
    this.fence = join([this.fence, this.retireSession(record)]);
    this.publish({
      phase: 'failed',
      session: null,
      available: false,
      error: 'Local board initialization failed. Retry or return to the default board.',
      canRetry: true,
      canReturnToDefault: true,
    });
  }
  private retireHost(host: HostRecord): Promise<void> {
    if (host.retirement) return host.retirement;
    const retired = deferred<void>();
    host.retirement = retired.promise;
    const attached = host.phase === 'attached' || host.phase === 'revoked';
    if (host.phase !== 'destroyed') host.phase = 'revoked';
    const gates = [...host.leases].map((lease) => call(() => lease.refresh()));
    // Native teardown can reenter; the promise and revocation already exist.
    const native = host.teardown ? call(host.teardown) : Promise.resolve();
    void host.acquisitions
      .settled()
      .then(() =>
        join([
          native,
          ...gates,
          ...[...host.leases].map((lease) => lease.dispose()),
          ...(attached ? [host.destroyed.promise] : []),
        ]),
      )
      .finally(() => {
        host.leases.clear();
        host.teardown = undefined;
      })
      .then(retired.resolve, retired.reject);
    return retired.promise;
  }
  private retireSession(record: SessionRecord): Promise<void> {
    if (record.retirement) return record.retirement;
    const retired = deferred<void>();
    record.retirement = retired.promise;
    record.closed = true;
    record.first.resolve({
      key: record.key,
      ok: false,
      error: 'Local session retired before initialization.',
    });
    record.abort.abort();
    const gates = call(() => record.personal?.setInteractionEnabled(false));
    const hosts = [...record.hosts].map((host) => this.retireHost(host));
    void record.acquisitions
      .settled()
      .then(() => {
        // Independent leaves begin even when another release throws/rejects.
        const personal = record.personal
          ? call(() => record.personal!.dispose())
          : call(() => record.repository?.dispose());
        const surface = call(() => record.surface?.dispose());
        return join([gates, personal, surface, record.operations.settled(), ...hosts]);
      })
      .finally(() => {
        record.repository = undefined;
        record.personal = undefined;
        record.surface = undefined;
        this.sessions.delete(record);
      })
      .then(retired.resolve, retired.reject);
    return retired.promise;
  }
  dispose(reason: RetirementReason): Promise<void> {
    if (this.disposal) return this.disposal;
    const disposed = deferred<void>();
    this.disposal = disposed.promise;
    this.terminal = true;
    ++this.generation;
    this.operation?.abort();
    this.transition = true;
    const gates = call(() => this.gates());
    this.session = undefined;
    this.setup = undefined;
    this.retryBoard = undefined;
    this.publish({
      phase: reason === 'pagehide' ? 'suspended' : 'disposed',
      session: null,
      setup: null,
      available: false,
      error: null,
      canRetry: false,
      canReturnToDefault: false,
    });
    const sessions = [...this.sessions].map((record) => this.retireSession(record));
    const setups = [...this.setups].map((record) => this.retireSetup(record));
    void join([gates, this.fence, ...sessions, ...setups, this.leaves.settled()]).then(
      disposed.resolve,
      disposed.reject,
    );
    return disposed.promise;
  }
}

/** Child intents can only narrow these gates; they can never reopen a modal/retired origin. */
class OriginLease implements BoardSurfaceHandle {
  closed = false;
  private interaction = false;
  private camera = false;
  private disposal?: Promise<void>;
  constructor(
    private readonly current: () => boolean,
    private readonly gates: () => { board: boolean; camera: boolean },
    private readonly predecessor: Promise<void>,
    private readonly raw: () => BoardSurfaceHandle,
  ) {}
  refresh(): void {
    const gates = this.gates();
    this.raw()?.setInteractionEnabled(
      !this.closed && this.current() && gates.board && this.interaction,
    );
    this.raw()?.setCameraEnabled(!this.closed && this.current() && gates.camera && this.camera);
  }
  async mount(
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
    presentation: LocalPresentation,
  ): Promise<void> {
    await this.predecessor;
    if (this.closed || !this.current() || signal.aborted) throw new Error('Host origin retired.');
    this.refresh();
    await this.raw().mount(canvas, signal, presentation);
    if (this.closed || !this.current() || signal.aborted) throw new Error('Host origin retired.');
  }
  unmount(canvas: HTMLCanvasElement): Promise<void> {
    return this.closed ? this.disposal! : this.raw().unmount(canvas);
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const disposed = deferred<void>();
    this.disposal = disposed.promise;
    this.closed = true;
    void call(() => this.raw()?.dispose()).then(disposed.resolve, disposed.reject);
    return disposed.promise;
  }
  apply(value: LocalPresentation): void {
    if (!this.closed && this.current()) this.raw().apply(value);
  }
  setInteractionEnabled(value: boolean): void {
    if (this.closed || !this.current()) return;
    this.interaction = value;
    this.refresh();
  }
  setCameraEnabled(value: boolean): void {
    if (this.closed || !this.current()) return;
    this.camera = value;
    this.refresh();
  }
  resize(): void {
    if (!this.closed && this.current()) this.raw().resize();
  }
  snap(view: 'top-down' | 'oblique'): void {
    if (!this.closed && this.current() && this.gates().camera) this.raw().snap(view);
  }
  pickAt(x: number, y: number) {
    return !this.closed && this.current() && this.gates().board ? this.raw().pickAt(x, y) : null;
  }
}
interface RegistryEntry {
  claim?: RouteOwnerClaim;
  readonly fence: Promise<void>;
}
const registry = new WeakMap<Window, Map<object, RegistryEntry>>();
/** Constructor claims serialize only leaf retirement, including canceled intermediate owners. */
export function claimRouteOwner(
  window: Window,
  slot: object,
  ports: Partial<SessionOwnerPorts> = {},
): RouteOwnerClaim {
  let slots = registry.get(window);
  if (!slots) {
    slots = new Map();
    registry.set(window, slots);
  }
  const old = slots.get(slot);
  const inherited = old?.claim
    ? old.claim.release('superseded')
    : (old?.fence ?? Promise.resolve());
  const owner = new SessionOwner(ports);
  predecessors.set(owner, inherited);
  let release: Promise<void> | undefined;
  const completion = deferred<void>();
  const entry: RegistryEntry = { fence: completion.promise };
  const claim: RouteOwnerClaim = Object.freeze({
    owner,
    predecessorRetired: inherited,
    release: (reason: RetirementReason) => {
      if (release) return release;
      release = completion.promise;
      const own = owner.dispose(reason);
      void join([inherited, own]).then(
        () => {
          if (slots!.get(slot) === entry) entry.claim = undefined;
          completion.resolve();
        },
        (error: unknown) => {
          if (slots!.get(slot) === entry) entry.claim = undefined;
          completion.reject(error);
        },
      );
      return release;
    },
  });
  entry.claim = claim;
  slots.set(slot, entry);
  return claim;
}
