import { Component, DestroyRef, inject, input, signal, type OnInit } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BoardPreparation,
  CertifiedBoard,
  MapCatalog,
} from '../../shared/game-setup/contracts';
import { createLocalBoardBinding } from './board-binding';
import type { BoardSurfaceHandle } from './board-host.component';
import type { LocalBoardBinding, LocalPresentation } from './contracts';
import { PersonalRepository } from './personal-repository';
import { PersonalStore } from './personal-store';
import {
  claimRouteOwner,
  SessionOwner,
  type HostRegistration,
  type LocalSessionHandle,
  type LocalSetupHandle,
  type SessionOwnerPorts,
  type SetupRegistration,
} from './session-owner';
import { SessionSurface } from './session-surface';

@Component({ selector: 'ks-owner-setup-ack', template: '' })
class SetupAckFixture implements OnInit {
  readonly owner = input.required<SessionOwner>();
  readonly handle = input.required<LocalSetupHandle>();
  private registration?: SetupRegistration;
  constructor() {
    inject(DestroyRef).onDestroy(() => this.registration?.destroyed());
  }
  ngOnInit(): void {
    this.registration = this.owner().attachSetup(this.handle(), {
      cancel: async () => {},
      dispose: async () => {},
    });
  }
}
@Component({
  imports: [SetupAckFixture],
  template: '@if (visible()) { <ks-owner-setup-ack [owner]="owner" [handle]="handle" /> }',
})
class RetainedSetupParentFixture {
  readonly visible = signal(true);
  owner!: SessionOwner;
  handle!: LocalSetupHandle;
}

