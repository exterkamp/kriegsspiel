import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ScenarioBattlefield } from '@kriegsspiel/protocol';
import type { ScenarioOptions } from '@legacy/shell/newGame';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattlefieldMapComponent } from '../lobby/battlefield-map/battlefield-map.component';
import { SHELL_API } from './shell-api';
import { NewGameComponent } from './new-game.component';

/** Parent contract test: actual dialog/geometry/focus behavior belongs to the component's own tests/browser. */
@Component({
  selector: 'ks-battlefield-map',
  template: `<button type="button" (click)="activeChange.emit(true)">Open map fixture</button>
    <button type="button" (click)="activeChange.emit(false)">Close map fixture</button>`,
})
class MapFixture {
  readonly battlefield = input.required<ScenarioBattlefield>();
  readonly scenarioName = input.required<string>();
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
  fixture = undefined;
  TestBed.resetTestingModule();
});

async function open(loaded = options) {
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
  TestBed.overrideComponent(NewGameComponent, {
    remove: { imports: [BattlefieldMapComponent] },
    add: { imports: [MapFixture] },
  });
  fixture = TestBed.createComponent(NewGameComponent);
  const create = vi.fn(async () => 'game-1');
  fixture.componentRef.setInput('load', async () => loaded);
  fixture.componentRef.setInput('create', create);
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
});
