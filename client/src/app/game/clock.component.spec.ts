import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeApprovedBattlefield } from '@kriegsspiel/protocol';
import type { fetchGame, GameInfo } from '@legacy/lobby/api';
import type { fetchGameBattlefield, GameBattlefield } from '@legacy/lobby/battlefield';
import { battlefieldMap } from '@legacy/table/battlefieldMap';
import { ClockComponent } from './clock.component';
import { GAME_BATTLEFIELD_LOADER, GAME_INFO_LOADER, GameService } from './game.service';

function liveGameFixture(): { info: GameInfo; terrain: GameBattlefield } {
  const scenarioId = 'hold-the-bridge';
  const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
  // Public protocol fixture only: independently bound parent and actual adapted geometry.
  const battlefield = decodeApprovedBattlefield(
    {
      map: {
        id: `${scenarioId}:default`,
        name: 'Test bridge battlefield',
        source: 'scenario-default',
        terrainIdentity,
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
        id: `${scenarioId}:default`,
        revision: `engine-pairing-v1:sha256:${'b'.repeat(64)}`,
        scenarioId,
        resolvedScenarioId: scenarioId,
        scenarioRevision: `engine-scenario-v1:sha256:${'c'.repeat(64)}`,
        terrainIdentity,
        assemblyVersion: 'engine-native-v1',
      },
      isDefault: true,
    },
    scenarioId,
  );
  return {
    info: {
      id: 'g1',
      scenario: scenarioId,
      battlefield,
      status: 'started',
      sessionType: 'team_vs_team',
      rate: 12,
      side: 'blue',
      creator: true,
      createdAtMs: 1,
      you: 'blue',
      ready: true,
      pause: null,
      umpire: { dial: 'standard', persona: 'dry' },
      sides: [
        { side: 'blue', taken: true, ready: true },
        { side: 'red', taken: true, ready: true },
      ],
    },
    terrain: {
      gameId: 'g1',
      scenarioId,
      battlefield,
      map: battlefieldMap(battlefield, scenarioId),
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const loadInfo = vi.fn<typeof fetchGame>();
const loadTerrain = vi.fn<typeof fetchGameBattlefield>();
let metadata: ReturnType<typeof deferred<GameInfo>>;
let terrain: ReturnType<typeof deferred<GameBattlefield>>;
let service: GameService;
beforeEach(() => {
  metadata = deferred<GameInfo>();
  terrain = deferred<GameBattlefield>();
  loadInfo.mockReset().mockReturnValue(metadata.promise);
  loadTerrain.mockReset().mockReturnValue(terrain.promise);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: GAME_INFO_LOADER, useValue: loadInfo },
      { provide: GAME_BATTLEFIELD_LOADER, useValue: loadTerrain },
    ],
  });
  service = TestBed.inject(GameService);
});
afterEach(() => {
  try {
    service?.disconnect();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe('ClockComponent', () => {
  it('shows no clock and the connecting link before the server speaks', async () => {
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No clock');
    expect(text).toContain('connecting…');
  });

  it('reports the offline link for the fixture board', async () => {
    TestBed.inject(GameService).connect({ protocol: 'http:', host: 'x', search: '' });
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no server (fixture)');
  });

  it('says the connection was lost and offers a retry once it gives up', async () => {
    const game = TestBed.inject(GameService);
    const retry = vi.spyOn(game, 'retry');
    const sockets: Array<{
      readyState: number;
      onopen?: () => void;
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
    }> = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        readyState = 0;
        onopen?: () => void;
        onmessage?: (e: { data: string }) => void;
        onclose?: () => void;
        constructor() {
          sockets.push(this);
        }
        send(): void {}
        close(): void {}
      },
    );
    const data = liveGameFixture();
    game.connect({ protocol: 'http:', host: 'x', search: '?game=g1&side=blue' });
    expect(sockets).toHaveLength(0);
    expect(game.map()).toBeUndefined();
    expect(loadTerrain).toHaveBeenCalledExactlyOnceWith('g1', expect.any(AbortSignal));
    expect(loadInfo).toHaveBeenCalledExactlyOnceWith(
      'g1',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(loadTerrain.mock.calls[0]![1]).toBe(loadInfo.mock.calls[0]![2]);
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    terrain.resolve(data.terrain);
    await terrain.promise;
    await fixture.whenStable();
    expect(sockets).toHaveLength(0); // Terrain alone cannot bypass game metadata.
    metadata.resolve(data.info);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
      expect(sockets[0]!.onmessage).toBeTypeOf('function');
      expect(game.mapLoading()).toBe(false);
    });
    expect(game.map()).toEqual(data.terrain.map);
    sockets[0]!.readyState = 1;
    sockets[0]!.onopen?.();
    expect(game.state().link).toBe('open');
    // The server says the game is closed and drops the socket: the connection gives up.
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ v: 1, kind: 'error', code: 'game_closed', message: 'gone' }),
    });
    sockets[0]!.onclose?.();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Connection lost');
    (el.querySelector('[data-testid="clock-retry"]') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
