import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPreparation, CertifiedBoard } from '../../shared/game-setup/contracts';
import { rasterLayout } from '../../shared/map-table/raster';
import { BOARD_BINDING_FACTORY, BoardHostComponent } from './board-host.component';
import { PersonalRepository } from './personal-repository';
import { PersonalStore } from './personal-store';
import { createLocalBoardBinding } from './board-binding';
import { BoardSurface, type BoardScene } from './board-surface';
import {
  LOCAL_BOARD_OWNER_PORTS,
  LOCAL_BOARD_ROUTE_SLOT,
  NativeLocalBoardComponent,
} from './local-board.component';
import { LocalSessionHostDirective } from './local-session-host.directive';
import { SetupComponent, SETUP_PREVIEW_FACTORY } from './setup/setup.component';
import { SessionSurface } from './session-surface';
import type { SessionOwnerPorts } from './session-owner';

let board: CertifiedBoard;
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  board = {
    asset,
    assetIdentity: await assetIdentity(asset, 'asset'),
    canonicalJson: canonicalizeAsset(asset),
    bounds: asset.bounds,
    summary: {
      name: asset.name,
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
      ref: { kind: 'premade', id: 'test-map' },
    },
  };
});
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
});
afterEach(async () => {
  TestBed.resetTestingModule();
  await Promise.resolve();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function harness(
  options: {
    loadDefault?: SessionOwnerPorts['loadDefault'];
    unmount?: Promise<void>;
    template?: string;
    bind?: SessionOwnerPorts['bind'];
    preparationLoad?: BoardPreparation['load'];
    preparationDispose?: () => void;
    hostBinding?: typeof createLocalBoardBinding;
  } = {},
) {
  const order: string[] = [],
    scenes: BoardScene[] = [];
  const raster = vi.fn((asset, identity: string, limit: number) => {
    const layout = rasterLayout(asset.bounds.maxX, asset.bounds.maxY, limit),
      canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    return {
      canvas,
      sourceKey: identity,
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
      contentWidthPx: layout.contentWidthPx,
      contentHeightPx: layout.contentHeightPx,
    };
  });
  const surfaceOwners: SessionSurface[] = [];
  const ports: Partial<SessionOwnerPorts> = {
    loadDefault: vi.fn(options.loadDefault ?? (async () => structuredClone(board))),
    ...(options.bind ? { bind: options.bind } : {}),
    freshKey: vi.fn(() => `local-${crypto.randomUUID()}` as const),
    makeRepository: vi.fn((scope, binding) => new PersonalRepository(scope, binding)),
    makePersonal: vi.fn(
      (scope, binding, repository) => new PersonalStore(scope, binding, repository),
    ),
    makeCatalog: vi.fn(() => ({
      list: async () => [{ ...board.summary, ref: board.summary.ref! }],
      read: async () => board.canonicalJson,
      save: async () => ({ ...board.summary, ref: board.summary.ref! }),
    })),
    makePreparation: vi.fn(() => ({
      load: options.preparationLoad ?? (async () => structuredClone(board)),
      generate: async () => structuredClone(board),
      dispose: vi.fn(options.preparationDispose),
    })),
    makeSurface: (key, certified, fixed) => {
      const owner = new SessionSurface(key, certified, fixed, (notify) => {
        const resource = new BoardSurface(key, certified, fixed, {
          onAvailability: notify,
          prepare: raster,
          observerFactory: () => ({ observe() {}, disconnect() {} }) as unknown as ResizeObserver,
          requestFrame: () => 1,
          cancelFrame: () => {},
          sceneFactory: () => {
            order.push('scene:new');
            const scene: BoardScene = {
              controls: { enabled: false, update: vi.fn(), listenToKeyEvents: vi.fn() },
              localBoardTextureLimit: () => 512,
              applyLocalBoard: vi.fn(),
              renderLocalBoardFrame: vi.fn(),
              snapTopDown: vi.fn(),
              snapOblique: vi.fn(),
              pickAt: () => ({ type: 'point', coord: { x: 12, y: 24 } }),
              resize: vi.fn(),
              dispose: vi.fn(() => order.push('scene:dispose')),
            };
            scenes.push(scene);
            return scene;
          },
        });
        if (options.unmount) {
          const unmount = resource.unmount.bind(resource);
          resource.unmount = async (canvas) => {
            await unmount(canvas);
            await options.unmount;
          };
        }
        return resource;
      });
      surfaceOwners.push(owner);
      return owner;
    },
  };
  TestBed.configureTestingModule({
    imports: [NativeLocalBoardComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: LOCAL_BOARD_OWNER_PORTS, useValue: ports },
      { provide: LOCAL_BOARD_ROUTE_SLOT, useValue: {} },
      ...(options.hostBinding
        ? [{ provide: BOARD_BINDING_FACTORY, useValue: options.hostBinding }]
        : []),
      {
        provide: SETUP_PREVIEW_FACTORY,
        useValue: () => ({ loadAsset: () => ({ ok: true, asset: board.asset }), dispose: vi.fn() }),
      },
    ],
  });
  if (options.template)
    TestBed.overrideComponent(NativeLocalBoardComponent, {
      set: { template: options.template, templateUrl: undefined },
    });
  const fixture = TestBed.createComponent(NativeLocalBoardComponent),
    component = fixture.componentInstance;
  // Real showModal needs a connected document; the test adapter above only sets native open state.
  document.body.append(fixture.nativeElement);
  const root = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...root.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)!;
  const ready = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(component.state()?.available).toBe(true));
    await fixture.whenStable();
  };
  return { fixture, component, root, button, ready, ports, scenes, raster, order, surfaceOwners };
}

