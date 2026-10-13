/** Pure lobby rules, shared by the screens and their tests. */
import { turnSettingsOf } from '@kriegsspiel/protocol';
import type { GameInfo, GameSummary, SessionType } from './api.js';

export const RATE_PRESETS = [1, 4, 12] as const;

export const SESSION_LABELS: Record<SessionType, string> = {
  team_vs_team: 'Team vs team',
  co_op_vs_ai: 'Co-op vs computer opponent',
  hot_seat: 'Hot-seat (one machine)',
};

/** Slowest and fastest custom ratio the server accepts. */
export const MIN_RATE = 0.01;
export const MAX_RATE = 86_400;

/** `1`, `4`, `12` or a custom number; undefined when it is not a usable ratio. */
export function parseRate(text: string): number | undefined {
  const n = Number(text.trim().replace(/:1$/, ''));
  return Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE ? n : undefined;
}

export const rateLabel = (rate: number): string => `${rate}:1`;

/**
 * How the game is paced, for its title: the clock rate, or for a turn-mode game (D39) its turns,
 * `turns of 20 min` or `turns of 20 min, orders due in 24 h`. A started turn game counts its turns
 * (#429): `3 turns of 20 min` once over (no deadline then), `turn 3, turns of 20 min` while it is played.
 */
export function paceLabel(
  g: Pick<GameSummary, 'rate' | 'umpire'> &
    Partial<Pick<GameSummary, 'status'>> & { finished?: boolean; gameTimeMs?: number },
): string {
  const t = turnSettingsOf(g.umpire);
  if (!t) return rateLabel(g.rate);
  const due = t.turnDeadlineHours === undefined ? '' : `, orders due in ${t.turnDeadlineHours} h`;
  const turns = `turns of ${t.turnMinutes} min${due}`;
  if (g.status !== 'started' || g.gameTimeMs === undefined) return turns;
  const turnMs = t.turnMinutes * 60_000;
  if (g.finished) {
    // The last turn may end early, at the time limit or at the victory.
    const n = Math.max(1, Math.ceil(g.gameTimeMs / turnMs));
    // No orders are due on a game that is over.
    return `${n} ${n === 1 ? 'turn' : 'turns'} of ${t.turnMinutes} min`;
  }
  return `turn ${Math.floor(g.gameTimeMs / turnMs) + 1}, ${turns}`;
}

/** What the start button should do now: ready, or the reason it is not. */
export function startBlocker(info: GameInfo): string | undefined {
  if (!info.creator) return 'Only the person who made the game can start it.';
  if (info.status !== 'lobby') return 'The game has started.';
  const open = info.sides.filter((s) => !s.taken).map((s) => s.side);
  if (open.length > 0) return `Waiting for a player on ${open.join(' and ')}.`;
  const waiting = info.sides.filter((s) => !s.ready).map((s) => s.side);
  if (waiting.length > 0) return `Waiting for ${waiting.join(' and ')} to be ready.`;
  return undefined;
}

/** The link to send a friend: it opens the game and takes a free side. */
export const inviteLink = (origin: string, gameId: string): string =>
  `${origin}/?game=${encodeURIComponent(gameId)}`;