let board: CertifiedBoard;
let binding: LocalBoardBinding;
const owners: SessionOwner[] = [];
const hosts: HostRegistration[] = [];
const setups: SetupRegistration[] = [];
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  board = {
    asset,
    canonicalJson: canonicalizeAsset(asset),
    assetIdentity: await assetIdentity(asset, 'asset'),
    bounds: asset.bounds,
    summary: {
      name: asset.name,
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
      ref: { kind: 'premade', id: 'reference' },
    },
  };
  binding = await createLocalBoardBinding(board, new AbortController().signal);
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(async () => {
  TestBed.resetTestingModule();
  const retirement = owners.splice(0).map((owner) => owner.dispose('departure'));
  hosts.splice(0).forEach((host) => host.destroyed());
  setups.splice(0).forEach((setup) => setup.destroyed());
  await Promise.allSettled(retirement);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const presentation = (): LocalPresentation => ({
  binding,
  marks: [],
  gameMs: 0,
  rate: 0,
  pieces: [],
  roster: [],
  papers: [],
});
function raw(): BoardSurfaceHandle {
  return {
    mount: vi.fn(async () => {}),
    unmount: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    apply: vi.fn(),
    setInteractionEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    resize: vi.fn(),
    snap: vi.fn(),
    pickAt: vi.fn(() => ({ x: 12, y: 20 })),
  };
}
function packet(overrides: Partial<SessionOwnerPorts> = {}) {
  let id = 0;
  const storage = new Map<string, string>();
  const repositories: PersonalRepository[] = [],
    stores: PersonalStore[] = [],
    surfaces: SessionSurface[] = [],
    resources: BoardSurfaceHandle[] = [];
  const preparation: BoardPreparation = {
    load: vi.fn(async () => board),
    generate: vi.fn(async () => board),
    dispose: vi.fn(),
  };
  const catalog: MapCatalog = {
    list: vi.fn(async () => []),
    read: vi.fn(async () => board.canonicalJson),
    save: vi.fn(async () => ({ ...board.summary, ref: board.summary.ref! })),
  };
  const ports: { -readonly [K in keyof SessionOwnerPorts]: SessionOwnerPorts[K] } = {
    loadDefault: vi.fn(async () => board),
    bind: vi.fn(createLocalBoardBinding),
    freshKey: vi.fn<SessionOwnerPorts['freshKey']>(
      () => `local-00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    ),
    makeRepository: vi.fn((scope, fixed) => {
      const repository = new PersonalRepository(scope, fixed, {
        storage: () => ({
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => {
            storage.set(key, value);
          },
        }),
      });
      repositories.push(repository);
      return repository;
    }),
    makePersonal: vi.fn((scope, fixed, repository) => {
      const store = new PersonalStore(scope, fixed, repository);
      stores.push(store);
      return store;
    }),
    makeSurface: vi.fn((key, certified, fixed) => {
      const resource = raw();
      resources.push(resource);
      const surface = new SessionSurface(key, certified, fixed, () => resource);
      surfaces.push(surface);
      return surface;
    }),
    makeCatalog: vi.fn(() => catalog),
    makePreparation: vi.fn(() => preparation),
    ...overrides,
  };
  const owner = new SessionOwner(ports);
  owners.push(owner);
  return { owner, ports, preparation, catalog, storage, repositories, stores, surfaces, resources };
}
async function descriptor(owner: SessionOwner): Promise<LocalSessionHandle> {
  await vi.waitFor(() => expect(owner.state().session).not.toBeNull());
  return owner.state().session!;
}
function attach(
  owner: SessionOwner,
  handle: LocalSessionHandle,
  teardown: () => Promise<void> = vi.fn(async () => {}),
) {
  const host = owner.attachHost(handle, teardown);
  hosts.push(host);
  return host;
}
function acknowledge(host: HostRegistration, handle: LocalSessionHandle) {
  host.availability({ key: handle.key, ready: true });
  host.initialized({ key: handle.key, ok: true });
}
async function ready(owner: SessionOwner) {
  const starting = owner.startDefault();
  const handle = await descriptor(owner),
    host = attach(owner, handle);
  acknowledge(host, handle);
  await starting;
  return { handle, host };
}
function attachSetup(
  owner: SessionOwner,
  handle = owner.openSetup(),
  control = { cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}) },
) {
  const registration = owner.attachSetup(handle, control);
  setups.push(registration);
  return { handle, control, registration };
}

describe('session owner startup, retirement and privacy', () => {
  it('uses one immutable fresh full-scope store, real binding and explicit first-frame acknowledgment', async () => {
    const p = packet();
    const starting = p.owner.startDefault();
    expect(p.owner.startDefault()).toBe(starting);
    const handle = await descriptor(p.owner);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.board.asset)).toBe(true);
    expect(handle.scope).toEqual({ gameId: handle.key, sideId: 'blue', playerId: 'local-general' });
    expect(handle.personal.scope).toEqual(handle.scope);
    expect(handle.personal.binding).toEqual(binding);
    expect(p.owner.state().phase).toBe('mounting');
    const host = attach(p.owner, handle);
    host.initialized({ key: 'local-other', ok: true });
    expect(p.owner.state().phase).toBe('mounting');
    acknowledge(host, handle);
    await starting;
    expect(p.owner.state().phase).toBe('ready');
    expect(p.ports.makeCatalog).not.toHaveBeenCalled();
    expect(p.ports.makePreparation).not.toHaveBeenCalled();
  });
  it('departure before the queued startup invokes no loader and publishes no late state', async () => {
    const p = packet();
    const start = p.owner.startDefault();
    const disposed = p.owner.dispose('departure');
    expect(p.owner.dispose('pagehide')).toBe(disposed);
    await Promise.all([start, disposed]);
    expect(p.ports.loadDefault).not.toHaveBeenCalled();
    expect(p.owner.state().phase).toBe('disposed');
  });
  it.each(['resolve', 'reject'] as const)(
    'departure retains actual default operation through late %s',
    async (outcome) => {
      const loading = deferred<CertifiedBoard>();
      let signal!: AbortSignal;
      const p = packet({
        loadDefault: vi.fn((captured) => {
          signal = captured;
          return loading.promise;
        }),
      });
      const start = p.owner.startDefault();
      await vi.waitFor(() => expect(p.ports.loadDefault).toHaveBeenCalledOnce());
      const disposal = p.owner.dispose('departure');
      let settled = false;
      void disposal.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(signal.aborted).toBe(true);
      if (outcome === 'resolve') loading.resolve(board);
      else loading.reject(new Error(board.canonicalJson));
      await Promise.all([start, disposal]);
      expect(p.ports.freshKey).not.toHaveBeenCalled();
      expect(p.owner.state().error).toBeNull();
    },
  );
  it('departure during full binding awaits hash settlement without allocating scope', async () => {
    const hashing = deferred<LocalBoardBinding>();
    const p = packet({ bind: vi.fn(() => hashing.promise) });
    const start = p.owner.startDefault();
    await vi.waitFor(() => expect(p.ports.bind).toHaveBeenCalledOnce());
    const stop = p.owner.dispose('departure');
    hashing.resolve(binding);
    await Promise.all([start, stop]);
    expect(p.ports.freshKey).not.toHaveBeenCalled();
  });
  it('never-attached retirement settles the first result without waiting a nonexistent Angular hook', async () => {
    const p = packet();
    const start = p.owner.startDefault(),
      handle = await descriptor(p.owner);
    await p.owner.dispose('departure');
    await start;
    expect(await handle.initialized).toMatchObject({ key: handle.key, ok: false });
    expect(() => p.owner.attachHost(handle, async () => {})).toThrow('retired');
  });
  it('attached pending initialization requires native retirement and the actual destruction hook independently', async () => {
    const held = deferred();
    const p = packet();
    const start = p.owner.startDefault();
    const handle = await descriptor(p.owner),
      teardown = vi.fn(() => held.promise),
      host = attach(p.owner, handle, teardown);
    const stop = p.owner.dispose('departure');
    let done = false;
    void stop.then(() => {
      done = true;
    });
    expect(teardown).toHaveBeenCalledOnce();
    held.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    host.destroyed();
    await Promise.all([start, stop]);
    expect(done).toBe(true);
  });
  it.each(['repository', 'personal', 'surface'] as const)(
    'retains and independently releases partial construction after %s factory throws',
    async (stage) => {
      const p = packet();
      const disposeRepository = vi.fn(async () => {}),
        disposePersonal = vi.fn(async () => {});
      if (stage === 'repository')
        p.ports.makeRepository = vi.fn(() => {
          throw new Error('private source');
        });
      else {
        p.ports.makeRepository = vi.fn((scope, fixed) => {
          const repository = new PersonalRepository(scope, fixed);
          repository.dispose = disposeRepository;
          return repository;
        });
        if (stage === 'personal')
          p.ports.makePersonal = vi.fn(() => {
            throw new Error('private source');
          });
        else {
          p.ports.makePersonal = vi.fn((scope, fixed, repository) => {
            const store = new PersonalStore(scope, fixed, repository);
            store.dispose = disposePersonal;
            return store;
          });
          p.ports.makeSurface = vi.fn(() => {
            throw new Error('private source');
          });
        }
      }
      // Ports are captured by value; construct the fault owner after replacing them.
      const owner = new SessionOwner(p.ports);
      owners.push(owner);
      await owner.startDefault();
      await owner.dispose('departure');
      expect(owner.state().error).toBeNull();
      if (stage === 'personal') expect(disposeRepository).toHaveBeenCalledOnce();
      if (stage === 'surface') expect(disposePersonal).toHaveBeenCalledOnce();
    },
  );
  it.each(['repository', 'personal', 'surface'] as const)(
    'disposes the late returned %s handle after synchronous constructor reentry',
    async (stage) => {
      const p = packet();
      let stop!: Promise<void>;
      const released = vi.fn(async () => {});
      const ports = { ...p.ports };
      if (stage === 'repository')
        ports.makeRepository = (scope, fixed) => {
          stop = owner.dispose('departure');
          const r = new PersonalRepository(scope, fixed);
          r.dispose = released;
          return r;
        };
      if (stage === 'personal')
        ports.makePersonal = (scope, fixed, repo) => {
          stop = owner.dispose('departure');
          const s = new PersonalStore(scope, fixed, repo);
          s.dispose = released;
          return s;
        };
      if (stage === 'surface')
        ports.makeSurface = (key) => {
          stop = owner.dispose('departure');
          return { key, factory: vi.fn(), dispose: released };
        };
      const owner: SessionOwner = new SessionOwner(ports);
      owners.push(owner);
      await owner.startDefault();
      await stop;
      expect(released).toHaveBeenCalledOnce();
      expect(owner.state().session).toBeNull();
    },
  );
  it('retirement starts personal abort/disposal while initialize itself is still pending', async () => {
    const initialization = deferred();
    const p = packet();
    let signal!: AbortSignal;
    const disposed = vi.fn(async () => {});
    const owner = new SessionOwner({
      ...p.ports,
      makePersonal: (scope, fixed, repository) => {
        const store = new PersonalStore(scope, fixed, repository);
        store.initialize = (captured) => {
          signal = captured!;
          return initialization.promise;
        };
        store.dispose = disposed;
        return store;
      },
    });
    owners.push(owner);
    const starting = owner.startDefault();
    await vi.waitFor(() => expect(signal).toBeDefined());
    const stop = owner.dispose('departure');
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce());
    expect(signal.aborted).toBe(true);
    initialization.resolve();
    await Promise.all([starting, stop]);
    expect(owner.state().session).toBeNull();
  });
});

describe('setup private preparation facade and replacement', () => {
  it('retires acquired preparation even with no view/configuration/OnInit', async () => {
    const p = packet();
    const { host } = await ready(p.owner);
    const setup = p.owner.openSetup();
    const stop = p.owner.dispose('departure');
    host.destroyed();
    await stop;
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
    await expect(
      setup.props.preparation.load('', board.summary as never, new AbortController().signal),
    ).rejects.toThrow('retired');
  });
  it('closes facade invocation synchronously before the underlying void dispose settles', async () => {
    const p = packet();
    await ready(p.owner);
    const setup = p.owner.openSetup();
    setup.props.preparation.dispose();
    await expect(
      setup.props.preparation.generate({} as never, new AbortController().signal),
    ).rejects.toThrow('retired');
    expect(p.preparation.generate).not.toHaveBeenCalled();
    await p.owner.cancelSetup();
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
  it('reserves preparation operation before a load synchronously reenters owner disposal', async () => {
    const operation = deferred<CertifiedBoard>();
    const p = packet();
    const { host } = await ready(p.owner);
    let stop!: Promise<void>;
    vi.mocked(p.preparation.load).mockImplementation(() => {
      stop = p.owner.dispose('departure');
      host.destroyed();
      return operation.promise;
    });
    const setup = p.owner.openSetup(),
      load = setup.props.preparation.load('', board.summary as never, new AbortController().signal);
    let done = false;
    void stop.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    operation.resolve(board);
    await expect(load).rejects.toThrow('retired');
    await stop;
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
  it('tracks deferred canceled operations independently of control disposal and waits before successor allocation', async () => {
    const operation = deferred<CertifiedBoard>();
    const p = packet();
    const { handle: old, host } = await ready(p.owner);
    vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
    const setup = p.owner.openSetup();
    const load = setup.props.preparation.load(
      '',
      board.summary as never,
      new AbortController().signal,
    );
    const starting = setup.props.onStart(board);
    await vi.waitFor(() => expect(p.owner.state().session).toBeNull());
    host.destroyed();
    await Promise.resolve();
    expect(p.ports.freshKey).toHaveBeenCalledTimes(1);
    operation.resolve(board);
    await expect(load).rejects.toThrow('retired');
    const next = await descriptor(p.owner),
      nextHost = attach(p.owner, next);
    acknowledge(nextHost, next);
    await starting;
    expect(next.key).not.toBe(old.key);
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
  it('retains a preparation returned after its factory synchronously closes an unattached setup', async () => {
    const p = packet();
    let stop!: Promise<void>;
    const owner: SessionOwner = new SessionOwner({
      ...p.ports,
      makePreparation: () => {
        stop = owner.dispose('departure');
        return p.preparation;
      },
    });
    owners.push(owner);
    const { host } = await ready(owner);
    expect(() => owner.openSetup()).toThrow('retired');
    host.destroyed();
    await stop;
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
  it('does not invoke a subsequent preparation port after catalog factory reentry', async () => {
    const p = packet();
    const owner: SessionOwner = new SessionOwner({
      ...p.ports,
      makeCatalog: () => {
        void owner.dispose('departure');
        return p.catalog;
      },
    });
    owners.push(owner);
    const { host } = await ready(owner);
    expect(() => owner.openSetup()).toThrow('retired');
    host.destroyed();
    await owner.dispose('departure');
    expect(p.ports.makePreparation).not.toHaveBeenCalled();
  });
  it('rejects late catalog data after cancellation without holding cleanup open', async () => {
    const listing = deferred<never[]>();
    const p = packet();
    await ready(p.owner);
    vi.mocked(p.catalog.list).mockReturnValue(listing.promise);
    const setup = p.owner.openSetup(),
      list = setup.props.catalog.list(new AbortController().signal);
    await p.owner.cancelSetup();
    listing.resolve([]);
    await expect(list).rejects.toThrow('retired');
  });
  it.each(['clone', 'ref', 'hash'] as const)(
    'precommit %s failure preserves the old session and unsaved private draft',
    async (fault) => {
      const p = packet();
      const { handle, host } = await ready(p.owner);
      handle.personal.setInteractionEnabled(true);
      handle.personal.setNotebookText('private draft');
      const setup = p.owner.openSetup();
      let candidate: CertifiedBoard = board;
      if (fault === 'clone')
        candidate = { ...board, asset: { ...board.asset, extra: () => {} } } as CertifiedBoard;
      if (fault === 'ref') candidate = { ...board, summary: { ...board.summary, ref: null } };
      if (fault === 'hash')
        vi.mocked(p.ports.bind).mockRejectedValueOnce(new Error(board.canonicalJson));
      await expect(Promise.resolve().then(() => setup.props.onStart(candidate))).rejects.toThrow();
      expect(p.owner.state().session).toBe(handle);
      expect(host.isCurrent()).toBe(true);
      expect(handle.personal.notebook().draft).toBe('private draft');
      expect(p.ports.freshKey).toHaveBeenCalledTimes(1);
    },
  );
  it('requires separate host/setup hook acknowledgments and native resource retirement after commit', async () => {
    const native = deferred();
    const p = packet();
    const start = p.owner.startDefault(),
      old = await descriptor(p.owner),
      host = attach(p.owner, old, () => native.promise);
    acknowledge(host, old);
    await start;
    const setup = attachSetup(p.owner);
    const replacement = setup.handle.props.onStart(board);
    await vi.waitFor(() => expect(p.owner.state().session).toBeNull());
    expect(setup.control.dispose).toHaveBeenCalledOnce();
    host.destroyed();
    setup.registration.destroyed();
    await Promise.resolve();
    expect(p.ports.freshKey).toHaveBeenCalledTimes(1);
    native.resolve();
    const next = await descriptor(p.owner),
      freshHost = attach(p.owner, next);
    acknowledge(freshHost, next);
    await replacement;
    expect(next.key).not.toBe(old.key);
  });
  it('postcommit failure permanently removes old scope; retry same board then default use fresh keys and no private drafts', async () => {
    const p = packet();
    const first = await ready(p.owner);
    first.handle.personal.setInteractionEnabled(true);
    first.handle.personal.setNotebookText('private');
    await first.handle.personal.saveNotebook();
    const retained = new Map(p.storage);
    const setup = p.owner.openSetup();
    const replacement = setup.props.onStart(board);
    await vi.waitFor(() => expect(p.owner.state().session).toBeNull());
    first.host.destroyed();
    const failing = await descriptor(p.owner),
      failedHost = attach(p.owner, failing);
    failedHost.initialized({ key: failing.key, ok: false, error: board.canonicalJson });
    failedHost.destroyed();
    await replacement;
    expect(p.owner.state().error).not.toContain(board.canonicalJson);
    expect(p.owner.state().session).toBeNull();
    const retry = p.owner.retry(),
      next = await descriptor(p.owner),
      nextHost = attach(p.owner, next);
    acknowledge(nextHost, next);
    await retry;
    expect(new Set([first.handle.key, failing.key, next.key]).size).toBe(3);
    expect(next.personal.notebook().draft).toBe('');
    nextHost.availability({ key: next.key, ready: false, error: 'lost' });
    nextHost.destroyed();
    const fallback = p.owner.returnToDefault(),
      last = await descriptor(p.owner),
      lastHost = attach(p.owner, last);
    acknowledge(lastHost, last);
    await fallback;
    expect(last.key).not.toBe(next.key);
    expect(p.ports.loadDefault).toHaveBeenCalledTimes(2);
    for (const [key, value] of retained) expect(p.storage.get(key)).toBe(value);
  });
  it('Start can await replacement while setup disposal excludes that callback and leaves route departure acyclic', async () => {
    const p = packet();
    const { host } = await ready(p.owner);
    const setup = attachSetup(p.owner);
    const start = setup.handle.props.onStart(board);
    await vi.waitFor(() => expect(p.owner.state().session).toBeNull());
    const stop = p.owner.dispose('departure');
    host.destroyed();
    setup.registration.destroyed();
    await Promise.all([start, stop]);
    expect(p.owner.state().phase).toBe('disposed');
  });
  it('uncommitted parent-view setup destruction invalidates ports; a new modal has a distinct token/preparation', async () => {
    const p = packet();
    await ready(p.owner);
    const setup = attachSetup(p.owner);
    setup.registration.destroyed();
    await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
    expect(p.owner.state().setup).toBeNull();
    expect(() => setup.handle.props.onStart(board)).toThrow('retired');
    const next = p.owner.openSetup();
    expect(next.token).not.toBe(setup.handle.token);
  });
  it('cancel callback does not recursively await the cancellation task', async () => {
    const p = packet();
    await ready(p.owner);
    const handle = p.owner.openSetup();
    const control = {
      cancel: vi.fn(async () => {
        handle.props.onCancel();
      }),
      dispose: vi.fn(async () => {}),
    };
    const setup = attachSetup(p.owner, handle, control);
    const cancel = p.owner.cancelSetup();
    setup.registration.destroyed();
    await cancel;
    expect(control.cancel).toHaveBeenCalledOnce();
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
});

describe('origin guards and authoritative lease gates', () => {
  it('future leases and stale true setters remain closed during modal, including camera and points', async () => {
    const p = packet();
    const { handle, host } = await ready(p.owner);
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
    lease.setInteractionEnabled(true);
    lease.setCameraEnabled(true);
    await lease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    const resource = p.resources[0]!;
    expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(true);
    p.owner.openSetup();
    lease.setInteractionEnabled(true);
    lease.setCameraEnabled(true);
    expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(false);
    expect(resource.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(handle.personal.interactionEnabled()).toBe(false);
    expect(lease.pickAt(1, 2)).toBeNull();
    p.owner.setInteractionState({ personal: false, board: false, camera: false });
    await p.owner.cancelSetup();
    expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(false);
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(true);
  });
  it('modal before lease acquisition and readiness changes cannot bypass closed intent', async () => {
    const p = packet();
    const { handle, host } = await ready(p.owner);
    p.owner.openSetup();
    const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
    lease.setInteractionEnabled(true);
    lease.setCameraEnabled(true);
    await lease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    host.availability({ key: handle.key, ready: true });
    expect(p.resources[0]!.setInteractionEnabled).toHaveBeenLastCalledWith(false);
  });
  it('new same-key host waits predecessor resources and destruction; old output/factory/gate cannot affect it', async () => {
    const oldResources = deferred();
    const p = packet();
    const start = p.owner.startDefault(),
      handle = await descriptor(p.owner),
      old = attach(p.owner, handle, () => oldResources.promise);
    acknowledge(old, handle);
    await start;
    const oldLease = old.factory(handle.key, handle.board, handle.binding, vi.fn());
    oldLease.setInteractionEnabled(true);
    await oldLease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    const next = attach(p.owner, handle);
    const lease = next.factory(handle.key, handle.board, handle.binding, vi.fn());
    const mounting = lease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    old.initialized({ key: handle.key, ok: false, error: 'old' });
    old.availability({ key: handle.key, ready: true });
    expect(old.isCurrent()).toBe(false);
    expect(p.owner.state().available).toBe(false);
    expect(() => old.factory(handle.key, handle.board, handle.binding, vi.fn())).toThrow('retired');
    oldResources.resolve();
    await Promise.resolve();
    expect(p.resources[0]!.mount).toHaveBeenCalledTimes(1);
    old.destroyed();
    await mounting;
    acknowledge(next, handle);
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    lease.setInteractionEnabled(true);
    const calls = vi.mocked(p.resources[0]!.setInteractionEnabled).mock.calls.length;
    oldLease.setInteractionEnabled(true);
    expect(p.resources[0]!.setInteractionEnabled).toHaveBeenCalledTimes(calls);
    expect(oldLease.pickAt(1, 2)).toBeNull();
  });
  it('availability loss closes flags synchronously and drawing keeps camera disabled while metre picking remains open', async () => {
    const p = packet();
    const { handle, host } = await ready(p.owner);
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
    lease.setInteractionEnabled(true);
    lease.setCameraEnabled(true);
    await lease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    handle.personal.beginTool('pin');
    handle.personal.startDrawing();
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    expect(p.resources[0]!.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(lease.pickAt(1, 2)).toEqual({ x: 12, y: 20 });
    host.availability({ key: handle.key, ready: false });
    expect(p.resources[0]!.setInteractionEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe('transitive Window/opaque-slot claim retirement fences', () => {
  it('A → canceled B → C cannot bypass deferred A resource/destruction retirement or duplicate startup', async () => {
    const p = packet(),
      slot = {},
      held = deferred();
    const a = claimRouteOwner(window, slot, p.ports);
    owners.push(a.owner);
    const start = a.owner.startDefault(),
      handle = await descriptor(a.owner),
      host = attach(a.owner, handle, () => held.promise);
    acknowledge(host, handle);
    await start;
    const b = claimRouteOwner(window, slot, p.ports);
    owners.push(b.owner);
    const bStart = b.owner.startDefault();
    const bStop = b.release('departure');
    const c = claimRouteOwner(window, slot, p.ports);
    owners.push(c.owner);
    const cStart = c.owner.startDefault();
    await Promise.resolve();
    expect(p.ports.loadDefault).toHaveBeenCalledTimes(1);
    held.resolve();
    await Promise.resolve();
    expect(p.ports.loadDefault).toHaveBeenCalledTimes(1);
    host.destroyed();
    await bStop;
    await bStart;
    const fresh = await descriptor(c.owner),
      current = attach(c.owner, fresh);
    acknowledge(current, fresh);
    await cStart;
    expect(p.ports.loadDefault).toHaveBeenCalledTimes(2);
    expect(fresh.key).not.toBe(handle.key);
    expect(b.release('pagehide')).toBe(bStop);
  });
  it('rejected cleanup remains a fence for all later claims while independent cleanup still runs', async () => {
    const p = packet(),
      slot = {};
    const a = claimRouteOwner(window, slot, p.ports);
    owners.push(a.owner);
    const first = await ready(a.owner);
    const storeRelease = vi
      .spyOn(first.handle.personal, 'dispose')
      .mockRejectedValue(new Error('source-private'));
    const surfaceRelease = vi.spyOn(first.handle.surface, 'dispose');
    const stop = a.release('departure');
    first.host.destroyed();
    await expect(stop).rejects.toThrow('retirement');
    expect(storeRelease).toHaveBeenCalledOnce();
    expect(surfaceRelease).toHaveBeenCalledOnce();
    const b = claimRouteOwner(window, slot, p.ports);
    owners.push(b.owner);
    await b.owner.startDefault();
    await expect(b.predecessorRetired).rejects.toThrow();
    expect(p.ports.loadDefault).toHaveBeenCalledTimes(1);
    const c = claimRouteOwner(window, slot, p.ports);
    owners.push(c.owner);
    await c.owner.startDefault();
    await expect(c.predecessorRetired).rejects.toThrow();
    expect(p.ports.makeRepository).toHaveBeenCalledTimes(1);
  });
  it('old finalization and reentrant release cannot clear or stop the newer claim', async () => {
    const p = packet(),
      slot = {};
    const a = claimRouteOwner(window, slot, p.ports);
    owners.push(a.owner);
    const first = await ready(a.owner);
    let repeated!: Promise<void>;
    const original = first.handle.surface.dispose.bind(first.handle.surface);
    vi.spyOn(first.handle.surface, 'dispose').mockImplementation(() => {
      repeated = a.release('departure');
      return original();
    });
    const b = claimRouteOwner(window, slot, p.ports);
    owners.push(b.owner);
    first.host.destroyed();
    await b.predecessorRetired;
    expect(repeated).toBe(a.release('pagehide'));
    const fresh = await ready(b.owner);
    expect(fresh.host.isCurrent()).toBe(true);
    await a.release('departure');
    expect(fresh.host.isCurrent()).toBe(true);
  });
});

describe('real default ports and additional acquisition faults', () => {
  it('real default loader uses only the pinned static fetch and shows honest unavailable state', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const p = packet();
    // Omit the override to select the audited real port, not an undefined port.
    const { loadDefault: _loader, ...ports } = p.ports;
    const real = new SessionOwner(ports);
    owners.push(real);
    await real.startDefault();
    expect(fetcher).toHaveBeenCalledWith(
      '/__local-default/countryside-rectangle.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(real.state().canRetry).toBe(true);
    expect(_loader).not.toHaveBeenCalled();
    expect(p.ports.makeCatalog).not.toHaveBeenCalled();
    expect(p.ports.makeRepository).not.toHaveBeenCalled();
    await real.retry();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('native origin lease acquisition records a late returned handle after synchronous owner disposal', async () => {
    const p = packet();
    const resource = raw();
    let stop!: Promise<void>;
    const owner: SessionOwner = new SessionOwner({
      ...p.ports,
      makeSurface: (key) => ({
        key,
        dispose: vi.fn(async () => {}),
        factory: () => {
          stop = owner.dispose('departure');
          return resource;
        },
      }),
    });
    owners.push(owner);
    const { handle, host } = await ready(owner);
    expect(() => host.factory(handle.key, handle.board, handle.binding, vi.fn())).toThrow(
      'retired',
    );
    host.destroyed();
    await stop;
    expect(resource.dispose).toHaveBeenCalledOnce();
    expect(resource.mount).not.toHaveBeenCalled();
  });
  it('retirement keeps releasing independent resources when a gate setter itself throws', async () => {
    const p = packet();
    const { handle, host } = await ready(p.owner);
    const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
    await lease.mount(
      document.createElement('canvas'),
      new AbortController().signal,
      presentation(),
    );
    const storeDisposal = vi.spyOn(handle.personal, 'dispose');
    vi.mocked(p.resources[0]!.setInteractionEnabled).mockImplementation(() => {
      throw new Error('gate');
    });
    const stop = p.owner.dispose('departure');
    host.destroyed();
    await expect(stop).rejects.toThrow('retirement');
    expect(storeDisposal).toHaveBeenCalledOnce();
    expect(p.resources[0]!.dispose).toHaveBeenCalledOnce();
  });
  it('setup control cleanup throws but acquired preparation and session leaves still release', async () => {
    const p = packet();
    const { host, handle } = await ready(p.owner);
    const surface = vi.spyOn(handle.surface, 'dispose');
    const control = {
      cancel: vi.fn(async () => {}),
      dispose: vi.fn(() => {
        throw new Error('control');
      }),
    };
    const setup = attachSetup(p.owner, p.owner.openSetup(), control);
    const stop = p.owner.dispose('departure');
    host.destroyed();
    setup.registration.destroyed();
    await expect(stop).rejects.toThrow('retirement');
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
    expect(surface).toHaveBeenCalledOnce();
  });
  it('reentrant preparation disposal observes the cached release and never invokes underlying cleanup twice', async () => {
    const p = packet();
    await ready(p.owner);
    const setup = p.owner.openSetup();
    vi.mocked(p.preparation.dispose).mockImplementation(() => setup.props.preparation.dispose());
    setup.props.preparation.dispose();
    await p.owner.cancelSetup();
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
  });
});

it('refuses a new setup owner while canceled preparation settlement is pending', async () => {
  const operation = deferred<CertifiedBoard>(),
    p = packet();
  await ready(p.owner);
  vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
  const setup = p.owner.openSetup(),
    loading = setup.props.preparation.load(
      '',
      board.summary as never,
      new AbortController().signal,
    );
  const cancel = p.owner.cancelSetup();
  await vi.waitFor(() => expect(p.owner.state().setup).toBeNull());
  expect(() => p.owner.openSetup()).toThrow('not retired');
  expect(p.ports.makePreparation).toHaveBeenCalledOnce();
  expect(p.ports.makeCatalog).toHaveBeenCalledOnce();
  p.owner.setInteractionState({ personal: true, board: true, camera: true });
  p.owner.state().session!.personal.setNotebookText('blocked during cancellation');
  expect(p.owner.state().session!.personal.notebook().draft).toBe('');
  operation.resolve(board);
  await expect(loading).rejects.toThrow('retired');
  await cancel;
  expect(p.owner.openSetup().token).not.toBe(setup.token);
});

describe('preliminary review exact regression traces', () => {
  it('retained Angular parent destroys setup during deferred precommit bind; abandoned Start retains old handle/key/store/drafts', async () => {
    const p = packet(),
      validation = deferred<LocalBoardBinding>();
    const { handle, host } = await ready(p.owner);
    handle.personal.setInteractionEnabled(true);
    handle.personal.setNotebookText('retained private draft');
    const storeDisposal = vi.spyOn(handle.personal, 'dispose');
    vi.mocked(p.ports.bind).mockReturnValueOnce(validation.promise);
    const setup = p.owner.openSetup();
    const fixture = TestBed.createComponent(RetainedSetupParentFixture);
    fixture.componentInstance.owner = p.owner;
    fixture.componentInstance.handle = setup;
    fixture.detectChanges();
    const start = setup.props.onStart(board);
    await vi.waitFor(() => expect(p.ports.bind).toHaveBeenCalledTimes(2));
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    expect(p.owner.state().setup).toBeNull();
    expect(p.owner.state().session).toBe(handle);
    validation.resolve(binding);
    await start;
    expect(p.owner.state().phase).toBe('ready');
    expect(p.owner.state().session).toBe(handle);
    expect(p.owner.state().session?.key).toBe(handle.key);
    expect(p.owner.state().session?.personal).toBe(handle.personal);
    expect(handle.personal.notebook().draft).toBe('retained private draft');
    expect(host.isCurrent()).toBe(true);
    expect(storeDisposal).not.toHaveBeenCalled();
    expect(p.ports.makeRepository).toHaveBeenCalledOnce();
    expect(p.ports.makeSurface).toHaveBeenCalledOnce();
    fixture.destroy();
    const stop = p.owner.dispose('departure');
    host.destroyed();
    await stop;
    expect(storeDisposal).toHaveBeenCalledOnce();
  });

  it('retained Angular parent destroys setup after commit; detached replacement waits old host resources and destruction then completes', async () => {
    const p = packet(),
      native = deferred();
    const starting = p.owner.startDefault(),
      old = await descriptor(p.owner);
    const host = attach(p.owner, old, () => native.promise);
    acknowledge(host, old);
    await starting;
    const setup = p.owner.openSetup();
    const fixture = TestBed.createComponent(RetainedSetupParentFixture);
    fixture.componentInstance.owner = p.owner;
    fixture.componentInstance.handle = setup;
    fixture.detectChanges();
    const replacement = setup.props.onStart(board);
    await vi.waitFor(() => expect(p.owner.state().session).toBeNull());
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    host.destroyed();
    expect(p.ports.freshKey).toHaveBeenCalledOnce();
    native.resolve();
    const next = await descriptor(p.owner),
      nextHost = attach(p.owner, next);
    acknowledge(nextHost, next);
    await replacement;
    expect(next.key).not.toBe(old.key);
    expect(p.owner.state().phase).toBe('ready');
    fixture.destroy();
  });

  it('attached cancellation with throwing private preparation disposal blocks successor acquisition permanently and attempts independent cleanup', async () => {
    const p = packet();
    const { handle, host } = await ready(p.owner);
    const surfaceRelease = vi.spyOn(handle.surface, 'dispose');
    const setup = p.owner.openSetup();
    vi.mocked(p.preparation.dispose).mockImplementation(() => {
      throw new Error('private cleanup');
    });
    const control = {
      cancel: vi.fn(async () => {
        setup.props.preparation.dispose();
        setup.props.onCancel();
      }),
      dispose: vi.fn(async () => {}),
    };
    const registered = attachSetup(p.owner, setup, control);
    const canceled = p.owner.cancelSetup();
    await vi.waitFor(() => expect(p.owner.state().setup).toBeNull());
    expect(() => p.owner.openSetup()).toThrow('not retired');
    p.owner.setInteractionState({ personal: true, board: true, camera: true });
    handle.personal.setNotebookText('blocked');
    expect(handle.personal.notebook().draft).toBe('');
    registered.registration.destroyed();
    await expect(canceled).rejects.toThrow('retirement');
    await expect(p.owner.cancelSetup()).rejects.toThrow('retirement');
    expect(() => p.owner.openSetup()).toThrow('not retired');
    expect(p.ports.makeCatalog).toHaveBeenCalledOnce();
    expect(p.ports.makePreparation).toHaveBeenCalledOnce();
    expect(p.preparation.dispose).toHaveBeenCalledOnce();
    expect(control.dispose).toHaveBeenCalledOnce();
    const stop = p.owner.dispose('departure');
    host.destroyed();
    await expect(stop).rejects.toThrow('retirement');
    expect(surfaceRelease).toHaveBeenCalledOnce();
  });

  it.each(['load', 'generate'] as const)(
    'combined-signal %s abort listener reenters facade disposal once and retains deferred operation plus cleanup failure',
    async (method) => {
      const p = packet(),
        operation = deferred<CertifiedBoard>();
      const { handle, host } = await ready(p.owner);
      const surfaceRelease = vi.spyOn(handle.surface, 'dispose');
      const setup = p.owner.openSetup();
      const listener = vi.fn(() => setup.props.preparation.dispose());
      if (method === 'load')
        vi.mocked(p.preparation.load).mockImplementation((_json, _summary, signal) => {
          signal.addEventListener('abort', listener, { once: true });
          return operation.promise;
        });
      else
        vi.mocked(p.preparation.generate).mockImplementation((_recipe, signal) => {
          signal.addEventListener('abort', listener, { once: true });
          return operation.promise;
        });
      vi.mocked(p.preparation.dispose).mockImplementation(() => {
        throw new Error('cleanup');
      });
      const loading =
        method === 'load'
          ? setup.props.preparation.load('', board.summary as never, new AbortController().signal)
          : setup.props.preparation.generate({} as never, new AbortController().signal);
      const cancel = p.owner.cancelSetup();
      let settled = false;
      void cancel.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
      expect(() => p.owner.openSetup()).toThrow('not retired');
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      setup.props.preparation.dispose();
      expect(settled).toBe(false);
      operation.resolve(board);
      await expect(loading).rejects.toThrow('retired');
      await expect(cancel).rejects.toThrow('retirement');
      expect(() => p.owner.openSetup()).toThrow('not retired');
      expect(p.ports.makePreparation).toHaveBeenCalledOnce();
      expect(p.preparation.dispose).toHaveBeenCalledOnce();
      const stop = p.owner.dispose('departure');
      host.destroyed();
      await expect(stop).rejects.toThrow('retirement');
      expect(surfaceRelease).toHaveBeenCalledOnce();
    },
  );
});

it.each(['load', 'generate'] as const)(
  'direct facade %s disposal reserves its release before live-signal abort listener reentry and retains operation/failure barriers',
  async (method) => {
    const p = packet(),
      operation = deferred<CertifiedBoard>();
    const { handle, host } = await ready(p.owner);
    const personalRelease = vi.spyOn(handle.personal, 'dispose');
    const surfaceRelease = vi.spyOn(handle.surface, 'dispose');
    const setup = p.owner.openSetup();
    let receivedSignal: AbortSignal | undefined;
    const reentered = vi.fn(() => setup.props.preparation.dispose());
    const invoke = (signal: AbortSignal) => {
      receivedSignal = signal;
      signal.addEventListener('abort', reentered, { once: true });
      return operation.promise;
    };
    if (method === 'load')
      vi.mocked(p.preparation.load).mockImplementation((_json, _summary, signal) => invoke(signal));
    else vi.mocked(p.preparation.generate).mockImplementation((_recipe, signal) => invoke(signal));
    vi.mocked(p.preparation.dispose).mockImplementation(() => {
      throw new Error('direct release failure');
    });
    const loading =
      method === 'load'
        ? setup.props.preparation.load('', board.summary as never, new AbortController().signal)
        : setup.props.preparation.generate({} as never, new AbortController().signal);
    // Observe the expected retirement rejection immediately; assertions still inspect the original promise.
    void loading.catch(() => {});
    try {
      expect(receivedSignal?.aborted).toBe(false);
      // No owner cancellation/disposal precedes this call: this release itself dispatches live abort.
      setup.props.preparation.dispose();
      expect(receivedSignal?.aborted).toBe(true);
      expect(reentered).toHaveBeenCalledOnce();
      expect(p.preparation.dispose).not.toHaveBeenCalled();
      const cancel = p.owner.cancelSetup();
      let canceled = false;
      void cancel.then(
        () => {
          canceled = true;
        },
        () => {
          canceled = true;
        },
      );
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      expect(canceled).toBe(false);
      expect(() => p.owner.openSetup()).toThrow('not retired');
      expect(p.ports.makeCatalog).toHaveBeenCalledOnce();
      expect(p.ports.makePreparation).toHaveBeenCalledOnce();
      const stop = p.owner.dispose('departure');
      host.destroyed();
      let retired = false;
      void stop.then(
        () => {
          retired = true;
        },
        () => {
          retired = true;
        },
      );
      await vi.waitFor(() => expect(surfaceRelease).toHaveBeenCalledOnce());
      expect(personalRelease).toHaveBeenCalledOnce();
      expect(retired).toBe(false);
      operation.resolve(board);
      await expect(loading).rejects.toThrow('retired');
      await expect(cancel).rejects.toThrow('retirement');
      await expect(stop).rejects.toThrow('retirement');
      expect(p.preparation.dispose).toHaveBeenCalledOnce();
      expect(reentered).toHaveBeenCalledOnce();
      expect(p.owner.dispose('departure')).toBe(stop);
      expect(p.ports.makePreparation).toHaveBeenCalledOnce();
    } finally {
      // Release fixture-owned gates even when an assertion fails, then join the actual owner fence.
      const retirement = p.owner.dispose('departure');
      operation.resolve(board);
      host.destroyed();
      await expect(loading).rejects.toThrow('retired');
      await expect(retirement).rejects.toThrow('retirement');
    }
  },
);

describe('complete owner source review production repair traces', () => {
  it.each([
    ['cancel', false],
    ['cancel', true],
    ['onCancel', false],
    ['onCancel', true],
    ['destroyed', false],
    ['destroyed', true],
  ] as const)(
    'true intent captured before %s keeps personal/raw/camera gates closed throughout deferred setup retirement (release rejects=%s)',
    async (path, rejects) => {
      const p = packet(),
        operation = deferred<CertifiedBoard>();
      const { handle, host } = await ready(p.owner);
      const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
      lease.setInteractionEnabled(true);
      lease.setCameraEnabled(true);
      await lease.mount(
        document.createElement('canvas'),
        new AbortController().signal,
        presentation(),
      );
      p.owner.setInteractionState({ personal: true, board: true, camera: true });
      const resource = p.resources[0]!;
      expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(true);
      const setup = p.owner.openSetup();
      const registration = path === 'destroyed' ? attachSetup(p.owner, setup).registration : null;
      vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
      if (rejects)
        vi.mocked(p.preparation.dispose).mockImplementation(() => {
          throw new Error('setup cleanup');
        });
      const loading = setup.props.preparation.load(
        '',
        board.summary as never,
        new AbortController().signal,
      );
      // The requested true intent predates descriptor loss. No later setter repairs the transition.
      p.owner.setInteractionState({ personal: true, board: true, camera: true });
      const point = vi.spyOn(handle.personal, 'acceptPoint');
      const closed = () => {
        expect(handle.personal.interactionEnabled()).toBe(false);
        expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(false);
        expect(resource.setCameraEnabled).toHaveBeenLastCalledWith(false);
        expect(lease.pickAt(1, 2)).toBeNull();
        handle.personal.setNotebookText('blocked behind retiring setup');
        expect(handle.personal.notebook().draft).toBe('');
        host.pointed({ key: handle.key, at: { x: 1, y: 2 } });
        expect(point).not.toHaveBeenCalled();
      };
      let canceled: Promise<void>;
      if (path === 'cancel') canceled = p.owner.cancelSetup();
      else {
        if (path === 'onCancel') setup.props.onCancel();
        else registration!.destroyed();
        canceled = p.owner.cancelSetup();
      }
      closed();
      await vi.waitFor(() => expect(p.owner.state().setup).toBeNull());
      closed();
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      closed();
      expect(() => p.owner.openSetup()).toThrow('not retired');
      expect(p.ports.makeCatalog).toHaveBeenCalledOnce();
      expect(p.ports.makePreparation).toHaveBeenCalledOnce();
      operation.resolve(board);
      await expect(loading).rejects.toThrow('retired');
      if (rejects) {
        await expect(canceled).rejects.toThrow('retirement');
        closed();
        expect(() => p.owner.openSetup()).toThrow('not retired');
      } else {
        await canceled;
        expect(handle.personal.interactionEnabled()).toBe(true);
        expect(resource.setInteractionEnabled).toHaveBeenLastCalledWith(true);
        expect(resource.setCameraEnabled).toHaveBeenLastCalledWith(true);
      }
      expect(p.ports.makeRepository).toHaveBeenCalledOnce();
    },
  );

  it.each(['retry', 'returnToDefault'] as const)(
    'board failure invalidates never-attached setup and gates %s through deferred preparation settlement',
    async (recovery) => {
      const p = packet(),
        operation = deferred<CertifiedBoard>();
      const { handle, host } = await ready(p.owner);
      const surface = vi.spyOn(handle.surface, 'dispose');
      const setup = p.owner.openSetup();
      vi.mocked(p.preparation.generate).mockReturnValue(operation.promise);
      const generating = setup.props.preparation.generate(
        {} as never,
        new AbortController().signal,
      );
      host.availability({ key: handle.key, ready: false, error: 'actual current-host failure' });
      expect(p.owner.state().setup).toBeNull();
      expect(p.owner.state().session).toBeNull();
      expect(() => setup.props.onStart(board)).toThrow('retired');
      const cancelBarrier = p.owner.cancelSetup(),
        recovering = p.owner[recovery]();
      let canceled = false;
      void cancelBarrier.then(() => {
        canceled = true;
      });
      host.destroyed();
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      expect(surface).toHaveBeenCalledOnce();
      expect(canceled).toBe(false);
      expect(p.ports.loadDefault).toHaveBeenCalledOnce();
      expect(p.ports.bind).toHaveBeenCalledOnce();
      expect(p.ports.freshKey).toHaveBeenCalledOnce();
      expect(p.ports.makeRepository).toHaveBeenCalledOnce();
      operation.resolve(board);
      await expect(generating).rejects.toThrow('retired');
      await cancelBarrier;
      const fresh = await descriptor(p.owner),
        newHost = attach(p.owner, fresh);
      acknowledge(newHost, fresh);
      await recovering;
      expect(fresh.key).not.toBe(handle.key);
      expect(p.owner.state().setup).toBeNull();
      expect(fresh.personal.notebook().draft).toBe('');
      expect(p.ports.loadDefault).toHaveBeenCalledTimes(recovery === 'retry' ? 1 : 2);
    },
  );

  it.each(['retry', 'returnToDefault'] as const)(
    'board failure gates %s independently through attached setup operation, control resource and actual destruction acknowledgment',
    async (recovery) => {
      const p = packet(),
        operation = deferred<CertifiedBoard>(),
        controlRetirement = deferred();
      const { handle, host } = await ready(p.owner);
      const setup = p.owner.openSetup();
      const control = {
        cancel: vi.fn(async () => {}),
        dispose: vi.fn(() => controlRetirement.promise),
      };
      const registration = attachSetup(p.owner, setup, control).registration;
      vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
      const loading = setup.props.preparation.load(
        '',
        board.summary as never,
        new AbortController().signal,
      );
      host.availability({
        key: handle.key,
        ready: false,
        error: 'current board failure during modal',
      });
      const cancelBarrier = p.owner.cancelSetup(),
        recovering = p.owner[recovery]();
      host.destroyed();
      expect(p.owner.state().setup).toBeNull();
      expect(control.dispose).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      const blocked = () => {
        expect(p.ports.loadDefault).toHaveBeenCalledOnce();
        expect(p.ports.bind).toHaveBeenCalledOnce();
        expect(p.ports.freshKey).toHaveBeenCalledOnce();
        expect(p.ports.makePersonal).toHaveBeenCalledOnce();
      };
      blocked();
      operation.resolve(board);
      await expect(loading).rejects.toThrow('retired');
      blocked();
      controlRetirement.resolve();
      await Promise.resolve();
      await Promise.resolve();
      blocked();
      expect(p.owner.state().session).toBeNull();
      registration.destroyed();
      await cancelBarrier;
      const fresh = await descriptor(p.owner),
        newHost = attach(p.owner, fresh);
      acknowledge(newHost, fresh);
      await recovering;
      expect(fresh.key).not.toBe(handle.key);
      expect(control.cancel).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['retry', false],
    ['retry', true],
    ['returnToDefault', false],
    ['returnToDefault', true],
  ] as const)(
    'board failure with throwing preparation cleanup permanently blocks %s (attached=%s) and attempts independent session/control release',
    async (recovery, attached) => {
      const p = packet(),
        operation = deferred<CertifiedBoard>();
      const { handle, host } = await ready(p.owner);
      const storeRelease = vi.spyOn(handle.personal, 'dispose'),
        surfaceRelease = vi.spyOn(handle.surface, 'dispose');
      const setup = p.owner.openSetup();
      const registered = attached ? attachSetup(p.owner, setup) : null;
      vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
      vi.mocked(p.preparation.dispose).mockImplementation(() => {
        throw new Error('private release failure');
      });
      const loading = setup.props.preparation.load(
        '',
        board.summary as never,
        new AbortController().signal,
      );
      host.availability({ key: handle.key, ready: false, error: 'current failure' });
      const canceled = p.owner.cancelSetup(),
        recovering = p.owner[recovery]();
      host.destroyed();
      if (registered) registered.registration.destroyed();
      await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
      expect(storeRelease).toHaveBeenCalledOnce();
      expect(surfaceRelease).toHaveBeenCalledOnce();
      if (registered) expect(registered.control.dispose).toHaveBeenCalledOnce();
      expect(p.ports.freshKey).toHaveBeenCalledOnce();
      operation.resolve(board);
      await expect(loading).rejects.toThrow('retired');
      await expect(canceled).rejects.toThrow('retirement');
      await recovering;
      expect(p.owner.state().phase).toBe('failed');
      expect(p.owner.state().session).toBeNull();
      expect(p.owner.state().setup).toBeNull();
      expect(p.ports.loadDefault).toHaveBeenCalledOnce();
      expect(p.ports.bind).toHaveBeenCalledOnce();
      expect(p.ports.freshKey).toHaveBeenCalledOnce();
      expect(p.ports.makeSurface).toHaveBeenCalledOnce();
      expect(() => p.owner.openSetup()).toThrow('not retired');
      await p.owner[recovery]();
      expect(p.ports.makeRepository).toHaveBeenCalledOnce();
    },
  );

  it.each(['retry', 'returnToDefault'] as const)(
    'synchronous first success then current availability error before startup continuation preserves failed outcome and gates %s on actual retirement',
    async (recovery) => {
      const p = packet(),
        nativeRetirement = deferred();
      const starting = p.owner.startDefault(),
        handle = await descriptor(p.owner);
      const host = attach(p.owner, handle, () => nativeRetirement.promise);
      let newHost: HostRegistration | undefined;
      try {
        acknowledge(host, handle);
        // No await separates historical first success from the newer current-host failure.
        host.availability({
          key: handle.key,
          ready: false,
          error: 'new current availability error',
        });
        expect(await handle.initialized).toEqual({ key: handle.key, ok: true });
        await starting;
        expect(p.owner.state().phase).toBe('failed');
        expect(p.owner.state().session).toBeNull();
        expect(p.owner.state().available).toBe(false);
        expect(p.owner.state().error).toContain('Retry');
        const recovering = p.owner[recovery]();
        await vi.waitFor(() => expect(p.owner.state().phase).toBe('preparing'));
        expect(p.ports.loadDefault).toHaveBeenCalledOnce();
        expect(p.ports.freshKey).toHaveBeenCalledOnce();
        nativeRetirement.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(p.ports.freshKey).toHaveBeenCalledOnce();
        host.destroyed();
        const fresh = await descriptor(p.owner);
        newHost = attach(p.owner, fresh);
        acknowledge(newHost, fresh);
        await recovering;
        expect(fresh.key).not.toBe(handle.key);
        expect(p.owner.state().phase).toBe('ready');
        expect(p.owner.state().error).toBeNull();
      } finally {
        // Native resource retirement and destruction acknowledgments remain real independent barriers.
        const retirement = p.owner.dispose('departure');
        nativeRetirement.resolve();
        host.destroyed();
        newHost?.destroyed();
        await retirement;
      }
    },
  );
});

it('successful deferred setup retirement refreshes gates from latest false UI intent rather than captured pre-cancel true intent', async () => {
  const p = packet(),
    operation = deferred<CertifiedBoard>();
  const { handle, host } = await ready(p.owner);
  const lease = host.factory(handle.key, handle.board, handle.binding, vi.fn());
  lease.setInteractionEnabled(true);
  lease.setCameraEnabled(true);
  await lease.mount(document.createElement('canvas'), new AbortController().signal, presentation());
  const setup = p.owner.openSetup();
  vi.mocked(p.preparation.load).mockReturnValue(operation.promise);
  const loading = setup.props.preparation.load(
    '',
    board.summary as never,
    new AbortController().signal,
  );
  p.owner.setInteractionState({ personal: true, board: true, camera: true });
  const canceled = p.owner.cancelSetup();
  await vi.waitFor(() => expect(p.owner.state().setup).toBeNull());
  p.owner.setInteractionState({ personal: false, board: false, camera: false });
  operation.resolve(board);
  await expect(loading).rejects.toThrow('retired');
  await canceled;
  expect(handle.personal.interactionEnabled()).toBe(false);
  expect(p.resources[0]!.setInteractionEnabled).toHaveBeenLastCalledWith(false);
  expect(p.resources[0]!.setCameraEnabled).toHaveBeenLastCalledWith(false);
  expect(p.owner.openSetup().token).not.toBe(setup.token);
});

it.each(['retry', 'returnToDefault'] as const)(
  'board failure retains throwing attached setup control cleanup for %s while preparation/session leaves and actual destruction independently settle',
  async (recovery) => {
    const p = packet(),
      operation = deferred<CertifiedBoard>();
    const { handle, host } = await ready(p.owner);
    const personalRelease = vi.spyOn(handle.personal, 'dispose'),
      surfaceRelease = vi.spyOn(handle.surface, 'dispose');
    const setup = p.owner.openSetup();
    const control = {
      cancel: vi.fn(async () => {}),
      dispose: vi.fn(() => {
        throw new Error('native control release');
      }),
    };
    const registration = attachSetup(p.owner, setup, control).registration;
    vi.mocked(p.preparation.generate).mockReturnValue(operation.promise);
    const generating = setup.props.preparation.generate({} as never, new AbortController().signal);
    host.availability({ key: handle.key, ready: false, error: 'current native failure' });
    const cancelBarrier = p.owner.cancelSetup(),
      recovering = p.owner[recovery]();
    let settled = false;
    void cancelBarrier.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    host.destroyed();
    await vi.waitFor(() => expect(p.preparation.dispose).toHaveBeenCalledOnce());
    expect(control.dispose).toHaveBeenCalledOnce();
    expect(personalRelease).toHaveBeenCalledOnce();
    expect(surfaceRelease).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    operation.resolve(board);
    await expect(generating).rejects.toThrow('retired');
    expect(settled).toBe(false);
    expect(p.ports.loadDefault).toHaveBeenCalledOnce();
    expect(p.ports.freshKey).toHaveBeenCalledOnce();
    registration.destroyed();
    await expect(cancelBarrier).rejects.toThrow('retirement');
    await recovering;
    expect(p.owner.state().phase).toBe('failed');
    expect(p.ports.loadDefault).toHaveBeenCalledOnce();
    expect(p.ports.bind).toHaveBeenCalledOnce();
    expect(p.ports.makeSurface).toHaveBeenCalledOnce();
  },
);

it('board-failure setup cleanup may reenter terminal departure without republishing failure or joining a coordinator continuation', async () => {
  const p = packet();
  const { handle, host } = await ready(p.owner);
  const setup = p.owner.openSetup();
  let stop: Promise<void> | undefined;
  const control = {
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      stop = p.owner.dispose('departure');
    }),
  };
  const registration = attachSetup(p.owner, setup, control).registration;
  host.availability({ key: handle.key, ready: false, error: 'current failure' });
  expect(p.owner.state().phase).toBe('disposed');
  expect(stop).toBeDefined();
  host.destroyed();
  registration.destroyed();
  await stop;
  expect(p.owner.state().phase).toBe('disposed');
  expect(p.owner.state().canRetry).toBe(false);
  expect(p.preparation.dispose).toHaveBeenCalledOnce();
  expect(p.ports.freshKey).toHaveBeenCalledOnce();
});
