/**
 * Accounts over HTTP (Epic #5, story 5.1):
 *
 *   POST   /auth/login    `{ email }`  mail a one-time login link; always 202 so it does not reveal who has an account
 *   GET    /auth/verify   `?token=`    spend the link, start a session, redirect to `/`
 *   GET    /auth/me                    the signed-in user, or 401
 *   GET    /auth/guest              `{ enabled }`: whether guest play is on
 *   POST   /auth/guest              start a guest session with no email (only when `guestPlay` is on, else 404)
 *   POST   /auth/logout                end this session
 *   DELETE /auth/account               delete the user, their sessions and seats
 *
 * The session is a random id in an HttpOnly, SameSite=Lax cookie (`Secure` when the public URL is
 * https). Only hashes of link tokens and session ids are stored. Login and verify are rate limited.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Mailer } from './mailer.js';
import { RateLimiter } from './rateLimit.js';
import { hashToken, type AuthStore, type User } from './store.js';

export const SESSION_COOKIE = 'ks_session';
export const LOGIN_LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;

export interface AuthOptions {
  store: AuthStore;
  mailer: Mailer;
  /** Origin the login link points at, e.g. `https://kriegsspiel.example`. Its scheme decides the `Secure` cookie flag. */
  publicUrl: string;
  wallNow?: () => number;
  /** Magic links per email per hour (default 5) and per client address per hour (default 20). */
  loginPerEmail?: number;
  loginPerIp?: number;
  /** Guest play (D17c): `POST /auth/guest` makes a guest user. Off by default here; `GUEST_PLAY` turns it on in `main.ts`. */
  guestPlay?: boolean;
  /** Guest sessions last this long unused before the guest and their games are removed (default 7 days). */
  guestIdleMs?: number;
  /** Guests created per client address per hour (default 10). */
  guestPerIp?: number;
  /** Called after a guest signs in with an email, with the games whose seats moved to the account. */
  onGuestAdopted?: (guestId: string, userId: string, gameIds: string[]) => void;
  /** Called after an account is deleted, with the game ids it held seats in. */
  onAccountDeleted?: (userId: string, gameIds: string[]) => void;
  /** Called after a logout, so the server can drop that user's open sockets. */
  onLogout?: (userId: string) => void;
}

export const GUEST_IDLE_MS = 7 * 24 * 3_600_000;

export interface Auth {
  /** The signed-in user for a request, from its session cookie. */
  userOf(req: FastifyRequest): User | undefined;
}

