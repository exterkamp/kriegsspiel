/** Pure lobby rules, shared by the screens and their tests. */
import type { GameInfo, SessionType } from './api.js';

export const RATE_PRESETS = [1, 4, 12] as const;

export const SESSION_LABELS: Record<SessionType, string> = {
  team_vs_team: 'Team vs team',
  co_op_vs_ai: 'Co-op vs AI commander',
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
