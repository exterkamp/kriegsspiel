import type { Coord } from '@kriegsspiel/protocol';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { sameLocalBinding, snapshotCertifiedBoard, validateLocalBinding } from './board-binding';
import type { BoardSurfaceFactory, BoardSurfaceHandle } from './board-host.component';
import { BoardSurface } from './board-surface';
import type { LocalBoardBinding, LocalPresentation, LocalSessionKey } from './contracts';

type SurfaceFactory = (notify: (ready: boolean, error?: string) => void) => BoardSurfaceHandle;
function joined(promises: readonly Promise<unknown>[]): Promise<void> {
  return Promise.allSettled(promises).then((results) => {
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Local surface retirement failed.');
  });
}
function handled<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}
interface Mount {
  readonly token: symbol;
  readonly canvas: HTMLCanvasElement;
  readonly abort: AbortController;
  readonly detach: () => void;
  pending: Promise<void>;
  resource?: BoardSurfaceHandle;
  invoked: boolean;
  retired: boolean;
  retirement?: Promise<void>;
}

/** Fixed session geography/raster; native hosts receive replaceable canvas leases. */
export class SessionSurface {
  private readonly board: CertifiedBoard;
  private readonly binding: LocalBoardBinding;
  private readonly make: SurfaceFactory;
  private readonly leases = new Set<SurfaceLease>();
  private resource?: BoardSurfaceHandle;
  private current?: SurfaceLease;
  private delivery?: { lease: SurfaceLease; mount: Mount };
  private fence = Promise.resolve();
  private closed = false;
  private disposal?: Promise<void>;

