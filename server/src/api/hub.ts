/**
 * Hub: the WebSocket connections of every game, and what each has been told.
 *
 * It pushes only `SideView` data built by `sideViewOf` (the visibility filter), and only
 * what changed since the connection's last push, so a client sees the initial view, then
 * view updates, new dispatches and clock changes as the game moves.
 */
import {
  parseCommand,
  serializeServerMessage,
  PROTOCOL_VERSION,
  type ClockState,
  type ServerMessage,
} from '@kriegsspiel/protocol';
import type { GameActor } from '../game/index.js';
import { sideViewOf } from './sideView.js';
import type { SideId } from '@kriegsspiel/engine';

/** The slice of a `ws` socket the hub uses. */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

const OPEN = 1;

interface Connection {
  side: SideId;
  socket: Socket;
  lastView: string;
  lastClock: string;
  sentDispatches: Set<string>;
  gameOverSent: boolean;
}

const error = (code: string, message: string): ServerMessage => ({
  v: PROTOCOL_VERSION,
  kind: 'error',
  code,
  message,
});

export class Hub {
  private readonly conns = new Map<string, Set<Connection>>();

  constructor(
    private readonly lookup: (gameId: string) => GameActor | undefined,
    private readonly onError: (gameId: string, e: unknown) => void,
  ) {}

  /** Number of open connections to a game. */
  count(gameId: string): number {
    return this.conns.get(gameId)?.size ?? 0;
  }

  /** Serve one player's socket: send the initial view, then handle its commands. */
  attach(gameId: string, side: SideId, socket: Socket): void {
    const conn: Connection = {
      side,
      socket,
      lastView: '',
      lastClock: '',
      sentDispatches: new Set(),
      gameOverSent: false,
    };
    const set = this.conns.get(gameId) ?? new Set();
    set.add(conn);
    this.conns.set(gameId, set);
    const detach = () => {
      set.delete(conn);
      if (set.size === 0 && this.conns.get(gameId) === set) this.conns.delete(gameId);
    };
    socket.on('close', detach);
    socket.on('error', () => {
      detach();
      socket.close();
    });
    socket.on('message', (data, isBinary) => {
      void this.handle(gameId, conn, data, isBinary).catch((e) => {
        this.onError(gameId, e);
        this.send(conn, error('internal', 'the server could not handle that message'));
      });
    });
    this.push(gameId, conn);
  }

  /** The game changed (a tick or a command): bring every connection up to date. */
  notify(gameId: string): void {
    for (const conn of [...(this.conns.get(gameId) ?? [])]) this.push(gameId, conn);
  }

  /** Close every connection to a game. */
  closeGame(gameId: string, code = 1001, reason = 'game closed'): void {
    for (const conn of [...(this.conns.get(gameId) ?? [])]) conn.socket.close(code, reason);
    this.conns.delete(gameId);
  }

  closeAll(): void {
    for (const id of [...this.conns.keys()]) this.closeGame(id, 1001, 'server shutting down');
  }

  private send(conn: Connection, message: ServerMessage): void {
    if (conn.socket.readyState !== OPEN) return;
    conn.socket.send(serializeServerMessage(message));
  }

  private push(gameId: string, conn: Connection): void {
    const game = this.lookup(gameId);
    if (!game) return;
    try {
      const clock: ClockState = game.gameClock.snapshot();
      const view = sideViewOf(game.state, conn.side, clock);
      const clockJson = JSON.stringify(clock);
      if (clockJson !== conn.lastClock) {
        // The first push carries the clock inside the view.
        if (conn.lastClock !== '')
          this.send(conn, { v: PROTOCOL_VERSION, kind: 'clockState', clock });
        conn.lastClock = clockJson;
      }
      const first = conn.lastView === '';
      // Only while the game is still waiting on the confirm: later joiners must not be told it is paused.
      if (first && game.restart && clock.status === 'paused' && !game.state.world.outcome) {
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'serverRestarted',
          downMs: game.restart.downMs,
        });
      }
      for (const dispatch of view.dispatches) {
        if (conn.sentDispatches.has(dispatch.id)) continue;
        conn.sentDispatches.add(dispatch.id);
        // Papers already in the initial view are not pushed a second time.
        if (!first) this.send(conn, { v: PROTOCOL_VERSION, kind: 'dispatch', dispatch });
      }
      const viewJson = JSON.stringify(view);
      if (viewJson !== conn.lastView) {
        conn.lastView = viewJson;
        this.send(conn, { v: PROTOCOL_VERSION, kind: 'viewUpdate', view });
      }
      // The outcome is public, so it is the same for both sides; it follows the final view.
      const outcome = game.state.world.outcome;
      if (outcome && !conn.gameOverSent) {
        conn.gameOverSent = true;
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'gameOver',
          winner: outcome.winner,
          reason: outcome.reason,
          atGame: outcome.time,
        });
      }
    } catch (e) {
      this.onError(gameId, e);
    }
  }

  private async handle(
    gameId: string,
    conn: Connection,
    data: unknown,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      this.send(conn, error('bad_message', 'messages must be JSON text'));
      return;
    }
    const parsed = parseCommand(String(data));
    if (!parsed.ok) {
      this.send(conn, error('bad_message', parsed.error));
      return;
    }
    const game = this.lookup(gameId);
    if (!game) {
      this.send(conn, error('game_closed', 'this game is no longer running'));
      return;
    }
    const command = parsed.value;
    if (command.kind !== 'issueOrder') {
      this.send(conn, error('not_implemented', `${command.kind} is not supported yet`));
      return;
    }
    if (command.text === undefined) {
      this.send(conn, error('not_implemented', 'order drafts are not supported yet; send text'));
      return;
    }
    let result;
    try {
      result = await game.submit({ kind: 'order', side: conn.side, text: command.text });
    } catch (e) {
      this.send(conn, error('game_closed', e instanceof Error ? e.message : 'game is closed'));
      return;
    }
    if (result.ok) return;
    if (result.kind === 'clarification') {
      const options = result.options?.length ? ` (${result.options.join(', ')})` : '';
      this.send(
        conn,
        error('order_clarification', `${command.orderId}: ${result.question}${options}`),
      );
    } else {
      this.send(conn, error('order_rejected', `${command.orderId}: ${result.reason}`));
    }
  }
}
