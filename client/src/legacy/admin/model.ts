/** Pure helpers for the admin page (Epic #119, story 8.3). The DOM wiring lives in `admin.ts`. */

export const PANELS = ['State', 'Events', 'Requests', 'LLM', 'Replay', 'Orders'] as const;
export type PanelId = (typeof PANELS)[number];

export type LinkStatus = 'connecting' | 'live' | 'reconnecting' | 'disabled' | 'unauthorized';

export interface GameSummary {
  id: string;
  open: boolean;
  gameMs?: number;
  clock?: { rate?: number; status?: string };
  entries: number;
}

export function linkLabel(status: LinkStatus): string {
  switch (status) {
    case 'live':
      return 'live';
    case 'connecting':
      return 'connecting…';
    case 'reconnecting':
      return 'reconnecting…';
    case 'disabled':
      return 'admin disabled';
    case 'unauthorized':
      return 'unauthorized';
  }
}

/** Next panel for a keyboard move along the tab list; wraps at both ends. */
export function stepPanel(current: PanelId, delta: number): PanelId {
  const i = PANELS.indexOf(current);
  return PANELS[(i + delta + PANELS.length) % PANELS.length]!;
}

/** The panel for a digit key `1`-`6`, if any. */
export function panelForKey(key: string): PanelId | undefined {
  const n = Number(key);
  return Number.isInteger(n) ? PANELS[n - 1] : undefined;
}

export function gameLabel(g: GameSummary): string {
  const short = g.id.slice(0, 8);
  const rate = g.clock?.rate !== undefined ? ` ×${g.clock.rate}` : '';
  return `${short}${g.open ? '' : ' (closed)'}${rate} · ${g.entries} entries`;
}

/** Keeps the current selection if it still exists, else the first game, else none. */
export function pickGame(games: GameSummary[], current: string | undefined): string | undefined {
  if (current && games.some((g) => g.id === current)) return current;
  return games[0]?.id;
}

/** The game to open on, from `?game=` on the page URL (the "Debug this game" links). */
export function adminGame(search: string): string | undefined {
  return new URLSearchParams(search).get('game') || undefined;
}

/** Token for the admin API, from `?token=` on the page URL. */
export function adminToken(search: string): string | undefined {
  return new URLSearchParams(search).get('token') || undefined;
}

export function apiUrl(
  path: string,
  token: string | undefined,
  query: Record<string, string> = {},
): string {
  const q = new URLSearchParams(query);
  if (token) q.set('token', token);
  const qs = q.toString();
  return `/admin/api/${path}${qs ? `?${qs}` : ''}`;
}

/** Reconnect delay: 1s, doubling to a 10s cap. */
export function backoffMs(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** Math.max(0, attempt));
}

export type MarkKind = 'input' | 'event' | 'contact' | 'order' | 'llm';

export interface ReplayMark {
  ms: number;
  kind: MarkKind;
  label: string;
}

/** Index of the first mark strictly after `ms` (of `kind`, if given), or -1. */
export function nextMarkIndex(marks: ReplayMark[], ms: number, kind?: MarkKind): number {
  return marks.findIndex((m) => m.ms > ms && (!kind || m.kind === kind));
}

/** Index of the last mark strictly before `ms` (of `kind`, if given), or -1. */
export function prevMarkIndex(marks: ReplayMark[], ms: number, kind?: MarkKind): number {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i]!.ms < ms && (!kind || marks[i]!.kind === kind)) return i;
  }
  return -1;
}

/** `m:ss` for a game time; the scrubber and mark list share it. */
export function formatGameMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
