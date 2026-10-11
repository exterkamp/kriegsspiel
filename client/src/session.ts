/** How the page was asked to run: against a server game, or the menu. */
export type SessionParams =
  | { mode: 'join'; game: string; side?: string }
  | { mode: 'create'; side?: string; rate?: number }
  | { mode: 'lobby' }
  | { mode: 'menu' };

/**
 * `?game=<id>[&side=red]` joins (taking a free side if you have none; `side` also picks a hot-seat side);
 * `?new=1[&side=blue][&rate=12]` makes and starts a game at once; `?lobby=1` shows the new-game form and
 * your games; anything else is the main menu. Who you are
 * comes from the session cookie, not the URL.
 */
export function parseSession(search: string): SessionParams {
  const q = new URLSearchParams(search);
  const game = q.get('game');
  const side = q.get('side') || undefined;
  if (game) return { mode: 'join', game, ...(side ? { side } : {}) };
  if (q.has('lobby')) return { mode: 'lobby' };
  if (q.has('new')) {
    const rate = Number(q.get('rate'));
    return {
      mode: 'create',
      ...(side ? { side } : {}),
      ...(Number.isFinite(rate) && rate > 0 ? { rate } : {}),
    };
  }
  return { mode: 'menu' };
}

/** WebSocket URL on the page's own origin; the dev server proxies `/games` to the API. The cookie authenticates it. */
export function wsUrl(
  loc: { protocol: string; host: string },
  game: string,
  side?: string,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = side ? `?side=${encodeURIComponent(side)}` : '';
  return `${scheme}//${loc.host}/games/${encodeURIComponent(game)}/ws${query}`;
}
