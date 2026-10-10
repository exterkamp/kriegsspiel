import type { Rng, RngState } from './rng.js';

/** JSON-safe value, so queue contents survive serialisation. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** An event waiting in the queue. */
export interface QueuedEvent {
  /** Game time (seconds) at which the event fires. */
  time: number;
  /** Insertion sequence id, unique per game. Breaks ties between equal times. */
  seq: number;
  /** Key into the handler registry. */
  type: string;
  payload: Json;
}

/** What a handler (or caller) asks to be scheduled. */
export interface NewEvent {
  time: number;
  type: string;
  payload?: Json;
}

/** An event the engine reports to the outside world (for logs, reports, clients). */
export interface EmittedEvent {
  /** Game time at which it happened. */
  time: number;
  type: string;
  payload: Json;
}

/**
 * Whole engine state. Plain JSON, so `JSON.stringify` gives a snapshot and
 * `JSON.parse` resumes it. `world` is owned by other tasks and must be JSON-safe.
 */
export interface EngineState<W = Json> {
  /** Current game time in seconds. Only moves forward, only via `advanceTo`. */
  time: number;
  rng: RngState;
  /** Always sorted by (time, seq). */
  queue: QueuedEvent[];
  /** Next sequence id to hand out. */
  nextSeq: number;
  world: W;
}

export interface HandlerResult<W> {
  world: W;
  /** New events to enqueue. Their time must be >= the firing event's time. */
  schedule?: NewEvent[];
  /** Events to report out of the engine. */
  emit?: Array<{ type: string; payload?: Json }>;
}

/**
 * Handlers must be pure: never mutate `world` (or the event) in place, return a
 * new world instead. In-place mutation would change the caller's input state and
 * break replay and chunking guarantees.
 */
export type Handler<W> = (
  world: W,
  event: QueuedEvent,
  /** The game RNG. Draw all randomness from here so replays match. */
  rng: Rng,
) => HandlerResult<W>;

/** Maps event type names to handlers. Other tasks register their types here. */
export class EventRegistry<W = Json> {
  private readonly handlers = new Map<string, Handler<W>>();

  register(type: string, handler: Handler<W>): this {
    if (this.handlers.has(type)) throw new Error(`event type already registered: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }

  get(type: string): Handler<W> {
    const h = this.handlers.get(type);
    if (!h) throw new Error(`no handler registered for event type: ${type}`);
    return h;
  }
}
