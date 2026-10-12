/**
 * Account storage: users, magic-link tokens, sessions and game seats.
 *
 * Tokens and session ids are never stored, only their SHA-256 (see `hashToken`), so a copy of the
 * database cannot be used to log in. `MemoryAuthStore` is for tests and for a server with no
 * `DB_PATH`; `SqliteAuthStore` shares the game database file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SideId } from '@kriegsspiel/engine';

export interface User {
  id: string;
  email: string;
  createdAtMs: number;
  /** A guest has no real address (`guest-<id>@guest.invalid`) and is removed when idle (D17c). */
  guest: boolean;
}

export interface AuthStore {
  /** The user with this (already normalised) email, created on first use. */
  upsertUser(email: string, nowMs: number): User;
  /** A new guest user with a placeholder address. */
  createGuest(nowMs: number): User;
  /**
   * Moves the guest's seats to `userId` and deletes the guest. A seat that collides with one the
   * target already holds (same game) is dropped. Returns the game ids that moved.
   */
  adoptGuest(guestId: string, userId: string): string[];
  /** Guests with no live session at `nowMs`. */
  idleGuests(nowMs: number): string[];
  getUser(id: string): User | undefined;
  /** Removes the user, their sessions, pending links and seats. Returns the game ids they held seats in. */
  deleteUser(id: string): string[];
  /** `guestId` is the guest session of the browser that asked for the link (adopted only if still the one at verify, #268). */
  putLoginToken(hash: string, email: string, expiresAtMs: number, guestId?: string): void;
  /** Single use: returns the link once, then nothing. Expired tokens are removed and refused. */
  consumeLoginToken(hash: string, nowMs: number): { email: string; guestId?: string } | undefined;
  putSession(hash: string, userId: string, expiresAtMs: number): void;
  getSession(hash: string, nowMs: number): string | undefined;
  deleteSession(hash: string): void;
  /** Takes a seat. False when another user holds that side, or this user already sits on another side. */
  claimSeat(gameId: string, side: SideId, userId: string): boolean;
  /** Gives up this user's seat in the game. False when they hold none. */
  releaseSeat(gameId: string, userId: string): boolean;
  seatOf(gameId: string, userId: string): SideId | undefined;
  seatsOf(gameId: string): Array<{ side: SideId; userId: string }>;
  /** Ids of the games this user holds a seat in. */
  gamesOf(userId: string): string[];
  /** Drops expired tokens and sessions. */
  prune(nowMs: number): void;
  close(): void;
}

