import { TransportError } from '../provider.js';

export type FetchFn = typeof globalThis.fetch;

/** Reads `retry-after-ms` or `retry-after` (seconds) from response headers. */
export function retryAfterMs(headers: Headers): number | undefined {
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const secs = Number(headers.get('retry-after'));
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  return undefined;
}

export const isRetryableStatus = (status: number) =>
  status === 408 || status === 409 || status === 429 || status >= 500;

/** POSTs JSON and returns the parsed body, or throws a `TransportError` with a retry verdict. */
export async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Aborts come from our own timeout; let the client classify them.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new TransportError(err instanceof Error ? err.message : String(err), true);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new TransportError(
      `${res.status}: ${text.slice(0, 300)}`,
      isRetryableStatus(res.status),
      retryAfterMs(res.headers),
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TransportError('response body is not JSON', false);
  }
}

export const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;
