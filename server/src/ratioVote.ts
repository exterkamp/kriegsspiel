/**
 * RatioVoting: vote to change the clock ratio mid-game. See docs/gameplay.md (Changing the
 * ratio), docs/decisions.md D5.
 *
 * Same voters and rules as the pause vote (`PauseConfig`: unanimous or majority, the vote
 * timeout), but a simpler machine: at most one proposal is open, and it ends passed, failed or
 * timed out. Pure: every method takes `nowMs`, and it never touches the game clock; the actor
 * applies a passed ratio with `GameClock.setRate`, which re-anchors so game time never jumps.
 */
import { DEFAULT_VOTE_TIMEOUT_MS, tallyVotes, type PauseConfig, type VoteRule } from './pause.js';

export type RatioOutcome = 'proposed' | 'passed' | 'failed' | 'timeout';

/** One step of the machine, recorded in the input log. */
export interface RatioTransition {
  outcome: RatioOutcome;
  proposal: string;
  /** The ratio proposed (game seconds per wall second). */
  rate: number;
  by?: string;
  /** For `passed` and `failed`: why. */
  cause?: 'all-yes' | 'majority-yes' | 'no-vote';
}

interface Proposal {
  id: string;
  by: string;
  rate: number;
  votes: Map<string, boolean>;
  deadlineMs: number;
}

export class RatioVoting {
  private proposal: Proposal | undefined;
  private readonly voters: readonly string[];
  private readonly rule: VoteRule;
  private readonly voteTimeoutMs: number;

  constructor(config: PauseConfig) {
    this.voters = [...new Set(config.voters)];
    this.rule = config.rule ?? 'unanimous';
    this.voteTimeoutMs = config.voteTimeoutMs ?? DEFAULT_VOTE_TIMEOUT_MS;
  }

  /** The open proposal, if any: who asked, the ratio, and the votes so far. */
  get open():
    | { id: string; by: string; rate: number; votes: Record<string, boolean>; deadlineMs: number }
    | undefined {
    const p = this.proposal;
    return (
      p && {
        id: p.id,
        by: p.by,
        rate: p.rate,
        votes: Object.fromEntries(p.votes),
        deadlineMs: p.deadlineMs,
      }
    );
  }

  /** Wall time the open vote closes. */
  get deadlineMs(): number | undefined {
    return this.proposal?.deadlineMs;
  }

  private requireVoter(player: string): void {
    if (!this.voters.includes(player)) throw new Error(`${player} is not a voter in this game`);
  }

  private end(
    outcome: 'passed' | 'failed' | 'timeout',
    p: Proposal,
    extra: Partial<RatioTransition>,
  ): RatioTransition {
    this.proposal = undefined;
    return { outcome, proposal: p.id, rate: p.rate, ...extra };
  }

  /** Ask for a new ratio. The proposer's own vote is yes. `currentRate` is the ratio now. */
  propose(
    id: string,
    by: string,
    rate: number,
    currentRate: number,
    nowMs: number,
  ): RatioTransition {
    this.requireVoter(by);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RangeError(`rate must be a positive finite number, got ${rate}`);
    }
    if (this.proposal) throw new Error('a ratio vote is already open');
    if (rate === currentRate) throw new Error(`the ratio is already ${rate}`);
    this.proposal = {
      id,
      by,
      rate,
      votes: new Map([[by, true]]),
      deadlineMs: nowMs + this.voteTimeoutMs,
    };
    // A lone voter decides at once.
    return this.decide(by) ?? { outcome: 'proposed', proposal: id, rate, by };
  }

  /** Cast a vote on the open proposal. Returns the steps taken (the vote may settle it). */
  vote(player: string, proposal: string, yes: boolean, nowMs: number): RatioTransition[] {
    this.requireVoter(player);
    const p = this.proposal;
    if (!p || p.id !== proposal) throw new Error(`no open ratio proposal ${proposal}`);
    if (p.votes.has(player)) throw new Error(`${player} has already voted on ${proposal}`);
    // The expiry timer may not have run yet: a late vote finds the proposal already timed out.
    if (nowMs >= p.deadlineMs) {
      const expired = this.expire(nowMs);
      if (expired) return [expired];
    }
    p.votes.set(player, yes);
    const settled = this.decide(player);
    return settled ? [settled] : [];
  }

  private decide(by: string): RatioTransition | undefined {
    const p = this.proposal;
    if (!p) return undefined;
    const yes = [...p.votes.values()].filter((v) => v).length;
    const verdict = tallyVotes(this.rule, this.voters.length, yes, p.votes.size - yes);
    if (verdict === 'fail') return this.end('failed', p, { by, cause: 'no-vote' });
    return verdict === undefined ? undefined : this.end('passed', p, { by, cause: verdict });
  }

  /** Whether `expire` would do anything at `nowMs`. */
  isDue(nowMs: number): boolean {
    return this.proposal !== undefined && nowMs >= this.proposal.deadlineMs;
  }

  /** The open vote ran out of time: it is cancelled and the ratio stays. */
  expire(nowMs: number): RatioTransition | undefined {
    const p = this.proposal;
    return p && nowMs >= p.deadlineMs ? this.end('timeout', p, {}) : undefined;
  }
}
