/**
 * PauseVoting: the game-wide pause state machine. See docs/architecture.md (Pause and voting),
 * docs/decisions.md D5.
 *
 *   running ──propose──► pause_proposed ──enough yes──► paused ──propose resume──► resume_proposed
 *      ▲                      │ no / timeout                ▲                           │
 *      │                      └──────► running              └── no / timeout ◄──────────┘
 *      └─────────────── resume vote passes, or the maximum pause length is up ◄───────┘
 *
 * Pure: it never reads the wall clock, every method takes `nowMs`. It does not touch the game
 * clock either; it reports each transition and the actor pauses or resumes the clock to match.
 * Voters are the human players of all sides. One "no" cancels, unless the host chose majority.
 */

export type PausePhase = 'running' | 'pause_proposed' | 'paused' | 'resume_proposed';

export type VoteRule = 'unanimous' | 'majority';

export interface PauseConfig {
  /** Player ids that vote: every human across all sides. */
  voters: readonly string[];
  /** `unanimous` (default): one "no" cancels. `majority`: more than half of the voters decide. */
  rule?: VoteRule;
  /** Wall ms a proposal stays open before it is cancelled. Default 60,000. */
  voteTimeoutMs?: number;
  /** Wall ms a pause may last before the game resumes by itself. Unset: no limit. */
  maxPauseMs?: number;
}

export const DEFAULT_VOTE_TIMEOUT_MS = 60_000;

/** Why the machine moved. Logged to the journal with the transition. */
export type PauseCause =
  'proposed' | 'all-yes' | 'majority-yes' | 'no-vote' | 'timeout' | 'max-pause' | 'forced';

/** One step of the machine, recorded in the input log. */
export interface PauseTransition {
  from: PausePhase;
  to: PausePhase;
  cause: PauseCause;
  /** The proposal this step belongs to, if any. */
  proposal?: string;
  by?: string;
}

interface Proposal {
  id: string;
  by: string;
  reason?: string;
  votes: Map<string, boolean>;
  deadlineMs: number;
}

/**
 * How a vote stands: `fail` when it can no longer pass, a passing cause, or undefined while open.
 * Shared by the pause vote and the ratio vote (`ratioVote.ts`), so both follow one rule.
 */
export function tallyVotes(
  rule: VoteRule,
  voters: number,
  yes: number,
  no: number,
): 'fail' | 'all-yes' | 'majority-yes' | undefined {
  if (rule === 'unanimous') {
    if (no > 0) return 'fail';
    return yes === voters ? 'all-yes' : undefined;
  }
  if (yes * 2 > voters) return yes === voters ? 'all-yes' : 'majority-yes';
  // Even if everyone left voted yes it could not pass.
  return (voters - no) * 2 <= voters ? 'fail' : undefined;
}

export class PauseVoting {
  private current: PausePhase;
  private proposal: Proposal | undefined;
  /** Wall time the current pause began, for the maximum pause length. */
  private pausedAtMs: number | undefined;
  private voters: readonly string[];
  private readonly rule: VoteRule;
  private readonly voteTimeoutMs: number;
  private readonly maxPauseMs: number | undefined;

  constructor(config: PauseConfig, start: { phase: 'running' | 'paused'; nowMs: number }) {
    this.voters = [...new Set(config.voters)];
    this.rule = config.rule ?? 'unanimous';
    this.voteTimeoutMs = config.voteTimeoutMs ?? DEFAULT_VOTE_TIMEOUT_MS;
    this.maxPauseMs = config.maxPauseMs;
    this.current = start.phase;
    // A game reopened after downtime starts paused, and the limit counts from now.
    if (start.phase === 'paused') this.pausedAtMs = start.nowMs;
  }

  get phase(): PausePhase {
    return this.current;
  }

  /**
   * The players who vote changed (someone took a role or gave one up mid-game, D6e). A vote cast
   * by one who is gone is dropped; an open vote is not re-counted, so it settles on the next vote
   * or runs out its timer.
   */
  setVoters(voters: readonly string[]): void {
    this.voters = [...new Set(voters)];
    for (const player of [...(this.proposal?.votes.keys() ?? [])]) {
      if (!this.voters.includes(player)) this.proposal?.votes.delete(player);
    }
  }

  /** How many players vote. */
  get voterCount(): number {
    return this.voters.length;
  }

  /** The open proposal, if any: who asked, why, and the votes so far. */
  get open():
    | {
        id: string;
        by: string;
        reason?: string;
        votes: Record<string, boolean>;
        deadlineMs: number;
      }
    | undefined {
    const p = this.proposal;
    return (
      p && {
        id: p.id,
        by: p.by,
        ...(p.reason === undefined ? {} : { reason: p.reason }),
        votes: Object.fromEntries(p.votes),
        deadlineMs: p.deadlineMs,
      }
    );
  }

