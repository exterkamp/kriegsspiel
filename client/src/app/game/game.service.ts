import { Injectable, computed, signal } from '@angular/core';
import { GameConnection } from '@legacy/net/connection';
import {
  applyServerMessage,
  gameNowMs,
  initialState,
  withLink,
  withMarkDeleted,
  withMarkPut,
  withPendingOrder,
  withRead,
  type ClientState,
  type PendingOrder,
} from '@legacy/net/state';
import type { Mark, TurnOrder } from '@kriegsspiel/protocol';
import { fetchGame } from '@legacy/lobby/api';
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
  private readonly _sides = signal<readonly string[]>([]);
  /** Every side in the game, from the lobby record; empty until read. The turn panel lists who has sent. */
  readonly sides = this._sides.asReadonly();
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
    this._sides.set([]);
    const game = params.game;
    fetchGame(game).then(
      (info) => {
        if (this._gameId() === game) this._sides.set(info.sides.map((x) => x.side));
      },
      () => undefined,
    );
    this.conn = new GameConnection({
      url: wsUrl(loc, params.game, params.side),
      onStatus: (s) => this._state.update((st) => withLink(st, s)),
      onMessage: (m) => {
        const before = this._state();
        const after = applyServerMessage(before, m, Date.now());
        this._state.set(after);
        // An entry that skipped a rev: start over from the server's snapshot.
        if (after.draftsStale && !before.draftsStale) this.conn?.syncDrafts();
      },
    });
    this.conn.start();
    this.listenForPageCache();
  }

  /** The player's manual retry after the connection gave up. */
  retry(): void {
    this.conn?.retry();
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
  sendOrder(
    text: string,
    extra: Partial<PendingOrder> = {},
    courier?: 'fast' | 'safe',
  ): string | undefined {
    if (!this.conn) return 'Not connected to a game (open with ?new=1 or ?game=…).';
    const orderId = `o-${Date.now().toString(36)}-${++this.orderSeq}`;
    if (!this.conn.sendOrder(orderId, text, courier))
      return 'Not connected. Try again when the link is back.';
    const s = this._state();
    const sentAtGame = s.clock ? gameNowMs(s.clock, Date.now()) : 0;
    this._state.set(withPendingOrder(s, { orderId, text, sentAtGame, ...extra }));
    return undefined;
  }

  /** Keep a mark on the table at once and send it to the server. False when the link is down: the mark is not saved. */
  putMark(mark: Mark): boolean {
    this._state.update((s) => withMarkPut(s, mark));
    return this.conn?.putMark(mark) ?? false;
  }

  deleteMark(id: string): void {
    this._state.update((s) => withMarkDeleted(s, id));
    this.conn?.deleteMark(id);
  }

  createDraft(...args: Parameters<GameConnection['createDraft']>): boolean {
    return this.conn?.createDraft(...args) ?? false;
  }
  draftEdit(...args: Parameters<GameConnection['draftEdit']>): boolean {
    return this.conn?.draftEdit(...args) ?? false;
  }
  draftComment(...args: Parameters<GameConnection['draftComment']>): boolean {
    return this.conn?.draftComment(...args) ?? false;
  }
  resolveComment(...args: Parameters<GameConnection['resolveComment']>): boolean {
    return this.conn?.resolveComment(...args) ?? false;
  }
  readDraft(...args: Parameters<GameConnection['readDraft']>): boolean {
    return this.conn?.readDraft(...args) ?? false;
  }
  forkDraft(...args: Parameters<GameConnection['forkDraft']>): boolean {
    return this.conn?.forkDraft(...args) ?? false;
  }
  mergeDraft(...args: Parameters<GameConnection['mergeDraft']>): boolean {
    return this.conn?.mergeDraft(...args) ?? false;
  }
  draftPresence(...args: Parameters<GameConnection['draftPresence']>): boolean {
    return this.conn?.draftPresence(...args) ?? false;
  }
  askStaff(...args: Parameters<GameConnection['askStaff']>): boolean {
    return this.conn?.askStaff(...args) ?? false;
  }
  /** Turn mode (D39): hold an order for the open turn (or replace the held one with its id). */
  holdTurnOrder(order: TurnOrder): boolean {
    return this.conn?.holdTurnOrder(order) ?? false;
  }
  withdrawTurnOrder(orderId: string): boolean {
    return this.conn?.withdrawTurnOrder(orderId) ?? false;
  }
  sendTurn(): boolean {
    return this.conn?.sendTurn() ?? false;
  }
  /** A fresh id for an order held for the turn. */
  newTurnOrderId(): string {
    return `t-${Date.now().toString(36)}-${++this.orderSeq}`;
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
