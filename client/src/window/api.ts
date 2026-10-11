import { WindowAt, WindowTimeline } from '@kriegsspiel/protocol';

async function getJson<T>(
  url: string,
  parse: (v: unknown) => T,
  fetchFn: typeof fetch,
): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return parse(await res.json());
}

export const fetchWindowTimeline = (game: string, fetchFn: typeof fetch = fetch) =>
  getJson(`/games/${encodeURIComponent(game)}/window`, (v) => WindowTimeline.parse(v), fetchFn);

export const fetchWindowAt = (
  game: string,
  at: number,
  side?: string,
  fetchFn: typeof fetch = fetch,
) =>
  getJson(
    `/games/${encodeURIComponent(game)}/window/at?at=${Math.round(at)}${side ? `&side=${encodeURIComponent(side)}` : ''}`,
    (v) => WindowAt.parse(v),
    fetchFn,
  );
