import { signal, type WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initialState, type ClientState } from '@legacy/net/state';
import { GameService } from '../game/game.service';

/** A stand-in `GameService` whose state a test can set directly. Components and `DeskStore` only read `state`. */
export function stubGame(state: ClientState = initialState): WritableSignal<ClientState> {
  const s = signal(state);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: GameService, useValue: { state: s.asReadonly(), view: () => s().view } },
    ],
  });
  return s;
}
