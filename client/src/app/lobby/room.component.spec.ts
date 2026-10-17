import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeApprovedBattlefield } from '@kriegsspiel/protocol';
import type { GameInfo } from '@legacy/lobby/api';
import { SHELL_API, SHELL_WINDOW } from '../shell/shell-api';
import { RoomComponent } from './room.component';
const scenario = 'hold-the-bridge';
const terrain = 'engine-terrain-v1:sha256:' + 'a'.repeat(64);
const selected = decodeApprovedBattlefield(
  {
    map: {
      id: scenario + ':open-v1',
      name: 'Open bridge approaches',
      source: 'included',
      terrainIdentity: terrain,
      widthM: 4000,
      heightM: 3000,
      preview: [
        {
          id: 'bridge',
          kind: 'bridge',
          layer: 4,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
      ],
    },
    pairing: {
      id: scenario + ':open-v1',
      revision: 'engine-pairing-v1:sha256:' + 'b'.repeat(64),
      scenarioId: scenario,
      resolvedScenarioId: 'hold-the-bridge-open-v1',
      scenarioRevision: 'engine-scenario-v1:sha256:' + 'c'.repeat(64),
      terrainIdentity: terrain,
      assemblyVersion: 'engine-native-v1',
    },
    isDefault: false,
  },
  scenario,
);
function info(over: Partial<GameInfo> = {}): GameInfo {
  return {
    id: 'room',
    scenario,
    battlefield: structuredClone(selected),
    status: 'lobby',
    sessionType: 'team_vs_team',
    rate: 12,
    side: 'blue',
    creator: true,
    createdAtMs: 1,
    you: 'blue',
    ready: true,
    pause: null,
    sides: [
      { side: 'blue', taken: true, ready: true },
      { side: 'red', taken: true, ready: true },
    ],
    ...over,
  };
}
let fixture: ComponentFixture<RoomComponent> | undefined;
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
async function open(first = info()) {
  const api = {
    fetchGame: vi.fn(async () => structuredClone(first)),
    fetchScenarios: vi.fn(async () => {
      throw new Error('Catalog unavailable');
    }),
    joinSide: vi.fn(async () => {}),
    setReady: vi.fn(async () => {}),
    leaveGame: vi.fn(async () => {}),
    kickPlayer: vi.fn(async () => {}),
    startGame: vi.fn(async () => {}),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SHELL_API, useValue: api },
      { provide: SHELL_WINDOW, useValue: { location: { origin: 'http://example.test' } } },
    ],
  });
  fixture = TestBed.createComponent(RoomComponent);
  fixture.componentRef.setInput('first', first);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, api };
}
describe('immutable room battlefield summary', () => {
  it('shows retained public geography before sides and invites, with inspection only', async () => {
    const p = await open();
    const summary = p.element.querySelector<HTMLElement>('[aria-label="Battlefield map"]')!;
    expect(summary.textContent).toContain('Open bridge approaches');
    expect(summary.textContent).toContain('4 × 3 km');
    expect(
      summary.compareDocumentPosition(p.element.querySelector('#room-sides')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(p.element.querySelector('#invite')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const details = summary.querySelector('details')!;
    expect(details.open).toBe(false);
    summary.querySelector('summary')!.click();
    expect(details.open).toBe(true);
    expect(summary.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 4000 3000');
    expect(summary.textContent).not.toMatch(/Choose map|Add map|Use map|Save map/);
    expect(p.api.startGame).not.toHaveBeenCalled();
    expect(p.api.joinSide).not.toHaveBeenCalled();
    expect(p.api.fetchScenarios).not.toHaveBeenCalled();
    await p.fixture.componentInstance.poll();
    expect(p.api.fetchScenarios).not.toHaveBeenCalled();
  });
  it('rejects contradictory modern geometry without a default fallback and retries public details only', async () => {
    const bad = info();
    bad.battlefield!.pairing.scenarioId = 'foreign';
    const p = await open(bad);
    expect(p.element.querySelector('[role=alert]')?.textContent).toContain('could not be checked');
    expect(p.element.querySelector('svg')).toBeNull();
    const start = p.element.querySelector<HTMLButtonElement>('#room-start')!;
    expect(start.disabled).toBe(true);
    start.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.api.startGame).not.toHaveBeenCalled();
    p.api.fetchGame.mockResolvedValue(info());
    [...p.element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Retry map details')!
      .click();
    await p.fixture.whenStable();
    expect(p.element.querySelector('svg')).not.toBeNull();
    expect(p.element.querySelector<HTMLButtonElement>('#room-start')!.disabled).toBe(false);
  });
  it('preserves legacy rooms without inventing a map or blocking their existing host action', async () => {
    const old = info();
    delete old.battlefield;
    const p = await open(old);
    expect(p.element.textContent).toContain('not available on this server');
    expect(p.element.querySelector('svg')).toBeNull();
    p.element.querySelector<HTMLButtonElement>('#room-start')!.click();
    await p.fixture.whenStable();
    expect(p.api.startGame).toHaveBeenCalledExactlyOnceWith('room');
  });
  it('retains invite, join, ready, leave and hot-seat behavior without a catalog lookup', async () => {
    const first = info({
      creator: false,
      you: null,
      side: null,
      ready: false,
      sides: [
        { side: 'blue', taken: true, ready: true },
        { side: 'red', taken: false, ready: false },
      ],
    });
    const p = await open(first);
    expect(p.element.querySelector<HTMLInputElement>('#invite')!.value).toBe(
      'http://example.test/?game=room',
    );
    p.api.fetchGame.mockResolvedValue(
      info({ creator: false, you: 'red', side: 'red', ready: false }),
    );
    [...p.element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Take red')!
      .click();
    await p.fixture.whenStable();
    expect(p.api.joinSide).toHaveBeenCalledExactlyOnceWith('room', 'red');
    p.element.querySelector<HTMLButtonElement>('#room-ready')!.click();
    await p.fixture.whenStable();
    expect(p.api.setReady).toHaveBeenCalledExactlyOnceWith('room', true);
    p.element.querySelector<HTMLButtonElement>('#room-leave')!.click();
    await p.fixture.whenStable();
    expect(p.api.leaveGame).toHaveBeenCalledExactlyOnceWith('room');
    expect(p.api.fetchScenarios).not.toHaveBeenCalled();
    p.api.fetchGame.mockResolvedValue(info({ sessionType: 'hot_seat' }));
    await p.fixture.componentInstance.poll();
    await p.fixture.whenStable();
    expect(p.element.querySelector('#invite')).toBeNull();
  });
});
