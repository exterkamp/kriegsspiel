/** How the page was asked to run: against a server game, or on the built-in fixture. */
export type SessionParams =
  | { mode: 'fixture' }
  | { mode: 'join'; game: string; side?: string }
  | { mode: 'create'; side?: string; rate?: number };

/**
 * `?game=<id>[&side=red]` joins (taking a free side if you have none); `?new=1[&side=blue][&rate=12]`
 * makes a game first; otherwise the fixture. Who you are comes from the session cookie, not the URL.
 */
export function parseSession(search: string): SessionParams {
  const q = new URLSearchParams(search);
  const game = q.get('game');
  const side = q.get('side') || undefined;
  if (game) return { mode: 'join', game, ...(side ? { side } : {}) };
  if (q.has('new')) {
    const rate = Number(q.get('rate'));
    return {
      mode: 'create',
      ...(side ? { side } : {}),
      ...(Number.isFinite(rate) && rate > 0 ? { rate } : {}),
    };
  }
  return { mode: 'fixture' };
}

/** WebSocket URL on the page's own origin; the dev server proxies `/games` to the API. The cookie authenticates it. */
export function wsUrl(loc: { protocol: string; host: string }, game: string): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/games/${encodeURIComponent(game)}/ws`;
}