describe('native local board composition', () => {
  it('mounts the real bridge with stable stopped presentation and retains the host/store through notebook navigation', async () => {
    const h = harness();
    await h.ready();
    const session = h.component.state()!.session!,
      canvas = h.root.querySelector('canvas');
    const presentation = h.component.presentation(session);
    expect(presentation).toMatchObject({ gameMs: 0, rate: 0, pieces: [], roster: [], papers: [] });
    session.personal.setNotebookText('unsaved commander note');
    h.component.navigate('notebook');
    await h.fixture.whenStable();
    expect(h.root.querySelector('textarea')?.value).toBe('unsaved commander note');
    h.component.navigate('table');
    await h.fixture.whenStable();
    expect(h.root.querySelector('canvas')).toBe(canvas);
    expect(h.component.state()!.session).toBe(session);
    expect(session.personal.notebook().dirty).toBe(true);
    expect(h.component.presentation(session)).toBe(presentation);
    expect(h.raster).toHaveBeenCalledOnce();
  });
  it('synchronously closes native camera/store gates and captures synthetic notebook input before its target handler', async () => {
    const h = harness();
    await h.ready();
    const session = h.component.state()!.session!;
    session.personal.setNotebookText('searchable unsaved');
    h.component.navigate('notebook');
    await h.fixture.whenStable();
    const search = h.root.querySelector<HTMLInputElement>('[name="notebook-search"]')!;
    h.component.openSettings(h.button('Settings'));
    expect(session.personal.interactionEnabled()).toBe(false);
    expect(h.scenes[0]!.controls.enabled).toBe(false);
    search.value = 'blocked';
    search.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    expect(session.personal.notebookQuery()).toBe('');
    h.component.closeSettings();
    await h.fixture.whenStable();
    search.value = 'unsaved';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(session.personal.notebookQuery()).toBe('unsaved');
    expect(session.personal.notebook().draft).toBe('searchable unsaved');
  });
  it('preserves drawing/notebook drafts through fullsize setup Cancel and restores focus after settlement', async () => {
    const h = harness();
    await h.ready();
    const session = h.component.state()!.session!,
      canvas = h.root.querySelector('canvas');
    session.personal.beginTool('polyline');
    session.personal.setMarkFields({ x: '12', y: '24' });
    session.personal.appendNumericPoint();
    session.personal.startDrawing();
    session.personal.setNotebookText('private draft');
    const trigger = h.button('Settings');
    h.component.openSettings(trigger);
    h.component.newGame();
    await h.fixture.whenStable();
    await vi.waitFor(() =>
      expect(h.fixture.debugElement.query(By.directive(SetupComponent))).toBeTruthy(),
    );
    expect(h.component.setupDialog()!.nativeElement.open).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    h.component.dialogCancel(cancel, 'setup');
    expect(cancel.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(h.component.modal()).toBe('none'));
    await h.fixture.whenStable();
    expect(h.root.querySelector('canvas')).toBe(canvas);
    expect(session.personal.drawingActive()).toBe(true);
    expect(session.personal.markForm().points).toEqual([{ x: 12, y: 24 }]);
    expect(session.personal.notebook().draft).toBe('private draft');
    expect(document.activeElement).toBe(trigger);
    expect(h.scenes[0]!.controls.enabled).toBe(false);
  });
  it('routes exposed canvas Escape only from a current origin and ignores an old same-key host', async () => {
    const h = harness();
    await h.ready();
    const session = h.component.state()!.session!,
      element = h.fixture.debugElement.query(By.directive(LocalSessionHostDirective));
    const origin = element.injector.get(LocalSessionHostDirective);
    session.personal.startDrawing();
    await h.fixture.whenStable();
    h.root
      .querySelector('canvas')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    expect(session.personal.drawingActive()).toBe(false);
    const owner = h.component.owner()!;
    h.fixture.destroy();
    expect(origin.isCurrent()).toBe(false);
    h.component.canvasKeys(session, {
      origin,
      event: new KeyboardEvent('keydown', { key: 'Delete' }),
    });
    await owner.dispose('departure');
    expect(session.personal.disposed()).toBe(true);
  });
  it('clears attached native outlets synchronously on pagehide with rendering withheld', async () => {
    const h = harness();
    await h.ready();
    const host = h.fixture.debugElement.query(By.directive(BoardHostComponent))
      .componentInstance as BoardHostComponent;
    const teardown = vi.spyOn(host, 'teardown');
    expect(h.root.querySelectorAll('canvas')).toHaveLength(1);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(h.root.querySelectorAll('canvas')).toHaveLength(0);
    expect(teardown).toHaveBeenCalled();
    expect(h.component.suspended()).toBe(true);
  });
  it('coalesces persisted restores, cancels a pending restart on repeated hide, then uses a fresh scope', async () => {
    const held = deferred(),
      h = harness({ unmount: held.promise });
    await h.ready();
    const old = h.component.state()!.session!;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    held.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.ports.loadDefault).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await h.ready();
    expect(h.ports.loadDefault).toHaveBeenCalledTimes(2);
    expect(h.component.state()!.session!.scope.gameId).not.toBe(old.scope.gameId);
    expect(h.root.querySelectorAll('canvas')).toHaveLength(1);
  });
  it('departure before the first render prevents late startup allocation/publication', async () => {
    const held = deferred(),
      load = vi.fn(async () => {
        await held.promise;
        return structuredClone(board);
      });
    const h = harness({ loadDefault: load });
    await Promise.resolve();
    await Promise.resolve();
    h.fixture.destroy();
    held.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.surfaceOwners).toHaveLength(0);
    expect(h.component.state()?.session).toBeNull();
  });
  it('retains parent session/store/raster across public native outlet destruction and recreation', async () => {
    const h = harness({
      template: `@if (outletsVisible()) { <ng-template localBoardOutlet="board" [outletController]="this" let-row><ks-local-board-host [localSessionHost]="row.session" [sessionOwner]="row.owner" [key]="row.session.key" [board]="row.session.board" [presentation]="presentation(row.session)" /></ng-template> }`,
    });
    const visible = signal(true);
    Object.assign(h.component, { outletsVisible: visible });
    await h.ready();
    const session = h.component.state()!.session!;
    session.personal.setNotebookText('retained unsaved note');
    visible.set(false);
    await h.fixture.whenStable();
    visible.set(true);
    await h.ready();
    expect(h.component.state()!.session).toBe(session);
    expect(session.personal.notebook().draft).toBe('retained unsaved note');
    expect(h.surfaceOwners).toHaveLength(1);
    expect(h.raster).toHaveBeenCalledOnce();
    expect(h.scenes).toHaveLength(2);
    expect(h.order.indexOf('scene:dispose')).toBeLessThan(h.order.lastIndexOf('scene:new'));
  });
  for (const action of ['Cancel button', 'outer Escape'] as const) {
    it(`${action} retains the logical modal and synthetic input gate until the full owner facade fence settles`, async () => {
      const held = deferred();
      let loads = 0;
      const h = harness({
        preparationLoad: async () => {
          if (++loads === 2) await held.promise;
          return structuredClone(board);
        },
      });
      await h.ready();
      const old = h.component.state()!.session!;
      old.personal.setNotebookText('retained draft');
      h.component.navigate('notebook');
      await h.fixture.whenStable();
      const search = h.root.querySelector<HTMLInputElement>('[name="notebook-search"]')!;
      const trigger = h.button('Settings');
      h.component.openSettings(trigger);
      h.component.newGame();
      await h.fixture.whenStable();
      const native = h.fixture.debugElement.query(By.directive(SetupComponent))
        .componentInstance as SetupComponent;
      await vi.waitFor(() => expect(native.state.canStart()).toBe(true));
      const setup = h.component.state()!.setup!;
      const operation = setup.props.preparation
        .load(
          board.canonicalJson,
          { ...board.summary, ref: board.summary.ref! },
          new AbortController().signal,
        )
        .catch(() => {});
      await vi.waitFor(() => expect(loads).toBe(2));
      if (action === 'Cancel button') h.button('Cancel').click();
      else
        h.component
          .setupDialog()!
          .nativeElement.dispatchEvent(new Event('cancel', { cancelable: true }));
      await vi.waitFor(() => expect(h.component.state()!.setup).toBeNull());
      await h.fixture.whenStable();
      expect(h.component.modal()).toBe('setup');
      expect(h.component.setupDialog()!.nativeElement.open).toBe(true);
      expect(h.component.cancelling()).toBe(true);
      expect(old.personal.interactionEnabled()).toBe(false);
      expect(h.scenes[0]!.controls.enabled).toBe(false);
      search.value = 'blocked';
      search.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      h.button('Settings').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(old.personal.notebookQuery()).toBe('');
      expect(() => h.component.owner()!.openSetup()).toThrow();
      expect(h.ports.makeCatalog).toHaveBeenCalledOnce();
      expect(h.ports.makePreparation).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(trigger);
      held.resolve();
      await operation;
      await vi.waitFor(() => expect(h.component.modal()).toBe('none'));
      await h.fixture.whenStable();
      expect(h.component.setupDialog()!.nativeElement.open).toBe(false);
      expect(document.activeElement).toBe(trigger);
      expect(h.component.state()!.session).toBe(old);
      expect(old.personal.notebook().draft).toBe('retained draft');
      h.component.openSettings(trigger);
      h.component.newGame();
      await h.fixture.whenStable();
      expect(h.ports.makePreparation).toHaveBeenCalledTimes(2);
    });
  }
  it('native Cancel keeps the dialog/input gate closed after private preparation release rejects', async () => {
    const release = vi.fn(() => {
      throw new Error('private release failed');
    });
    const h = harness({ preparationDispose: release });
    await h.ready();
    const old = h.component.state()!.session!;
    h.component.navigate('notebook');
    await h.fixture.whenStable();
    const search = h.root.querySelector<HTMLInputElement>('[name="notebook-search"]')!;
    h.component.openSettings(h.button('Settings'));
    h.component.newGame();
    await h.fixture.whenStable();
    h.button('Cancel').click();
    await vi.waitFor(() => expect(h.component.uiError()).toContain('could not retire'));
    await h.fixture.whenStable();
    expect(h.component.modal()).toBe('setup');
    expect(h.component.setupDialog()!.nativeElement.open).toBe(true);
    expect(h.component.cancelling()).toBe(true);
    expect(old.personal.interactionEnabled()).toBe(false);
    search.value = 'blocked';
    search.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    expect(old.personal.notebookQuery()).toBe('');
    expect(() => h.component.owner()!.openSetup()).toThrow();
    h.component.openSettings(h.button('Settings'));
    h.component.newGame();
    expect(h.ports.makePreparation).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(
      h.component.setupDialog()!.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('could not retire');
  });
  it('actual setup outlet destruction during deferred precommit bind preserves old handle/key/store/drafts and settles Start without allocation', async () => {
    const held = deferred();
    let binds = 0;
    const h = harness({
      template: replacementTemplate,
      bind: async (candidate, signal) => {
        if (++binds === 2) await held.promise;
        return createLocalBoardBinding(candidate, signal);
      },
    });
    const visible = signal(true);
    Object.assign(h.component, { setupVisible: visible });
    await h.ready();
    const old = h.component.state()!.session!;
    old.personal.setNotebookText('private retained text');
    old.personal.beginTool('polyline');
    old.personal.setMarkFields({ x: '12', y: '24' });
    old.personal.appendNumericPoint();
    h.component.openSettings(document.createElement('button'));
    h.component.newGame();
    await h.fixture.whenStable();
    const native = h.fixture.debugElement.query(By.directive(SetupComponent))
      .componentInstance as SetupComponent;
    await vi.waitFor(() => expect(native.state.canStart()).toBe(true));
    let settled = false;
    const start = native.state.start().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(binds).toBe(2));
    visible.set(false);
    await h.fixture.whenStable();
    expect(native.state.closed()).toBe(true);
    expect(h.component.state()!.session).toBe(old);
    expect(h.surfaceOwners).toHaveLength(1);
    held.resolve();
    await start;
    await vi.waitFor(() => expect(settled).toBe(true));
    visible.set(true);
    await h.fixture.whenStable();
    expect(h.component.state()!.session).toBe(old);
    expect(h.component.state()!.session!.key).toBe(old.key);
    expect(h.component.state()!.session!.personal).toBe(old.personal);
    expect(old.personal.disposed()).toBe(false);
    expect(old.personal.notebook().draft).toBe('private retained text');
    expect(old.personal.markForm().points).toEqual([{ x: 12, y: 24 }]);
    expect(h.surfaceOwners).toHaveLength(1);
    expect(h.raster).toHaveBeenCalledOnce();
    expect(h.component.state()!.phase).toBe('ready');
  });
  it('actual setup outlet destruction after commit leaves the detached candidate running behind the old resource/hook fence', async () => {
    const held = deferred(),
      h = harness({ template: replacementTemplate, unmount: held.promise });
    const visible = signal(true);
    Object.assign(h.component, { setupVisible: visible });
    await h.ready();
    const old = h.component.state()!.session!;
    h.component.openSettings(document.createElement('button'));
    h.component.newGame();
    await h.fixture.whenStable();
    const native = h.fixture.debugElement.query(By.directive(SetupComponent))
      .componentInstance as SetupComponent;
    await vi.waitFor(() => expect(native.state.canStart()).toBe(true));
    const start = native.state.start();
    await vi.waitFor(() => expect(h.component.state()!.phase).toBe('retiring'));
    visible.set(false);
    await h.fixture.whenStable();
    expect(native.state.closed()).toBe(true);
    expect(h.surfaceOwners).toHaveLength(1);
    visible.set(true);
    await h.fixture.whenStable();
    expect(h.fixture.debugElement.query(By.directive(SetupComponent))).toBeNull();
    held.resolve();
    await h.ready();
    await start;
    expect(h.component.state()!.session!.key).not.toBe(old.key);
    expect(old.personal.disposed()).toBe(true);
    expect(h.surfaceOwners).toHaveLength(2);
    expect(h.root.querySelectorAll('canvas')).toHaveLength(1);
  });
  for (const recovery of ['retry', 'default'] as const) {
    it(`current native board availability failure retires full Setup hooks and keeps ${recovery} behind deferred preparation/control retirement`, async () => {
      const operationHeld = deferred(),
        controlHeld = deferred(),
        release = vi.fn();
      let loads = 0;
      const h = harness({
        preparationDispose: release,
        preparationLoad: async () => {
          if (++loads === 2) await operationHeld.promise;
          return structuredClone(board);
        },
      });
      await h.ready();
      const owner = h.component.owner()!,
        old = h.component.state()!.session!;
      const hostElement = h.fixture.debugElement.query(By.directive(BoardHostComponent));
      const host = hostElement.componentInstance as BoardHostComponent;
      const origin = hostElement.injector.get(LocalSessionHostDirective);
      const teardown = vi.spyOn(host, 'teardown');
      h.component.openSettings(h.button('Settings'));
      h.component.newGame();
      await h.fixture.whenStable();
      const setup = h.fixture.debugElement.query(By.directive(SetupComponent))
        .componentInstance as SetupComponent;
      await vi.waitFor(() => expect(setup.state.canStart()).toBe(true));
      const operation = setup.state.selectSaved(setup.state.selectedKey());
      await vi.waitFor(() => expect(loads).toBe(2));
      const nativeDispose = setup.dispose.bind(setup);
      const dispose = vi.spyOn(setup, 'dispose').mockImplementation(async () => {
        await nativeDispose();
        await controlHeld.promise;
      });
      vi.mocked(h.scenes[0]!.resize).mockImplementationOnce(() => {
        throw new Error('render failure during setup');
      });
      host.resize();
      expect(owner.state().phase).toBe('failed');
      expect(old.personal.interactionEnabled()).toBe(false);
      expect(h.scenes[0]!.controls.enabled).toBe(false);
      let barrierSettled = false;
      const barrier = owner.cancelSetup().then(() => {
        barrierSettled = true;
      });
      await h.fixture.whenStable();
      expect(h.fixture.debugElement.query(By.directive(SetupComponent))).toBeNull();
      expect(h.fixture.debugElement.query(By.directive(BoardHostComponent))).toBeNull();
      expect(setup.state.closed()).toBe(true);
      expect(dispose).toHaveBeenCalled();
      expect(teardown).toHaveBeenCalled();
      expect(origin.isCurrent()).toBe(false);
      expect(h.root.querySelectorAll('canvas')).toHaveLength(0);
      expect(h.component.modal()).toBe('setup');
      expect(h.component.cancelling()).toBe(true);
      expect(
        h.component.setupDialog()!.nativeElement.querySelector('[role="alert"]')?.textContent,
      ).toContain('Local board initialization failed');
      expect(barrierSettled).toBe(false);
      const probe = document.createElement('input'),
        target = vi.fn();
      h.root.querySelector('.background')!.append(probe);
      for (const name of [
        'input',
        'change',
        'click',
        'keydown',
        'pointerdown',
        'pointermove',
        'wheel',
      ]) {
        probe.addEventListener(name, target);
        const event = new Event(name, { bubbles: true, cancelable: true });
        probe.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(target).not.toHaveBeenCalled();
      const noSuccessor = () => {
        expect(h.ports.loadDefault).toHaveBeenCalledOnce();
        expect(h.ports.freshKey).toHaveBeenCalledOnce();
        expect(h.ports.makeRepository).toHaveBeenCalledOnce();
        expect(h.ports.makePersonal).toHaveBeenCalledOnce();
        expect(h.ports.makeCatalog).toHaveBeenCalledOnce();
        expect(h.ports.makePreparation).toHaveBeenCalledOnce();
        expect(h.surfaceOwners).toHaveLength(1);
      };
      const replacement = recovery === 'retry' ? owner.retry() : owner.returnToDefault();
      await h.fixture.whenStable();
      noSuccessor();
      operationHeld.resolve();
      await operation;
      await h.fixture.whenStable();
      expect(release).toHaveBeenCalledOnce();
      expect(barrierSettled).toBe(false);
      expect(h.component.modal()).toBe('setup');
      noSuccessor();
      controlHeld.resolve();
      await barrier;
      await h.ready();
      await replacement;
      expect(h.component.modal()).toBe('none');
      expect(h.component.setupDialog()!.nativeElement.open).toBe(false);
      expect(h.component.uiError()).toBe('');
      expect(h.component.state()!.session!.key).not.toBe(old.key);
      expect(h.ports.freshKey).toHaveBeenCalledTimes(2);
      expect(h.ports.makePersonal).toHaveBeenCalledTimes(2);
      expect(h.surfaceOwners).toHaveLength(2);
      expect(h.ports.loadDefault).toHaveBeenCalledTimes(recovery === 'default' ? 2 : 1);
    });
  }

  it('native board failure stays visible when outer Escape already holds the full Setup cancellation barrier', async () => {
    const held = deferred();
    let loads = 0;
    const h = harness({
      preparationLoad: async () => {
        if (++loads === 2) await held.promise;
        return structuredClone(board);
      },
    });
    await h.ready();
    const owner = h.component.owner()!,
      host = h.fixture.debugElement.query(By.directive(BoardHostComponent))
        .componentInstance as BoardHostComponent;
    h.component.openSettings(h.button('Settings'));
    h.component.newGame();
    await h.fixture.whenStable();
    const setup = h.fixture.debugElement.query(By.directive(SetupComponent))
      .componentInstance as SetupComponent;
    await vi.waitFor(() => expect(setup.state.canStart()).toBe(true));
    const operation = setup.state.selectSaved(setup.state.selectedKey());
    await vi.waitFor(() => expect(loads).toBe(2));
    const cancellation = h.component.cancelSetup(new Event('cancel', { cancelable: true }));
    expect(h.component.cancelling()).toBe(true);
    vi.mocked(h.scenes[0]!.resize).mockImplementationOnce(() => {
      throw new Error('board failed during Escape retirement');
    });
    host.resize();
    await h.fixture.whenStable();
    expect(
      h.component.setupDialog()!.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('initialization failed');
    expect(h.component.modal()).toBe('setup');
    expect(h.component.blocked()).toBe(true);
    expect(owner.state().phase).toBe('failed');
    expect(h.fixture.debugElement.query(By.directive(SetupComponent))).toBeNull();
    expect(h.fixture.debugElement.query(By.directive(BoardHostComponent))).toBeNull();
    expect(h.ports.loadDefault).toHaveBeenCalledOnce();
    expect(h.ports.freshKey).toHaveBeenCalledOnce();
    expect(h.ports.makePersonal).toHaveBeenCalledOnce();
    expect(h.surfaceOwners).toHaveLength(1);
    held.resolve();
    await operation;
    await cancellation;
    await h.fixture.whenStable();
    expect(h.component.modal()).toBe('none');
    expect(h.root.querySelector('[role="alert"]')?.textContent).toContain('initialization failed');
  });
  it('board failure during full Setup retains a visible blocked dialog and prevents recovery allocation after preparation retirement rejects', async () => {
    const held = deferred(),
      release = vi.fn(() => {
        throw new Error('setup release rejected');
      });
    let loads = 0;
    const h = harness({
      preparationDispose: release,
      preparationLoad: async () => {
        if (++loads === 2) await held.promise;
        return structuredClone(board);
      },
    });
    await h.ready();
    const owner = h.component.owner()!,
      old = h.component.state()!.session!;
    const host = h.fixture.debugElement.query(By.directive(BoardHostComponent))
      .componentInstance as BoardHostComponent;
    h.component.openSettings(h.button('Settings'));
    h.component.newGame();
    await h.fixture.whenStable();
    const setup = h.fixture.debugElement.query(By.directive(SetupComponent))
      .componentInstance as SetupComponent;
    await vi.waitFor(() => expect(setup.state.canStart()).toBe(true));
    const operation = setup.state.selectSaved(setup.state.selectedKey());
    await vi.waitFor(() => expect(loads).toBe(2));
    vi.mocked(h.scenes[0]!.resize).mockImplementationOnce(() => {
      throw new Error('board failed behind setup');
    });
    host.resize();
    let outcome = 'pending';
    const barrier = owner.cancelSetup().then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );
    await h.fixture.whenStable();
    expect(h.fixture.debugElement.query(By.directive(SetupComponent))).toBeNull();
    expect(h.fixture.debugElement.query(By.directive(BoardHostComponent))).toBeNull();
    expect(setup.state.closed()).toBe(true);
    expect(h.component.modal()).toBe('setup');
    expect(
      h.component.setupDialog()!.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('initialization failed');
    const recovery = owner.returnToDefault();
    await h.fixture.whenStable();
    expect(outcome).toBe('pending');
    expect(h.ports.loadDefault).toHaveBeenCalledOnce();
    expect(h.ports.freshKey).toHaveBeenCalledOnce();
    held.resolve();
    await operation;
    await barrier;
    await recovery;
    await vi.waitFor(() => expect(h.component.uiError()).toContain('could not retire'));
    await h.fixture.whenStable();
    expect(outcome).toBe('rejected');
    expect(release).toHaveBeenCalledOnce();
    expect(owner.state()).toMatchObject({
      phase: 'failed',
      session: null,
      setup: null,
      available: false,
    });
    expect(h.component.modal()).toBe('setup');
    expect(h.component.setupDialog()!.nativeElement.open).toBe(true);
    expect(h.component.cancelling()).toBe(true);
    expect(old.personal.interactionEnabled()).toBe(false);
    expect(
      h.component.setupDialog()!.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('could not retire');
    const probe = document.createElement('input'),
      listener = vi.fn();
    h.root.querySelector('.background')!.append(probe);
    probe.addEventListener('input', listener);
    probe.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    expect(listener).not.toHaveBeenCalled();
    expect(() => owner.openSetup()).toThrow();
    await owner.retry();
    expect(h.ports.loadDefault).toHaveBeenCalledOnce();
    expect(h.ports.freshKey).toHaveBeenCalledOnce();
    expect(h.ports.makeRepository).toHaveBeenCalledOnce();
    expect(h.ports.makePersonal).toHaveBeenCalledOnce();
    expect(h.ports.makePreparation).toHaveBeenCalledOnce();
    expect(h.surfaceOwners).toHaveLength(1);
  });
  it('first native success followed synchronously by current render failure cannot publish Ready from the pending startup continuation', async () => {
    const hostBindingHeld = deferred(),
      unmountHeld = deferred();
    const h = harness({
      unmount: unmountHeld.promise,
      hostBinding: async (candidate, signal) => {
        await hostBindingHeld.promise;
        return createLocalBoardBinding(candidate, signal);
      },
    });
    h.fixture.detectChanges();
    await vi.waitFor(() =>
      expect(h.fixture.debugElement.query(By.directive(BoardHostComponent))).toBeTruthy(),
    );
    const owner = h.component.owner()!,
      host = h.fixture.debugElement.query(By.directive(BoardHostComponent))
        .componentInstance as BoardHostComponent;
    let observedFailure = false;
    host.initialized.subscribe((result) => {
      if (!result.ok) return;
      expect(owner.state().phase).toBe('mounting');
      vi.mocked(h.scenes[0]!.resize).mockImplementationOnce(() => {
        throw new Error('failure before startup resumes');
      });
      host.resize();
      expect(owner.state().phase).toBe('failed');
      observedFailure = true;
    });
    hostBindingHeld.resolve();
    await owner.startDefault();
    expect(observedFailure).toBe(true);
    expect(owner.state()).toMatchObject({
      phase: 'failed',
      session: null,
      available: false,
      canRetry: true,
    });
    expect(owner.state().error).toContain('initialization failed');
    await h.fixture.whenStable();
    expect(h.fixture.debugElement.query(By.directive(BoardHostComponent))).toBeNull();
    expect(h.root.querySelector('[role="alert"]')?.textContent).toContain('initialization failed');
    const replacement = owner.returnToDefault();
    await h.fixture.whenStable();
    expect(h.ports.loadDefault).toHaveBeenCalledOnce();
    expect(h.ports.freshKey).toHaveBeenCalledOnce();
    expect(h.ports.makePersonal).toHaveBeenCalledOnce();
    expect(h.surfaceOwners).toHaveLength(1);
    unmountHeld.resolve();
    await h.ready();
    await replacement;
    expect(h.ports.loadDefault).toHaveBeenCalledTimes(2);
    expect(h.surfaceOwners).toHaveLength(2);
  });
});

// Public Angular structural destruction exercises the retained parent controller and real native
// child hooks. Actual metadata HMR remains an independent root browser integration gate.
const replacementTemplate = `
<ng-template localBoardOutlet="board" [outletController]="this" let-row>
  <ks-local-board-host [localSessionHost]="row.session" [sessionOwner]="row.owner" [key]="row.session.key" [board]="row.session.board" [presentation]="presentation(row.session)" />
</ng-template>
<dialog #setupDialog (cancel)="dialogCancel($event, 'setup')">
@if (setupVisible()) {
  <ng-template localBoardOutlet="setup" [outletController]="this" let-row>
    <ks-local-board-setup [localSetupHost]="row.setup" [sessionOwner]="row.owner" (attached)="setupAttached(row, $event)" [catalog]="row.setup.props.catalog" [preparation]="row.setup.props.preparation" [initialRef]="row.setup.props.initialRef" [onStart]="setupStartCallback(row)" [onCancel]="setupCancelCallback(row)" />
  </ng-template>
}
</dialog>`;
