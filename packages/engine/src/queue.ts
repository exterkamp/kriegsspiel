import type { EngineState, NewEvent, QueuedEvent } from './events.js';

/**
 * Ordering: ascending game time, then ascending sequence id. Sequence ids are
 * assigned in insertion order, so events at the same instant fire in the order
 * they were scheduled. This is total and independent of how advanceTo is chunked.
 */
export function compareEvents(a: QueuedEvent, b: QueuedEvent): number {
  return a.time - b.time || a.seq - b.seq;
}

/** Insert into a sorted queue (binary search) without mutating the input. */
function insertSorted(queue: QueuedEvent[], ev: QueuedEvent): QueuedEvent[] {
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareEvents(queue[mid]!, ev) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return [...queue.slice(0, lo), ev, ...queue.slice(lo)];
}

/** Return a new state with the events enqueued (in the given order). */
export function schedule<W>(state: EngineState<W>, events: NewEvent[]): EngineState<W> {
  let queue = state.queue;
  let nextSeq = state.nextSeq;
  for (const e of events) {
    if (!Number.isFinite(e.time)) throw new Error(`event time must be finite: ${e.type}`);
    if (e.time < state.time) {
      throw new Error(`cannot schedule ${e.type} at ${e.time}, before current time ${state.time}`);
    }
    queue = insertSorted(queue, {
      time: e.time,
      seq: nextSeq++,
      type: e.type,
      payload: e.payload ?? null,
    });
  }
  return { ...state, queue, nextSeq };
}
