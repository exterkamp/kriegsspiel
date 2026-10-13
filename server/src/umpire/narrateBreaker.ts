/**
 * The narrate stage's circuit breaker (#419). A small local model can fail the checks or time out
 * on most calls, and every failed call holds game time for nothing. When most of the recent calls
 * fail, the breaker opens and the stage stops calling the model for a cooling-off period in game
 * time; the reports keep their template text. After it the breaker closes with a clean slate and
 * the model gets another chance.
 *
 * Everything here is a pure function of the call outcomes and the game time they were recorded at,
 * so the decision is deterministic. The actor logs the state after every window (`InputLogEntry.
 * narrateBreaker`) and a reopened game starts from the last one.
 */
import { MS_PER_MINUTE } from '@kriegsspiel/engine';

/** Calls looked back over. */
export const BREAKER_RECENT = 5;
/** Failures among the last `BREAKER_RECENT` calls that open the breaker. */
export const BREAKER_FAILURES = 3;
/** Narration windows the breaker stays open for, at the rate it opened at. */
export const BREAKER_COOLDOWN_WINDOWS = 3;
/** The shortest cooling-off, in game time, whatever the window. */
export const BREAKER_MIN_COOLDOWN_MS = 15 * MS_PER_MINUTE;

/** The breaker's whole state; plain data, so it goes into the input log as it is. */
export interface NarrateBreakerState {
  /** Outcome of each recent model call, oldest first (true: it passed the checks). At most `BREAKER_RECENT`. */
  recent: boolean[];
  /** Calls and failures since the breaker last closed, for the admin panel's "5 of 6 failed". */
  calls: number;
  failed: number;
  /** Set while open: the game time the model may be called again. */
  pausedUntil?: number;
}

export function closedBreaker(): NarrateBreakerState {
  return { recent: [], calls: 0, failed: 0 };
}

/** Whether the model may be called at game time `now`. */
export function breakerAllows(state: NarrateBreakerState, now: number): boolean {
  return state.pausedUntil === undefined || now >= state.pausedUntil;
}

/**
 * The state at `now`: an open breaker whose cooling-off has run out closes again with no history,
 * so one bad call after it does not reopen it at once.
 */
export function breakerAt(state: NarrateBreakerState, now: number): NarrateBreakerState {
  return state.pausedUntil !== undefined && now >= state.pausedUntil ? closedBreaker() : state;
}

/**
 * Record one model call's outcome at game time `now`. Opens the breaker, until `now + cooldownMs`,
 * when `BREAKER_FAILURES` of the last `BREAKER_RECENT` calls failed.
 */
export function recordNarrateCall(
  state: NarrateBreakerState,
  ok: boolean,
  now: number,
  cooldownMs: number,
): NarrateBreakerState {
  const current = breakerAt(state, now);
  const recent = [...current.recent, ok].slice(-BREAKER_RECENT);
  const next: NarrateBreakerState = {
    recent,
    calls: current.calls + 1,
    failed: current.failed + (ok ? 0 : 1),
  };
  if (current.pausedUntil !== undefined) return { ...next, pausedUntil: current.pausedUntil };
  if (recent.filter((r) => !r).length >= BREAKER_FAILURES) {
    next.pausedUntil = now + cooldownMs;
  }
  return next;
}

/** Cooling-off for a game whose narration window is `windowMs` long: pass to `recordNarrateCall`. */
export function breakerCooldownMs(windowMs: number): number {
  return Math.max(BREAKER_MIN_COOLDOWN_MS, BREAKER_COOLDOWN_WINDOWS * windowMs);
}

/** "model narration paused: 5 of 6 failed", for the admin LLM panel and the log. */
export function breakerSummary(state: NarrateBreakerState): string {
  return `model narration paused: ${state.failed} of ${state.calls} failed`;
}
