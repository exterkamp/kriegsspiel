import type { EmittedEvent, EngineState, EventRegistry, Json } from './events.js';
import { schedule } from './queue.js';
import { Rng, seedRng } from './rng.js';

/** Fresh state at game time `time` with an empty queue. */
export function createState<W>(seed: number, world: W, time = 0): EngineState<W> {
  return { time, rng: seedRng(seed), queue: [], nextSeq: 0, world };
}

export interface AdvanceResult<W> {
  state: EngineState<W>;
  /** Events emitted by handlers, in firing order. */
  emitted: EmittedEvent[];
}

/**
 * Pop and apply every event with time <= t in (time, seq) order, then set the
 * clock to t. Pure: the input state is not mutated. Events handlers schedule
 * for <= t fire in this same call. Advancing to t1 then t2 gives exactly the
 * same state and emitted list as advancing to t2 directly.
 */
export function advanceTo<W>(
  state: EngineState<W>,
  t: number,
  registry: EventRegistry<W>,
): AdvanceResult<W> {
  if (!Number.isFinite(t)) throw new Error('advanceTo target must be finite');
  if (t < state.time) throw new Error(`cannot advance backwards: ${t} < ${state.time}`);

  let cur = state;
  const rng = new Rng(state.rng);
  const emitted: EmittedEvent[] = [];

  while (cur.queue.length > 0 && cur.queue[0]!.time <= t) {
    const ev = cur.queue[0]!;
    cur = { ...cur, time: ev.time, queue: cur.queue.slice(1) };
    const res = registry.get(ev.type)(cur.world, ev, rng);
    cur = { ...cur, world: res.world };
    if (res.schedule) cur = schedule(cur, res.schedule);
    for (const e of res.emit ?? []) {
      emitted.push({ time: ev.time, type: e.type, payload: (e.payload ?? null) as Json });
    }
  }

  return { state: { ...cur, time: t, rng: rng.getState() }, emitted };
}
