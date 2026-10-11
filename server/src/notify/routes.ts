/**
 *   GET  /notifications/prefs               signed in: your thresholds, quiet hours and channels
 *   PUT  /notifications/prefs               replace them
 *   GET  /notifications/push                the VAPID public key (`key` is null when web push is off)
 *   POST /notifications/push/subscription   register this browser's push subscription
 *   DELETE /notifications/push/subscription  remove it, body `{ endpoint }`
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../auth/routes.js';
import { THRESHOLDS } from './policy.js';
import type { PushSender } from './push.js';
import type { NotifyStore } from './store.js';

const Minute = z.number().int().min(0).max(1439);

const Prefs = z
  .object({
    threshold: z.enum(THRESHOLDS as [string, ...string[]]),
    push: z.boolean(),
    email: z.boolean(),
    quietHours: z
      .object({
        startMin: Minute,
        endMin: Minute,
        utcOffsetMin: z
          .number()
          .int()
          .min(-14 * 60)
          .max(14 * 60),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Browsers hand out https endpoints on public push-service hosts. Refuse anything else a user could use to
 * aim the server at itself or its network: non-https, IP literals, `localhost` and single-label names. This
 * is not a full SSRF defence: a public name can still resolve to a private address (`web-push` resolves it
 * at send time), so a deployment that cares should also block egress to private ranges.
 */
export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  return host.includes('.') && host !== 'localhost' && !host.endsWith('.localhost');
}

const Subscription = z
  .object({
    endpoint: z.string().max(2048).refine(isPushEndpoint, 'endpoint must be an https push service'),
    keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
  })
  .strict();

/** Most browsers a player may register. */
export const MAX_SUBSCRIPTIONS = 10;

export function notifyRoutes(
  server: FastifyInstance,
  opts: { auth: Auth; store: NotifyStore; push?: PushSender },
): void {
  const user = (req: FastifyRequest) => opts.auth.userOf(req);

  server.get('/notifications/prefs', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(401).send({ error: 'not_signed_in' });
    return opts.store.getPrefs(u.id);
  });

  server.put('/notifications/prefs', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(401).send({ error: 'not_signed_in' });
    const body = Prefs.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const prefs = body.data as Parameters<NotifyStore['setPrefs']>[1];
    opts.store.setPrefs(u.id, prefs);
    return prefs;
  });

  server.get('/notifications/push', async (req, reply) => {
    if (!user(req)) return reply.code(401).send({ error: 'not_signed_in' });
    return { key: opts.push?.publicKey ?? null };
  });

  server.post('/notifications/push/subscription', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(401).send({ error: 'not_signed_in' });
    if (!opts.push) return reply.code(404).send({ error: 'push_unavailable' });
    const body = Subscription.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.message });
    }
    const mine = opts.store.subscriptionsOf(u.id);
    if (!mine.some((s) => s.endpoint === body.data.endpoint) && mine.length >= MAX_SUBSCRIPTIONS) {
      return reply.code(409).send({ error: 'too_many_subscriptions' });
    }
    opts.store.putSubscription(u.id, body.data);
    return reply.code(201).send({ ok: true });
  });

  server.delete('/notifications/push/subscription', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(401).send({ error: 'not_signed_in' });
    const body = z.object({ endpoint: z.string() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    opts.store.removeSubscription(body.data.endpoint, u.id);
    return reply.code(204).send();
  });
}
