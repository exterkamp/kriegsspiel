import { Injectable, computed, signal } from '@angular/core';
import { GameConnection } from '@legacy/net/connection';
import { applyServerMessage, initialState, withLink, type ClientState } from '@legacy/net/state';
import { fixtureView } from '@legacy/table/fixture';
import { parseSession, wsUrl } from '@legacy/session';

/**
 * The client state for one game, as a signal. The reducers and the WebSocket client are the existing framework-free
 * modules from `client/src/net`; this service only holds the result and feeds them messages.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly _state = signal<ClientState>(initialState);
  readonly state = this._state.asReadonly();
  readonly view = computed(() => this._state().view);
  private conn: GameConnection | undefined;

  /** Join `?game=<id>` from the query string; with none, show the fixture board offline. */
  connect(loc: { protocol: string; host: string; search: string }): void {
    const params = parseSession(loc.search);
    if (params.mode !== 'join') {
      // Spike only: `?new=1` and `?lobby` also land here and show the offline fixture board; stage 2 routes them properly.
      this._state.set({ ...withLink(initialState, 'offline'), view: fixtureView });
      return;
    }
    this.conn?.stop();
    this.conn = new GameConnection({
      url: wsUrl(loc, params.game, params.side),
      onStatus: (s) => this._state.update((st) => withLink(st, s)),
      onMessage: (m) => this._state.update((st) => applyServerMessage(st, m, Date.now())),
    });
    this.conn.start();
  }

  disconnect(): void {
    this.conn?.stop();
    this.conn = undefined;
  }
}
