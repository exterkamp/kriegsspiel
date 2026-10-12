/**
 * The Notifier (docs/architecture.md). After each tick or command it spots what is new for each seated
 * player and delivers it by the right channel:
 *
 *  - a player with the game open gets a `notification` WebSocket message;
 *  - a player who is away gets web push and/or email, unless it is their quiet hours.
 *
 * Preferences (threshold, quiet hours, channels) are the player's; the text is fixed per event kind.
 */
import { PROTOCOL_VERSION, type ServerMessage } from '@kriegsspiel/protocol';
import type { SideId } from '@kriegsspiel/engine';
import type { GameActor } from '../game/index.js';
import type { Mailer } from '../auth/mailer.js';
import type { AuthStore } from '../auth/store.js';
import { baseline, detect, type Seen } from './detect.js';
import { NOTICE, isQuiet, isUrgent, wanted, type NotifyEvent } from './policy.js';
import type { PushSender } from './push.js';
import type { NotifyStore } from './store.js';

export interface NotifierOptions {
  auth: AuthStore;
  store: NotifyStore;
  mailer: Mailer;
  push?: PushSender;
  /** Origin used in links back to the game. */
  publicUrl: string;
  lookup: (gameId: string) => GameActor | undefined;
  /** Sends to the user's open sockets on `side` in the game; returns how many received it. */
  sendToUser: (gameId: string, userId: string, message: ServerMessage, side: SideId) => number;
  wallNow: () => number;
  /** Least wall time between routine emails to one player about one game. Urgent ones always go. */
  emailEveryMs?: number;
  onError: (gameId: string, error: unknown) => void;
}

export class Notifier {
  private readonly seen = new Map<string, Seen>();
  private readonly lastEmail = new Map<string, number>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly o: NotifierOptions) {}

  /** Look at a game after it changed. Never throws; delivery runs in the background (see `flush`). */
  observe(gameId: string): void {
    const game = this.o.lookup(gameId);
    if (!game) return;
    let events;
    try {
      const prev = this.seen.get(gameId);
      if (!prev) {
        this.seen.set(gameId, baseline(game));
        return;
      }
      const d = detect(prev, game);
      this.seen.set(gameId, d.seen);
      events = d.events;
    } catch (e) {
      this.o.onError(gameId, e);
      return;
    }
    // One delivery per side and kind per look: five contact reports in a tick are one notice.
    const once = new Set<string>();
    for (const { side, event } of events) {
      if (once.has(`${side}\0${event}`)) continue;
      once.add(`${side}\0${event}`);
      const p = this.deliver(gameId, side, event).catch((e) => this.o.onError(gameId, e));
      this.inFlight.add(p);
      void p.finally(() => this.inFlight.delete(p));
    }
  }

  /**
   * A one-off notice to one account about a game (for example, that the host removed them from the room).
   * It goes by push and email when they want those, whatever their threshold, and never names anyone else.
   */
  async notifyUser(gameId: string, userId: string, title: string, text: string): Promise<void> {
    const prefs = this.o.store.getPrefs(userId);
    const url = `${this.o.publicUrl.replace(/\/$/, '')}/?game=${encodeURIComponent(gameId)}`;
    const sends: Promise<unknown>[] = [];
    if (prefs.push && this.o.push) {
      const push = this.o.push;
      const payload = JSON.stringify({ title, body: text, url, tag: `${gameId}:removed` });
      for (const sub of this.o.store.subscriptionsOf(userId)) {
        sends.push(
          push
            .send(sub, payload)
            .then((r) => {
              if (r === 'gone') this.o.store.removeSubscription(sub.endpoint);
            })
            .catch((e) => this.o.onError(gameId, e)),
        );
      }
    }
    const user = this.o.auth.getUser(userId);
    if (prefs.email && user && !user.guest && this.o.mailer.sendNotification) {
      sends.push(
        this.o.mailer.sendNotification(user.email, title, `${text}\n\n${url}`).catch((e) =>
          this.o.onError(gameId, e),
        ),
      );
    }
    const p = Promise.all(sends).then(() => undefined);
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
    await p;
  }

  /** Forget a game that has closed. */
  forget(gameId: string): void {
    this.seen.delete(gameId);
    for (const key of this.lastEmail.keys()) {
      if (key.endsWith(`\0${gameId}`)) this.lastEmail.delete(key);
    }
  }

  /** Resolves when every delivery started so far has finished. */
  async flush(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  private async deliver(gameId: string, side: SideId, event: NotifyEvent): Promise<void> {
    const seat = this.o.auth.seatsOf(gameId).find((s) => s.side === side);
    if (!seat) return;
    const prefs = this.o.store.getPrefs(seat.userId);
    if (!wanted(prefs, event)) return;
    const { title, text } = NOTICE[event];
    const here = this.o.sendToUser(
      gameId,
      seat.userId,
      {
        v: PROTOCOL_VERSION,
        kind: 'notification',
        event,
        title,
        text,
      },
      side,
    );
    if (here > 0) return;
    const now = this.o.wallNow();
    if (isQuiet(prefs.quietHours, now)) return;
    const url = `${this.o.publicUrl.replace(/\/$/, '')}/?game=${encodeURIComponent(gameId)}`;
    const sends: Promise<unknown>[] = [];
    if (prefs.push && this.o.push) {
      const push = this.o.push;
      const payload = JSON.stringify({ title, body: text, url, tag: `${gameId}:${event}` });
      for (const sub of this.o.store.subscriptionsOf(seat.userId)) {
        sends.push(
          push
            .send(sub, payload)
            .then((r) => {
              if (r === 'gone') this.o.store.removeSubscription(sub.endpoint);
            })
            .catch((e) => this.o.onError(gameId, e)),
        );
      }
    }
    if (prefs.email && this.o.mailer.sendNotification) {
      const user = this.o.auth.getUser(seat.userId);
      const key = `${seat.userId}\0${gameId}`;
      const last = this.lastEmail.get(key);
      const limit = this.o.emailEveryMs ?? 60_000;
      if (user && !user.guest && (isUrgent(event) || last === undefined || now - last >= limit)) {
        this.lastEmail.set(key, now);
        sends.push(
          this.o.mailer.sendNotification!(user.email, title, `${text}\n\n${url}`).catch((e) =>
            this.o.onError(gameId, e),
          ),
        );
      }
    }
    await Promise.all(sends);
  }
}