const Login = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export async function authRoutes(server: FastifyInstance, o: AuthOptions): Promise<Auth> {
  const now = o.wallNow ?? Date.now;
  const secure = o.publicUrl.startsWith('https:');
  const perEmail = new RateLimiter(o.loginPerEmail ?? 5, 3_600_000, now);
  const perIp = new RateLimiter(o.loginPerIp ?? 20, 3_600_000, now);
  const perGuestIp = new RateLimiter(o.guestPerIp ?? 10, 3_600_000, now);
  const guestIdleMs = o.guestIdleMs ?? GUEST_IDLE_MS;
  const verifyPerIp = new RateLimiter(30, 15 * 60_000, now);

  const cookie = (value: string, maxAgeS: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;

  const sessionHash = (req: FastifyRequest) => {
    const id = readCookie(req.headers.cookie, SESSION_COOKIE);
    return id ? hashToken(id) : undefined;
  };

  const userOf = (req: FastifyRequest): User | undefined => {
    const hash = sessionHash(req);
    const userId = hash && o.store.getSession(hash, now());
    const user = userId ? o.store.getUser(userId) : undefined;
    // A guest session slides, so "idle" means unused; refreshed at most hourly to spare the store.
    if (user?.guest && hash) {
      const last = lastTouch.get(hash) ?? 0;
      if (now() - last > 3_600_000) {
        lastTouch.set(hash, now());
        o.store.putSession(hash, user.id, now() + guestIdleMs);
      }
    }
    return user;
  };
  const lastTouch = new Map<string, number>();

  const sweep = (): void => {
    o.store.prune(now());
    for (const id of o.store.idleGuests(now())) {
      const games = o.store.deleteUser(id);
      o.onAccountDeleted?.(id, games);
    }
  };
  const timer = setInterval(sweep, 10 * 60_000);
  timer.unref();
  server.addHook('onClose', async () => clearInterval(timer));

  server.get('/auth/guest', async () => ({ enabled: o.guestPlay === true }));

  server.post('/auth/guest', async (req, reply) => {
    if (!o.guestPlay) return reply.code(404).send({ error: 'guest_play_disabled' });
    if (!perGuestIp.hit(req.ip)) {
      return reply.code(429).header('retry-after', '3600').send({ error: 'rate_limited' });
    }
    // Already signed in (guest or not): keep that session rather than minting another account.
    const user = userOf(req) ?? o.store.createGuest(now());
    if (!userOf(req)) {
      const session = randomBytes(32).toString('base64url');
      o.store.putSession(hashToken(session), user.id, now() + guestIdleMs);
      reply.header('set-cookie', cookie(session, guestIdleMs / 1000));
    }
    return reply
      .header('cache-control', 'no-store')
      .send({ id: user.id, email: user.email, guest: user.guest });
  });

  server.post('/auth/login', async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_email' });
    const { email } = body.data;
    if (!perIp.hit(req.ip) || !perEmail.hit(email)) {
      return reply.code(429).header('retry-after', '3600').send({ error: 'rate_limited' });
    }
    const token = randomBytes(32).toString('base64url');
    o.store.putLoginToken(hashToken(token), email, now() + LOGIN_LINK_TTL_MS);
    const link = `${o.publicUrl.replace(/\/$/, '')}/auth/verify?token=${token}`;
    try {
      await o.mailer.sendLoginLink(email, link);
    } catch (e) {
      // Same answer as a sent mail, so a failing gateway does not reveal anything either.
      req.log.error({ err: e }, 'could not send login link');
    }
    return reply.code(202).send({ ok: true });
  });

  server.get<{ Querystring: { token?: string } }>('/auth/verify', async (req, reply) => {
    if (!verifyPerIp.hit(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const token = req.query.token;
    const email =
      typeof token === 'string' ? o.store.consumeLoginToken(hashToken(token), now()) : undefined;
    if (!email) {
      return reply
        .code(400)
        .type('text/plain')
        .send('This login link is invalid, expired or already used. Request a new one.');
    }
    const guest = userOf(req);
    const user = o.store.upsertUser(email, now());
    if (guest?.guest && guest.id !== user.id) {
      const moved = o.store.adoptGuest(guest.id, user.id);
      o.onGuestAdopted?.(guest.id, user.id, moved);
    }
    const session = randomBytes(32).toString('base64url');
    o.store.putSession(hashToken(session), user.id, now() + SESSION_TTL_MS);
    return reply
      .header('set-cookie', cookie(session, SESSION_TTL_MS / 1000))
      .header('cache-control', 'no-store')
      .redirect('/');
  });

  server.get('/auth/me', async (req, reply) => {
    const user = userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    return { id: user.id, email: user.email, guest: user.guest };
  });

  server.post('/auth/logout', async (req, reply) => {
    const hash = sessionHash(req);
    const user = userOf(req);
    if (hash) o.store.deleteSession(hash);
    if (user) o.onLogout?.(user.id);
    return reply.header('set-cookie', cookie('', 0)).code(204).send();
  });

  server.delete('/auth/account', async (req, reply) => {
    const user = userOf(req);
    if (!user) return reply.code(401).send({ error: 'not_signed_in' });
    const games = o.store.deleteUser(user.id);
    o.onAccountDeleted?.(user.id, games);
    return reply.header('set-cookie', cookie('', 0)).code(204).send();
  });

  return { userOf };
}
