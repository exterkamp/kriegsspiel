import type { StaffRole } from '@kriegsspiel/protocol';
import type { SideId } from '@kriegsspiel/engine';

/** Game time a question takes each officer to answer (D6b). The same at every clock rate. */
export const STAFF_QUESTION_COST_MS: Readonly<Record<StaffRole, number>> = {
  chiefOfStaff: 10 * 60_000,
  intelligence: 15 * 60_000,
  quartermaster: 10 * 60_000,
  engineer: 20 * 60_000,
};

/**
 * Game time the chief of staff spends reading a draft (the staff check, D6d). It is the chief of
 * staff's time, so it shares the officer's busy state with conference questions.
 */
export const DRAFT_CHECK_COST_MS = 10 * 60_000;

export type StaffCharge =
  | { ok: true; askedAtGame: number; answerAtGame: number; costMs: number }
  | { ok: false; busyUntilGame: number };

/**
 * Which officers are busy, per game and side. An officer taking a question is busy until game time
 * reaches `answerAtGame`; the deadline is in game time, so a pause holds it and a faster clock shortens it.
 */
export class StaffDesk {
  private readonly busyUntil = new Map<string, number>();

  ask(
    gameId: string,
    side: SideId,
    role: StaffRole,
    nowGame: number,
    costMs: number = STAFF_QUESTION_COST_MS[role],
  ): StaffCharge {
    const key = `${gameId}\0${side}\0${role}`;
    const until = this.busyUntil.get(key);
    if (until !== undefined && nowGame < until) return { ok: false, busyUntilGame: until };
    const answerAtGame = nowGame + costMs;
    this.busyUntil.set(key, answerAtGame);
    return { ok: true, askedAtGame: nowGame, answerAtGame, costMs };
  }
}
