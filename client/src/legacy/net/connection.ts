import {
  PROTOCOL_VERSION,
  parseServerMessage,
  serializeCommand,
  type Command,
  type Mark,
  type StaffRole,
  type ServerMessage,
  type TextOp,
  type TurnOrder,
} from '@kriegsspiel/protocol';

/** The slice of a browser WebSocket the connection uses, so tests can fake it. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface ConnectionOptions {
  url: string;
  onMessage(m: ServerMessage): void;
  onStatus(status: 'connecting' | 'open' | 'closed' | 'failed'): void;
  /** Called for a frame that does not parse as a `ServerMessage`. */
  onBadMessage?(error: string): void;
  createSocket?(url: string): WebSocketLike;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Delays between reconnect attempts; the last one repeats. */
  backoffMs?: readonly number[];
  /** Give up after this long without an open socket (default 2 minutes); `retry()` starts over. */
  giveUpAfterMs?: number;
  now?(): number;
}

const GIVE_UP_AFTER_MS = 120_000;

const OPEN = 1;

/** A WebSocket to one side of one game that reconnects after a drop. The server resends the full view on connect. */
export class GameConnection {
  private socket: WebSocketLike | undefined;
  private attempt = 0;
  private timer: unknown;
  private stopped = false;
  private failed = false;
  private closedByServer = false;
  /** When the current run of failed attempts began; undefined while connected. */
  private downSince: number | undefined;
  private readonly backoff: readonly number[];

  constructor(private readonly o: ConnectionOptions) {
    this.backoff = o.backoffMs ?? [500, 1000, 2000, 5000];
  }

  start(): void {
    this.stopped = false;
    if (this.timer !== undefined) (this.o.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = undefined;
    this.failed = false;
    this.closedByServer = false;
    this.downSince = undefined;
    this.attempt = 0;
    this.open();
  }

  /** The player's manual retry after the connection gave up. */
  retry(): void {
    if (this.stopped) return;
    this.socket?.close();
    this.start();
  }

  /** Stop reconnecting and tell the player; `retry()` or `start()` resumes. */
  private giveUp(): void {
    this.failed = true;
    this.o.onStatus('failed');
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) (this.o.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = undefined;
    this.socket?.close();
  }

  /** Returns false when the socket is not open, so the caller can tell the player. */
  send(command: Command): boolean {
    if (this.socket?.readyState !== OPEN) return false;
    this.socket.send(serializeCommand(command));
    return true;
  }

  sendOrder(orderId: string, text: string, courier?: 'fast' | 'safe'): boolean {
    return this.send({
      v: PROTOCOL_VERSION,
      kind: 'issueOrder',
      orderId,
      text,
      ...(courier ? { courier } : {}),
    });
  }

  /** Turn mode (D39): hold an order for the open turn, or replace the held order with the same id. */
  holdTurnOrder(order: TurnOrder): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'holdTurnOrder', order });
  }

  withdrawTurnOrder(orderId: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'withdrawTurnOrder', orderId });
  }

  /** Send the side's held orders for the open turn. Final for the side. */
  sendTurn(): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'sendTurn' });
  }

  askStaff(questionId: string, role: StaffRole, question: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'askStaff', questionId, role, question });
  }

  putMark(mark: Mark): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'putMark', mark });
  }

  deleteMark(markId: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'deleteMark', markId });
  }

  syncDrafts(): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'syncDrafts' });
  }

  createDraft(draft: string, input: { text?: string; title?: string } = {}): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'createDraft', draft, ...input });
  }

  draftEdit(draft: string, e: { baseRev: number; op: TextOp; opId: string }): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'draftEdit', draft, ...e });
  }

  draftComment(
    draft: string,
    baseRev: number,
    comment: { id: string; from: number; to: number; body: string; replyTo?: string },
  ): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'draftComment', draft, baseRev, comment });
  }

  resolveComment(draft: string, commentId: string, resolved: boolean): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'resolveComment', draft, commentId, resolved });
  }

  readDraft(draft: string, rev: number): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'readDraft', draft, rev });
  }

  forkDraft(draft: string, newDraft: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'forkDraft', draft, newDraft });
  }

  mergeDraft(draft: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'mergeDraft', draft });
  }

  /** Tell the side which draft this player has open, or none. */
  draftPresence(draft: string | null): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'draftPresence', draft });
  }

  proposePause(reason?: string): boolean {
    const r = reason?.trim();
    return this.send({ v: PROTOCOL_VERSION, kind: 'proposePause', ...(r ? { reason: r } : {}) });
  }

  proposeResume(): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'proposeResume' });
  }

  vote(proposal: string, yes: boolean): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'vote', proposal, yes });
  }

  private open(): void {
    this.o.onStatus('connecting');
    const make: (url: string) => WebSocketLike =
      this.o.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
    const socket = make(this.o.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.downSince = undefined;
      this.o.onStatus('open');
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const r = parseServerMessage(e.data);
      if (r.ok) {
        // An edit on a rev the server does not have (it lost it, or we missed one): start over from its snapshot.
        if (r.value.kind === 'error' && r.value.code === 'bad_rev') this.syncDrafts();
        // The game is gone: the server will not take us back, so stop knocking.
        if (r.value.kind === 'error' && r.value.code === 'game_closed') this.closedByServer = true;
        this.o.onMessage(r.value);
      } else this.o.onBadMessage?.(r.error);
    };
    // `close` follows `error`, so reconnecting only from `close` schedules one retry.
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if (this.stopped) return this.o.onStatus('closed');
      const now = (this.o.now ?? Date.now)();
      this.downSince ??= now;
      if (this.closedByServer || now - this.downSince >= (this.o.giveUpAfterMs ?? GIVE_UP_AFTER_MS))
        return this.giveUp();
      this.o.onStatus('closed');
      const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 1000;
      this.attempt += 1;
      this.timer = (this.o.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => this.open(), delay);
    };
  }
}
