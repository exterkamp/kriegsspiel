import {
  PROTOCOL_VERSION,
  parseServerMessage,
  serializeCommand,
  type Command,
  type Mark,
  type ServerMessage,
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
  onStatus(status: 'connecting' | 'open' | 'closed'): void;
  /** Called for a frame that does not parse as a `ServerMessage`. */
  onBadMessage?(error: string): void;
  createSocket?(url: string): WebSocketLike;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Delays between reconnect attempts; the last one repeats. */
  backoffMs?: readonly number[];
}

const OPEN = 1;

/** A WebSocket to one side of one game that reconnects after a drop. The server resends the full view on connect. */
export class GameConnection {
  private socket: WebSocketLike | undefined;
  private attempt = 0;
  private timer: unknown;
  private stopped = false;
  private readonly backoff: readonly number[];

  constructor(private readonly o: ConnectionOptions) {
    this.backoff = o.backoffMs ?? [500, 1000, 2000, 5000];
  }

  start(): void {
    this.stopped = false;
    this.open();
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

  putMark(mark: Mark): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'putMark', mark });
  }

  deleteMark(markId: string): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'deleteMark', markId });
  }

  syncDrafts(): boolean {
    return this.send({ v: PROTOCOL_VERSION, kind: 'syncDrafts' });
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
      this.o.onStatus('open');
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const r = parseServerMessage(e.data);
      if (r.ok) {
        // An edit on a rev the server does not have (it lost it, or we missed one): start over from its snapshot.
        if (r.value.kind === 'error' && r.value.code === 'bad_rev') this.syncDrafts();
        this.o.onMessage(r.value);
      } else this.o.onBadMessage?.(r.error);
    };
    // `close` follows `error`, so reconnecting only from `close` schedules one retry.
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.o.onStatus('closed');
      if (this.stopped) return;
      const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 1000;
      this.attempt += 1;
      this.timer = (this.o.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => this.open(), delay);
    };
  }
}
