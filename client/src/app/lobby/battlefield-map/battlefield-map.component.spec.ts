import { webcrypto } from 'node:crypto';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { parseReplayParameters } from '../../../legacy/map-authoring/generation/protocol';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  importAsset,
} from '@kriegsspiel/maps';
import type { BoardPreparation, CertifiedBoard } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import {
  MAP_LIBRARY_PREVIEW_FACTORY,
  MapLibraryComponent,
} from '../map-library/map-library.component';
import { LibraryBrowserComponent } from '../map-library/library-browser.component';
import { MAP_LIBRARY_ASSET_VERIFIER } from '../map-library/asset-verifier';
import { checkLibraryAssetForTest } from '../map-library/asset-verifier.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  decodeApprovedBattlefield,
  decodeBattlefieldCatalog,
  type ApprovedBattlefield,
  type BattlefieldCatalog,
  type BattlefieldFeature,
  type ScenarioBattlefield,
} from '@kriegsspiel/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattlefieldMapComponent } from './battlefield-map.component';

// Public geography fixture from the accepted Hold the Bridge descriptor. No engine state.
function battlefield(): ScenarioBattlefield {
  const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
  const revision = `engine-scenario-v1:sha256:${'b'.repeat(64)}`;
  return {
    map: {
      id: 'hold-the-bridge:default',
      name: 'The bridge battlefield',
      source: 'scenario-default',
      terrainIdentity,
      widthM: 4000,
      heightM: 3000,
      preview: [
        {
          id: 'north-wood',
          kind: 'wood',
          name: 'Northern wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 600, y: 300 },
              { x: 1300, y: 350 },
              { x: 1250, y: 900 },
              { x: 650, y: 850 },
            ],
          },
        },
        {
          id: 'south-wood',
          kind: 'wood',
          name: 'Southern wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 2700, y: 1900 },
              { x: 3400, y: 1950 },
              { x: 3350, y: 2500 },
              { x: 2750, y: 2450 },
            ],
          },
        },
        {
          id: 'river',
          kind: 'river',
          name: 'The river',
          layer: 3,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 0, y: 1500 },
              { x: 4000, y: 1500 },
            ],
            widthM: 200,
          },
        },
        {
          id: 'high-road',
          kind: 'road',
          name: 'High road',
          layer: 2,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 2050, y: 0 },
              { x: 2050, y: 3000 },
            ],
            widthM: 20,
          },
        },
        {
          id: 'bridge',
          kind: 'bridge',
          name: 'The bridge',
          layer: 4,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
      ],
    },
    pairing: {
      id: 'hold-the-bridge:default',
      revision,
      scenarioId: 'hold-the-bridge',
      scenarioRevision: revision,
      terrainIdentity,
    },
    capabilities: { addMaps: false },
  };
}

function catalog(): BattlefieldCatalog {
  const legacy = battlefield();
  const defaultEntry = decodeApprovedBattlefield(
    {
      map: legacy.map,
      pairing: {
        ...legacy.pairing,
        revision: `engine-pairing-v1:sha256:${'c'.repeat(64)}`,
        resolvedScenarioId: 'hold-the-bridge',
        assemblyVersion: 'engine-native-v1',
      },
      isDefault: true,
    },
    legacy.pairing.scenarioId,
  );
  const terrainIdentity = `engine-terrain-v1:sha256:${'d'.repeat(64)}`;
  const included = decodeApprovedBattlefield(
    {
      map: {
        ...defaultEntry.map,
        id: 'hold-the-bridge:open',
        name: 'Open bridge approaches',
        source: 'included',
        terrainIdentity,
        preview: defaultEntry.map.preview.filter((feature) => feature.kind !== 'wood'),
      },
      pairing: {
        ...defaultEntry.pairing,
        id: 'hold-the-bridge:open',
        revision: `engine-pairing-v1:sha256:${'e'.repeat(64)}`,
        scenarioRevision: `engine-scenario-v1:sha256:${'f'.repeat(64)}`,
        resolvedScenarioId: 'hold-the-bridge-open-v1',
        terrainIdentity,
      },
      isDefault: false,
    },
    legacy.pairing.scenarioId,
  );
  return { schemaVersion: 1, scenarioId: 'hold-the-bridge', entries: [defaultEntry, included] };
}

function selection(entry: ApprovedBattlefield) {
  return { pairingId: entry.pairing.id, revision: entry.pairing.revision };
}

@Component({
  imports: [BattlefieldMapComponent],
  template: `
    <form (submit)="submit($event)" (keydown)="keys.push($event.key)">
      <input aria-label="Parent draft" value="unchanged timing and side draft" />
      <ks-battlefield-map
        [battlefield]="data()!"
        [scenarioName]="name()"
        [scenarioId]="parentId()"
        [catalog]="maps()"
        [selection]="selected()"
        [canOpen]="allowMapEntry"
        [library]="library()"
        [preparationFactory]="preparationFactory()"
        (activeChange)="gate($event)"
        (selectionChange)="select($event)"
      />
      <button type="submit">Start game</button>
    </form>
  `,
})
class Host {
  readonly data = signal<ScenarioBattlefield | undefined>(battlefield());
  readonly name = signal('Hold the Bridge');
  readonly parentId = signal<string | undefined>(undefined);
  readonly maps = signal<BattlefieldCatalog | undefined>(undefined);
  readonly selected = signal<{ pairingId: string; revision: string } | undefined>(undefined);
  readonly selections: ApprovedBattlefield[] = [];
  onSelection: ((entry: ApprovedBattlefield) => void) | undefined;
  readonly library = signal<MapLibraryPort | undefined>(undefined);
  readonly preparationFactory = signal<(() => BoardPreparation) | undefined>(undefined);
  readonly pending = signal(false);
  readonly allowMapEntry = () => !this.pending();
  readonly transitions: boolean[] = [];
  readonly keys: string[] = [];
  active = false;
  starts = 0;
  blockedStarts = 0;
  select(entry: ApprovedBattlefield): void {
    this.selections.push(entry);
    this.onSelection?.(entry);
  }
  gate(active: boolean): void {
    this.active = active;
    this.transitions.push(active);
  }
  submit(event: Event): void {
    event.preventDefault();
    if (this.active) this.blockedStarts++;
    else this.starts++;
  }
}

let fixture: ComponentFixture<Host>;
let host: Host;
let root: HTMLElement;
let modal: HTMLDialogElement;
const nativeShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

function button(label: string, inDialog = false): HTMLButtonElement {
  const scope = inDialog ? modal : root.querySelector('ks-battlefield-map > fieldset')!;
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function click(label: string, inDialog = false): void {
  button(label, inDialog).click();
  fixture.detectChanges();
}
function nextPop(): Promise<void> {
  return new Promise((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true }),
  );
}
async function close(label = 'Cancel'): Promise<void> {
  const pop = nextPop();
  click(label, true);
  // Parent protection remains synchronous until the asynchronous history traversal settles.
  expect(host.active).toBe(true);
  expect(modal.open).toBe(true);
  await pop;
  fixture.detectChanges();
  await fixture.whenStable();
  expect(modal.open).toBe(false);
  expect(host.active).toBe(false);
}
async function back(): Promise<void> {
  const pop = nextPop();
  window.history.back();
  await pop;
  fixture.detectChanges();
  await fixture.whenStable();
}
function key(target: Element, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  fixture.detectChanges();
  return event;
}
function feature(
  id: string,
  selector: string,
  scope: ParentNode = root.querySelector('fieldset')!,
): Element {
  const result = scope.querySelector(`[data-feature-id="${id}"] ${selector}`);
  if (!result) throw new Error(`Missing rendered feature ${id}`);
  return result;
}

/** Hold the browser's queued close event without replacing real history or clocks. */
function deferNativeClose(): () => void {
  let queued = 0;
  Object.defineProperty(modal, 'close', {
    configurable: true,
    value: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
      modal.removeAttribute('open');
      queued++;
    },
  });
  return () => {
    expect(queued).toBeGreaterThan(0);
    queued--;
    modal.dispatchEvent(new Event('close'));
  };
}