  constructor(
    readonly key: LocalSessionKey,
    board: CertifiedBoard,
    binding: LocalBoardBinding,
    make?: SurfaceFactory,
  ) {
    if (!/^local-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
      throw new TypeError('A fresh local UUID session key is required.');
    this.board = snapshotCertifiedBoard(board);
    this.binding = validateLocalBinding(binding);
    if (
      this.binding.assetIdentity !== this.board.assetIdentity ||
      this.binding.bounds.maxX !== this.board.bounds.maxX ||
      this.binding.bounds.maxY !== this.board.bounds.maxY
    )
      throw new TypeError('Local surface binding disagrees with its board.');
    this.make =
      make ??
      ((notify) => new BoardSurface(key, this.board, this.binding, { onAvailability: notify }));
  }

  readonly factory: BoardSurfaceFactory = (key, board, binding, notify) => {
    if (this.closed) throw new Error('Local session has retired.');
    const snapshot = snapshotCertifiedBoard(board);
    if (
      this.closed ||
      key !== this.key ||
      snapshot.canonicalJson !== this.board.canonicalJson ||
      snapshot.assetIdentity !== this.board.assetIdentity ||
      !sameLocalBinding(binding, this.binding) ||
      JSON.stringify(snapshot.summary) !== JSON.stringify(this.board.summary)
    )
      throw new Error('A host cannot change or revive the fixed local session.');
    const lease = new SurfaceLease(this, notify);
    this.leases.add(lease);
    return lease;
  };

  owns(lease: SurfaceLease, mount?: Mount): boolean {
    return (
      !this.closed &&
      this.current === lease &&
      !lease.closed &&
      (!mount || (!mount.retired && !mount.abort.signal.aborted && lease.current === mount))
    );
  }
  claim(lease: SurfaceLease): Promise<void> {
    if (this.closed || lease.closed)
      return handled(Promise.reject(new Error('Local host retired.')));
    if (this.current === lease) return this.fence;
    const old = this.current;
    this.current = lease;
    this.delivery = undefined;
    this.fence = handled(joined([this.fence, ...(old ? [old.dispose()] : [])]));
    return this.fence;
  }
  acquire(lease: SurfaceLease, mount: Mount): BoardSurfaceHandle {
    if (!this.owns(lease, mount)) throw new Error('Local host retired.');
    if (!this.resource) {
      const resource = this.make((ready, error) => {
        const delivery = this.delivery;
        if (delivery && this.owns(delivery.lease, delivery.mount))
          delivery.lease.notify(ready, error);
      });
      // Record a returned handle even if its constructor synchronously retired us.
      this.resource = resource;
    }
    mount.resource = this.resource;
    if (!this.owns(lease, mount)) throw new Error('Local host retired.');
    return this.resource;
  }
  forward(lease: SurfaceLease, mount: Mount): void {
    if (this.owns(lease, mount)) this.delivery = { lease, mount };
  }
  silence(lease: SurfaceLease, mount: Mount): void {
    if (this.delivery?.lease === lease && this.delivery.mount === mount) this.delivery = undefined;
  }
  live(lease: SurfaceLease): BoardSurfaceHandle | undefined {
    const mount = lease.current;
    return mount && this.owns(lease, mount) && this.delivery?.mount === mount
      ? mount.resource
      : undefined;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.disposal = handled(
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    this.closed = true;
    this.current = undefined;
    this.delivery = undefined;
    const retirement = joined([this.fence, ...[...this.leases].map((lease) => lease.dispose())]);
    void Promise.allSettled([retirement])
      .then(async (results) => {
        // Independent terminal release must run even if a borrowed unmount failed.
        const resource = this.resource;
        this.resource = undefined;
        this.leases.clear();
        await joined([
          ...(results[0].status === 'rejected' ? [Promise.reject(results[0].reason)] : []),
          Promise.resolve().then(() => resource?.dispose()),
        ]);
      })
      .then(resolve, reject);
    return this.disposal;
  }
}

class SurfaceLease implements BoardSurfaceHandle {
  closed = false;
  current?: Mount;
  private fence = Promise.resolve();
  private disposal?: Promise<void>;
  private interaction = false;
  private camera = false;
  constructor(
    private readonly owner: SessionSurface,
    readonly notify: (ready: boolean, error?: string) => void,
  ) {}
  mount(
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
    presentation: LocalPresentation,
  ): Promise<void> {
    if (this.closed || signal.aborted)
      return handled(Promise.reject(new Error('Local host retired.')));
    if (this.current?.canvas === canvas && !this.current.retired) return this.current.pending;
    const predecessor = joined([
      this.fence,
      this.owner.claim(this),
      ...(this.current ? [this.retire(this.current)] : []),
    ]);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const mount: Mount = {
      token: Symbol('canvas'),
      canvas,
      abort,
      detach: () => signal.removeEventListener('abort', cancel),
      pending: Promise.resolve(),
      invoked: false,
      retired: false,
    };
    this.current = mount;
    // Pending is installed before callbacks, factories, and abort propagation can reenter.
    mount.pending = handled(
      Promise.resolve().then(async () => {
        await predecessor;
        if (!this.owner.owns(this, mount)) throw new Error('Local host retired.');
        const resource = this.owner.acquire(this, mount);
        resource.setInteractionEnabled(this.interaction);
        resource.setCameraEnabled(this.camera);
        if (!this.owner.owns(this, mount)) throw new Error('Local host retired.');
        this.owner.forward(this, mount);
        mount.invoked = true;
        await resource.mount(canvas, abort.signal, presentation);
        if (!this.owner.owns(this, mount)) throw new Error('Local host retired.');
      }),
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) abort.abort();
    return mount.pending;
  }
  private retire(mount: Mount): Promise<void> {
    if (mount.retirement) return mount.retirement;
    let resolve!: () => void, reject!: (error: unknown) => void;
    mount.retirement = handled(
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    mount.retired = true;
    this.owner.silence(this, mount);
    if (this.current === mount) this.current = undefined;
    const inherited = this.fence;
    this.fence = handled(joined([inherited, mount.retirement]));
    mount.detach();
    mount.abort.abort();
    void mount.pending
      .catch(() => {})
      .then(() => (mount.invoked ? mount.resource?.unmount(mount.canvas) : undefined))
      .then(resolve, reject);
    return mount.retirement;
  }
  unmount(canvas: HTMLCanvasElement): Promise<void> {
    return this.current?.canvas === canvas ? this.retire(this.current) : this.fence;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.disposal = handled(
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    this.closed = true;
    const current = this.current;
    if (current) this.retire(current);
    void this.fence.then(resolve, reject);
    return this.disposal;
  }
  apply(value: LocalPresentation): void {
    this.owner.live(this)?.apply(value);
  }
  setInteractionEnabled(value: boolean): void {
    if (this.closed) return;
    this.interaction = value;
    this.owner.live(this)?.setInteractionEnabled(value);
  }
  setCameraEnabled(value: boolean): void {
    if (this.closed) return;
    this.camera = value;
    this.owner.live(this)?.setCameraEnabled(value);
  }
  resize(): void {
    this.owner.live(this)?.resize();
  }
  snap(view: 'top-down' | 'oblique'): void {
    this.owner.live(this)?.snap(view);
  }
  pickAt(x: number, y: number): Readonly<Coord> | null {
    return this.owner.live(this)?.pickAt(x, y) ?? null;
  }
}
