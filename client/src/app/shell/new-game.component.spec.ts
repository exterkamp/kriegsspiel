import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ScenarioBattlefield } from '@kriegsspiel/protocol';
import {
  initialForm,
  type Form,
  type ScenarioOptions,
  type CreateRequest,
} from '@legacy/shell/newGame';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattlefieldMapComponent } from '../lobby/battlefield-map/battlefield-map.component';
import { SHELL_API } from './shell-api';
import { NewGameComponent, type NewGameDraft } from './new-game.component';
import { CreationPendingError } from '@legacy/shell/newGameApi';

/** Parent contract test: actual dialog/geometry/focus behavior belongs to the component's own tests/browser. */
@Component({
  selector: 'ks-battlefield-map',
  template: `<button type="button" (click)="activeChange.emit(true)">Open map fixture</button>
    <button type="button" (click)="activeChange.emit(false)">Close map fixture</button>`,
})
class MapFixture {
  readonly battlefield = input.required<ScenarioBattlefield>();
  readonly scenarioName = input.required<string>();
  readonly scenarioId = input<string>();
  readonly catalog = input<import('@kriegsspiel/protocol').BattlefieldCatalog>();
  readonly selection = input<{ pairingId: string; revision: string }>();
  readonly selectionChange = output<import('@kriegsspiel/protocol').ApprovedBattlefield>();
  readonly canOpen = input<() => boolean>(() => true);
  readonly library = input<import('../../shared/lobby-map-library/contracts').MapLibraryPort>();
  readonly preparationFactory =
    input<() => import('../../shared/game-setup/contracts').BoardPreparation>();
  readonly activeChange = output<boolean>();
}

const identity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
const revision = `engine-scenario-v1:sha256:${'b'.repeat(64)}`;
const battlefield: ScenarioBattlefield = {
  map: {
    id: 'bridge:default',
    name: 'The bridge battlefield',
    source: 'scenario-default',
    widthM: 4000,
    heightM: 3000,
    terrainIdentity: identity,
    preview: [],
  },
  pairing: {
    id: 'bridge:default',
    revision,
    scenarioId: 'bridge',
    scenarioRevision: revision,
    terrainIdentity: identity,
  },
  capabilities: { addMaps: false },
};
const options: ScenarioOptions = {
  opponent: 'scripted',
  scenarios: [
    {
      id: 'bridge',
      name: 'Hold the Bridge',
      briefing: 'Hold the crossing.',
      lengthMinutes: 50,
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
      battlefield,
    },
  ],
};

let fixture: ComponentFixture<NewGameComponent> | undefined;
afterEach(() => {
  fixture?.destroy();
  sessionStorage.clear();
  fixture = undefined;
  TestBed.resetTestingModule();
});

async function open(
  loaded = options,
  realMap = false,
  create: (req: CreateRequest) => Promise<string> = vi.fn(async () => 'game-1'),
  ownerId?: string,
  loadOverride?: () => Promise<ScenarioOptions>,
  draft?: NewGameDraft,
) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: SHELL_API,
        useValue: {
          fetchGames: async () => [],
          fetchScenarios: async () => [],
          adminMode: async () => undefined,
        },
      },
    ],
  });
  if (!realMap)
    TestBed.overrideComponent(NewGameComponent, {
      remove: { imports: [BattlefieldMapComponent] },
      add: { imports: [MapFixture] },
    });
  fixture = TestBed.createComponent(NewGameComponent);
  fixture.componentRef.setInput('load', loadOverride ?? (async () => loaded));
  fixture.componentRef.setInput('create', create);
  if (ownerId) fixture.componentRef.setInput('ownerId', ownerId);
  if (draft) fixture.componentRef.setInput('draft', draft);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, element: fixture.nativeElement as HTMLElement, create };
}

