import { Injectable, computed, signal } from '@angular/core';
import { GameConnection } from '@legacy/net/connection';
import {
  applyServerMessage,
  gameNowMs,
  initialState,
  withLink,
  withPendingOrder,
  withRead,
  type ClientState,
  type PendingOrder,
} from '@legacy/net/state';
import { fixtureView } from '@legacy/table/fixture';
import { parseSession, wsUrl } from '@legacy/session';

/**
 * The client state for one game, as a signal. The reducers and the WebSocket client are the existing framework-free
 * modules from `client/src/net`; this service holds the result, feeds them messages, sends commands, and keeps the
 * connection alive across the back/forward cache.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly _state = signal<ClientState>(initialState);
  readonly state = this._state.asReadonly();
  readonly view = computed(() => this._state().view);
  private readonly _gameId = signal<string | undefined>(undefined);
  /** The game this page is playing, once joined; the umpire's window reads its log. */
  readonly gameId = this._gameId.asReadonly();
  private conn: GameConnection | undefined;
  private orderSeq = 0;
  private stopPageEvents: (() => void) | undefined;

  /** Join `?game=<id>` from the query string; with none, show the fixture board offline. */
  connect(loc: { protocol: string; host: string; search: string }): void {
    this.disconnect();
    const params = parseSession(loc.search);
    if (params.mode !== 'join') {
      // `?new=1` and `?lobby` also land here until the shell routes them (stage 2 step 4).
      this._gameId.set(undefined);
      this._state.set({ ...withLink(initialState, 'offline'), view: fixtureView });
      return;
    }
    this._gameId.set(params.game);
    this.conn = new GameConnection({
      url: wsUrl(loc, params.game, params.side),
      onStatus: (s) => this._state.update((st) => withLink(st, s)),
      onMessage: (m) => this._state.update((st) => applyServerMessage(st, m, Date.now())),
    });
    this.conn.start();
    this.listenForPageCache();
  }

  /** Stop the connection and the page listeners. */
  disconnect(): void {
    this.stopPageEvents?.();
    this.stopPageEvents = undefined;
    this.conn?.stop();
    this.conn = undefined;
  }

  /** A page kept in the back/forward cache is not closed, so it must come back with a live connection. */
  private listenForPageCache(): void {
    const hide = (): void => this.conn?.stop();
    const show = (e: PageTransitionEvent): void => {
      if (e.persisted) this.conn?.start();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    this.stopPageEvents = () => {
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }

  /** Mark a dispatch read. */
  markRead(id: string): void {
    this._state.update((s) => withRead(s, id));
  }

  /** Add dispatches saved as read on an earlier visit. */
  mergeRead(ids: Iterable<string>): void {
    this._state.update((s) => ({ ...s, read: new Set([...s.read, ...ids]) }));
  }

  /** Send finished order wording and remember it as pending. Returns an error for the form, or undefined. */
  sendOrder(text: string, extra: Partial<PendingOrder> = {}, courier?: 'fast' | 'safe'): string | undefined {
    if (!this.conn) return 'Not connected to a game (open with ?new=1 or ?game=…).';
    const orderId = `o-${Date.now().toString(36)}-${++this.orderSeq}`;
    if (!this.conn.sendOrder(orderId, text, courier)) return 'Not connected. Try again when the link is back.';
    const s = this._state();
    const sentAtGame = s.clock ? gameNowMs(s.clock, Date.now()) : 0;
    this._state.set(withPendingOrder(s, { orderId, text, sentAtGame, ...extra }));
    return undefined;
  }

  askStaff(...args: Parameters<GameConnection['askStaff']>): boolean {
    return this.conn?.askStaff(...args) ?? false;
  }
  proposePause(reason?: string): boolean {
    return this.conn?.proposePause(reason) ?? false;
  }
  proposeResume(): boolean {
    return this.conn?.proposeResume() ?? false;
  }
  vote(proposal: string, yes: boolean): boolean {
    return this.conn?.vote(proposal, yes) ?? false;
  }
}
