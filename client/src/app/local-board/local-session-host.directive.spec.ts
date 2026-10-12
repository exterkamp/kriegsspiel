import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { createLocalBoardBinding } from './board-binding';
import {
  BOARD_SURFACE_FACTORY,
  BoardHostComponent,
  type BoardSurfaceFactory,
  type BoardSurfaceHandle,
} from './board-host.component';
import type { LocalPresentation } from './contracts';
import { LocalSessionHostDirective } from './local-session-host.directive';
import { SessionOwner, type LocalSessionHandle } from './session-owner';
import { SessionSurface } from './session-surface';
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
      ref: { kind: 'premade', id: 'bridge-map' },
    },
  };
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(async () => {
  TestBed.resetTestingModule();
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
@Component({
  standalone: true,
  imports: [BoardHostComponent, LocalSessionHostDirective],
  template: `<ks-local-board-host
    [localSessionHost]="session()"
    [sessionOwner]="owner()"
    [key]="session().key"
    [board]="session().board"
    [presentation]="presentation()"
  />`,
})
class BridgeHost {
  readonly session = input.required<LocalSessionHandle>();
  readonly owner = input.required<SessionOwner>();
  presentation(): LocalPresentation {
    return {
      binding: this.session().binding,
      marks: [],
      gameMs: 0,
      rate: 0,
      pieces: [],
      roster: [],
      papers: [],
    };
  }
}
async function ownerHarness() {
  const resource: BoardSurfaceHandle = {
    mount: vi.fn(async () => {}),
    unmount: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    apply: vi.fn(),
    setInteractionEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    resize: vi.fn(),
    snap: vi.fn(),
    pickAt: () => null,
  };
  const factory = vi.fn<BoardSurfaceFactory>();
  const owner = new SessionOwner({
    loadDefault: async () => structuredClone(board),
    bind: createLocalBoardBinding,
    makeSurface: (key, board, binding) => {
      const surface = new SessionSurface(key, board, binding, () => resource);
      factory.mockImplementation(surface.factory);
      return { key, factory, dispose: () => surface.dispose() };
    },
  });
  const pending = owner.startDefault();
  void pending.catch(() => {});
  await vi.waitFor(() => expect(owner.state().session).toBeTruthy());
  const fallback = vi.fn<BoardSurfaceFactory>(() => {
    throw new Error('root fallback must never allocate');
  });
  TestBed.configureTestingModule({
    imports: [BridgeHost],
    providers: [
      provideZonelessChangeDetection(),
      { provide: BOARD_SURFACE_FACTORY, useValue: fallback },
    ],
  });
  const create = () => {
    const fixture = TestBed.createComponent(BridgeHost);
    fixture.componentRef.setInput('session', owner.state().session);
    fixture.componentRef.setInput('owner', owner);
    fixture.detectChanges();
    const element = fixture.debugElement.query(By.directive(LocalSessionHostDirective));
    return {
      fixture,
      bridge: element.injector.get(LocalSessionHostDirective),
      host: element.injector.get(BoardHostComponent),
      factory: element.injector.get(BOARD_SURFACE_FACTORY),
    };
  };
  return { owner, pending, resource, factory, fallback, create };
}
describe('real native session bridge', () => {
  it('registers before asynchronous host acquisition without a DI cycle or root factory fallback', async () => {
    const h = await ownerHarness(),
      native = h.create();
    await native.fixture.whenStable();
    await vi.waitFor(() => expect(h.owner.state().available).toBe(true));
    expect(native.bridge.isCurrent()).toBe(true);
    expect(h.factory).toHaveBeenCalledOnce();
    expect(h.fallback).not.toHaveBeenCalled();
    const retirement = h.owner.dispose('departure');
    native.fixture.destroy();
    await retirement;
    expect(h.resource.dispose).toHaveBeenCalledOnce();
  });
  it('rejects predecessor same-key outputs and lazy acquisition while awaiting its real destruction hook', async () => {
    const h = await ownerHarness(),
      first = h.create();
    await first.fixture.whenStable();
    await h.pending;
    const second = h.create();
    await second.fixture.whenStable();
    expect(first.bridge.isCurrent()).toBe(false);
    first.host.availability.emit({
      key: h.owner.state().session!.key,
      ready: false,
      error: 'stale host failure',
    });
    expect(h.owner.state().error).not.toBe('stale host failure');
    expect(h.factory).toHaveBeenCalledOnce();
    expect(() =>
      first.factory(
        h.owner.state().session!.key,
        board,
        h.owner.state().session!.binding,
        () => {},
      ),
    ).toThrow('retired');
    first.fixture.destroy();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledTimes(2));
    const retirement = h.owner.dispose('departure');
    second.fixture.destroy();
    await retirement;
  });
  it('tears down the native component safely before directive OnInit and settles the never-attached reservation', async () => {
    const h = await ownerHarness();
    TestBed.overrideComponent(BoardHostComponent, {
      add: {
        hostDirectives: [
          { directive: LocalSessionHostDirective, inputs: ['localSessionHost', 'sessionOwner'] },
        ],
      },
    });
    const fixture = TestBed.createComponent(BoardHostComponent);
    const teardown = vi.spyOn(fixture.componentInstance, 'teardown');
    fixture.destroy();
    await h.owner.dispose('departure');
    expect(teardown).toHaveBeenCalled();
    expect(h.factory).not.toHaveBeenCalled();
  });
});
