/** Web push delivery. The server depends on `PushSender` only; `WebPushSender` is the VAPID implementation. */
import webpush from 'web-push';
import type { PushSubscriptionRecord } from './store.js';

export interface PushSender {
  /** The VAPID public key a browser needs to subscribe. */
  readonly publicKey: string;
  /** `gone` when the browser dropped the subscription (the caller forgets it). Other failures throw. */
  send(sub: PushSubscriptionRecord, payload: string): Promise<'ok' | 'gone'>;
}

export class WebPushSender implements PushSender {
  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async send(sub: PushSubscriptionRecord, payload: string): Promise<'ok' | 'gone'> {
    try {
      await webpush.sendNotification(sub, payload, {
        vapidDetails: {
          subject: this.subject,
          publicKey: this.publicKey,
          privateKey: this.privateKey,
        },
        TTL: 60 * 60,
      });
      return 'ok';
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) return 'gone';
      throw e;
    }
  }
}

/** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a mailto: or https: URL); unset: no web push. */
export function pushFromEnv(env: Record<string, string | undefined>): PushSender | undefined {
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return undefined;
  return new WebPushSender(pub, priv, env.VAPID_SUBJECT?.trim() || 'mailto:admin@localhost');
}