function click(element: HTMLElement, label: string) {
  const button = [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button absent: ${label}`);
  button.click();
}

describe('new-game battlefield integration', () => {
  it('places the server descriptor between Scenario and Your side', async () => {
    const { fixture, element, create } = await open();
    const map = fixture.debugElement.query(By.directive(MapFixture));
    expect(map.componentInstance.battlefield()).toEqual(battlefield);
    expect(map.componentInstance.scenarioName()).toBe('Hold the Bridge');
    const children = [...element.querySelector('form')!.children];
    expect(children[0]!.querySelector('legend')?.textContent).toBe('Scenario');
    expect(children[1]!.tagName.toLowerCase()).toBe('ks-battlefield-map');
    expect(children[2]!.querySelector('legend')?.textContent).toBe('Your side');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks synthetic submission, edits and navigation behind the picker, then resumes the retained draft', async () => {
    const { fixture, element, create } = await open();
    const back = vi.fn();
    fixture.componentInstance.back.subscribe(back);
    const rate = element.querySelector<HTMLInputElement>('input[name=rate][value="4"]')!;
    rate.click();
    await fixture.whenStable();
    click(element, 'Open map fixture');
    const backgroundRate = element.querySelector<HTMLInputElement>('input[name=rate][value="1"]')!;
    backgroundRate.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    click(element, 'Back');
    expect(create).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    click(element, 'Close map fixture');
    click(element, 'Start game');
    await fixture.whenStable();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      scenario: 'bridge',
      side: 'blue',
      rate: 4,
      dial: 'standard',
      persona: 'dry',
      sessionType: 'co_op_vs_ai',
    });
  });

  it('keeps older servers playable without inventing preview metadata', async () => {
    const { fixture, element, create } = await open({
      ...options,
      scenarios: [{ ...options.scenarios[0]!, battlefield: undefined }],
    });
    expect(fixture.debugElement.query(By.directive(MapFixture))).toBeNull();
    expect(element.textContent).toContain('Map previews are not available on this server.');
    click(element, 'Start game');
    await fixture.whenStable();
    expect(create).toHaveBeenCalledOnce();
  });

  it('locks all real map entries synchronously during creation and restores controls after a definite failure', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<string>((_resolve, fail) => {
      reject = fail;
    });
    const create = vi.fn(() => pending);
    const { fixture, element } = await open(options, true, create);
    const push = vi.spyOn(window.history, 'pushState');
    const entries = [
      ...element.querySelectorAll<HTMLButtonElement>('ks-battlefield-map > fieldset button'),
    ];
    expect(entries.map((b) => b.textContent?.trim())).toEqual([
      'Choose map',
      'Add map',
      'View map',
    ]);
    click(element, 'Start game');
    // Deliberately no detectChanges/whenStable between Start and these entry clicks.
    // The child's live gate must observe pending creation before its DOM refresh.
    for (const button of entries) button.click();
    expect(create).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(element.querySelector('dialog')?.open).toBe(false);
    await fixture.whenStable();
    expect(entries.every((b) => b.disabled)).toBe(true);
    expect(element.querySelector('input[name=rate]')?.matches(':disabled')).toBe(true);

    reject(new Error('The server refused this request.'));
    // The externally rejected create promise resumes before Angular schedules
    // its pending-state render; wait for that continuation before stability.
    await Promise.resolve();
    await fixture.whenStable();
    expect(entries.every((b) => !b.disabled)).toBe(true);
    expect(element.querySelector('input[name=rate]')?.matches(':disabled')).toBe(false);
    expect(
      fixture.debugElement
        .query(By.directive(BattlefieldMapComponent))
        .componentInstance.canOpen()(),
    ).toBe(true);
    expect(element.querySelector('[role=alert]')?.textContent).toContain('server refused');
    push.mockRestore();
  });
});

function modernOptions(): ScenarioOptions {
  const entry = (isDefault: boolean) => ({
    map: {
      ...structuredClone(battlefield.map),
      preview: [],
      id: isDefault ? 'bridge:default' : 'bridge:open-v1',
      source: isDefault ? ('scenario-default' as const) : ('included' as const),
      name: isDefault ? 'The bridge battlefield' : 'Open bridge approaches',
    },
    pairing: {
      ...structuredClone(battlefield.pairing),
      id: isDefault ? 'bridge:default' : 'bridge:open-v1',
      revision: 'engine-pairing-v1:sha256:' + (isDefault ? 'c' : 'd').repeat(64),
      resolvedScenarioId: isDefault ? 'bridge' : 'bridge-open-v1',
      assemblyVersion: 'engine-native-v1' as const,
    },
    isDefault,
  });
  return {
    ...options,
    scenarios: [
      {
        ...structuredClone(options.scenarios[0]!),
        battlefields: {
          schemaVersion: 1,
          scenarioId: 'bridge',
          entries: [entry(true), entry(false)],
        },
      },
    ],
  };
}
describe('committed native pairing and recoverable creation', () => {
  it('commits only a checked child choice and sends its exact identity with one request key', async () => {
    const loaded = modernOptions();
    const create = vi.fn<(req: CreateRequest) => Promise<string>>(async () => 'native-game');
    const { fixture, element } = await open(loaded, false, create, 'owner');
    const child = fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    const selected = loaded.scenarios[0]!.battlefields!.entries[1]!;
    child.selectionChange.emit(selected);
    await fixture.whenStable();
    expect(child.selection()).toEqual({
      pairingId: selected.pairing.id,
      revision: selected.pairing.revision,
    });
    click(element, 'Start game');
    await fixture.whenStable();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({
      pairing: { pairingId: selected.pairing.id, revision: selected.pairing.revision },
      battlefieldVersion: 1,
      requestId: expect.any(String),
      rate: 12,
    });
    expect(sessionStorage.getItem('ks:lobby-creation:owner')).toBeNull();
  });
  it('blocks malformed modern metadata rather than creating a legacy default game', async () => {
    const loaded = modernOptions();
    loaded.scenarios[0]!.battlefields!.scenarioId = 'foreign';
    const { fixture, element, create } = await open(loaded);
    click(element, 'Start game');
    await fixture.whenStable();
    expect(create).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Choose an available battlefield');
  });
  it('retains exact accepted choices and key through ambiguous retry and changed current defaults', async () => {
    const loaded = modernOptions();
    const create = vi
      .fn<(req: CreateRequest) => Promise<string>>()
      .mockImplementationOnce(async (req) => {
        throw new CreationPendingError(req.requestId!);
      })
      .mockResolvedValue('same-game');
    let page = await open(loaded, false, create, 'owner');
    page.element.querySelector<HTMLInputElement>('input[name=rate][value="4"]')!.click();
    click(page.element, 'Start game');
    await page.fixture.whenStable();
    const first = structuredClone(create.mock.calls[0]![0]);
    expect(page.element.textContent).toContain('Retry creation');
    expect(page.element.querySelector('input[name=rate]')!.matches(':disabled')).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('ks:lobby-creation:owner')!).request).toEqual(first);
    page.fixture.destroy();
    TestBed.resetTestingModule();
    const changed = modernOptions();
    changed.opponent = undefined;
    changed.scenarios[0]!.defaults.rate = 1;
    changed.scenarios[0]!.battlefields!.entries[0]!.pairing.revision =
      'engine-pairing-v1:sha256:' + 'e'.repeat(64);
    page = await open(changed, false, create, 'owner');
    expect(page.element.textContent).toContain('Retry creation');
    click(page.element, 'Retry creation');
    await page.fixture.whenStable();
    expect(create.mock.calls[1]![0]).toEqual(first);
    expect(sessionStorage.getItem('ks:lobby-creation:owner')).toBeNull();
  });
});

describe('creation owner lifetime', () => {
  it('never opens an old owner game or reuses its pending request after owner replacement', async () => {
    let finish!: (id: string) => void;
    const create = vi.fn<(request: CreateRequest) => Promise<string>>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const page = await open(modernOptions(), false, create, 'owner-a');
    const started = vi.fn();
    page.fixture.componentInstance.started.subscribe(started);
    click(page.element, 'Start game');
    await Promise.resolve();
    const retained = sessionStorage.getItem('ks:lobby-creation:owner-a');
    expect(retained).not.toBeNull();
    page.fixture.componentRef.setInput('ownerId', 'owner-b');
    await page.fixture.whenStable();
    finish('old-owner-game');
    await Promise.resolve();
    await page.fixture.whenStable();
    expect(started).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ks:lobby-creation:owner-a')).toBe(retained);
    expect(sessionStorage.getItem('ks:lobby-creation:owner-b')).toBeNull();
    expect(page.element.textContent).not.toContain('Retry creation');
  });
});

describe('pending creation recovery boundaries', () => {
  it('retains the identical ambiguous intent when a retry storage write fails', async () => {
    const create = vi
      .fn<(request: CreateRequest) => Promise<string>>()
      .mockImplementationOnce(async (request) => {
        throw new CreationPendingError(request.requestId!);
      })
      .mockResolvedValue('same-game');
    const page = await open(modernOptions(), false, create, 'recovery-owner');
    click(page.element, 'Start game');
    await page.fixture.whenStable();
    const first = structuredClone(create.mock.calls[0]![0]);
    const retained = sessionStorage.getItem('ks:lobby-creation:recovery-owner');
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    click(page.element, 'Retry creation');
    await page.fixture.whenStable();
    expect(create).toHaveBeenCalledOnce();
    expect(page.element.querySelector('input[name=rate]')!.matches(':disabled')).toBe(true);
    expect(sessionStorage.getItem('ks:lobby-creation:recovery-owner')).toBe(retained);
    storage.mockRestore();
    click(page.element, 'Retry creation');
    await page.fixture.whenStable();
    expect(create.mock.calls[1]![0]).toEqual(first);
  });
  it.each(['', ' ', '{'])('blocks every present malformed retained record %j', async (text) => {
    sessionStorage.setItem('ks:lobby-creation:malformed-owner', text);
    const page = await open(
      modernOptions(),
      false,
      vi.fn(async () => 'must-not-create'),
      'malformed-owner',
    );
    const button = [...page.element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Start game',
    );
    button?.click();
    await page.fixture.whenStable();
    expect(page.create).not.toHaveBeenCalled();
    expect(page.element.textContent).toContain('could not be recovered');
    expect(sessionStorage.getItem('ks:lobby-creation:malformed-owner')).toBe(text);
  });
  it.each(['empty', 'removed'])(
    'recovers one retained key when the latest catalog is %s',
    async (kind) => {
      const create = vi
        .fn<(request: CreateRequest) => Promise<string>>()
        .mockImplementationOnce(async (request) => {
          throw new CreationPendingError(request.requestId!);
        })
        .mockResolvedValue('retained-game');
      let page = await open(modernOptions(), false, create, 'retained-owner');
      click(page.element, 'Start game');
      await page.fixture.whenStable();
      const first = structuredClone(create.mock.calls[0]![0]);
      page.fixture.destroy();
      TestBed.resetTestingModule();
      const latest = modernOptions();
      latest.scenarios =
        kind === 'empty' ? [] : [{ ...latest.scenarios[0]!, id: 'other-scenario' }];
      page = await open(latest, false, create, 'retained-owner');
      expect(page.element.textContent).toContain('Retry creation');
      click(page.element, 'Retry creation');
      await page.fixture.whenStable();
      expect(create.mock.calls[1]![0]).toEqual(first);
      expect(create).toHaveBeenCalledTimes(2);
    },
  );
});

it('recovers a retained intent even when the current scenario request fails', async () => {
  const create = vi
    .fn<(request: CreateRequest) => Promise<string>>()
    .mockImplementationOnce(async (request) => {
      throw new CreationPendingError(request.requestId!);
    })
    .mockResolvedValue('recovered-during-outage');
  let page = await open(modernOptions(), false, create, 'offline-catalog-owner');
  click(page.element, 'Start game');
  await page.fixture.whenStable();
  const first = structuredClone(create.mock.calls[0]![0]);
  page.fixture.destroy();
  TestBed.resetTestingModule();
  page = await open(modernOptions(), false, create, 'offline-catalog-owner', async () => {
    throw new Error('Catalog unavailable');
  });
  expect(page.element.textContent).toContain('Retry creation');
  click(page.element, 'Retry creation');
  await page.fixture.whenStable();
  expect(create.mock.calls[1]![0]).toEqual(first);
  expect(create).toHaveBeenCalledTimes(2);
});

describe('reviewed library capability attachment', () => {
  it('attaches only with an authenticated owner and the explicit server capability', async () => {
    const loaded = modernOptions();
    loaded.mapLibrary = true;
    const page = await open(loaded, false, undefined, 'library-owner');
    const child = page.fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    expect(child.library()).toBeDefined();
    const factory = child.preparationFactory()!;
    const first = factory();
    const second = factory();
    expect(first).not.toBe(second);
    first.dispose();
    second.dispose();
    const old = child.library();
    page.fixture.componentRef.setInput('ownerId', 'another-owner');
    await page.fixture.whenStable();
    const current = page.fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    expect(current.library()).toBeDefined();
    expect(current.library()).not.toBe(old);
  });
  it.each([false, undefined])('does not attach library for capability %s', async (mapLibrary) => {
    const loaded = modernOptions();
    loaded.mapLibrary = mapLibrary;
    const page = await open(loaded, false, undefined, 'library-owner');
    const child = page.fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    expect(child.library()).toBeUndefined();
    expect(child.preparationFactory()).toBeUndefined();
  });
  it('keeps the real library unavailable without an authenticated owner', async () => {
    const loaded = modernOptions();
    loaded.mapLibrary = true;
    const page = await open(loaded);
    const child = page.fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    expect(child.library()).toBeUndefined();
    expect(child.preparationFactory()).toBeUndefined();
  });
});

it('blocks stale rendered map and Start controls before acknowledging an owner replacement', async () => {
  const loaded = modernOptions();
  loaded.mapLibrary = true;
  const create = vi.fn(async () => 'must-not-create');
  const page = await open(loaded, false, create, 'first-owner');
  const child = page.fixture.debugElement.query(By.directive(MapFixture))
    .componentInstance as MapFixture;
  expect(child.canOpen()()).toBe(true);
  page.fixture.componentRef.setInput('ownerId', 'second-owner');
  expect(child.canOpen()()).toBe(false);
  click(page.element, 'Start game');
  expect(create).not.toHaveBeenCalled();
  await page.fixture.whenStable();
  expect(sessionStorage.getItem('ks:lobby-creation:first-owner')).toBeNull();
  expect(sessionStorage.getItem('ks:lobby-creation:second-owner')).toBeNull();
});

function ordinaryDraft(loaded = modernOptions(), ownerId = 'draft-owner'): NewGameDraft {
  const alternative = loaded.scenarios[0]!.battlefields!.entries[1]!;
  return {
    ownerId,
    form: {
      ...initialForm(loaded)!,
      rate: 'custom',
      customRate: '6:1',
      mode: 'turns',
      turnMinutes: '30',
      deadlineHours: '24',
      dial: 'free',
      persona: 'dramatic',
    },
    selection: { pairingId: alternative.pairing.id, revision: alternative.pairing.revision },
  };
}
describe('owner-scoped ordinary draft snapshots', () => {
  it.each(['slow', 'offline', 'empty'])(
    'keeps an owner draft snapshot available through a %s current catalog without creating',
    async (kind) => {
      const draft = ordinaryDraft();
      let resolve!: (value: ScenarioOptions) => void;
      const delayed = new Promise<ScenarioOptions>((done) => {
        resolve = done;
      });
      const load =
        kind === 'slow'
          ? () => delayed
          : async () => {
              if (kind === 'offline') throw new Error('Catalog unavailable');
              return { ...modernOptions(), scenarios: [] };
            };
      const page = await open(modernOptions(), false, undefined, draft.ownerId, load, draft);
      expect(page.fixture.componentInstance.snapshotDraft()).toEqual(draft);
      expect(page.create).not.toHaveBeenCalled();
      if (kind === 'slow') {
        expect(page.element.textContent).toContain('Loading scenarios');
        resolve(modernOptions());
        await delayed;
        await page.fixture.whenStable();
        expect(page.fixture.componentInstance.snapshotDraft()).toEqual(draft);
      } else expect(page.element.textContent).not.toContain('Loading scenarios');
    },
  );

  it('restores detached allowlisted form and committed pairing only, excluding assets and creation state', async () => {
    const draft = ordinaryDraft();
    Object.assign(draft, { canonicalJson: 'not a draft field', requestId: 'not retained' });
    Object.assign(draft.form, { asset: { private: 'not retained' } });
    const page = await open(modernOptions(), false, undefined, draft.ownerId, undefined, draft);
    const snapshot = page.fixture.componentInstance.snapshotDraft()!;
    expect(Object.keys(snapshot).sort()).toEqual(['form', 'ownerId', 'selection']);
    expect(Object.keys(snapshot.form).sort()).toEqual(
      [
        'scenario',
        'side',
        'rate',
        'customRate',
        'dial',
        'persona',
        'mode',
        'turnMinutes',
        'deadlineHours',
      ].sort(),
    );
    expect(Object.keys(snapshot.selection!).sort()).toEqual(['pairingId', 'revision']);
    expect(snapshot.form).toEqual({
      scenario: 'bridge',
      side: 'blue',
      rate: 'custom',
      customRate: '6:1',
      dial: 'free',
      persona: 'dramatic',
      mode: 'turns',
      turnMinutes: '30',
      deadlineHours: '24',
    });
    expect(snapshot.form).not.toBe(draft.form);
    expect(snapshot.selection).not.toBe(draft.selection);
    Object.assign(snapshot.form, { turnMinutes: '60' });
    Object.assign(snapshot.selection!, { pairingId: 'changed' });
    expect(page.fixture.componentInstance.snapshotDraft()!.form.turnMinutes).toBe('30');
    expect(page.fixture.componentInstance.snapshotDraft()!.selection).toEqual(draft.selection);
    expect(page.create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ks:lobby-creation:draft-owner')).toBeNull();
  });

  it('does not restore a draft for a different current owner', async () => {
    const page = await open(
      modernOptions(),
      false,
      undefined,
      'other-owner',
      undefined,
      ordinaryDraft(),
    );
    expect(
      page.element.querySelector<HTMLInputElement>('input[name=mode][value=realtime]')!.checked,
    ).toBe(true);
    expect(page.fixture.componentInstance.snapshotDraft()!.ownerId).toBe('other-owner');
    expect(page.fixture.componentInstance.snapshotDraft()!.form.rate).toBe('12');
    expect(page.create).not.toHaveBeenCalled();
  });

  it('gives retained pending creation precedence over an ordinary draft without automatically creating', async () => {
    const loaded = modernOptions();
    const first = loaded.scenarios[0]!.battlefields!.entries[0]!;
    const form: Form = { ...initialForm(loaded)!, rate: '4' };
    const selection = { pairingId: first.pairing.id, revision: first.pairing.revision };
    const request: CreateRequest = {
      scenario: form.scenario,
      side: form.side,
      rate: 4,
      dial: form.dial,
      persona: form.persona,
      sessionType: 'co_op_vs_ai',
      pairing: selection,
      requestId: '7da01aae-638e-4700-9a8d-5f39646c78d1',
      battlefieldVersion: 1,
    };
    const saved = JSON.stringify({ form, selection, request });
    sessionStorage.setItem('ks:lobby-creation:draft-owner', saved);
    const page = await open(
      loaded,
      false,
      undefined,
      'draft-owner',
      undefined,
      ordinaryDraft(loaded),
    );
    expect(page.element.textContent).toContain('Retry creation');
    expect(
      page.element.querySelector<HTMLInputElement>('input[name=rate][value="4"]')!.checked,
    ).toBe(true);
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
    expect(page.create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ks:lobby-creation:draft-owner')).toBe(saved);
    click(page.element, 'Retry creation');
    await page.fixture.whenStable();
    expect(page.create).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('cannot snapshot a recovery-blocked form or replace its retained evidence with an ordinary draft', async () => {
    sessionStorage.setItem('ks:lobby-creation:draft-owner', '{');
    const page = await open(
      modernOptions(),
      false,
      undefined,
      'draft-owner',
      undefined,
      ordinaryDraft(),
    );
    expect(page.element.textContent).toContain('could not be recovered');
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
    expect(sessionStorage.getItem('ks:lobby-creation:draft-owner')).toBe('{');
    expect(page.create).not.toHaveBeenCalled();
  });

  it.each(['removed pairing', 'changed revision', 'removed catalog', 'removed metadata'])(
    'restores a stale committed identity and visibly blocks Start for %s',
    async (change) => {
      const loaded = modernOptions();
      const draft = ordinaryDraft(loaded);
      const catalog = loaded.scenarios[0]!.battlefields!;
      if (change === 'removed pairing') catalog.entries = [catalog.entries[0]!];
      if (change === 'changed revision')
        catalog.entries = catalog.entries.map((entry) => ({
          ...entry,
          pairing: { ...entry.pairing, revision: `engine-pairing-v1:sha256:${'f'.repeat(64)}` },
        }));
      if (change === 'removed catalog' || change === 'removed metadata')
        delete loaded.scenarios[0]!.battlefields;
      if (change === 'removed metadata') delete loaded.scenarios[0]!.battlefield;
      const page = await open(loaded, false, undefined, 'draft-owner', undefined, draft);
      expect(page.element.textContent).toContain(
        'Choose an available battlefield map before starting.',
      );
      expect(page.element.querySelector('button[type=submit]')!.getAttribute('aria-disabled')).toBe(
        'true',
      );
      expect(page.fixture.componentInstance.snapshotDraft()!.selection).toEqual(draft.selection);
      if (change === 'removed metadata') {
        expect(page.element.textContent).toContain('selected battlefield is unavailable');
        expect(page.element.textContent).not.toContain(
          "The scenario's default battlefield will be used.",
        );
      }
      click(page.element, 'Start game');
      await page.fixture.whenStable();
      expect(page.create).not.toHaveBeenCalled();
    },
  );

  it('pins an implicit modern default revision in the snapshot instead of silently updating it on restore', async () => {
    let page = await open(modernOptions(), false, undefined, 'draft-owner');
    const draft = page.fixture.componentInstance.snapshotDraft()!;
    expect(draft.selection).toEqual({
      pairingId: 'bridge:default',
      revision: modernOptions().scenarios[0]!.battlefields!.entries[0]!.pairing.revision,
    });
    page.fixture.destroy();
    TestBed.resetTestingModule();
    const changed = modernOptions();
    const catalog = changed.scenarios[0]!.battlefields!;
    catalog.entries = catalog.entries.map((entry) => ({
      ...entry,
      pairing: { ...entry.pairing, revision: `engine-pairing-v1:sha256:${'e'.repeat(64)}` },
    }));
    page = await open(changed, false, undefined, 'draft-owner', undefined, draft);
    click(page.element, 'Start game');
    await page.fixture.whenStable();
    expect(page.create).not.toHaveBeenCalled();
    expect(page.element.textContent).toContain('Choose an available battlefield');
  });

  it('reconciles a removed allowed side without resetting the other ordinary edits', async () => {
    const draft = ordinaryDraft();
    Object.assign(draft.form, { side: 'red' });
    const page = await open(modernOptions(), false, undefined, 'draft-owner', undefined, draft);
    const snapshot = page.fixture.componentInstance.snapshotDraft()!;
    expect(snapshot.form).toEqual({ ...draft.form, side: 'blue' });
    expect(page.element.querySelector('input[name=side][value=red]')).toBeNull();
    expect(page.create).not.toHaveBeenCalled();
  });

  it('offers current scenario choices when the retained scenario has disappeared rather than hanging Loading', async () => {
    const loaded = modernOptions();
    loaded.scenarios = [
      {
        ...loaded.scenarios[0]!,
        id: 'another',
        name: 'Another scenario',
        battlefield: undefined,
        battlefields: undefined,
      },
    ];
    const page = await open(loaded, false, undefined, 'draft-owner', undefined, ordinaryDraft());
    expect(page.element.textContent).toContain('previous scenario is no longer available');
    expect(page.element.textContent).not.toContain('Loading scenarios');
    expect(page.element.querySelector('button[type=submit]')).toBeNull();
    page.element.querySelector<HTMLInputElement>('input[name=scenario][value=another]')!.click();
    await page.fixture.whenStable();
    expect(page.element.querySelector('form[aria-label="New game"]')).not.toBeNull();
    expect(page.element.textContent).not.toContain('previous scenario is no longer available');
    expect(page.fixture.componentInstance.snapshotDraft()!.selection).toBeUndefined();
    expect(page.create).not.toHaveBeenCalled();
  });

  it('refuses snapshots while a map dialog is active, starting, stale-owned, or destroyed', async () => {
    let fail!: (error: Error) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const page = await open(modernOptions(), false, create, 'draft-owner');
    const child = page.fixture.debugElement.query(By.directive(MapFixture))
      .componentInstance as MapFixture;
    child.activeChange.emit(true);
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
    child.activeChange.emit(false);
    expect(page.fixture.componentInstance.snapshotDraft()).toBeDefined();
    click(page.element, 'Start game');
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
    fail(new Error('Definite rejection'));
    await Promise.resolve();
    await page.fixture.whenStable();
    expect(page.fixture.componentInstance.snapshotDraft()).toBeDefined();
    page.fixture.componentRef.setInput('ownerId', 'next-owner');
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
    page.fixture.destroy();
    expect(page.fixture.componentInstance.snapshotDraft()).toBeUndefined();
  });
});
