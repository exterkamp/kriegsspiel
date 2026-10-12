/**
 * #198 review follow-up: response bytes for a traced WebSocket message come from the
 * per-connection counter in `Hub.send`, never from patching `socket.send`. Handlers overlap,
 * so a patched send could be restored out from under a later handler and leave a stale
 * wrapper installed; the counter cannot. These tests drive the hub with a fake socket and a
 * game lookup that finds nothing, so every order is answered with one `game_closed` error.
 */
import { PROTOCOL_VERSION } from '@kriegsspiel/protocol';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { TraceStore, type TraceEntry } from '../debug/trace.js';
import { Hub, type Socket } from './hub.js';

type Listener = (data: unknown, isBinary: boolean) => void;

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }
  /** Deliver one inbound message exactly as the real socket would. */
  message(data: string): void {
    for (const l of this.listeners.get('message') ?? []) l(data, false);
  }
}

const order = (orderId: string) =>
  JSON.stringify({ v: PROTOCOL_VERSION, kind: 'issueOrder', orderId, text: 'advance' });

const requestsOf = (entries: TraceEntry[]) => entries.filter((e) => e.kind === 'request');
const dataOf = (e: TraceEntry) => e.data as Record<string, unknown>;

/** Resolve as soon as the store holds `count` request entries for the game. */
async function waitForRequests(trace: TraceStore, gameId: string, count: number): Promise<void> {
  if (requestsOf(trace.entries(gameId)).length >= count) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for request entries')),
      5000,
    );
    const unsub = trace.subscribe((entry) => {
      if (entry.gameId !== gameId) return;
      if (requestsOf(trace.entries(gameId)).length < count) return;
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

async function startHub() {
  const trace = new TraceStore();
  const hub = new Hub(
    () => undefined,
    () => undefined,
    undefined,
    undefined,
    undefined,
    trace,
  );
  const socket = new FakeSocket();
  hub.attach('g1', 'blue', socket as unknown as Socket, 'user-1');
  // Let the attach-time sends (drafts, marks) settle before measuring anything.
  await new Promise((r) => setTimeout(r, 10));
  socket.sent.length = 0;
  return { trace, socket };
}

describe('hub trace byte counting (#198)', () => {
  it('counts a sequential message exactly', async () => {
    const { trace, socket } = await startHub();
    socket.message(order('o1'));
    await waitForRequests(trace, 'g1', 1);
    expect(socket.sent).toHaveLength(1);
    const [entry] = requestsOf(trace.entries('g1'));
    expect(dataOf(entry!)).toMatchObject({ transport: 'ws', method: 'issueOrder', ok: true });
    expect(dataOf(entry!).responseBytes).toBe(Buffer.byteLength(socket.sent[0]!));
  });

  it('stays correct when two messages are handled at once, and for the message after them', async () => {
    const { trace, socket } = await startHub();
    // Two messages in the same tick: their handlers overlap.
    socket.message(order('o1'));
    socket.message(order('o2'));
    await waitForRequests(trace, 'g1', 2);
    expect(socket.sent).toHaveLength(2);
    const one = Buffer.byteLength(socket.sent[0]!);
    for (const entry of requestsOf(trace.entries('g1'))) {
      // No send is lost or double-delivered, and each window counted at least its own reply.
      expect(typeof dataOf(entry).responseBytes).toBe('number');
      expect(dataOf(entry).responseBytes as number).toBeGreaterThanOrEqual(one);
    }
    // The next message is counted exactly, which a stale wrapper left on the socket by the
    // overlapping handlers would corrupt.
    socket.message(order('o3'));
    await waitForRequests(trace, 'g1', 3);
    expect(socket.sent).toHaveLength(3);
    const third = requestsOf(trace.entries('g1')).at(-1)!;
    expect(dataOf(third).responseBytes).toBe(Buffer.byteLength(socket.sent[2]!));
  });
});
