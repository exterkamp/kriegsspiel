import { vi } from 'vitest';
import type { Mark } from '@kriegsspiel/protocol';
import { computed, signal } from '@angular/core';
import { initialState, withRead, type ClientState } from '@legacy/net/state';
import { GameService } from '../game/game.service';

/** A stand-in `GameService` for component specs: the state is a plain signal the spec sets directly. */
export function fakeGame(state: Partial<ClientState> = {}, gameId?: string) {
  const s = signal<ClientState>({ ...initialState, ...state });
  const fake = {
    state: s.asReadonly(),
    view: computed(() => s().view),
    gameId: signal(gameId).asReadonly(),
    markRead: (id: string) => s.update((x) => withRead(x, id)),
    mergeRead: (ids: Iterable<string>) =>
      s.update((x) => ({ ...x, read: new Set([...x.read, ...ids]) })),
    disconnect: vi.fn(),
    putMark: vi.fn<(mark: Mark) => boolean>(() => true),
    deleteMark: vi.fn<(id: string) => void>(),
    createDraft: vi.fn(() => true),
    draftEdit: vi.fn(() => true),
    draftComment: vi.fn(() => true),
    resolveComment: vi.fn(() => true),
    readDraft: vi.fn(() => true),
    forkDraft: vi.fn(() => true),
    mergeDraft: vi.fn(() => true),
    draftPresence: vi.fn(() => true),
    set: (p: Partial<ClientState>) => s.update((x) => ({ ...x, ...p })),
  };
  return { provide: GameService, useValue: fake, fake };
}