export const guestEmail = (id: string): string => `guest-${id}@guest.invalid`;

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export class MemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, User>();
  private readonly links = new Map<string, { email: string; exp: number; guestId?: string }>();
  private readonly sessions = new Map<string, { userId: string; exp: number }>();
  /** gameId -> side -> userId */
  private readonly seats = new Map<string, Map<SideId, string>>();

  upsertUser(email: string, nowMs: number): User {
    for (const u of this.users.values()) if (u.email === email) return u;
    const user = { id: randomUUID(), email, createdAtMs: nowMs, guest: false };
    this.users.set(user.id, user);
    return user;
  }

  createGuest(nowMs: number): User {
    const id = randomUUID();
    const user = { id, email: guestEmail(id), createdAtMs: nowMs, guest: true };
    this.users.set(id, user);
    return user;
  }

  adoptGuest(guestId: string, userId: string): string[] {
    const moved: string[] = [];
    for (const [gameId, bySide] of this.seats) {
      for (const [side, u] of bySide) {
        if (u !== guestId) continue;
        bySide.delete(side);
        if (this.claimSeat(gameId, side, userId)) moved.push(gameId);
      }
    }
    this.deleteUser(guestId);
    return moved;
  }

  idleGuests(nowMs: number): string[] {
    const live = new Set<string>();
    for (const s of this.sessions.values()) if (s.exp > nowMs) live.add(s.userId);
    return [...this.users.values()].filter((u) => u.guest && !live.has(u.id)).map((u) => u.id);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  deleteUser(id: string): string[] {
    const email = this.users.get(id)?.email;
    this.users.delete(id);
    for (const [h, s] of this.sessions) if (s.userId === id) this.sessions.delete(h);
    if (email) for (const [h, l] of this.links) if (l.email === email) this.links.delete(h);
    const games: string[] = [];
    for (const [gameId, bySide] of this.seats) {
      for (const [side, userId] of bySide) {
        if (userId !== id) continue;
        bySide.delete(side);
        games.push(gameId);
      }
    }
    return games;
  }

  putLoginToken(hash: string, email: string, expiresAtMs: number, guestId?: string): void {
    this.links.set(hash, { email, exp: expiresAtMs, guestId });
  }

  consumeLoginToken(hash: string, nowMs: number): { email: string; guestId?: string } | undefined {
    const link = this.links.get(hash);
    this.links.delete(hash);
    return link && link.exp > nowMs ? { email: link.email, guestId: link.guestId } : undefined;
  }

  putSession(hash: string, userId: string, expiresAtMs: number): void {
    this.sessions.set(hash, { userId, exp: expiresAtMs });
  }

  getSession(hash: string, nowMs: number): string | undefined {
    const s = this.sessions.get(hash);
    if (!s) return undefined;
    if (s.exp <= nowMs) {
      this.sessions.delete(hash);
      return undefined;
    }
    return s.userId;
  }

  deleteSession(hash: string): void {
    this.sessions.delete(hash);
  }

  claimSeat(gameId: string, side: SideId, userId: string): boolean {
    const bySide = this.seats.get(gameId) ?? new Map<SideId, string>();
    const holder = bySide.get(side);
    if (holder !== undefined) return holder === userId;
    for (const u of bySide.values()) if (u === userId) return false;
    bySide.set(side, userId);
    this.seats.set(gameId, bySide);
    return true;
  }

  releaseSeat(gameId: string, userId: string): boolean {
    const side = this.seatOf(gameId, userId);
    if (side === undefined) return false;
    this.seats.get(gameId)?.delete(side);
    return true;
  }

  seatOf(gameId: string, userId: string): SideId | undefined {
    for (const [side, u] of this.seats.get(gameId) ?? []) if (u === userId) return side;
    return undefined;
  }

  seatsOf(gameId: string): Array<{ side: SideId; userId: string }> {
    return [...(this.seats.get(gameId) ?? [])].map(([side, userId]) => ({ side, userId }));
  }

  gamesOf(userId: string): string[] {
    return [...this.seats]
      .filter(([, bySide]) => [...bySide.values()].includes(userId))
      .map(([gameId]) => gameId);
  }

  prune(nowMs: number): void {
    for (const [h, l] of this.links) if (l.exp <= nowMs) this.links.delete(h);
    for (const [h, s] of this.sessions) if (s.exp <= nowMs) this.sessions.delete(h);
  }

  close(): void {}
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_login_tokens (
    hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    guest_id TEXT
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions (user_id);
  CREATE TABLE IF NOT EXISTS auth_seats (
    game_id TEXT NOT NULL,
    side TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (game_id, side),
    UNIQUE (game_id, user_id)
  );
`;

interface Row {
  [column: string]: string | number;
}

/** Account tables in the same SQLite file as the games (own `auth_` tables, created if missing). */
export class SqliteAuthStore implements AuthStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    const cols = this.db.prepare('PRAGMA table_info(auth_users)').all() as Row[];
    if (!cols.some((c) => c.name === 'guest')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN guest INTEGER NOT NULL DEFAULT 0');
    }
    const linkCols = this.db.prepare('PRAGMA table_info(auth_login_tokens)').all() as Row[];
    if (!linkCols.some((c) => c.name === 'guest_id')) {
      this.db.exec('ALTER TABLE auth_login_tokens ADD COLUMN guest_id TEXT');
    }
  }

  createGuest(nowMs: number): User {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO auth_users (id, email, created_at_ms, guest) VALUES (?, ?, ?, 1)')
      .run(id, guestEmail(id), nowMs);
    return { id, email: guestEmail(id), createdAtMs: nowMs, guest: true };
  }

  adoptGuest(guestId: string, userId: string): string[] {
    const seats = this.db
      .prepare('SELECT game_id, side FROM auth_seats WHERE user_id = ?')
      .all(guestId) as Row[];
    const moved: string[] = [];
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM auth_seats WHERE user_id = ?').run(guestId);
      for (const r of seats) {
        if (this.claimSeat(String(r.game_id), String(r.side) as SideId, userId)) {
          moved.push(String(r.game_id));
        }
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.deleteUser(guestId);
    return moved;
  }

  idleGuests(nowMs: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM auth_users WHERE guest = 1 AND id NOT IN
             (SELECT user_id FROM auth_sessions WHERE expires_at_ms > ?)`,
        )
        .all(nowMs) as Row[]
    ).map((r) => String(r.id));
  }

  upsertUser(email: string, nowMs: number): User {
    this.db
      .prepare('INSERT OR IGNORE INTO auth_users (id, email, created_at_ms) VALUES (?, ?, ?)')
      .run(randomUUID(), email, nowMs);
    const row = this.db.prepare('SELECT * FROM auth_users WHERE email = ?').get(email) as Row;
    return toUser(row);
  }

  getUser(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id) as Row | undefined;
    return row && toUser(row);
  }

  deleteUser(id: string): string[] {
    const user = this.getUser(id);
    const games = (
      this.db.prepare('SELECT game_id FROM auth_seats WHERE user_id = ?').all(id) as Row[]
    ).map((r) => String(r.game_id));
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM auth_seats WHERE user_id = ?').run(id);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
      if (user) this.db.prepare('DELETE FROM auth_login_tokens WHERE email = ?').run(user.email);
      this.db.prepare('DELETE FROM auth_users WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return games;
  }

  putLoginToken(hash: string, email: string, expiresAtMs: number, guestId?: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO auth_login_tokens (hash, email, expires_at_ms, guest_id) VALUES (?, ?, ?, ?)',
      )
      .run(hash, email, expiresAtMs, guestId ?? null);
  }

  consumeLoginToken(hash: string, nowMs: number): { email: string; guestId?: string } | undefined {
    // DELETE ... RETURNING is atomic, so two requests cannot both use one link.
    const row = this.db
      .prepare(
        'DELETE FROM auth_login_tokens WHERE hash = ? RETURNING email, expires_at_ms, guest_id',
      )
      .get(hash) as Row | undefined;
    if (!row || Number(row.expires_at_ms) <= nowMs) return undefined;
    return {
      email: String(row.email),
      guestId: row.guest_id == null ? undefined : String(row.guest_id),
    };
  }

  putSession(hash: string, userId: string, expiresAtMs: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO auth_sessions (hash, user_id, expires_at_ms) VALUES (?, ?, ?)',
      )
      .run(hash, userId, expiresAtMs);
  }

  getSession(hash: string, nowMs: number): string | undefined {
    const row = this.db
      .prepare('SELECT user_id, expires_at_ms FROM auth_sessions WHERE hash = ?')
      .get(hash) as Row | undefined;
    if (!row) return undefined;
    if (Number(row.expires_at_ms) <= nowMs) {
      this.deleteSession(hash);
      return undefined;
    }
    return String(row.user_id);
  }

  deleteSession(hash: string): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE hash = ?').run(hash);
  }

  claimSeat(gameId: string, side: SideId, userId: string): boolean {
    const holder = this.db
      .prepare('SELECT user_id FROM auth_seats WHERE game_id = ? AND side = ?')
      .get(gameId, side) as Row | undefined;
    if (holder) return holder.user_id === userId;
    if (this.seatOf(gameId, userId) !== undefined) return false;
    this.db
      .prepare('INSERT INTO auth_seats (game_id, side, user_id) VALUES (?, ?, ?)')
      .run(gameId, side, userId);
    return true;
  }

  releaseSeat(gameId: string, userId: string): boolean {
    const r = this.db
      .prepare('DELETE FROM auth_seats WHERE game_id = ? AND user_id = ?')
      .run(gameId, userId);
    return Number(r.changes) > 0;
  }

  seatOf(gameId: string, userId: string): SideId | undefined {
    const row = this.db
      .prepare('SELECT side FROM auth_seats WHERE game_id = ? AND user_id = ?')
      .get(gameId, userId) as Row | undefined;
    return row ? (String(row.side) as SideId) : undefined;
  }

  seatsOf(gameId: string): Array<{ side: SideId; userId: string }> {
    return (
      this.db.prepare('SELECT side, user_id FROM auth_seats WHERE game_id = ?').all(gameId) as Row[]
    ).map((r) => ({ side: String(r.side) as SideId, userId: String(r.user_id) }));
  }

  gamesOf(userId: string): string[] {
    return (
      this.db.prepare('SELECT game_id FROM auth_seats WHERE user_id = ?').all(userId) as Row[]
    ).map((r) => String(r.game_id));
  }

  prune(nowMs: number): void {
    this.db.prepare('DELETE FROM auth_login_tokens WHERE expires_at_ms <= ?').run(nowMs);
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at_ms <= ?').run(nowMs);
  }

  close(): void {
    this.db.close();
  }
}

const toUser = (r: Row): User => ({
  id: String(r.id),
  email: String(r.email),
  createdAtMs: Number(r.created_at_ms),
  guest: Number(r.guest ?? 0) === 1,
});
