import type { EngineState } from './events.js';

/** Serialise state (including queue and RNG) for a snapshot. */
export function serialize<W>(state: EngineState<W>): string {
  return JSON.stringify(state);
}

/** Restore a state saved by `serialize`. */
export function deserialize<W>(text: string): EngineState<W> {
  return JSON.parse(text) as EngineState<W>;
}
