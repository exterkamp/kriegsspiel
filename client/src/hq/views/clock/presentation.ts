import type { SourceState } from '../../contracts';
import { projectGameTime } from '../../data/fixture';

export function validGameTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Parent supplies the shared projection. This view never samples a clock. */
export function clockDisplay(state: SourceState, kind: 'fixture' | 'live', gameMs: number | null) {
  const snapshot = state.snapshot;
  const clock = snapshot?.clock;
  const frozen = clock ? projectGameTime(state, kind, clock.receivedMonotonicMs) : null;
  const anchor =
    clock && validGameTime(clock.authoritativeGameMs) && validGameTime(frozen) ? frozen : null;
  const eligible = Boolean(
    clock &&
    snapshot &&
    anchor !== null &&
    validGameTime(snapshot.atGame) &&
    snapshot.atGame === clock.authoritativeGameMs &&
    Number.isFinite(clock.receivedMonotonicMs) &&
    Number.isFinite(clock.rate) &&
    clock.rate > 0 &&
    kind === 'fixture' &&
    state.connection === 'ready' &&
    !state.stale &&
    clock.coherence === 'fixture-atomic' &&
    clock.status === 'running' &&
    clock.mode === 'realtime' &&
    clock.barrier?.kind === 'clear',
  );
  const projected = eligible && validGameTime(gameMs) && anchor !== null && gameMs >= anchor;
  return { time: projected ? gameMs : anchor, projected, eligible };
}

export function formatGameTime(value: number | null) {
  if (!validGameTime(value)) return 'Unavailable';
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')} (${value} game ms)`;
}
