import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BattlefieldFeature, ScenarioBattlefield } from '@kriegsspiel/protocol';
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

@Component({
  imports: [BattlefieldMapComponent],
  template: `
    <form (submit)="submit($event)" (keydown)="keys.push($event.key)">
      <input aria-label="Parent draft" value="unchanged timing and side draft" />
      <ks-battlefield-map
        [battlefield]="data()!"
        [scenarioName]="name()"
        [canOpen]="allowMapEntry"
        (activeChange)="gate($event)"
      />
      <button type="submit">Start game</button>
    </form>
  `,
})
class Host {
  readonly data = signal<ScenarioBattlefield | undefined>(battlefield());
  readonly name = signal('Hold the Bridge');
  readonly pending = signal(false);
  readonly allowMapEntry = () => !this.pending();
  readonly transitions: boolean[] = [];
  readonly keys: string[] = [];
  active = false;
  starts = 0;
  blockedStarts = 0;
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
  expect(modal.open).toBe(false);
  expect(host.active).toBe(false);
}
async function back(): Promise<void> {
  const pop = nextPop();
  window.history.back();
  await pop;
  fixture.detectChanges();
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
    providers: [provideZonelessChangeDetection()],
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
      'It cannot be used for a game.',
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
    expect(root.querySelector('fieldset [role=alert]')?.textContent).toContain('cannot be used');
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