  /** Wall time the current pause runs out, if a maximum length is set. */
  private get pauseLimitMs(): number | undefined {
    const paused = this.current === 'paused' || this.current === 'resume_proposed';
    return paused && this.maxPauseMs !== undefined && this.pausedAtMs !== undefined
      ? this.pausedAtMs + this.maxPauseMs
      : undefined;
  }

  /** Wall time of the next thing that happens by itself (a vote closing, the pause running out). */
  get deadlineMs(): number | undefined {
    const all = [this.proposal?.deadlineMs, this.pauseLimitMs].filter((d) => d !== undefined);
    return all.length === 0 ? undefined : Math.min(...all);
  }

  private requireVoter(player: string): void {
    if (!this.voters.includes(player)) throw new Error(`${player} is not a voter in this game`);
  }

  private move(to: PausePhase, cause: PauseCause, nowMs: number, extra: Partial<PauseTransition>) {
    const t: PauseTransition = { from: this.current, to, cause, ...extra };
    this.current = to;
    if (to === 'paused' && t.from !== 'resume_proposed') this.pausedAtMs = nowMs;
    if (to === 'running') this.pausedAtMs = undefined;
    if (to === 'paused' || to === 'running') this.proposal = undefined;
    return t;
  }

  /** Ask to pause (from running) or to resume (from paused). The proposer's own vote is yes. */
  propose(id: string, by: string, nowMs: number, reason?: string): PauseTransition {
    this.requireVoter(by);
    const resuming = this.current === 'paused';
    if (this.current !== 'running' && !resuming) {
      throw new Error(`cannot propose in state ${this.current}`);
    }
    this.proposal = {
      id,
      by,
      ...(reason === undefined ? {} : { reason }),
      votes: new Map([[by, true]]),
      deadlineMs: nowMs + this.voteTimeoutMs,
    };
    const step = this.move(resuming ? 'resume_proposed' : 'pause_proposed', 'proposed', nowMs, {
      proposal: id,
      by,
    });
    // A lone voter decides at once.
    return this.decide(nowMs) ?? step;
  }

  /** Cast a vote on the open proposal. Returns the steps taken (the vote may settle the proposal). */
  vote(player: string, proposal: string, yes: boolean, nowMs: number): PauseTransition[] {
    this.requireVoter(player);
    const p = this.proposal;
    if (!p || p.id !== proposal) throw new Error(`no open proposal ${proposal}`);
    if (p.votes.has(player)) throw new Error(`${player} has already voted on ${proposal}`);
    // The expiry timer may not have run yet: a late vote finds the proposal already timed out.
    if (nowMs >= p.deadlineMs) {
      const expired = this.expire(nowMs);
      if (expired) return [expired];
    }
    p.votes.set(player, yes);
    const settled = this.decide(nowMs, player);
    return settled ? [settled] : [];
  }

  /** Settle the open proposal if its votes decide it. */
  private decide(nowMs: number, by?: string): PauseTransition | undefined {
    const p = this.proposal;
    if (!p) return undefined;
    const n = this.voters.length;
    const yes = [...p.votes.values()].filter((v) => v).length;
    const no = p.votes.size - yes;
    const resuming = this.current === 'resume_proposed';
    const extra = { proposal: p.id, ...(by === undefined ? {} : { by }) };
    const passed = (cause: PauseCause) =>
      this.move(resuming ? 'running' : 'paused', cause, nowMs, extra);
    const failed = () => this.move(resuming ? 'paused' : 'running', 'no-vote', nowMs, extra);
    const verdict = tallyVotes(this.rule, n, yes, no);
    if (verdict === 'fail') return failed();
    if (verdict === 'all-yes' || verdict === 'majority-yes') return passed(verdict);
    return undefined;
  }

  /** Whether `expire` would do anything at `nowMs`. */
  isDue(nowMs: number): boolean {
    const d = this.deadlineMs;
    return d !== undefined && nowMs >= d;
  }

  /** A deadline passed: the pause hit its maximum length, or the open vote times out (cancels). */
  expire(nowMs: number): PauseTransition | undefined {
    const limit = this.pauseLimitMs;
    const proposal = this.proposal?.id;
    if (limit !== undefined && nowMs >= limit) {
      return this.move('running', 'max-pause', nowMs, proposal === undefined ? {} : { proposal });
    }
    if (this.proposal && nowMs >= this.proposal.deadlineMs) {
      return this.move(this.current === 'pause_proposed' ? 'running' : 'paused', 'timeout', nowMs, {
        proposal,
      });
    }
    return undefined;
  }

  /** The host or the server set the clock directly (the `pause` / `resume` commands). */
  force(to: 'running' | 'paused', nowMs: number): PauseTransition | undefined {
    if (this.current === to) return undefined;
    return this.move(to, 'forced', nowMs, {});
  }
}
