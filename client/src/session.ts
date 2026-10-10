/** How the page was asked to run: against a server game, or on the built-in fixture. */
export type SessionParams =
  | { mode: 'fixture' }
  | { mode: 'join'; game: string; token: string }
  | { mode: 'create'; side: string; rate?: number };

/** `?game=<id>&token=<t>` joins; `?new=1[&side=blue][&rate=12]` makes a game first; otherwise the fixture. */
export function parseSession(search: string): SessionParams {
  const q = new URLSearchParams(search);
  const game = q.get('game');
  const token = q.get('token');
  if (game && token) return { mode: 'join', game, token };
  if (q.has('new')) {
    const rate = Number(q.get('rate'));
    return {
      mode: 'create',
      side: q.get('side') || 'blue',
      ...(Number.isFinite(rate) && rate > 0 ? { rate } : {}),
    };
  }
  return { mode: 'fixture' };
}

/** WebSocket URL on the page's own origin; the dev server proxies `/games` to the API. */
export function wsUrl(
  loc: { protocol: string; host: string },
  game: string,
  token: string,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/games/${encodeURIComponent(game)}/ws?token=${encodeURIComponent(token)}`;
}
