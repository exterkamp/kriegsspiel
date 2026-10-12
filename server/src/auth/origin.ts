/** Helpers that keep login redirects and WebSocket upgrades on this site (#208). */

const MAX_NEXT = 512;

/** A backslash or control character, which browsers may read as a path separator or strip. */
function hasUnsafeChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\' || c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * A relative target for after sign-in, or undefined. Only a same-origin path is kept (`/` then a
 * non-slash, no backslash or control characters), re-serialised through `URL` so what is returned
 * is exactly path, query and hash. `/auth/*` is refused so a link cannot loop through login.
 */
export function safeNext(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT) return undefined;
  if (!raw.startsWith('/') || raw.startsWith('//') || hasUnsafeChar(raw)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw, 'http://next.invalid');
  } catch {
    return undefined;
  }
  if (url.origin !== 'http://next.invalid') return undefined;
  if (url.pathname.startsWith('/auth/')) return undefined;
  return url.pathname + url.search + url.hash;
}

/** Normalised `scheme://host[:port]` of a URL, or undefined when it is not one. */
export function originOf(url: string): string | undefined {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? undefined : o;
  } catch {
    return undefined;
  }
}

/**
 * Whether a WebSocket upgrade's `Origin` header is acceptable. No header (a non-browser client)
 * passes: it carries no ambient cookie from another site. Otherwise the origin must be the public
 * origin, the origin the request itself was addressed to (same `Host`, which covers a LAN address
 * and the dev proxy), or one of `allowed`; `*` in `allowed` turns the check off.
 *
 * This defends against cross-site WebSocket hijacking through the session cookie. The `Host` match
 * is only an allowance for LAN and dev-proxy use: a cross-site page cannot forge `Host`, and
 * `X-Forwarded-Host` is deliberately not read.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  publicUrl: string,
  allowed: readonly string[] = [],
): boolean {
  if (origin === undefined) return true;
  if (allowed.includes('*')) return true;
  const o = originOf(origin);
  if (!o) return false;
  if (o === originOf(publicUrl)) return true;
  if (host && new URL(o).host.toLowerCase() === host.toLowerCase()) return true;
  return allowed.some((a) => originOf(a) === o);
}

/** `ALLOWED_ORIGINS`: comma-separated extra origins for WebSocket upgrades; `*` allows any. */
export function allowedOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
