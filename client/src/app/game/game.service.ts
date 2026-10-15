import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
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
  withTurnSettings,
  type ClientState,
  type PendingOrder,
} from '@legacy/net/state';
import type { Mark, TurnOrder } from '@kriegsspiel/protocol';
import { fetchGame } from '@legacy/lobby/api';
import { fetchGameBattlefield, GameBattlefieldError } from '@legacy/lobby/battlefield';
import { fixtureView, fixtureMap } from '@legacy/table/fixture';
import type { BaseMap } from '@legacy/table/types';
import { parseSession, wsUrl } from '@legacy/session';

/** Narrow transport seams keep lifecycle tests independent of browser HTTP. */
export const GAME_BATTLEFIELD_LOADER = new InjectionToken<typeof fetchGameBattlefield>(
  'GAME_BATTLEFIELD_LOADER',
  { factory: () => fetchGameBattlefield },
);
export const GAME_INFO_LOADER = new InjectionToken<typeof fetchGame>('GAME_INFO_LOADER', {
  factory: () => fetchGame,
});

/**
 * The client state for one game, as a signal. The reducers and the WebSocket client are the existing framework-free
 * modules from `client/src/net`; this service holds the result, feeds them messages, sends commands, and keeps the
 * connection alive across the back/forward cache.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly loadBattlefield = inject(GAME_BATTLEFIELD_LOADER);
  private readonly loadInfo = inject(GAME_INFO_LOADER);
  private readonly _state = signal<ClientState>(initialState);
  readonly state = this._state.asReadonly();
  readonly view = computed(() => this._state().view);
  private readonly _gameId = signal<string | undefined>(undefined);
  /** The game this page is playing, once joined; the umpire's window reads its log. */
  readonly gameId = this._gameId.asReadonly();
  private readonly _sides = signal<readonly string[]>([]);
  /** Every side in the game, from the lobby record; empty until read. The turn panel lists who has sent. */
  readonly sides = this._sides.asReadonly();
  private readonly _map = signal<BaseMap | undefined>(fixtureMap);
  /** Checked public terrain for this connection; undefined while a live game's terrain is unverified. */
  readonly map = this._map.asReadonly();
  private readonly _mapLoading = signal(false);
  readonly mapLoading = this._mapLoading.asReadonly();
  private readonly _mapError = signal('');
  readonly mapError = this._mapError.asReadonly();
  private mapRequest: AbortController | undefined;
  private visit = 0;
  private location: { protocol: string; host: string; search: string } | undefined;
  private conn: GameConnection | undefined;
  private orderSeq = 0;
  private stopPageEvents: (() => void) | undefined;

  /** Join `?game=<id>` from the query string; with none, show the fixture board offline. */
  connect(loc: { protocol: string; host: string; search: string }): void {
    this.disconnect();
    const params = parseSession(loc.search);
    if (params.mode !== 'join') {
      // `?new=1` and `?lobby` also land here until the shell routes them (stage 2 step 4).
      this._map.set(fixtureMap);
      this._gameId.set(undefined);
      this._state.set({ ...withLink(initialState, 'offline'), view: fixtureView });
      return;
    }
    this.location = { ...loc };
    this._map.set(undefined);
    this._gameId.set(params.game);
    this._sides.set([]);
    this._state.set(initialState);
    this._mapLoading.set(true);
    this._mapError.set('');
    const request = new AbortController();
    this.mapRequest = request;
    const visit = this.visit;
    const current = () => visit === this.visit && !request.signal.aborted;
    const timeout = setTimeout(() => request.abort(), 30_000);
    // Terrain and game settings belong to one connection lifetime, including reconnects to the same game.
    void Promise.all([
      this.loadBattlefield(params.game, request.signal),
      this.loadInfo(params.game, fetch, request.signal),
    ])
      .then(([terrain, info]) => {
        if (!current()) return;
        if (
          info.id !== params.game ||
          info.scenario !== terrain.scenarioId ||
          !Array.isArray(info.sides)
        )
          throw new Error('Game metadata mismatch');
        this._map.set(terrain.map);
        this._sides.set(info.sides.map((x) => x.side));
        this._state.update((state) => withTurnSettings(state, info.umpire));
        const url = wsUrl(loc, params.game, params.side);
        this.conn = new GameConnection({
          url: url + (url.includes('?') ? '&' : '?') + 'battlefieldVersion=1',
          onStatus: (status) => {
            if (current()) this._state.update((state) => withLink(state, status));
          },
          onMessage: (message) => {
            if (!current()) return;
            const before = this._state();
            const after = applyServerMessage(before, message, Date.now());
            this._state.set(after);
            if (after.draftsStale && !before.draftsStale) this.conn?.syncDrafts();
          },
        });
        this.conn.start();
        this.listenForPageCache();
      })
      .catch((error: unknown) => {
        if (visit !== this.visit) return;
        request.abort();
        this.conn?.stop();
        this.conn = undefined;
        this._map.set(undefined);
        this._mapError.set(
          error instanceof GameBattlefieldError
            ? error.message
            : 'The battlefield map could not be loaded. Try again.',
        );
        this._state.set(withLink(initialState, 'offline'));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (visit === this.visit) this._mapLoading.set(false);
      });
  }

  /** Retry the terrain gate after a loading failure, otherwise retry the established side connection. */
  retry(): void {
    if (this._mapError() && this.location) this.connect(this.location);
    else this.conn?.retry();
  }

  /** Stop this lifetime before clearing its map; late messages cannot repopulate it. */
  disconnect(): void {
    this.visit++;
    this.mapRequest?.abort();
    this.mapRequest = undefined;
    this.stopPageEvents?.();
    this.stopPageEvents = undefined;
    this.conn?.stop();
    this.conn = undefined;
    this.location = undefined;
    this._map.set(undefined);
    this._mapLoading.set(false);
    this._mapError.set('');
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