beforeEach(() => {
  // jsdom has no top layer or native dialog focus implementation. Only those browser
  // primitives are stubbed; Angular events and actual same-document history are exercised.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      if (this.open) throw new Error('Already open');
      expect(host.active).toBe(true);
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
  window.history.replaceState({ parent: 'retained' }, '', '/?lobby=1');
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MAP_LIBRARY_ASSET_VERIFIER, useValue: checkLibraryAssetForTest },
      {
        provide: MAP_LIBRARY_PREVIEW_FACTORY,
        useValue: () => ({ loadAsset: () => ({ ok: true }), dispose: vi.fn() }),
      },
    ],
  });
  fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  root = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  modal = root.querySelector('dialog')!;
});

afterEach(async () => {
  const ownEntry = (window.history.state as { __ksBattlefield?: unknown } | null)?.__ksBattlefield;
  const pop = ownEntry ? nextPop() : null;
  fixture?.destroy();
  if (pop) await pop;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (nativeShowModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', nativeShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (nativeClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', nativeClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('public battlefield geography', () => {
  it('shows the actual asymmetric 4 × 3 km terrain with full widths, radius and precedence', () => {
    const summary = root.querySelector('fieldset')!;
    expect(summary.textContent).toContain('Scenario default · Ready for Hold the Bridge');
    expect(summary.textContent).toContain('4 × 3 km');
    expect(summary.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 4000 3000');
    expect(feature('north-wood', 'polygon').getAttribute('points')).toBe(
      '600,300 1300,350 1250,900 650,850',
    );
    expect(feature('south-wood', 'polygon').getAttribute('points')).toBe(
      '2700,1900 3400,1950 3350,2500 2750,2450',
    );
    expect(feature('river', 'polyline').getAttribute('points')).toBe('0,1500 4000,1500');
    expect(feature('river', 'polyline').getAttribute('stroke-width')).toBe('200');
    expect(feature('high-road', 'polyline').getAttribute('stroke-width')).toBe('20');
    expect(feature('high-road', 'polyline').getAttribute('points')).toBe('2050,0 2050,3000');
    const bridge = feature('bridge', 'circle');
    expect([
      bridge.getAttribute('cx'),
      bridge.getAttribute('cy'),
      bridge.getAttribute('r'),
    ]).toEqual(['2050', '1500', '110']);
    const order = [...summary.querySelectorAll('[data-feature-id]')].map((e) =>
      e.getAttribute('data-feature-id'),
    );
    expect(order.indexOf('high-road')).toBeLessThan(order.indexOf('river'));
    expect(order.indexOf('river')).toBeLessThan(order.indexOf('bridge'));
  });

  it('draws replacement descriptor coordinates and dimensions rather than a fixed schematic', () => {
    const initial = battlefield();
    host.data.set({
      ...initial,
      map: {
        ...initial.map,
        widthM: 8000,
        heightM: 6000,
        preview: [
          {
            id: 'new-ground',
            kind: 'marsh',
            layer: 9,
            geometry: { shape: 'point', at: { x: 621, y: 433 }, radiusM: 72 },
          },
        ],
      },
    });
    fixture.detectChanges();
    expect(root.querySelector('fieldset svg')?.getAttribute('viewBox')).toBe('0 0 8000 6000');
    expect(root.querySelector('fieldset')?.textContent).toContain('8 × 6 km');
    expect(feature('new-ground', 'circle').getAttribute('r')).toBe('72');
    expect(feature('new-ground', 'circle').getAttribute('cx')).toBe('621');
    expect(root.querySelector('[data-feature-id="bridge"]')).toBeNull();
  });

  it('resolves equal layers deterministically with the engine ID precedence', () => {
    const initial = battlefield();
    const geometry = { shape: 'point' as const, at: { x: 500, y: 500 }, radiusM: 20 };
    const preview: BattlefieldFeature[] = [
      { id: 'a', kind: 'wood', layer: 1, geometry },
      { id: 'z', kind: 'water', layer: 1, geometry },
    ];
    host.data.set({ ...initial, map: { ...initial.map, preview } });
    fixture.detectChanges();
    expect(
      [...root.querySelectorAll('fieldset [data-feature-id]')].map((e) =>
        e.getAttribute('data-feature-id'),
      ),
    ).toEqual(['z', 'a']);
  });

  it('offers an actual read-only larger view, text geography and fit/zoom keyboard controls', async () => {
    click('View map');
    expect(modal.querySelector('h2')?.textContent).toBe('View battlefield map');
    expect(modal.querySelector('input')).toBeNull();
    expect(modal.textContent).not.toContain('Use map');
    expect(feature('bridge', 'circle', modal).getAttribute('r')).toBe('110');
    const canvas = modal.querySelector('svg')!;
    expect(canvas.getAttribute('aria-label')).toContain('4000 by 3000 metres');
    expect(modal.querySelector('details')?.textContent).toContain('radius 110 metres');
    // The disclosure keeps its native Enter activation while the event remains
    // contained in the dialog; only implicit form submission is suppressed.
    expect(key(modal.querySelector('summary')!, 'Enter').defaultPrevented).toBe(false);
    expect(host.keys).toEqual([]);
    click('Zoom in', true);
    expect(canvas.getAttribute('viewBox')).toBe('1000 750 2000 1500');
    key(canvas, 'ArrowRight');
    expect(canvas.getAttribute('viewBox')).toBe('1200 750 2000 1500');
    key(canvas, 'F');
    expect(canvas.getAttribute('viewBox')).toBe('0 0 4000 3000');
    key(canvas, '+');
    const escape = key(canvas, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(modal.open).toBe(true);
    expect(canvas.getAttribute('viewBox')).toBe('0 0 4000 3000');
    click('Zoom in', true);
    click('Pan east', true);
    expect(canvas.getAttribute('viewBox')).toBe('1500 750 2000 1500');
    click('Fit map', true);
    expect(canvas.getAttribute('viewBox')).toBe('0 0 4000 3000');
    const pop = nextPop();
    key(canvas, 'Escape');
    await pop;
    fixture.detectChanges();
    expect(modal.open).toBe(false);
    expect(host.starts).toBe(0);
  });
});

describe('dialog ownership and parent isolation', () => {
  it.each([true, false])(
    'ignores an old close event when the next visit is open=%s',
    async (acknowledgeWhileOpen) => {
      const acknowledge = deferNativeClose();
      click('Choose map');
      await close();
      click('Add map');
      const title = modal.querySelector<HTMLElement>('h2')!;
      expect(document.activeElement).toBe(title);
      if (acknowledgeWhileOpen) {
        acknowledge();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(modal.open).toBe(true);
        expect(document.activeElement).toBe(title);
      }
      await close();
      if (!acknowledgeWhileOpen) {
        acknowledge();
        fixture.detectChanges();
        await fixture.whenStable();
        // The old close must not acknowledge the new visit's pending close.
        expect(document.activeElement).toBe(document.body);
      }
      acknowledge();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(button('Add map'));
      expect(host.transitions).toEqual([true, false, true, false]);
      expect(window.history.state).toEqual({ parent: 'retained' });
    },
  );

  it('does not steal focus into map entries if creation becomes pending before the close render callback', async () => {
    const acknowledge = deferNativeClose();
    click('Choose map');
    await close();
    acknowledge();
    host.pending.set(true);
    const start = root.querySelector<HTMLButtonElement>('button[type=submit]')!;
    start.focus();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(start);
    expect(button('Choose map').disabled).toBe(true);
    expect(host.transitions).toEqual([true, false]);
    expect(window.history.state).toEqual({ parent: 'retained' });
  });

  it('cancels the pending focus render callback on destruction', async () => {
    const acknowledge = deferNativeClose();
    click('Choose map');
    await close();
    acknowledge();
    const outside = document.createElement('button');
    outside.textContent = 'Another view';
    document.body.append(outside);
    try {
      outside.focus();
      fixture.destroy();
      await fixture.whenStable();
      expect(document.activeElement).toBe(outside);
      expect(host.transitions).toEqual([true, false]);
    } finally {
      outside.remove();
    }
  });

  it.each([
    ['Choose map', 'Use map'],
    ['Choose map', 'Cancel'],
    ['Choose map', 'browser Back'],
    ['Add map', 'Use map'],
  ])(
    'restores the %s opener after %s history, queued native close and rendering settle',
    async (entry, action) => {
      const opener = button(entry);
      click(entry);
      if (entry === 'Add map') click('Back to maps', true);
      let acknowledgeNativeClose: (() => void) | undefined;
      const enabledDuringNativeClose: boolean[] = [];
      Object.defineProperty(modal, 'close', {
        configurable: true,
        value: () => {
          // Native close attempts its built-in focus restoration before queuing
          // the close event. An AX activation need not have focused the opener,
          // so that built-in fallback can leave BODY as the active element.
          enabledDuringNativeClose.push(!opener.matches(':disabled'));
          const focused = document.activeElement;
          if (focused instanceof HTMLElement) focused.blur();
          // Clear focus before hiding: jsdom's blur() is a no-op once its
          // dialog ancestor has display:none, unlike native dialog closure.
          modal.removeAttribute('open');
          acknowledgeNativeClose = () => modal.dispatchEvent(new Event('close'));
        },
      });

      const pop = nextPop();
      if (action === 'browser Back') window.history.back();
      else {
        button(action, true).focus();
        button(action, true).click();
        fixture.detectChanges();
        expect(opener.disabled).toBe(true);
      }
      expect(host.active).toBe(true);
      expect(modal.open).toBe(true);
      await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(enabledDuringNativeClose).toEqual([true]);
      expect(modal.open).toBe(false);
      expect(host.transitions).toEqual([true, false]);
      expect(window.history.state).toEqual({ parent: 'retained' });
      expect(document.activeElement).toBe(document.body);

      expect(acknowledgeNativeClose).toBeTypeOf('function');
      acknowledgeNativeClose!();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(opener);
      expect(opener.disabled).toBe(false);
      expect(host.transitions).toEqual([true, false]);
    },
  );

  it('blocks all three entries before rendering a changed pending signal and resumes when it clears', async () => {
    const entries = ['Choose map', 'Add map', 'View map'].map((label) => button(label));
    const historyLength = window.history.length;
    const historyState: unknown = window.history.state;
    expect(entries.every((entry) => !entry.disabled)).toBe(true);

    host.pending.set(true);
    // No change detection: stale enabled DOM must still be guarded by the live
    // parent signal read through the stable callback, before any history push.
    for (const entry of entries) {
      expect(entry.disabled).toBe(false);
      entry.click();
    }
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([]);
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state).toEqual(historyState);

    fixture.detectChanges();
    expect(entries.every((entry) => entry.disabled)).toBe(true);
    host.pending.set(false);
    fixture.detectChanges();
    expect(entries.every((entry) => !entry.disabled)).toBe(true);
    for (const label of ['Choose map', 'Add map', 'View map']) {
      click(label);
      expect(modal.open).toBe(true);
      await close(label === 'View map' ? 'Close' : 'Cancel');
    }
    expect(host.transitions).toEqual([true, false, true, false, true, false]);
    expect(host.starts).toBe(0);
    expect(window.history.state).toEqual(historyState);
  });

  it('contains Tab from the initially focused heading and wraps both control boundaries', async () => {
    click('Choose map');
    const title = modal.querySelector<HTMLElement>('h2')!;
    const first = modal.querySelector<HTMLInputElement>('input[type=radio]')!;
    const last = button('Use map', true);
    expect(document.activeElement).toBe(title);
    expect(key(title, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(key(last, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key(first, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    title.focus();
    expect(key(title, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(host.keys).toEqual([]);
    await close();
  });

  it('gates before native opening, focuses the heading and restores the opener/draft after Cancel', async () => {
    const opener = button('Choose map');
    const draft = root.querySelector<HTMLInputElement>('input[aria-label="Parent draft"]')!;
    draft.value = 'edited turn and side settings';
    opener.focus();
    click('Choose map');
    expect(host.transitions).toEqual([true]);
    expect(document.activeElement).toBe(modal.querySelector('h2'));
    expect(modal.getAttribute('aria-labelledby')).toBe(modal.querySelector('h2')!.id);
    expect(modal.querySelector<HTMLInputElement>('input[type=radio]')!.checked).toBe(true);
    await close();
    expect(document.activeElement).toBe(opener);
    expect(draft.value).toBe('edited turn and side settings');
    expect(host.transitions).toEqual([true, false]);
    expect(window.location.search).toBe('?lobby=1');
    expect(window.history.state).toEqual({ parent: 'retained' });
  });

  it('keeps synthetic Start gated during pending Cancel history cleanup', async () => {
    click('Choose map');
    const form = root.querySelector('form')!;
    const pop = nextPop();
    click('Cancel', true);
    form.requestSubmit();
    click('Choose map');
    expect(host.starts).toBe(0);
    expect(host.blockedStarts).toBe(1);
    expect(host.transitions).toEqual([true]);
    expect(modal.open).toBe(true);
    await pop;
    fixture.detectChanges();
    expect(host.transitions).toEqual([true, false]);
    form.requestSubmit();
    expect(host.starts).toBe(1);
    expect(window.history.state).toEqual({ parent: 'retained' });
  });

  it('returns focus to the Battlefield map heading if the actual opener disappears', async () => {
    const opener = button('Choose map');
    click('Choose map');
    opener.remove();
    await close();
    expect(document.activeElement).toBe(root.querySelector('fieldset legend'));
  });

  it('never submits the parent through map buttons or Enter on the candidate', async () => {
    for (const label of ['Choose map', 'Add map', 'View map']) {
      click(label);
      for (const action of root.querySelectorAll('ks-battlefield-map button'))
        expect((action as HTMLButtonElement).type).toBe('button');
      const target = modal.querySelector('input') ?? modal.querySelector('h2')!;
      expect(key(target, 'Enter').defaultPrevented).toBe(true);
      expect(host.keys).toEqual([]);
      expect(host.starts).toBe(0);
      await close(label === 'View map' ? 'Close' : 'Cancel');
    }
    expect(host.starts).toBe(0);
  });

  it('does not treat candidate clicks as confirmation; Use map is an explicit harmless no-op', async () => {
    const original = host.data();
    click('Choose map');
    modal.querySelector<HTMLInputElement>('input[type=radio]')!.click();
    fixture.detectChanges();
    expect(host.transitions).toEqual([true]);
    expect(host.data()).toBe(original);
    await close('Use map');
    expect(host.data()).toBe(original);
    expect(root.querySelector('fieldset [role=status]')?.textContent).toContain(
      'Map selected: The bridge battlefield.',
    );
    expect(host.starts).toBe(0);
  });

  it('ignores scrim clicks and cancels through the native Escape/cancel event', async () => {
    click('Choose map');
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.open).toBe(true);
    const pop = nextPop();
    const event = new Event('cancel', { cancelable: true });
    modal.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.active).toBe(true);
    await pop;
    fixture.detectChanges();
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([true, false]);
  });

  it('unwinds Add then the chooser on browser Back without leaving New game', async () => {
    click('Choose map');
    click('Add map', true);
    expect(modal.querySelector('h2')?.textContent).toBe('Add battlefield map');
    await back();
    expect(modal.open).toBe(true);
    expect(host.transitions).toEqual([true]);
    expect(modal.querySelector('h2')?.textContent).toBe('Choose battlefield map');
    expect(document.activeElement).toBe(modal.querySelector('h2'));
    await back();
    expect(modal.open).toBe(false);
    expect(window.location.search).toBe('?lobby=1');
    expect(document.activeElement).toBe(button('Choose map'));
    expect(host.starts).toBe(0);
  });

  it('supports Back to maps from both direct Add and nested Add', async () => {
    click('Add map');
    click('Back to maps', true);
    expect(modal.querySelector('h2')?.textContent).toBe('Choose battlefield map');
    expect(host.transitions).toEqual([true]);
    click('Add map', true);
    const pop = nextPop();
    click('Back to maps', true);
    expect(host.active).toBe(true);
    await pop;
    fixture.detectChanges();
    expect(modal.querySelector('h2')?.textContent).toBe('Choose battlefield map');
    await close();
    expect(document.activeElement).toBe(button('Add map'));
  });

  it('removes the whole internal history depth when canceling nested Add', async () => {
    click('Choose map');
    click('Add map', true);
    await close();
    expect(window.history.state).toEqual({ parent: 'retained' });
    expect(host.transitions).toEqual([true, false]);
  });

  it('guards repeated confirmation and starts a fresh preview on reopening', async () => {
    click('Choose map');
    click('Zoom in', true);
    const pop = nextPop();
    const use = button('Use map', true);
    use.click();
    use.click();
    fixture.detectChanges();
    expect(host.transitions).toEqual([true]);
    await pop;
    fixture.detectChanges();
    expect(host.transitions).toEqual([true, false]);
    click('Choose map');
    expect(modal.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 4000 3000');
    // An old queued close event cannot close a newly opened native dialog.
    modal.dispatchEvent(new Event('close'));
    expect(modal.open).toBe(true);
    await close();
    expect(host.transitions).toEqual([true, false, true, false]);
  });
});

describe('capability and input lifetime boundaries', () => {
  it.each([false, true])(
    'shows only the truthful current Add capability explanation (advertised=%s)',
    async (addMaps) => {
      const initial = battlefield();
      host.data.set({ ...initial, capabilities: { addMaps } });
      fixture.detectChanges();
      click('Add map');
      expect(modal.textContent).toContain('Adding maps to live games is not available yet.');
      expect(modal.textContent).toContain('A map needs a scenario with armies and objectives');
      expect(modal.querySelector('input, select, textarea')).toBeNull();
      expect([...modal.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
        'Cancel',
        'Back to maps',
      ]);
      await close();
    },
  );

  it.each([
    ['missing', () => undefined],
    ['missing pairing', () => ({ ...battlefield(), pairing: undefined })],
    [
      'mismatched terrain',
      () => ({
        ...battlefield(),
        pairing: {
          ...battlefield().pairing,
          terrainIdentity: `engine-terrain-v1:sha256:${'c'.repeat(64)}`,
        },
      }),
    ],
    [
      'mismatched scenario binding',
      () => ({
        ...battlefield(),
        pairing: { ...battlefield().pairing, scenarioId: 'other-scenario' },
      }),
    ],
    [
      'mismatched revisions',
      () => ({
        ...battlefield(),
        pairing: {
          ...battlefield().pairing,
          revision: `engine-scenario-v1:sha256:${'c'.repeat(64)}`,
        },
      }),
    ],
    [
      'unpaired source',
      () => ({ ...battlefield(), map: { ...battlefield().map, source: 'included' } }),
    ],
    [
      'nonfinite dimensions',
      () => ({ ...battlefield(), map: { ...battlefield().map, widthM: NaN } }),
    ],
    [
      'malformed points',
      () => ({
        ...battlefield(),
        map: {
          ...battlefield().map,
          preview: [
            {
              id: 'bad',
              kind: 'wood',
              layer: 1,
              geometry: { shape: 'polygon', points: [null, null, null] },
            },
          ],
        },
      }),
    ],
    [
      'unsupported geometry',
      () => ({
        ...battlefield(),
        map: {
          ...battlefield().map,
          preview: [{ id: 'bad', kind: 'wood', layer: 1, geometry: { shape: 'image' } }],
        },
      }),
    ],
  ])('fails visibly for %s instead of showing a wrong map as ready', (_label, invalid) => {
    host.data.set(invalid() as ScenarioBattlefield | undefined);
    fixture.detectChanges();
    const summary = root.querySelector('fieldset')!;
    expect(summary.querySelector('[role=alert]')?.textContent).toContain(
      "This battlefield map preview could not be checked. The scenario's default game settings are unchanged.",
    );
    expect(summary.textContent).not.toContain('Ready for');
    expect(summary.querySelector('svg')).toBeNull();
    expect(button('Choose map').disabled).toBe(true);
    expect(button('View map').disabled).toBe(true);
    expect(host.transitions).toEqual([]);
  });

  it('fails visibly when required inputs are omitted by a runtime caller', () => {
    const missing = TestBed.createComponent(BattlefieldMapComponent);
    expect(() => missing.detectChanges()).not.toThrow();
    expect(
      (missing.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent,
    ).toContain('could not be checked');
    missing.destroy();
  });

  it('invalidates an open lifetime on descriptor or display-name replacement', async () => {
    click('Choose map');
    const pop = nextPop();
    const initial = battlefield();
    host.data.set({ ...initial, map: { ...initial.map, name: 'Updated public name' } });
    host.name.set('Updated scenario name');
    fixture.detectChanges();
    expect(host.active).toBe(true);
    expect(button('Use map', true).disabled).toBe(true);
    await pop;
    fixture.detectChanges();
    expect(host.transitions).toEqual([true, false]);
    expect(root.querySelector('fieldset')?.textContent).toContain('Updated public name');
    click('Choose map');
    expect(modal.textContent).toContain('Ready for Updated scenario name');
    await close();
    expect(root.querySelector('fieldset [role=status]')?.textContent).not.toContain('Map selected');
  });

  it('tears down an open native dialog/history lifetime and ignores later navigation after destruction', async () => {
    click('Choose map');
    click('Add map', true);
    const pop = nextPop();
    fixture.destroy();
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([true, false]);
    await pop;
    window.dispatchEvent(new PopStateEvent('popstate', { state: { unrelated: true } }));
    expect(host.transitions).toEqual([true, false]);
    expect(window.history.state).toEqual({ parent: 'retained' });
  });

  it('finishes invalidating replaced input even while Back to maps is already traversing', async () => {
    click('Choose map');
    click('Add map', true);
    const internalPop = nextPop();
    click('Back to maps', true);
    host.data.set(undefined);
    fixture.detectChanges();
    await internalPop;
    // Reaching the chooser is only an intermediate acknowledgement; the
    // replaced input must cancel the old lifetime all the way to its parent.
    expect(host.active).toBe(true);
    const finalPop = nextPop();
    await finalPop;
    fixture.detectChanges();
    expect(host.transitions).toEqual([true, false]);
    expect(modal.open).toBe(false);
    expect(window.history.state).toEqual({ parent: 'retained' });
    expect(root.querySelector('fieldset [role=alert]')?.textContent).toContain(
      'default game settings are unchanged',
    );
  });

  it('settles in-flight internal Back on destruction without duplicate close or stranded history', async () => {
    click('Choose map');
    click('Add map', true);
    const internalPop = nextPop();
    click('Back to maps', true);
    fixture.destroy();
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([true, false]);
    await internalPop;
    await nextPop();
    expect(window.history.state).toEqual({ parent: 'retained' });
    window.dispatchEvent(new PopStateEvent('popstate', { state: { unrelated: true } }));
    expect(host.transitions).toEqual([true, false]);
  });
});

function modern(selectionValue?: { pairingId: string; revision: string }): BattlefieldCatalog {
  const value = catalog();
  decodeBattlefieldCatalog(value, value.scenarioId);
  host.parentId.set(value.scenarioId);
  host.maps.set(value);
  host.selected.set(selectionValue);
  fixture.detectChanges();
  return value;
}

function radios(): HTMLInputElement[] {
  return [...modal.querySelectorAll<HTMLInputElement>('input[type=radio]')];
}

function pick(id: string): void {
  const radio = radios().find((input) => input.value === id);
  if (!radio) throw new Error(`Missing candidate ${id}`);
  radio.click();
  fixture.detectChanges();
}

describe('approved native map choices', () => {
  it('uses the catalog default and shows only server-approved rows with actual candidate geography', async () => {
    const value = modern();
    const summary = root.querySelector('fieldset')!;
    expect(summary.textContent).toContain('Scenario default · Ready for Hold the Bridge');
    click('Choose map');
    expect(radios().map((input) => [input.value, input.checked])).toEqual([
      ['hold-the-bridge:default', true],
      ['hold-the-bridge:open', false],
    ]);
    expect(radios().map((input) => input.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Scenario default'),
      expect.stringContaining('Included map'),
    ]);
    for (const radio of radios())
      expect(radio.closest('label')?.textContent).toContain('Ready for Hold the Bridge');
    expect(modal.textContent).not.toContain('Only the scenario');
    expect(modal.textContent).not.toContain('One map is available');
    pick(value.entries[1]!.pairing.id);
    expect(modal.querySelector('section[aria-label="Map preview"] h3')?.textContent).toContain(
      'Open bridge approaches',
    );
    expect(modal.querySelector('[data-feature-id="north-wood"]')).toBeNull();
    expect(feature('bridge', 'circle', modal).getAttribute('cx')).toBe('2050');
    expect(feature('river', 'polyline', modal).getAttribute('stroke-width')).toBe('200');
    expect(summary.textContent).toContain('The bridge battlefield');
    expect(summary.querySelector('[data-feature-id="north-wood"]')).not.toBeNull();
    expect(host.selections).toEqual([]);
    await close();
  });

  it('keeps candidate changes out of summary and View, and discards them on Cancel/reopen', async () => {
    const value = modern();
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    click('Zoom in', true);
    pick(value.entries[0]!.pairing.id);
    expect(modal.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 4000 3000');
    pick(value.entries[1]!.pairing.id);
    await close();
    click('View map');
    expect(modal.textContent).toContain('The bridge battlefield');
    expect(modal.querySelector('[data-feature-id="north-wood"]')).not.toBeNull();
    expect(radios()).toEqual([]);
    expect(modal.textContent).not.toContain('Use map');
    await close('Close');
    click('Choose map');
    expect(radios().find((input) => input.checked)?.value).toBe(value.entries[0]!.pairing.id);
    await close();
    expect(host.selections).toEqual([]);
  });

  it('commits one detached checked entry only on Use, then reopens and Views that committed choice', async () => {
    const value = modern();
    const original = structuredClone(value);
    const opener = button('Choose map');
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    await close('Use map');
    expect(host.selections).toEqual([value.entries[1]]);
    expect(host.selections[0]).not.toBe(value.entries[1]);
    expect(root.querySelector('fieldset')?.textContent).toContain(
      'Included map · Ready for Hold the Bridge',
    );
    expect(root.querySelector('fieldset [role=status]')?.textContent).toContain(
      'Map selected: Open bridge approaches.',
    );
    expect(document.activeElement).toBe(opener);
    host.selections[0]!.map.name = 'Mutated output';
    host.selections[0]!.map.preview.length = 0;
    fixture.detectChanges();
    expect(root.querySelector('fieldset')?.textContent).toContain('Open bridge approaches');
    expect(root.querySelector('fieldset [data-feature-id="bridge"]')).not.toBeNull();
    expect(value).toEqual(original);
    click('View map');
    expect(modal.textContent).toContain('Open bridge approaches');
    expect(modal.querySelector('[data-feature-id="north-wood"]')).toBeNull();
    await close('Close');
    click('Choose map');
    expect(radios().find((input) => input.checked)?.value).toBe(value.entries[1]!.pairing.id);
    await close();
    expect(host.selections).toHaveLength(1);
    expect(host.starts).toBe(0);
  });

  it.each(['Back to maps', 'browser Back'])(
    'retains an uncommitted candidate through nested Add and %s',
    async (action) => {
      const value = modern();
      click('Choose map');
      pick(value.entries[1]!.pairing.id);
      click('Add map', true);
      expect(modal.textContent).toContain('Adding maps to live games is not available yet.');
      expect(modal.textContent).not.toContain("keep playing on the scenario's default");
      expect(modal.querySelector('input, textarea, select, a')).toBeNull();
      if (action === 'browser Back') await back();
      else {
        const pop = nextPop();
        click(action, true);
        await pop;
        fixture.detectChanges();
      }
      expect(radios().find((input) => input.checked)?.value).toBe(value.entries[1]!.pairing.id);
      expect(modal.querySelector('[data-feature-id="north-wood"]')).toBeNull();
      expect(root.querySelector('fieldset')?.textContent).toContain('The bridge battlefield');
      expect(host.selections).toEqual([]);
      await close();
    },
  );

  it.each(['Escape', 'browser Back'])(
    '%s preserves the committed native choice and complete parent draft',
    async (action) => {
      const value = catalog();
      modern(selection(value.entries[1]!));
      const draft = root.querySelector<HTMLInputElement>('input[aria-label="Parent draft"]')!;
      draft.value = 'Blue, Red, turns, 4:1 and umpire draft';
      click('Choose map');
      pick(value.entries[0]!.pairing.id);
      if (action === 'browser Back') await back();
      else {
        const pop = nextPop();
        key(modal.querySelector('h2')!, 'Escape');
        await pop;
        fixture.detectChanges();
        await fixture.whenStable();
      }
      expect(document.activeElement).toBe(button('Choose map'));
      expect(root.querySelector('fieldset')?.textContent).toContain('Open bridge approaches');
      expect(host.selected()).toEqual(selection(value.entries[1]!));
      expect(draft.value).toBe('Blue, Red, turns, 4:1 and umpire draft');
      expect(host.selections).toEqual([]);
    },
  );

  it.each(['before history', 'after history'])(
    'accepts parent selection feedback %s without duplicate output, traversal or lost focus/announcement',
    async (timing) => {
      const value = modern();
      const go = vi.spyOn(window.history, 'go');
      const acknowledgeClose = deferNativeClose();
      if (timing === 'before history')
        host.onSelection = (entry) => {
          expect(host.active).toBe(true);
          host.selected.set(selection(entry));
          fixture.detectChanges();
          root.querySelector('form')!.requestSubmit();
        };
      click('Choose map');
      pick(value.entries[1]!.pairing.id);
      const pop = nextPop();
      const use = button('Use map', true);
      use.click();
      use.click();
      fixture.detectChanges();
      expect(host.active).toBe(true);
      expect(modal.open).toBe(true);
      expect(host.selections).toEqual([value.entries[1]]);
      await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(modal.open).toBe(false);
      expect(document.activeElement).toBe(document.body);
      if (timing === 'after history') {
        host.selected.set(selection(host.selections[0]!));
        fixture.detectChanges();
      }
      // A repeated immutable parent acknowledgement is still the same selection.
      host.selected.set(selection(host.selections[0]!));
      fixture.detectChanges();
      acknowledgeClose();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(go.mock.calls).toEqual([[-1]]);
      expect(host.transitions).toEqual([true, false]);
      expect(document.activeElement).toBe(button('Choose map'));
      expect(root.querySelector('fieldset [role=status]')?.textContent).toContain(
        'Map selected: Open bridge approaches.',
      );
      expect(host.selections).toHaveLength(1);
      expect(host.starts).toBe(0);
      expect(host.blockedStarts).toBe(timing === 'before history' ? 1 : 0);
    },
  );

  it('contains the native radio group at its checked member and suppresses Enter submission', async () => {
    const value = modern(selection(catalog().entries[1]!));
    click('Choose map');
    const checked = radios()[1]!;
    expect(checked.checked).toBe(true);
    const title = modal.querySelector('h2')!;
    key(title, 'Tab', true);
    expect(document.activeElement).toBe(button('Use map', true));
    key(button('Use map', true), 'Tab');
    expect(document.activeElement).toBe(checked);
    key(checked, 'Tab', true);
    expect(document.activeElement).toBe(button('Use map', true));
    expect(key(checked, 'Enter').defaultPrevented).toBe(true);
    expect(key(checked, 'ArrowLeft').defaultPrevented).toBe(false);
    expect(host.keys).toEqual([]);
    pick(value.entries[0]!.pairing.id);
    expect(host.selections).toEqual([]);
    expect(host.starts).toBe(0);
    for (const action of root.querySelectorAll<HTMLButtonElement>('ks-battlefield-map button'))
      expect(action.type).toBe('button');
    await close();
  });

  it('blocks all modern entries synchronously before the starting signal is rendered, then resumes', async () => {
    modern();
    const entries = ['Choose map', 'Add map', 'View map'].map((label) => button(label));
    const push = vi.spyOn(window.history, 'pushState');
    host.pending.set(true);
    for (const entry of entries) {
      expect(entry.disabled).toBe(false);
      entry.click();
    }
    expect(push).not.toHaveBeenCalled();
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([]);
    expect(host.selections).toEqual([]);
    fixture.detectChanges();
    expect(entries.every((entry) => entry.disabled)).toBe(true);
    host.pending.set(false);
    fixture.detectChanges();
    for (const label of ['Choose map', 'Add map', 'View map']) {
      click(label);
      expect(modal.open).toBe(true);
      await close(label === 'View map' ? 'Close' : 'Cancel');
    }
  });

  it('cannot commit a candidate through stale enabled Use DOM once the starting callback becomes false', async () => {
    const value = modern();
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    const use = button('Use map', true);
    host.pending.set(true);
    expect(use.disabled).toBe(false);
    use.click();
    expect(host.selections).toEqual([]);
    expect(modal.open).toBe(true);
    host.pending.set(false);
    fixture.detectChanges();
    await close();
  });
});

describe('modern approval and replacement boundaries', () => {
  it('honors invalid parent feedback during Use without a second unwind or false readiness', async () => {
    const value = modern();
    host.onSelection = (entry) => {
      host.selected.set({ ...selection(entry), revision: 'stale' });
      fixture.detectChanges();
    };
    const go = vi.spyOn(window.history, 'go');
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    await close('Use map');
    expect(go.mock.calls).toEqual([[-1]]);
    expect(host.selections).toEqual([value.entries[1]]);
    expect(host.transitions).toEqual([true, false]);
    expect(root.querySelector('fieldset')?.textContent).not.toContain('Ready for');
    expect(root.querySelector('fieldset [role=status]')?.textContent).not.toContain('Map selected');
    expect(button('View map').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Choose map'));
  });

  it('rejects selection accessors and inherited identity without reading or trusting them', () => {
    const value = modern();
    const read = vi.fn(() => {
      throw new Error('Selection getter must not run');
    });
    const accessor = { revision: value.entries[0]!.pairing.revision };
    Object.defineProperty(accessor, 'pairingId', { enumerable: true, get: read });
    host.selected.set(accessor as { pairingId: string; revision: string });
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(root.querySelector('fieldset')?.textContent).not.toContain('Ready for');
    const inherited = Object.create(selection(value.entries[0]!)) as {
      pairingId: string;
      revision: string;
    };
    Object.assign(inherited, { unrelated: true, alsoUnrelated: true });
    host.selected.set(inherited);
    fixture.detectChanges();
    expect(root.querySelector('fieldset')?.textContent).not.toContain('Ready for');
  });

  it.each([
    [
      'unknown pairing',
      { pairingId: 'foreign:default', revision: catalog().entries[0]!.pairing.revision },
    ],
    [
      'stale revision',
      { pairingId: 'hold-the-bridge:open', revision: `engine-pairing-v1:sha256:${'0'.repeat(64)}` },
    ],
    [
      'legacy revision',
      { pairingId: 'hold-the-bridge:default', revision: battlefield().pairing.revision },
    ],
    ['missing revision', { pairingId: 'hold-the-bridge:default' }],
    ['null selection', null],
    ['extra selection fields', { ...selection(catalog().entries[0]!), approved: true }],
  ])(
    'keeps a present %s unavailable until explicit Use of a valid choice',
    async (_label, invalid) => {
      modern(invalid as { pairingId: string; revision: string });
      const summary = root.querySelector('fieldset')!;
      expect(summary.textContent).not.toContain('Ready for');
      expect(summary.querySelector('svg')).toBeNull();
      expect(summary.querySelector('[role=alert]')?.textContent).toContain('unavailable');
      expect(button('Choose map').disabled).toBe(false);
      expect(button('View map').disabled).toBe(true);
      click('Choose map');
      await close();
      expect(summary.textContent).not.toContain('Ready for');
      expect(host.selections).toEqual([]);
      click('Choose map');
      await close('Use map');
      expect(host.selections).toEqual([catalog().entries[0]]);
      expect(summary.textContent).toContain('Scenario default · Ready for Hold the Bridge');
      expect(host.starts).toBe(0);
    },
  );

  it.each([
    ['null catalog', () => null],
    ['missing catalog', () => undefined],
    ['foreign catalog parent', () => ({ ...catalog(), scenarioId: 'another-scenario' })],
    [
      'foreign pairing parent',
      () => {
        const value = catalog();
        value.entries[1]!.pairing.scenarioId = 'another-scenario';
        return value;
      },
    ],
    [
      'unpaired map with approved-looking name/source',
      () => {
        const value = catalog();
        return { ...value, entries: [{ map: value.entries[1]!.map }] };
      },
    ],
    ['private field', () => ({ ...catalog(), initialWorld: { units: [] } })],
    ['legacy format', () => ({ ...catalog(), entries: [battlefield()] })],
    [
      'off-grid preview',
      () => {
        const value = catalog();
        value.entries[1]!.map.preview[0]!.geometry = {
          shape: 'point',
          at: { x: 0.0001, y: 1 },
          radiusM: 1,
        };
        return value;
      },
    ],
  ])('rejects %s without falling back to a valid legacy battlefield', async (_label, invalid) => {
    modern();
    host.maps.set(invalid() as BattlefieldCatalog);
    fixture.detectChanges();
    const summary = root.querySelector('fieldset')!;
    expect(summary.textContent).not.toContain('Ready for');
    expect(summary.querySelector('svg')).toBeNull();
    expect(summary.querySelector('[role=alert]')?.textContent).toContain('could not be checked');
    expect(button('Choose map').disabled).toBe(true);
    expect(button('View map').disabled).toBe(true);
    click('Add map');
    click('Back to maps', true);
    expect(radios()).toEqual([]);
    expect(button('Use map', true).disabled).toBe(true);
    expect(modal.textContent).not.toContain('Ready for');
    await close();
    expect(host.selections).toEqual([]);
  });

  it.each([undefined, 'another-scenario', 'a'.repeat(129), 'hold-the-bridge\n'])(
    'requires independent bounded parent scenarioId=%s',
    async (parent) => {
      modern();
      host.parentId.set(parent);
      fixture.detectChanges();
      expect(root.querySelector('fieldset')?.textContent).not.toContain('Ready for');
      expect(button('Choose map').disabled).toBe(true);
      expect(button('View map').disabled).toBe(true);
      expect(host.selections).toEqual([]);
    },
  );

  it('checks a detached bounded catalog without invoking transport accessors', () => {
    const value = modern();
    value.entries[0]!.map.name = 'Mutated transport';
    fixture.detectChanges();
    expect(root.querySelector('fieldset')?.textContent).toContain('The bridge battlefield');
    const accessor = catalog();
    const read = vi.fn(() => {
      throw new Error('Getter must not run');
    });
    Object.defineProperty(accessor, 'entries', { enumerable: true, get: read });
    host.maps.set(accessor);
    fixture.detectChanges();
    expect(read).not.toHaveBeenCalled();
    expect(button('Choose map').disabled).toBe(true);
    expect(root.querySelector('fieldset')?.textContent).not.toContain('Ready for');
  });

  it.each(['catalog', 'scenario', 'selection'])(
    'invalidates an open candidate on %s replacement without committing or losing the draft',
    async (replacement) => {
      const value = modern();
      click('Choose map');
      pick(value.entries[1]!.pairing.id);
      const pop = nextPop();
      if (replacement === 'catalog') {
        const changed = catalog();
        changed.entries[1]!.map.name = 'Updated included name';
        host.maps.set(changed);
      } else if (replacement === 'scenario') host.parentId.set('another-scenario');
      else host.selected.set({ pairingId: 'stale', revision: 'stale' });
      fixture.detectChanges();
      expect(modal.open).toBe(true);
      expect(host.active).toBe(true);
      expect(button('Use map', true).disabled).toBe(true);
      await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(modal.open).toBe(false);
      expect(host.transitions).toEqual([true, false]);
      expect(host.selections).toEqual([]);
      expect(root.querySelector<HTMLInputElement>('input[aria-label="Parent draft"]')?.value).toBe(
        'unchanged timing and side draft',
      );
      expect(window.history.state).toEqual({ parent: 'retained' });
      expect(root.querySelector('fieldset [role=status]')?.textContent).not.toContain(
        'Map selected',
      );
    },
  );

  it('ignores an earlier native-close acknowledgement during a newer native selection lifetime', async () => {
    const value = modern();
    const acknowledgeClose = deferNativeClose();
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    await close('Use map');
    click('Choose map');
    pick(value.entries[0]!.pairing.id);
    acknowledgeClose();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(modal.open).toBe(true);
    expect(document.activeElement).toBe(modal.querySelector('h2'));
    expect(host.selections).toHaveLength(1);
    await close();
    acknowledgeClose();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(button('Choose map'));
    expect(root.querySelector('fieldset')?.textContent).toContain('Open bridge approaches');
    expect(host.selections).toHaveLength(1);
  });
});

function deferredLibrary<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function addBody(): MapLibraryComponent {
  const found = fixture.debugElement.query(By.directive(MapLibraryComponent));
  if (!found) throw new Error('Missing actual Add child');
  return found.componentInstance as MapLibraryComponent;
}
function browserBody(): LibraryBrowserComponent {
  const found = fixture.debugElement.query(By.directive(LibraryBrowserComponent));
  if (!found) throw new Error('Missing actual library browser');
  return found.componentInstance as LibraryBrowserComponent;
}

describe('attached geography library with real Add content and outer history ownership', () => {
  let library: MapLibraryPort;
  let preparations: BoardPreparation[];
  let factory: ReturnType<typeof vi.fn<() => BoardPreparation>>;
  let savedSummary: LibraryMapSummary;
  let canonicalJson: string;
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    preparations = [];
    // Preparation doubles certify public reference geography expanded to the requested
    // recipe/grid. These tests exercise presentation ownership, not real generation.
    factory = vi.fn(() => {
      const preparation: BoardPreparation = {
        generate: vi.fn<BoardPreparation['generate']>(async (recipe) => {
          const asset = createReferenceAsset();
          asset.settings = structuredClone(recipe.settings);
          asset.provenance.seed = recipe.seed;
          asset.overrides = structuredClone(recipe.overrides);
          asset.bounds.maxX = recipe.settings.widthM;
          asset.bounds.maxY = recipe.settings.heightM;
          const spacingM = recipe.settings.sampleSpacingM;
          const columns = Math.ceil(recipe.settings.widthM / spacingM) + 1;
          const rows = Math.ceil(recipe.settings.heightM / spacingM) + 1;
          if (asset.elevation.columns !== columns || asset.elevation.rows !== rows)
            asset.elevation = { columns, rows, spacingM, samples: Array(columns * rows).fill(100) };
          canonicalJson = canonicalizeAsset(asset);
          const identity = await assetIdentity(asset, 'asset');
          savedSummary = {
            ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d1' },
            name: 'Saved geography',
            widthM: asset.bounds.maxX,
            heightM: asset.bounds.maxY,
            assetIdentity: identity,
            status: 'needs-scenario',
          };
          return {
            asset,
            canonicalJson,
            assetIdentity: identity,
            bounds: { minX: 0, minY: 0, maxX: asset.bounds.maxX, maxY: asset.bounds.maxY },
            summary: {
              ref: null,
              name: asset.name,
              widthM: asset.bounds.maxX,
              heightM: asset.bounds.maxY,
            },
          };
        }),
        load: vi.fn<BoardPreparation['load']>(async (json, summary) => {
          const asset = importAsset(json);
          return {
            asset,
            canonicalJson: json,
            assetIdentity: await assetIdentity(asset, 'asset'),
            bounds: { minX: 0, minY: 0, maxX: asset.bounds.maxX, maxY: asset.bounds.maxY },
            summary,
          };
        }),
        dispose: vi.fn(),
      };
      preparations.push(preparation);
      return preparation;
    });
    library = {
      list: vi.fn().mockResolvedValue({ items: [] }),
      read: vi.fn(async () => ({ item: savedSummary, canonicalJson })),
      save: vi.fn(async (intent) => ({ ...savedSummary, name: intent.name })),
    };
    host.library.set(library);
    host.preparationFactory.set(factory);
    fixture.detectChanges();
  });

  function dirtyAdd() {
    const child = addBody();
    child.state.setSeed('17');
    fixture.detectChanges();
    return child;
  }

  it('keeps native candidates distinct from My maps and unpaired included browsing, with Use disabled', async () => {
    const choices = modern();
    click('Choose map');
    pick(choices.entries[1]!.pairing.id);
    click('My maps', true);
    await fixture.whenStable();
    expect(library.list).toHaveBeenCalledWith('owned', expect.any(AbortSignal), undefined);
    expect(modal.textContent).toContain('Needs a scenario');
    expect(modal.textContent).not.toContain('Ready for');
    expect(button('Use map', true).disabled).toBe(true);
    button('Use map', true).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.selections).toEqual([]);
    click('Back to scenario maps', true);
    expect(radios().find((radio) => radio.checked)?.value).toBe(choices.entries[1]!.pairing.id);
    click('Browse included maps', true);
    await fixture.whenStable();
    expect(library.list).toHaveBeenCalledWith('included', expect.any(AbortSignal), undefined);
    expect(button('Use map', true).disabled).toBe(true);
    expect(modal.textContent).toContain('Other included maps');
    click('Back to scenario maps', true);
    await close('Use map');
    expect(host.selections).toEqual([choices.entries[1]]);
    expect(host.starts).toBe(0);
  });

  it.each(['Escape', 'native cancel', 'native close', 'Cancel', 'Back to maps'])(
    'routes dirty %s through the child and keeps the exact draft through Keep editing',
    async (action) => {
      modern();
      click('Choose map');
      click('Add map', true);
      const child = dirtyAdd();
      if (action === 'Escape') key(modal.querySelector('input')!, 'Escape');
      else if (action === 'native cancel') {
        const event = new Event('cancel', { cancelable: true });
        modal.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        fixture.detectChanges();
      } else if (action === 'native close') {
        modal.close();
        fixture.detectChanges();
      } else click(action, true);
      await fixture.whenStable();
      expect(child.state.confirming()).toBe(true);
      expect(addBody()).toBe(child);
      expect(preparations[0]!.dispose).not.toHaveBeenCalled();
      expect(modal.open).toBe(true);
      expect(host.transitions).toEqual([true]);
      expect(document.activeElement?.textContent).toBe('Discard this map?');
      click('Keep editing', true);
      await fixture.whenStable();
      expect(child.state.seed()).toBe('17');
      expect(child.state.confirming()).toBe(false);
      // A fresh Escape is a close intent, even after keeping an earlier Back-to-maps draft.
      key(modal.querySelector('input')!, 'Escape');
      await fixture.whenStable();
      const pop = nextPop();
      click('Discard map', true);
      expect(host.active).toBe(true);
      await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(host.transitions).toEqual([true, false]);
      expect(window.history.state).toEqual({ parent: 'retained' });
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(button('Choose map'));
      expect(host.selections).toEqual([]);
      expect(host.starts).toBe(0);
    },
  );

  it.each([false, true])(
    're-owns browser Back during dirty Add (nested=%s), retains Keep editing, and acknowledges final discard',
    async (nested) => {
      modern();
      const opener = nested ? 'Choose map' : 'Add map';
      click(opener);
      if (nested) click('Add map', true);
      const child = dirtyAdd();
      const draft = root.querySelector<HTMLInputElement>('[aria-label="Parent draft"]')!;
      draft.value = 'preserved turn fields';
      await back();
      expect(modal.open).toBe(true);
      expect(addBody()).toBe(child);
      expect(child.state.confirming()).toBe(true);
      expect(window.history.state.__ksBattlefield.view).toBe('add');
      expect(window.history.state.__ksBattlefield.depth).toBe(nested ? 2 : 1);
      expect(host.transitions).toEqual([true]);
      expect(preparations[0]!.dispose).not.toHaveBeenCalled();
      click('Keep editing', true);
      await fixture.whenStable();
      expect(child.state.seed()).toBe('17');
      await back();
      expect(child.state.confirming()).toBe(true);
      // Repeated Back while confirmation is pending must retain this same child.
      await back();
      expect(addBody()).toBe(child);
      expect(window.history.state.__ksBattlefield.view).toBe('add');
      const pop = nextPop();
      click('Discard map', true);
      await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(draft.value).toBe('preserved turn fields');
      expect(host.selections).toEqual([]);
      if (nested) {
        expect(modal.open).toBe(true);
        expect(modal.querySelector('h2')?.textContent).toBe('Choose battlefield map');
        await close();
      } else expect(modal.open).toBe(false);
      expect(document.activeElement).toBe(button(opener));
      expect(window.history.state).toEqual({ parent: 'retained' });
      expect(host.starts).toBe(0);
    },
  );

  it('preserves the native candidate when Back to maps discards a dirty Add child', async () => {
    const value = modern();
    click('Choose map');
    pick(value.entries[1]!.pairing.id);
    click('Add map', true);
    dirtyAdd();
    click('Back to maps', true);
    const pop = nextPop();
    click('Discard map', true);
    await pop;
    fixture.detectChanges();
    expect(radios().find((radio) => radio.checked)?.value).toBe(value.entries[1]!.pairing.id);
    expect(host.selections).toEqual([]);
    await close();
  });

  it.each([false, true])(
    'returns a verified Save to My maps inspection without committing or enabling native Use (nested=%s)',
    async (nested) => {
      const value = modern();
      const nativeCandidate = value.entries[nested ? 1 : 0]!;
      if (nested) {
        click('Choose map');
        pick(nativeCandidate.pairing.id);
        click('Add map', true);
      } else click('Add map');
      const child = addBody();
      // Use the frozen child's recorded-recipe seam: the public reference fixture
      // has one village, unlike the default generator preset's ten settlements.
      const reference = createReferenceAsset();
      child.state.configure(
        preparations[0]!,
        library,
        parseReplayParameters({
          seed: reference.provenance.seed,
          settings: reference.settings,
          overrides: reference.overrides,
        }),
      );
      await child.state.generate();
      await fixture.whenStable();
      expect(child.state.board()).toBeDefined();
      child.state.setName('Saved geography');
      fixture.detectChanges();
      const pop = nested ? nextPop() : undefined;
      await child.state.save();
      if (pop) await pop;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(modal.open).toBe(true);
      expect(host.transitions).toEqual([true]);
      expect(host.selections).toEqual([]);
      expect(host.starts).toBe(0);
      expect(button('Use map', true).disabled).toBe(true);
      expect(modal.textContent).toContain('My maps');
      expect(modal.textContent).toContain('Saved geography');
      await vi.waitFor(() => expect(browserBody().board()).toBeDefined());
      await fixture.whenStable();
      expect(modal.querySelector('canvas')).not.toBeNull();
      const inspectionHeading = modal.querySelector<HTMLElement>(
        'section[aria-label="Geography inspection"] h3',
      )!;
      expect(inspectionHeading.textContent).toBe('Saved geography');
      expect(document.activeElement).toBe(inspectionHeading);
      expect(modal.textContent).not.toContain('Ready for');
      expect(root.querySelector('fieldset')?.textContent).toContain('The bridge battlefield');
      expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(preparations[1]!.load).toHaveBeenCalledWith(
        canonicalJson,
        {
          ref: { kind: 'generated', id: savedSummary.ref.id },
          name: savedSummary.name,
          widthM: 150,
          heightM: 150,
        },
        expect.any(AbortSignal),
      );
      click('Back to scenario maps', true);
      expect(radios().find((radio) => radio.checked)?.value).toBe(nativeCandidate.pairing.id);
      expect(preparations[1]!.dispose).toHaveBeenCalledTimes(1);
      await close();
      expect(host.selections).toEqual([]);
    },
  );

  it('allocates a fresh preparation for each Add visit and retires a browser read immediately on outer Cancel', async () => {
    modern();
    click('Choose map');
    click('Add map', true);
    let pop = nextPop();
    click('Back to maps', true);
    await pop;
    fixture.detectChanges();
    click('Add map', true);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(preparations[0]).not.toBe(preparations[1]);
    expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    pop = nextPop();
    click('Back to maps', true);
    await pop;
    fixture.detectChanges();
    click('My maps', true);
    await fixture.whenStable();
    const asset = createReferenceAsset();
    const item: LibraryMapSummary = {
      ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d1' },
      name: 'Late inspection',
      widthM: 150,
      heightM: 150,
      assetIdentity: await assetIdentity(asset, 'asset'),
      status: 'needs-scenario',
    };
    const delayed = deferredLibrary<Awaited<ReturnType<MapLibraryPort['read']>>>();
    vi.mocked(library.read).mockReturnValueOnce(delayed.promise);
    const browser = browserBody();
    const operation = browser.inspect(item);
    const signal = vi.mocked(library.read).mock.calls[0]![1];
    pop = nextPop();
    button('Cancel', true).click();
    expect(signal.aborted).toBe(true);
    delayed.resolve({ item, canonicalJson: canonicalizeAsset(asset) });
    await operation;
    expect(browser.board()).toBeUndefined();
    await pop;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(host.selections).toEqual([]);
    expect(window.history.state).toEqual({ parent: 'retained' });
  });

  it('retries a failed preparation factory without creating a dialog/history owner', async () => {
    factory.mockImplementationOnce(() => {
      throw new Error('private failure');
    });
    click('Add map');
    expect(modal.textContent).toContain('Add map could not be opened');
    expect(modal.textContent).not.toContain('private failure');
    const state = window.history.state;
    click('Retry Add map', true);
    expect(addBody()).toBeDefined();
    expect(window.history.state).toEqual(state);
    await close();
    expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('revokes dirty generation on capability replacement without accepting late save or stealing a newer focus owner', async () => {
    modern();
    click('Add map');
    const child = addBody();
    const delayed = deferredLibrary<CertifiedBoard>();
    vi.mocked(preparations[0]!.generate).mockReturnValueOnce(delayed.promise);
    const operation = child.state.generate();
    const signal = vi.mocked(preparations[0]!.generate).mock.calls[0]![1];
    const pop = nextPop();
    host.library.set(undefined);
    fixture.detectChanges();
    expect(signal.aborted).toBe(true);
    expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    await pop;
    fixture.detectChanges();
    await fixture.whenStable();
    delayed.resolve({} as CertifiedBoard);
    await operation;
    expect(host.selections).toEqual([]);
    expect(library.save).not.toHaveBeenCalled();
    expect(modal.open).toBe(false);
    click('Add map');
    expect(modal.textContent).toContain('Adding maps to live games is not available yet.');
    expect(modal.querySelector('ks-map-library')).toBeNull();
    await close();
  });

  it('unwinds reinserted dirty history on destruction and never publishes the old child afterward', async () => {
    click('Choose map');
    click('Add map', true);
    const child = dirtyAdd();
    await back();
    expect(child.state.confirming()).toBe(true);
    const pop = nextPop();
    fixture.destroy();
    expect(modal.open).toBe(false);
    await pop;
    expect(window.history.state).toEqual({ parent: 'retained' });
    expect(preparations[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(host.transitions).toEqual([true, false]);
    child.requestCancel();
    expect(host.transitions).toEqual([true, false]);
    expect(host.selections).toEqual([]);
  });
  it('disposes a preparation handed back after its factory destroys the owner, without focusing or reopening it', async () => {
    const orphan: BoardPreparation = { generate: vi.fn(), load: vi.fn(), dispose: vi.fn() };
    factory.mockImplementationOnce(() => {
      fixture.destroy();
      return orphan;
    });
    const pop = nextPop();
    click('Add map');
    await pop;
    expect(orphan.dispose).toHaveBeenCalledTimes(1);
    expect(orphan.generate).not.toHaveBeenCalled();
    expect(modal.open).toBe(false);
    expect(host.transitions).toEqual([true, false]);
    expect(window.history.state).toEqual({ parent: 'retained' });
  });
  it.each(['library only', 'factory only'])(
    'keeps Add truthfully unavailable with partial capability: %s',
    async (capability) => {
      if (capability === 'library only') host.preparationFactory.set(undefined);
      else host.library.set(undefined);
      fixture.detectChanges();
      click('Add map');
      expect(modal.textContent).toContain('Adding maps to live games is not available yet.');
      expect(modal.querySelector('ks-map-library, input, select')).toBeNull();
      expect(factory).not.toHaveBeenCalled();
      expect(library.list).not.toHaveBeenCalled();
      await close();
      click('Choose map');
      expect(modal.querySelector('nav[aria-label="Map sources"]')).toBeNull();
      await close();
    },
  );
});
