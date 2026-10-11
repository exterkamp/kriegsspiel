/** Notification settings and web push subscriptions, per user. Memory for tests; SQLite shares the game database. */
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PREFS, type NotifyPrefs } from './policy.js';

/** A browser's push subscription (the `PushSubscription.toJSON()` shape). */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface NotifyStore {
  getPrefs(userId: string): NotifyPrefs;
  setPrefs(userId: string, prefs: NotifyPrefs): void;
  /** Adds or replaces (by endpoint) a subscription. */
  putSubscription(userId: string, sub: PushSubscriptionRecord): void;
  removeSubscription(endpoint: string, userId?: string): void;
  subscriptionsOf(userId: string): PushSubscriptionRecord[];
  deleteUser(userId: string): void;
  close(): void;
}

export class MemoryNotifyStore implements NotifyStore {
  private readonly prefs = new Map<string, NotifyPrefs>();
  private readonly subs = new Map<string, { userId: string; sub: PushSubscriptionRecord }>();

  getPrefs(userId: string): NotifyPrefs {
    return this.prefs.get(userId) ?? { ...DEFAULT_PREFS };
  }

  setPrefs(userId: string, prefs: NotifyPrefs): void {
    this.prefs.set(userId, prefs);
  }

  putSubscription(userId: string, sub: PushSubscriptionRecord): void {
    this.subs.set(sub.endpoint, { userId, sub });
  }

  removeSubscription(endpoint: string, userId?: string): void {
    const row = this.subs.get(endpoint);
    if (row && (userId === undefined || row.userId === userId)) this.subs.delete(endpoint);
  }

  subscriptionsOf(userId: string): PushSubscriptionRecord[] {
    return [...this.subs.values()].filter((r) => r.userId === userId).map((r) => r.sub);
  }

  deleteUser(userId: string): void {
    this.prefs.delete(userId);
    for (const [e, r] of this.subs) if (r.userId === userId) this.subs.delete(e);
  }

  close(): void {}
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notify_prefs (
    user_id TEXT PRIMARY KEY,
    prefs TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notify_push (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notify_push_user ON notify_push (user_id);
`;

interface Row {
  [column: string]: string | number;
}

export class SqliteNotifyStore implements NotifyStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  getPrefs(userId: string): NotifyPrefs {
    const row = this.db.prepare('SELECT prefs FROM notify_prefs WHERE user_id = ?').get(userId) as
      Row | undefined;
    return row ? (JSON.parse(String(row.prefs)) as NotifyPrefs) : { ...DEFAULT_PREFS };
  }

  setPrefs(userId: string, prefs: NotifyPrefs): void {
    this.db
      .prepare('INSERT OR REPLACE INTO notify_prefs (user_id, prefs) VALUES (?, ?)')
      .run(userId, JSON.stringify(prefs));
  }

  putSubscription(userId: string, sub: PushSubscriptionRecord): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO notify_push (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)',
      )
      .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth);
  }

  removeSubscription(endpoint: string, userId?: string): void {
    if (userId === undefined) {
      this.db.prepare('DELETE FROM notify_push WHERE endpoint = ?').run(endpoint);
    } else {
      this.db
        .prepare('DELETE FROM notify_push WHERE endpoint = ? AND user_id = ?')
        .run(endpoint, userId);
    }
  }

  subscriptionsOf(userId: string): PushSubscriptionRecord[] {
    return (
      this.db
        .prepare('SELECT endpoint, p256dh, auth FROM notify_push WHERE user_id = ?')
        .all(userId) as Row[]
    ).map((r) => ({
      endpoint: String(r.endpoint),
      keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
    }));
  }

  deleteUser(userId: string): void {
    this.db.prepare('DELETE FROM notify_prefs WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM notify_push WHERE user_id = ?').run(userId);
  }

  close(): void {
    this.db.close();
  }
}
