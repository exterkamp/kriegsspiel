/**
 * GameClock: maps wall time to game time. See docs/architecture.md (The game clock).
 *
 * Pure: it never reads the wall clock itself, it calls the injected `WallClock`.
 * Every change (rate, pause, resume, mode, advance) re-anchors at the current game
 * time, so game time never jumps.
 */

/** Returns the current wall time in ms. */
export type WallClock = () => number;

export type ClockStatus = 'running' | 'paused' | 'stopped';

/**
 * realtime: game time follows wall time at `rate` (1, 4, 12, any).
 * manual: game time moves only through `advanceTo` / `step`.
 * fast-forward: like manual, but nothing is ever waited for (`wallDueFor` is "now").
 */
export type ClockMode = 'realtime' | 'manual' | 'fast-forward';

export type ClockState = {
  gameMsAtAnchor: number;
  wallMsAtAnchor: number;
  /** Game seconds per wall second. */
  rate: number;
  status: ClockStatus;
};

export type ClockChange = {
  wallMs: number;
  gameMs: number;
  kind: 'rate' | 'pause' | 'resume' | 'stop' | 'mode' | 'advance';
  rate: number;
  status: ClockStatus;
  mode: ClockMode;
};

export type GameClockOptions = {
  gameMs?: number;
  rate?: number;
  mode?: ClockMode;
  status?: ClockStatus;
};

function assertRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`rate must be a positive finite number, got ${rate}`);
  }
}

export class GameClock {
  private state: ClockState;
  private clockMode: ClockMode;
  private readonly changes: ClockChange[] = [];

  constructor(
    private readonly wallNow: WallClock,
    options: GameClockOptions = {},
  ) {
    const rate = options.rate ?? 1;
    assertRate(rate);
    this.clockMode = options.mode ?? 'realtime';
    this.state = {
      gameMsAtAnchor: options.gameMs ?? 0,
      wallMsAtAnchor: wallNow(),
      rate,
      status: options.status ?? 'running',
    };
  }

  get mode(): ClockMode {
    return this.clockMode;
  }

  get rate(): number {
    return this.state.rate;
  }

  get status(): ClockStatus {
    return this.state.status;
  }

  /** Snapshot of the anchor state. */
  snapshot(): ClockState {
    return { ...this.state };
  }

  /** Every clock change so far, with its wall time (for the clock history log). */
  history(): readonly ClockChange[] {
    return this.changes;
  }

  private get following(): boolean {
    return this.clockMode === 'realtime' && this.state.status === 'running';
  }

  /** Current game time in ms. */
  now(): number {
    if (!this.following) return this.state.gameMsAtAnchor;
    return (
      this.state.gameMsAtAnchor + (this.wallNow() - this.state.wallMsAtAnchor) * this.state.rate
    );
  }

  /** Game time at an arbitrary wall time, assuming the clock keeps its current settings. */
  gameMsAtWall(wallMs: number): number {
    if (!this.following) return this.state.gameMsAtAnchor;
    return this.state.gameMsAtAnchor + (wallMs - this.state.wallMsAtAnchor) * this.state.rate;
  }

  /**
   * Wall time at which game time reaches `gameMs`, for the scheduler.
   * May be in the past if already due. Infinity if it will never be reached without
   * outside action (paused, stopped, manual), unless the game time is already reached.
   * Fast-forward never waits, so it returns the current wall time.
   */
  wallDueFor(gameMs: number): number {
    if (this.clockMode === 'fast-forward' && this.state.status === 'running') return this.wallNow();
    if (this.following) {
      return this.state.wallMsAtAnchor + (gameMs - this.state.gameMsAtAnchor) / this.state.rate;
    }
    return gameMs <= this.state.gameMsAtAnchor ? this.state.wallMsAtAnchor : Infinity;
  }

  private reanchor(kind: ClockChange['kind'], gameMs = this.now()): void {
    const wallMs = this.wallNow();
    this.state = { ...this.state, gameMsAtAnchor: gameMs, wallMsAtAnchor: wallMs };
    this.changes.push({
      wallMs,
      gameMs,
      kind,
      rate: this.state.rate,
      status: this.state.status,
      mode: this.clockMode,
    });
  }

  setRate(rate: number): void {
    assertRate(rate);
    this.reanchor('rate');
    this.state.rate = rate;
    this.changes[this.changes.length - 1]!.rate = rate;
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.reanchor('pause');
    this.state.status = 'paused';
    this.changes[this.changes.length - 1]!.status = 'paused';
  }

  resume(): void {
    if (this.state.status === 'stopped') throw new Error('clock is stopped');
    if (this.state.status !== 'paused') return;
    this.reanchor('resume');
    this.state.status = 'running';
    this.changes[this.changes.length - 1]!.status = 'running';
  }

  /** Permanently freeze the clock (game over). */
  stop(): void {
    if (this.state.status === 'stopped') return;
    this.reanchor('stop');
    this.state.status = 'stopped';
    this.changes[this.changes.length - 1]!.status = 'stopped';
  }

  setMode(mode: ClockMode): void {
    if (mode === this.clockMode) return;
    this.reanchor('mode');
    this.clockMode = mode;
    this.changes[this.changes.length - 1]!.mode = mode;
  }

  /** Manual and fast-forward modes: move game time to `gameMs`. Never backwards. */
  advanceTo(gameMs: number): void {
    if (this.clockMode === 'realtime')
      throw new Error('advanceTo requires manual or fast-forward mode');
    if (this.state.status !== 'running') throw new Error(`clock is ${this.state.status}`);
    if (!Number.isFinite(gameMs)) throw new RangeError(`gameMs must be finite, got ${gameMs}`);
    if (gameMs < this.state.gameMsAtAnchor) {
      throw new RangeError(
        `cannot move game time backwards (${gameMs} < ${this.state.gameMsAtAnchor})`,
      );
    }
    this.reanchor('advance', gameMs);
  }

  /** Manual and fast-forward modes: advance game time by `dtMs`. */
  step(dtMs: number): void {
    this.advanceTo(this.now() + dtMs);
  }
}
