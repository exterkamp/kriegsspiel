import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockState } from '@kriegsspiel/protocol';
import type { ClientState } from '@legacy/net/state';
import { GameService } from '../game/game.service';
import { DeskStore } from './desk.store';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('DeskStore', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts on the table with empty marks', () => {
    const d = TestBed.inject(DeskStore);
    expect(d.activeView()).toBe('table');
    expect(d.trayFiled().size).toBe(0);
    expect(d.journal()).toEqual([]);
  });

  it('files and discards; discarding unfiles; repeats keep the same set', () => {
    const d = TestBed.inject(DeskStore);
    d.setFiled('a', true);
    const first = d.trayFiled();
    d.setFiled('a', true);
    expect(d.trayFiled()).toBe(first);
    d.discard('a');
    expect(d.trayFiled().has('a')).toBe(false);
    expect(d.trayDiscarded().has('a')).toBe(true);
  });

  it('derives trayMarks from the game read set', () => {
    const d = TestBed.inject(DeskStore);
    TestBed.inject(GameService).markRead('r');
    expect(d.trayMarks().read.has('r')).toBe(true);
  });

  it('persists tray marks and reloads them, including read ones', () => {
    const d = TestBed.inject(DeskStore);
    const stop = d.persistTray('g');
    d.setFiled('f', true);
    TestBed.inject(GameService).markRead('r');
    TestBed.tick();
    stop();
    d.setFiled('later', true);
    TestBed.tick();

    TestBed.resetTestingModule();
    const d2 = TestBed.inject(DeskStore);
    d2.persistTray('g');
    expect([...d2.trayFiled()]).toEqual(['f']);
    expect(TestBed.inject(GameService).state().read.has('r')).toBe(true);
  });

  it('persists the order draft and reloads it', () => {
    const d = TestBed.inject(DeskStore);
    d.persistDraft('g');
    d.orderDraft.update((x) => ({ ...x, text: 'hold the bridge' }));
    TestBed.tick();

    TestBed.resetTestingModule();
    const d2 = TestBed.inject(DeskStore);
    d2.persistDraft('g');
    expect(d2.orderDraft().text).toBe('hold the bridge');
  });

  it('adds trimmed notes, ignores blank ones, and persists the diary', () => {
    const d = TestBed.inject(DeskStore);
    d.persistJournal('g');
    TestBed.tick();
    d.addNote('   ', 1);
    expect(d.journal()).toHaveLength(0);
    d.addNote('  watch the left  ', 1);
    TestBed.tick();
    expect(d.journal().map((e) => e.text)).toEqual(['watch the left']);

    TestBed.resetTestingModule();
    const d2 = TestBed.inject(DeskStore);
    d2.persistJournal('g');
    expect(d2.journal().map((e) => e.text)).toEqual(['watch the left']);
  });

  it('records a pending order in the diary and drops it when the order leaves pending', () => {
    const d = TestBed.inject(DeskStore);
    const game = TestBed.inject(GameService);
    d.persistJournal('g');
    TestBed.tick();
    (game as unknown as { _state: { update(f: (s: never) => unknown): void } })._state.update(((s: {
      pending: unknown[];
    }) => ({
      ...s,
      pending: [{ orderId: 'x', text: 'go', sentAtGame: 0 }],
    })) as never);
    TestBed.tick();
    expect(d.journal().some((e) => e.id === 'order:x')).toBe(true);
    (game as unknown as { _state: { update(f: (s: never) => unknown): void } })._state.update(((
      s: object,
    ) => ({
      ...s,
      pending: [],
    })) as never);
    TestBed.tick();
    expect(d.journal().some((e) => e.id === 'order:x')).toBe(false);
  });

  it('stops saving after the returned function is called', () => {
    const d = TestBed.inject(DeskStore);
    const stop = d.persistDraft('g');
    stop();
    d.orderDraft.update((x) => ({ ...x, text: 'unsaved' }));
    TestBed.tick();
    expect(storage.length).toBe(0);
  });

  it('writes tray marks only when a mark set changed, not on unrelated game state', () => {
    const d = TestBed.inject(DeskStore);
    const game = TestBed.inject(GameService);
    d.persistTray('g');
    TestBed.tick();
    const set = vi.spyOn(storage, 'setItem');
    (game as unknown as { _state: { update(f: (s: never) => unknown): void } })._state.update(((
      s: object,
    ) => ({ ...s, link: 'closed' })) as never);
    TestBed.tick();
    expect(set).not.toHaveBeenCalled();
    d.setFiled('f', true);
    TestBed.tick();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite a freshly loaded diary until it changes', () => {
    const d = TestBed.inject(DeskStore);
    d.persistJournal('g');
    TestBed.tick();
    d.addNote('kept', 1);
    TestBed.tick();

    TestBed.resetTestingModule();
    const d2 = TestBed.inject(DeskStore);
    const set = vi.spyOn(storage, 'setItem');
    d2.persistJournal('g');
    TestBed.tick();
    expect(d2.journal().map((e) => e.text)).toEqual(['kept']);
    expect(set).not.toHaveBeenCalled();
    d2.addNote('next', 2);
    TestBed.tick();
    expect(set).toHaveBeenCalled();
  });

  it('writes each turn into the diary in a turn-mode game, with no pause or resume lines (D39)', () => {
    const d = TestBed.inject(DeskStore);
    const game = TestBed.inject(GameService) as unknown as {
      _state: { update(f: (s: ClientState) => ClientState): void };
    };
    const MIN = 60_000;
    const at = (turn: number, status: ClockState['status']) =>
      game._state.update((s) => ({
        ...s,
        turnMode: true,
        clock: { gameMs: turn * 20 * MIN, localWallMs: 0, rate: 1, status },
        turn: {
          turn,
          startsAt: (turn - 1) * 20 * MIN,
          endsAt: turn * 20 * MIN,
          sent: [],
          resolving: false,
          held: [],
        },
      }));
    d.persistJournal('g');
    TestBed.tick();
    at(1, 'paused');
    TestBed.tick();
    at(2, 'running');
    TestBed.tick();
    at(2, 'paused');
    TestBed.tick();
    const ids = d.journal().map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['turn:1', 'turn:2']));
    expect(d.journal().some((e) => e.kind === 'pause')).toBe(false);
  });

  it("files the staff's summary of a turn once it is decided, and keeps it (#439)", () => {
    const d = TestBed.inject(DeskStore);
    const game = TestBed.inject(GameService) as unknown as {
      _state: { update(f: (s: ClientState) => ClientState): void };
    };
    const MIN = 60_000;
    const unit = (y: number, strength: number) => ({
      id: 'b1',
      name: '1st Battalion',
      position: { x: 1000, y },
      facing: 0,
      formation: 'line' as const,
      footprint: { frontage: 200, depth: 40 },
      strength,
      morale: 0.9,
      place: 'at the bridge',
    });
    const at = (turn: number, y: number, strength: number) =>
      game._state.update((s) => ({
        ...s,
        turnMode: true,
        turnMinutes: 20,
        view: {
          side: 'blue',
          atGame: (turn - 1) * 20 * MIN,
          ownUnits: [unit(y, strength)],
          visibleEnemies: [],
          lastKnownContacts: [],
          dispatches: [],
          clock: { gameMsAtAnchor: 0, wallMsAtAnchor: 0, rate: 1, status: 'paused' },
        },
        turn: {
          turn,
          startsAt: (turn - 1) * 20 * MIN,
          endsAt: turn * 20 * MIN,
          sent: [],
          resolving: false,
          held: [],
        },
      }));
    d.persistTurns('g');
    at(1, 3000, 600);
    TestBed.tick();
    expect(d.turnRecord().starts[1]).toHaveLength(1);
    expect(d.papers()).toHaveLength(0);
    at(2, 2000, 540);
    TestBed.tick();
    const [summary] = d.papers();
    expect(summary).toMatchObject({
      id: 'turn-summary-1',
      from: 'Chief of staff',
      receivedAtGame: 20 * MIN,
    });
    expect(summary!.text).toContain('Moved: 1st Battalion about 1000 m north, now at the bridge.');
    expect(summary!.text).toContain('Losses: 1st Battalion moderate, about 60 men.');
    TestBed.tick();
    expect(JSON.parse(storage.getItem('kriegsspiel.turns.g')!).summaries).toHaveLength(1);
    // A reload keeps the paper as it was filed.
    TestBed.resetTestingModule();
    const again = TestBed.inject(DeskStore);
    again.persistTurns('g');
    expect(again.papers().map((x) => x.id)).toEqual(['turn-summary-1']);
  });
});
