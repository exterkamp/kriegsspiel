import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeApprovedBattlefield } from '@kriegsspiel/protocol';
import type { fetchGame, GameInfo } from '@legacy/lobby/api';
import type { fetchGameBattlefield, GameBattlefield } from '@legacy/lobby/battlefield';
import { battlefieldMap } from '@legacy/table/battlefieldMap';
import { GAME_BATTLEFIELD_LOADER, GAME_INFO_LOADER, GameService } from './game.service';
import { CONFERENCE_SENDER, ORDER_SENDER, PAUSE_ACTIONS } from './ports';

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
afterEach(() => {
  try {
    TestBed.inject(GameService).disconnect();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe('injection tokens', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', class {}));

  it('default to GameService and report a missing connection', () => {
    expect(
      TestBed.inject(ORDER_SENDER).send({
        text: 't',
        toName: 'n',
        courier: 'safe',
        eta: undefined,
      }),
    ).toMatch(/Not connected/);
    expect(TestBed.inject(CONFERENCE_SENDER)('q', 'chiefOfStaff', 'x')).toBe(false);
    expect(TestBed.inject(PAUSE_ACTIONS).vote('p', true)).toBe(false);
  });

  it('can be replaced', () => {
    const send = vi.fn(() => undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ORDER_SENDER, useValue: { send } }] });
    TestBed.inject(ORDER_SENDER).send({ text: 't', toName: 'n', courier: 'fast', eta: 5 });
    expect(send).toHaveBeenCalledOnce();
    expect(TestBed.inject(GameService).state().pending).toHaveLength(0);
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {}
}

describe('ORDER_SENDER with a connection', () => {
  beforeEach(async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const data = liveGameFixture();
    const metadata = deferred<GameInfo>();
    const terrain = deferred<GameBattlefield>();
    const loadInfo = vi.fn<typeof fetchGame>().mockReturnValue(metadata.promise);
    const loadTerrain = vi.fn<typeof fetchGameBattlefield>().mockReturnValue(terrain.promise);
    TestBed.configureTestingModule({
      providers: [
        { provide: GAME_INFO_LOADER, useValue: loadInfo },
        { provide: GAME_BATTLEFIELD_LOADER, useValue: loadTerrain },
      ],
    });
    const game = TestBed.inject(GameService);
    game.connect({
      protocol: 'http:',
      host: 'localhost:4200',
      search: '?game=g1',
    });
    expect(FakeSocket.all).toHaveLength(0);
    expect(game.map()).toBeUndefined();
    expect(loadTerrain).toHaveBeenCalledExactlyOnceWith('g1', expect.any(AbortSignal));
    expect(loadInfo).toHaveBeenCalledExactlyOnceWith(
      'g1',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(loadTerrain.mock.calls[0]![1]).toBe(loadInfo.mock.calls[0]![2]);
    metadata.resolve(data.info);
    await metadata.promise;
    expect(FakeSocket.all).toHaveLength(0); // Metadata alone cannot bypass checked terrain.
    terrain.resolve(data.terrain);
    await vi.waitFor(() => {
      expect(FakeSocket.all).toHaveLength(1);
      expect(FakeSocket.all[0]!.onopen).toBeTypeOf('function');
      expect(game.mapLoading()).toBe(false);
    });
    expect(game.map()).toEqual(data.terrain.map);
    FakeSocket.all[0]!.readyState = 1;
    FakeSocket.all[0]!.onopen?.({});
    expect(game.state().link).toBe('open');
  });

  it('maps the desk order onto the pending order (addressee, courier, ETA)', () => {
    const err = TestBed.inject(ORDER_SENDER).send({
      text: 'advance',
      toName: 'Ney',
      courier: 'fast',
      eta: 5,
    });
    expect(err).toBeUndefined();
    expect(FakeSocket.all[0]!.sent).toHaveLength(1);
    expect(FakeSocket.all[0]!.sent[0]).toContain('fast');
    const p = TestBed.inject(GameService).state().pending;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ text: 'advance', toName: 'Ney', courier: 'fast', etaGame: 5 });
  });

  it('leaves etaGame absent when there is no estimate', () => {
    TestBed.inject(ORDER_SENDER).send({
      text: 'hold',
      toName: 'Soult',
      courier: 'safe',
      eta: undefined,
    });
    const p = TestBed.inject(GameService).state().pending[0]!;
    expect(p).toMatchObject({ toName: 'Soult', courier: 'safe' });
    expect('etaGame' in p).toBe(false);
  });
});
