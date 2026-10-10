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
  kind: 'rate' | 'pause' | 'resume' | 'stop' | 'mode' | 'advance' | 'barrier';
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
  /** Highest game time reported so far, so a wall source stepping back never rewinds `now()`. */
  private highWater: number;
  /** Game time the clock may not pass: the earliest unresolved LLM dependency (the LLM barrier). */
  private barrierMs: number | undefined;

  constructor(
    private readonly wallNow: WallClock,
    options: GameClockOptions = {},
  ) {
    const rate = options.rate ?? 1;
    assertRate(rate);
    if (options.gameMs !== undefined && !Number.isFinite(options.gameMs)) {
      throw new RangeError(`gameMs must be finite, got ${options.gameMs}`);
    }
    this.clockMode = options.mode ?? 'realtime';
    this.state = {
      gameMsAtAnchor: options.gameMs ?? 0,
      wallMsAtAnchor: wallNow(),
      rate,
      status: options.status ?? 'running',
    };
    this.highWater = this.state.gameMsAtAnchor;
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

  /** Copy of every clock change so far, with its wall time (for the clock history log). */
  history(): readonly ClockChange[] {
    return this.changes.map((c) => ({ ...c }));
  }

  private get following(): boolean {
    return this.clockMode === 'realtime' && this.state.status === 'running';
  }

  /** Wall ms since the anchor, clamped at 0 so a wall source stepping back never moves game time back. */
  private wallElapsed(wallMs: number): number {
    return Math.max(0, wallMs - this.state.wallMsAtAnchor);
  }

  /** The barrier, if one is set. Game time never passes it. */
  get barrier(): number | undefined {
    return this.barrierMs;
  }

  /** Current game time in ms: the clock's own reading, held at the barrier if there is one. */
  now(): number {
    const cap = this.barrierMs ?? Infinity;
    if (!this.following) return Math.min(this.state.gameMsAtAnchor, cap);
    const t = this.state.gameMsAtAnchor + this.wallElapsed(this.wallNow()) * this.state.rate;
    this.highWater = Math.max(this.highWater, Math.min(t, cap));
    return this.highWater;
  }

  /** Game time at an arbitrary wall time, assuming the clock keeps its current settings. */
  gameMsAtWall(wallMs: number): number {
    const cap = this.barrierMs ?? Infinity;
    if (!this.following) return Math.min(this.state.gameMsAtAnchor, cap);
    return Math.min(this.state.gameMsAtAnchor + this.wallElapsed(wallMs) * this.state.rate, cap);
  }

  /**
   * Wall time at which game time reaches `gameMs`, for the scheduler.
   * May be in the past if already due. Infinity if it will never be reached without
   * outside action (paused, stopped, manual), unless the game time is already reached.
   * Fast-forward never waits, so it returns the current wall time.
   * Infinity for any time past the barrier, which only a result arriving can lift.
   */
  wallDueFor(gameMs: number): number {
    if (this.barrierMs !== undefined && gameMs > this.barrierMs) return Infinity;
    if (this.clockMode === 'fast-forward' && this.state.status === 'running') return this.wallNow();
    if (this.following) {
      return this.state.wallMsAtAnchor + (gameMs - this.state.gameMsAtAnchor) / this.state.rate;
    }
    return gameMs <= this.state.gameMsAtAnchor ? this.state.wallMsAtAnchor : Infinity;
  }

  /**
   * Re-anchor at `gameMs` (default: the current game time) and apply `patch` to the
   * rate, status and mode, recording one history entry with the new values.
   */
  private reanchor(
    kind: ClockChange['kind'],
    patch: { rate?: number; status?: ClockStatus; mode?: ClockMode } = {},
    gameMs = this.now(),
  ): void {
    const wallMs = this.wallNow();
    this.highWater = gameMs;
    this.clockMode = patch.mode ?? this.clockMode;
    this.state = {
      gameMsAtAnchor: gameMs,
      wallMsAtAnchor: wallMs,
      rate: patch.rate ?? this.state.rate,
      status: patch.status ?? this.state.status,
    };
    this.changes.push({
      wallMs,
      gameMs,
      kind,
      rate: this.state.rate,
      status: this.state.status,
      mode: this.clockMode,
    });
  }

  /**
   * Hold game time at `gameMs` (the LLM barrier), or lift the hold with `undefined`. Re-anchors at
   * the current game time first, so game time stalls at the barrier and, when it is lifted or
   * raised, carries on from where it stopped instead of jumping to catch up with the wall.
   */
  setBarrier(gameMs: number | undefined): void {
    if (gameMs === this.barrierMs) return;
    if (gameMs !== undefined && !(gameMs >= this.now())) {
      throw new RangeError(`barrier ${gameMs} is before the current game time ${this.now()}`);
    }
    this.reanchor('barrier');
    this.barrierMs = gameMs;
  }

  /**
   * Hold game time at its current reading and return that time. One step, so a caller that wants
   * "stall here" never passes a reading the wall clock has since moved past (see `setBarrier`).
   * The barrier can only move earlier this way: the reading is already capped by any barrier.
   */
  holdAtNow(): number {
    const t = this.now();
    if (t !== this.barrierMs) {
      this.reanchor('barrier', {}, t);
      this.barrierMs = t;
    }
    return t;
  }

  setRate(rate: number): void {
    assertRate(rate);
    this.reanchor('rate', { rate });
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.reanchor('pause', { status: 'paused' });
  }

  resume(): void {
    if (this.state.status === 'stopped') throw new Error('clock is stopped');
    if (this.state.status !== 'paused') return;
    this.reanchor('resume', { status: 'running' });
  }

  /** Permanently freeze the clock (game over). */
  stop(): void {
    if (this.state.status === 'stopped') return;
    this.reanchor('stop', { status: 'stopped' });
  }

  setMode(mode: ClockMode): void {
    if (mode === this.clockMode) return;
    this.reanchor('mode', { mode });
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
    // A manual advance stalls at the barrier like everything else.
    this.reanchor('advance', {}, Math.min(gameMs, this.barrierMs ?? Infinity));
  }

  /** Manual and fast-forward modes: advance game time by `dtMs`. */
  step(dtMs: number): void {
    this.advanceTo(this.now() + dtMs);
  }
}
