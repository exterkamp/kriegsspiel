import { webcrypto } from 'node:crypto';
import { assetIdentity, canonicalizeAsset, createReferenceAsset } from '@kriegsspiel/maps';
import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import { LocalSetupHostDirective } from './local-setup-host.directive';
import { SessionOwner, type LocalSetupHandle } from './session-owner';
import { SetupComponent, SETUP_PREVIEW_FACTORY } from './setup/setup.component';
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
      ref: { kind: 'premade', id: 'setup-bridge' },
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
  imports: [SetupComponent, LocalSetupHostDirective],
  template: `<ks-local-board-setup
    [localSetupHost]="setup()"
    [sessionOwner]="owner()"
    [catalog]="setup().props.catalog"
    [preparation]="setup().props.preparation"
    [onStart]="setup().props.onStart"
    [onCancel]="setup().props.onCancel"
  />`,
})
class SetupHost {
  readonly setup = input.required<LocalSetupHandle>();
  readonly owner = input.required<SessionOwner>();
}
async function harness() {
  const prepDispose = vi.fn();
  const owner = new SessionOwner({
    loadDefault: async () => structuredClone(board),
    makeCatalog: () => ({
      list: async () => [],
      read: async () => '',
      save: async () => ({ ...board.summary, ref: board.summary.ref! }),
    }),
    makePreparation: () => ({
      load: async () => structuredClone(board),
      generate: async () => structuredClone(board),
      dispose: prepDispose,
    }),
  });
  const pending = owner.startDefault();
  void pending.catch(() => {});
  await vi.waitFor(() => expect(owner.state().session).toBeTruthy());
  const session = owner.state().session!,
    host = owner.attachHost(session, async () => {});
  host.availability({ key: session.key, ready: true });
  host.initialized({ key: session.key, ok: true });
  await pending;
  const setup = owner.openSetup();
  TestBed.configureTestingModule({
    imports: [SetupHost],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: SETUP_PREVIEW_FACTORY,
        useValue: () => ({ loadAsset: vi.fn(), dispose: vi.fn() }),
      },
    ],
  });
  return { owner, setup, host, prepDispose };
}
describe('real native setup bridge', () => {
  it('attaches real cancel/dispose control and keeps resource settlement separate from native destruction', async () => {
    const h = await harness(),
      fixture = TestBed.createComponent(SetupHost);
    fixture.componentRef.setInput('setup', h.setup);
    fixture.componentRef.setInput('owner', h.owner);
    fixture.detectChanges();
    await fixture.whenStable();
    const native = fixture.debugElement.query(By.directive(SetupComponent))
      .componentInstance as SetupComponent;
    const dispose = vi.spyOn(native, 'dispose');
    const canceled = h.owner.cancelSetup();
    let settled = false;
    void canceled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    fixture.destroy();
    await canceled;
    expect(dispose).toHaveBeenCalled();
    expect(h.prepDispose).toHaveBeenCalledOnce();
    const retired = h.owner.dispose('departure');
    h.host.destroyed();
    await retired;
  });
  it('disposes safely before OnInit without waiting for a nonexistent setup registration', async () => {
    const h = await harness();
    TestBed.overrideComponent(SetupComponent, {
      add: {
        hostDirectives: [
          { directive: LocalSetupHostDirective, inputs: ['localSetupHost', 'sessionOwner'] },
        ],
      },
    });
    const fixture = TestBed.createComponent(SetupComponent),
      dispose = vi.spyOn(fixture.componentInstance, 'dispose');
    fixture.destroy();
    const retired = h.owner.dispose('departure');
    h.host.destroyed();
    await retired;
    expect(dispose).toHaveBeenCalled();
    expect(h.prepDispose).toHaveBeenCalledOnce();
  });
});
